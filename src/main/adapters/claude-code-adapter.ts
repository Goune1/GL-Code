// ---------------------------------------------------------------------------
// ClaudeCodeAdapter — same AgentAdapter contract as OpenClaw, backed by the
// Claude Agent SDK (@anthropic-ai/claude-agent-sdk, verified against v0.3.x).
//
// SDK shape (from its .d.ts, not guessed):
//   query({ prompt, options }) -> async iterable of SDKMessage
//   - includePartialMessages:true  -> {type:'stream_event'} carrying text deltas
//   - {type:'assistant'} carries the full BetaMessage (tool_use blocks, errors)
//   - {type:'result'}    terminal (subtype 'success' | 'error_*', is_error)
//
// Permissions: this is a personal, single-user app — Claude runs tools without
// prompting (permissionMode 'bypassPermissions'). No interactive approval UI.
//
// Mapping to AgentEvent:
//   text delta            -> {type:'text'}
//   tool_use block        -> {type:'tool', name, detail:input}
//   result / end of turn  -> {type:'done'}
//   auth / result errors  -> {type:'error'}
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  query as QueryFn,
  Options,
  SDKUserMessage,
  ModelInfo,
  SlashCommand,
  SdkBeta,
} from '@anthropic-ai/claude-agent-sdk'
import type { AgentAdapter, AgentEvent, Attachment, SendOpts } from './openclaw-adapter'

// In packaged builds, binaries live in app.asar.unpacked (not inside the asar
// archive, which the OS cannot execute). Rewrite the asar path to unpacked so
// child_process.spawn resolves the real file. Returns undefined in dev so the
// SDK finds the exe itself via normal module resolution.
function resolveClaudeExePath(): string | undefined {
  if (!app.isPackaged) return undefined
  const appPath = app.getAppPath() // …/resources/app.asar
  const exePath = join(
    appPath.replace('app.asar', 'app.asar.unpacked'),
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk-win32-x64',
    'claude.exe',
  )
  return existsSync(exePath) ? exePath : undefined
}

// The SDK ships ESM-only (sdk.mjs). Our main process loads as CommonJS
// (Electron's static ESM import of the 'electron' built-in is broken under
// this Electron/Node combo — see electron.vite.config.ts), so a static
// `import { query } from '@anthropic-ai/claude-agent-sdk'` would fail with
// ERR_REQUIRE_ESM. Load it lazily via dynamic import instead, cached after
// the first call.
let sdkPromise: Promise<{ query: typeof QueryFn }> | undefined
function loadSdk(): Promise<{ query: typeof QueryFn }> {
  if (!sdkPromise) sdkPromise = import('@anthropic-ai/claude-agent-sdk')
  return sdkPromise
}

export interface PermissionAsk {
  toolName: string
  title?: string
  description?: string
  input: Record<string, unknown>
}

export interface ClaudeCodeDeps {
  /** Fresh cwd/model each send so settings changes apply immediately. */
  getCwd: () => string
  getModel: () => string
  /** Stored Anthropic API key (optional; otherwise CLI/Pro login is used). */
  getApiKey: () => string | undefined
  /** Ask the UI to approve a non-read-only tool (used in 'default' mode). */
  requestPermission: (ask: PermissionAsk) => Promise<boolean>
}

// Tools that never need approval (read-only). Everything else prompts in
// 'default' permission mode.
const READONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'LS'])

function credentialsPath(): string {
  return join(homedir(), '.claude', '.credentials.json')
}

/** Detect what auth is available. Never throws. */
export function detectAuth(apiKey: string | undefined): {
  ok: boolean
  method: 'cli' | 'apiKey' | 'none'
} {
  if (apiKey || process.env.ANTHROPIC_API_KEY) return { ok: true, method: 'apiKey' }
  if (existsSync(credentialsPath())) return { ok: true, method: 'cli' }
  return { ok: false, method: 'none' }
}

const AUTH_HELP =
  "Aucune authentification Claude détectée. Connecte-toi avec « claude login » " +
  '(compte Claude Pro), ou renseigne une clé ANTHROPIC_API_KEY dans les Réglages.'

/**
 * Fetch the models the SDK/CLI offers, via Query.supportedModels(). We spawn a
 * query with a gated prompt that never yields a turn, ask for the model list,
 * then abort. Times out with an empty result so the UI can fall back.
 */
export async function fetchSupportedModels(apiKey: string | undefined): Promise<ModelInfo[]> {
  const ac = new AbortController()
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    await gate // never yields — keeps the session open until released
  }
  const claudeExe = resolveClaudeExePath()
  const { query } = await loadSdk()
  const q = query({
    prompt: prompt(),
    options: {
      abortController: ac,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      env: apiKey ? { ...process.env, ANTHROPIC_API_KEY: apiKey } : process.env,
      ...(claudeExe ? { pathToClaudeCodeExecutable: claudeExe } : {}),
    },
  })
  try {
    const timeout = new Promise<ModelInfo[]>((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), 20_000),
    )
    return await Promise.race([q.supportedModels(), timeout])
  } finally {
    release()
    ac.abort()
  }
}

/**
 * Fetch the built-in slash commands the SDK/CLI offers (e.g. /goal, /loop), via
 * Query.supportedCommands(). Same gated-prompt-then-abort pattern as
 * fetchSupportedModels. Uses settingSources:[] so the list matches what send()
 * (also isolated) can actually run. Times out with an empty result.
 */
export async function fetchSupportedCommands(apiKey: string | undefined): Promise<SlashCommand[]> {
  const ac = new AbortController()
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  async function* prompt(): AsyncGenerator<SDKUserMessage> {
    await gate // never yields — keeps the session open until released
  }
  const claudeExe = resolveClaudeExePath()
  const { query } = await loadSdk()
  const q = query({
    prompt: prompt(),
    options: {
      abortController: ac,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      env: apiKey ? { ...process.env, ANTHROPIC_API_KEY: apiKey } : process.env,
      ...(claudeExe ? { pathToClaudeCodeExecutable: claudeExe } : {}),
    },
  })
  try {
    const timeout = new Promise<SlashCommand[]>((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), 20_000),
    )
    return await Promise.race([q.supportedCommands(), timeout])
  } finally {
    release()
    ac.abort()
  }
}

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code' as const
  private deps: ClaudeCodeDeps
  private abort?: AbortController

  constructor(deps: ClaudeCodeDeps) {
    this.deps = deps
  }

  async connect(): Promise<void> {
    // No persistent connection: the SDK spawns the CLI per query.
  }

  async disconnect(): Promise<void> {
    this.abort?.abort()
  }

  /** Interrupt the in-flight query (wired to agent:cancel). */
  cancel(): void {
    this.abort?.abort()
  }

  private buildCanUseTool() {
    return async (
      toolName: string,
      input: Record<string, unknown>,
      ctx: { title?: string; description?: string },
    ) => {
      if (READONLY_TOOLS.has(toolName)) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
      const approved = await this.deps.requestPermission({
        toolName,
        title: ctx.title,
        description: ctx.description,
        input,
      })
      return approved
        ? { behavior: 'allow' as const, updatedInput: input }
        : { behavior: 'deny' as const, message: "Refusé par l'utilisateur." }
    }
  }

  // Build the SDK prompt as a single streaming user message. Streaming input is
  // REQUIRED for the canUseTool control channel (permission prompts); plain text
  // goes as a text content block, attachments as image/document/text blocks.
  private buildPrompt(text: string, attachments?: Attachment[]): AsyncGenerator<SDKUserMessage> {
    const blocks: Array<Record<string, unknown>> = [{ type: 'text', text }]
    for (const a of attachments ?? []) {
      const name = a.path.split(/[\\/]/).pop() ?? a.path
      if (a.mime.startsWith('image/')) {
        blocks.push({
          type: 'image',
          source: { type: 'base64', media_type: a.mime, data: readFileSync(a.path).toString('base64') },
        })
      } else if (a.mime === 'application/pdf') {
        blocks.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: readFileSync(a.path).toString('base64') },
        })
      } else if (a.mime.startsWith('text/') || a.mime === 'application/json') {
        // Text-like files: inline the content (most reliable across models).
        const content = readFileSync(a.path, 'utf8')
        blocks.push({ type: 'text', text: `\n\n--- Fichier joint : ${name} ---\n${content}` })
      } else {
        // Unknown binary: best-effort document block.
        blocks.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: a.mime || 'application/octet-stream',
            data: readFileSync(a.path).toString('base64'),
          },
        })
      }
    }

    async function* gen(): AsyncGenerator<SDKUserMessage> {
      yield {
        type: 'user',
        parent_tool_use_id: null,
        // content blocks; cast since our local type is intentionally loose.
        message: { role: 'user', content: blocks as never },
      }
    }
    return gen()
  }

  async *send(
    text: string,
    attachments?: Attachment[],
    opts?: SendOpts,
  ): AsyncIterable<AgentEvent> {
    const apiKey = this.deps.getApiKey()
    const auth = detectAuth(apiKey)
    if (!auth.ok) {
      yield { type: 'error', message: AUTH_HELP }
      return
    }

    this.abort = new AbortController()
    // Project cwd (from opts) takes priority over the global setting.
    const cwd = opts?.cwd || this.deps.getCwd() || homedir()
    const model = opts?.model || this.deps.getModel() || ''
    const effort = opts?.effort
    const contextWindow = opts?.contextWindow ?? '200k'
    const sessionKey = opts?.sessionKey

    // 1M context window requires the 'context-1m-2025-08-07' beta flag.
    // Documented as Sonnet 4/4.5 only per SDK; passes for other models at
    // the caller's risk — controlled via ModelConfig.supports1M in the UI.
    const betas: SdkBeta[] = contextWindow === '1m' ? ['context-1m-2025-08-07'] : []

    // SAFE default: 'default' prompts (via canUseTool) before non-read-only
    // tools. 'bypassPermissions' = exécution directe (no prompt).
    const bypass = opts?.permissionMode === 'bypassPermissions'

    const options: Options = {
      cwd,
      includePartialMessages: true,
      permissionMode: bypass ? 'bypassPermissions' : 'default',
      ...(bypass
        ? { allowDangerouslySkipPermissions: true }
        : { canUseTool: this.buildCanUseTool() }),
      // Isolation: don't load ~/.claude settings so OUR policy governs approvals.
      settingSources: [],
      abortController: this.abort,
      // Per-conversation session continuity: use the conversation's UUID as the
      // SDK session id on the first turn, then resume it on later turns.
      ...(sessionKey
        ? opts?.sessionStarted
          ? { resume: sessionKey }
          : { sessionId: sessionKey }
        : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort: effort as Options['effort'] } : {}),
      ...(betas.length > 0 ? { betas } : {}),
      // Inject the API key only if the user provided one; otherwise the spawned
      // CLI uses the existing Claude Pro login from ~/.claude/.credentials.json.
      env: apiKey ? { ...process.env, ANTHROPIC_API_KEY: apiKey } : process.env,
    }

    const claudeExe = resolveClaudeExePath()
    if (claudeExe) options.pathToClaudeCodeExecutable = claudeExe

    try {
      const { query } = await loadSdk()
      for await (const msg of query({ prompt: this.buildPrompt(text, attachments), options })) {
        if (msg.type === 'stream_event') {
          // Incremental text deltas.
          const ev = msg.event as {
            type?: string
            delta?: { type?: string; text?: string }
          }
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            if (ev.delta.text) yield { type: 'text', text: ev.delta.text }
          }
        } else if (msg.type === 'assistant') {
          if (msg.error) {
            yield { type: 'error', message: mapAssistantError(msg.error) }
          }
          // Surface tool calls as distinct blocks (text already streamed above).
          const content = (msg.message?.content ?? []) as Array<{
            type: string
            name?: string
            input?: unknown
          }>
          for (const block of content) {
            if (block.type === 'tool_use') {
              yield { type: 'tool', name: block.name ?? 'tool', detail: block.input }
            }
          }
        } else if (msg.type === 'system') {
          // Local slash commands (e.g. /usage, /context) don't run a model turn;
          // they emit their result as a system 'local_command_output' message.
          // Surface that text so the user sees the command's output in the chat.
          const sys = msg as { subtype?: string; content?: string }
          if (sys.subtype === 'local_command_output' && sys.content) {
            yield { type: 'text', text: sys.content }
          }
        } else if (msg.type === 'result') {
          if (msg.is_error || msg.subtype !== 'success') {
            // SDKResultError carries errors:string[] with the actual reason.
            // SDKResultSuccess carries result:string. Check both.
            const errMsg = msg as unknown as { errors?: string[]; result?: string }
            const detail =
              errMsg.errors?.length
                ? errMsg.errors.join('\n')
                : errMsg.result || `Échec (${msg.subtype}).`
            console.error('[claude-code] result error', msg.subtype, errMsg.errors)
            yield { type: 'error', message: detail }
          }
          yield { type: 'done' }
          return
        }
      }
      // Stream ended without an explicit result.
      yield { type: 'done' }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // Abort is a user cancel, not an error to shout about.
      if (this.abort?.signal.aborted) {
        yield { type: 'done' }
        return
      }
      yield { type: 'error', message }
    }
  }
}

function mapAssistantError(error: string): string {
  switch (error) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
      return AUTH_HELP
    case 'billing_error':
      return 'Erreur de facturation Claude (crédits/abonnement).'
    case 'rate_limit':
      return 'Limite de débit atteinte. Réessaie dans un moment.'
    case 'overloaded':
      return 'Service Claude surchargé. Réessaie.'
    case 'model_not_found':
      return 'Modèle introuvable — vérifie le réglage « modèle » de Claude Code.'
    default:
      return `Erreur Claude: ${error}`
  }
}
