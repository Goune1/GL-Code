// ---------------------------------------------------------------------------
// Adaptateur OpenClaw pour ton app unifiée.
//
// Idee: chaque "cerveau" (OpenClaw, Claude Code, Codex) implemente la meme
// interface AgentAdapter. Ton UI ne connait que cette interface, et un selecteur
// choisit l'adaptateur. Separation nette, fenetre de chat partagee.
//
// Prerequis topologie (gateway sur VPS):
//   Ouvre un tunnel SSH AVANT de te connecter, pour que le gateway te voie en
//   loopback (= connexion locale = auto-approve, pas de pairing de device):
//     ssh -N -L 18789:127.0.0.1:18789 user@ton-vps
//   Puis l'adaptateur se connecte a ws://127.0.0.1:18789.
//   Tu peux aussi spawn ce tunnel depuis Node (child_process) et le superviser,
//   mais commence a la main pour valider la connexion d'abord.
// ---------------------------------------------------------------------------

// npm i openclaw-node   (Node 22+ : WebSocket natif. Node 20-21 : npm i ws aussi)
// Lib communautaire, a vetter. Verifie qu'elle parle le meme protocole que TON
// gateway (le protocole est a v4 ; un client qui cible une version trop vieille
// se fait fermer la socket avec une erreur de protocol mismatch).
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { OpenClawClient, type ChatAttachment } from "openclaw-node";

// --- Interface commune aux trois adaptateurs --------------------------------

export type AgentEvent =
  | { type: "text"; text: string }        // delta de texte a streamer dans la bulle
  | { type: "tool"; name: string; detail?: unknown } // tool call de l'agent
  | { type: "done" }                      // fin du run
  | { type: "error"; message: string };

export interface Attachment {
  path: string; // chemin local du fichier a envoyer
  mime: string; // ex: "image/png", "application/pdf"
}

// Optionnel et additif (phase 3): mappe l'envoi a une session backend continue.
// sessionStarted = false au tout premier tour d'une conversation.
export interface SendOpts {
  sessionKey?: string;
  sessionStarted?: boolean;
  // Claude Code only (ignored by OpenClaw): per-conversation model + effort.
  model?: string;
  effort?: string;
  // Claude Code only: working directory of the active project.
  cwd?: string;
  // Claude Code only: "default" prompts before tools, "bypassPermissions" runs directly.
  permissionMode?: "default" | "bypassPermissions";
  // Claude Code only: '200k' (default) or '1m' context window.
  contextWindow?: '200k' | '1m';
}

export interface AgentAdapter {
  readonly id: "openclaw" | "claude-code" | "codex";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  // Envoie un message et stream les events de la reponse.
  send(
    text: string,
    attachments?: Attachment[],
    opts?: SendOpts,
  ): AsyncIterable<AgentEvent>;
}

// --- Adaptateur OpenClaw ----------------------------------------------------

export interface OpenClawOptions {
  url?: string;   // defaut ws://127.0.0.1:18789 (cote local du tunnel SSH)
  token?: string; // OPENCLAW_GATEWAY_TOKEN si configure cote gateway
}

function encodedSize(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

function attachmentType(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "file";
}

export class OpenClawAdapter implements AgentAdapter {
  readonly id = "openclaw" as const;
  private client: OpenClawClient;
  private connected = false;
  private defaultAgentId?: string;
  private gatewayMaxPayloadBytes = 5 * 1024 * 1024;

  constructor(opts: OpenClawOptions = {}) {
    this.client = new OpenClawClient({
      url: opts.url ?? "ws://127.0.0.1:18789",
      token: opts.token ?? process.env.OPENCLAW_GATEWAY_TOKEN,
      // autoReconnect: true est le defaut de la lib
    });
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const helloOk = await this.client.connect();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.defaultAgentId = (helloOk.snapshot as any)?.sessionDefaults?.defaultAgentId as string | undefined;
    if (Number.isFinite(helloOk.policy?.maxPayload) && helloOk.policy.maxPayload > 0) {
      this.gatewayMaxPayloadBytes = helloOk.policy.maxPayload;
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.client.disconnect();
    this.connected = false;
  }

  async *send(
    text: string,
    attachments?: Attachment[],
    opts?: SendOpts,
  ): AsyncIterable<AgentEvent> {
    if (!this.connected) await this.connect();

    try {
      const openClawAttachments = this.toOpenClawAttachments(attachments ?? [], text);
      const stream = this.client.chat(text, {
        agentId: this.defaultAgentId,
        sessionKey: opts?.sessionKey,
        ...(openClawAttachments.length ? { attachments: openClawAttachments } : {}),
      });
      for await (const chunk of stream) {
        if (chunk.type === "text") {
          yield { type: "text", text: chunk.text };
        } else if (chunk.type === "done") {
          yield { type: "done" };
        } else if (chunk.type === "error") {
          yield { type: "error", message: chunk.text };
        }
        // CONFIRM: mapper ici les chunks de tool call si la lib les expose,
        // sinon ils arrivent juste fondus dans le texte.
      }
    } catch (err) {
      yield {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private toOpenClawAttachments(attachments: Attachment[], text: string): ChatAttachment[] {
    if (attachments.length === 0) return [];

    // openclaw-node sends attachments inline in the JSON RPC payload as base64.
    // Stay below the gateway payload budget to avoid closing the websocket.
    const budget = Math.floor(this.gatewayMaxPayloadBytes * 0.85);
    let estimated = encodedSize(Buffer.byteLength(text, "utf8")) + 512;

    const stats = attachments.map((attachment) => {
      const stat = statSync(attachment.path);
      estimated += encodedSize(stat.size) + attachment.path.length + attachment.mime.length + 256;
      return { attachment, size: stat.size };
    });

    if (estimated > budget) {
      const mb = (budget / 1024 / 1024).toFixed(1);
      throw new Error(
        `Pieces jointes OpenClaw trop volumineuses pour ce gateway (limite estimee ${mb} MB).`,
      );
    }

    return stats.map(({ attachment }) => ({
      type: attachmentType(attachment.mime),
      mimeType: attachment.mime,
      fileName: basename(attachment.path),
      content: readFileSync(attachment.path).toString("base64"),
    }));
  }
}

// --- Les deux autres adaptateurs, meme interface (a remplir ensuite) --------
//
// export class ClaudeCodeAdapter implements AgentAdapter {
//   readonly id = "claude-code" as const;
//   // wrappe @anthropic-ai/claude-agent-sdk : query() / ClaudeSDKClient,
//   // stream-json, --resume pour les sessions, content blocks pour les images.
//   ...
// }
//
// export class CodexAdapter implements AgentAdapter {
//   readonly id = "codex" as const;
//   // wrappe @openai/codex-sdk : startThread() / thread.run(), resumeThread(),
//   // images via le flag -i en mode exec.
//   ...
// }
