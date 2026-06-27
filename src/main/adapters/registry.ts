// ---------------------------------------------------------------------------
// Adapter registry — the drop-in seam for new agents.
//
// Every agent ("brain") implements the SAME AgentAdapter interface. The registry
// holds the live instances and hands them to the IPC layer by id. Adding Codex
// later is a pure drop-in: implement AgentAdapter, register it here, expose it in
// the shared AGENTS list, done. No other code changes.
// ---------------------------------------------------------------------------

import type { AgentAdapter } from './openclaw-adapter'
import { OpenClawAdapter } from './openclaw-adapter'
import { ClaudeCodeAdapter, type ClaudeCodeDeps } from './claude-code-adapter'

export type AgentKey = AgentAdapter['id']

class AdapterRegistry {
  private adapters = new Map<AgentKey, AgentAdapter>()

  register(adapter: AgentAdapter): void {
    this.adapters.set(adapter.id, adapter)
  }

  get(id: AgentKey): AgentAdapter | undefined {
    return this.adapters.get(id)
  }

  has(id: AgentKey): boolean {
    return this.adapters.has(id)
  }

  /** Replace an adapter (e.g. OpenClaw reconfigured with a new url/token). */
  async replace(adapter: AgentAdapter): Promise<void> {
    const existing = this.adapters.get(adapter.id)
    if (existing) {
      try {
        await existing.disconnect()
      } catch {
        // ignore teardown errors
      }
    }
    this.adapters.set(adapter.id, adapter)
  }

  async disconnectAll(): Promise<void> {
    await Promise.allSettled(
      [...this.adapters.values()].map((a) => a.disconnect()),
    )
  }
}

export const registry = new AdapterRegistry()

// --- Wiring helpers --------------------------------------------------------

/** (Re)build the OpenClaw adapter from the current settings + secret token. */
export function configureOpenClaw(opts: { url: string; token?: string }): void {
  registry.replace(new OpenClawAdapter({ url: opts.url, token: opts.token }))
}

/** Register the Claude Code adapter (deps stay live via getter functions). */
export function configureClaudeCode(deps: ClaudeCodeDeps): void {
  if (!registry.has('claude-code')) {
    registry.register(new ClaudeCodeAdapter(deps))
  }
}

// --- Codex seam (NOT built yet) -------------------------------------------
//
// When the time comes, this is the entire integration:
//
//   import { CodexAdapter } from './codex-adapter'
//   export function configureCodex(opts: { ... }): void {
//     registry.replace(new CodexAdapter(opts))
//   }
//
// ...then add { id: 'codex', label: 'Codex', enabled: true, attachments: true }
// to AGENTS in src/shared/types.ts and call configureCodex() at startup.
