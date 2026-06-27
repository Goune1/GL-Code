// ---------------------------------------------------------------------------
// Shared types — the ONLY thing main, preload and renderer all agree on.
// Pure types + a couple of constants: safe to import from the browser renderer
// (no Node runtime pulled in).
// ---------------------------------------------------------------------------

// The canonical AgentEvent shape comes from the OpenClaw adapter contract.
// Re-declared here (identical) so the renderer never imports a Node module.
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail?: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string }

// Agents available in the selector. "codex" is reserved for the future
// drop-in adapter (seam only — not built yet).
export type AgentId = 'openclaw' | 'claude-code' | 'codex'

export interface AgentDescriptor {
  id: AgentId
  label: string
  /** false = shown in the UI but not yet usable (e.g. codex seam). */
  enabled: boolean
  /** Attachments allowed for this agent. */
  attachments: boolean
}

// Static registry the renderer renders the sidebar from. Kept in sync with the
// main-process adapter registry by name only (main owns the real adapters).
export const AGENTS: AgentDescriptor[] = [
  { id: 'openclaw', label: 'OpenClaw', enabled: true, attachments: true },
  { id: 'claude-code', label: 'Claude Code', enabled: true, attachments: true },
  // Codex seam — appears later when CodexAdapter is registered.
  // { id: 'codex', label: 'Codex', enabled: false, attachments: true },
]


// --- Tunnel ---------------------------------------------------------------

export type TunnelState =
  | 'disabled' // probe-only fallback mode, no SSH tunnel
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'down'

export interface TunnelStatus {
  state: TunnelState
  /** "tunnel" when SSH forward is up, "probe" when fallback port check passed. */
  mode: 'tunnel' | 'probe'
  attempt?: number
  error?: string
  since?: number
}

// --- Settings (non-secret) -------------------------------------------------

export interface SshSettings {
  /** true = open an SSH tunnel; false = fallback "port already open" probe. */
  enabled: boolean
  host: string
  port: number // SSH port (default 22)
  user: string
  keyPath: string // path to private key file on disk
  // Forward localhost:localPort -> remoteHost:remotePort on the VPS.
  localPort: number // default 18789
  remoteHost: string // default 127.0.0.1
  remotePort: number // default 18789
}

export interface OpenClawSettings {
  url: string // ws://127.0.0.1:18789 (local side of the tunnel)
}

export interface ClaudeCodeSettings {
  cwd: string // working directory of the agent (empty = user home)
  model: string // empty = Claude Code CLI default
}

export interface DiscordPresenceSettings {
  enabled: boolean
}

export interface AppSettings {
  ssh: SshSettings
  openclaw: OpenClawSettings
  claudeCode: ClaudeCodeSettings
  discord: DiscordPresenceSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  ssh: {
    enabled: true,
    host: '',
    port: 22,
    user: '',
    keyPath: '',
    localPort: 18789,
    remoteHost: '127.0.0.1',
    remotePort: 18789,
  },
  openclaw: {
    url: 'ws://127.0.0.1:18789',
  },
  claudeCode: {
    cwd: '',
    model: '',
  },
  discord: {
    enabled: true,
  },
}

// Which secrets are currently stored (booleans only — values never leave main).
export interface SecretsPresence {
  gatewayToken: boolean
  sshPassphrase: boolean
  sshPrivateKey: boolean
  anthropicApiKey: boolean
}

export interface SecretsInput {
  gatewayToken?: string
  sshPassphrase?: string
  anthropicApiKey?: string
}

// --- Persistence (conversations + messages) -------------------------------

// A "project" = a working directory on disk (Claude Code workspace).
export interface Project {
  id: string
  name: string
  cwd: string
  createdAt: number
  updatedAt: number
}

export interface Conversation {
  id: string
  agentId: AgentId
  title: string
  sessionKey: string
  sessionStarted: number
  /** Claude Code: the project (cwd) this session is scoped to. */
  projectId: string | null
  /** Claude Code: selected model value (empty = SDK default). */
  model: string
  /** Claude Code: selected effort level (empty = model default). */
  effort: string
  /** Claude Code: context window size ('200k' | '1m'). */
  contextWindow: ContextWindow
  /**
   * git HEAD sha of the project's cwd, snapshotted when the conversation was
   * created. Not used for scoping yet (v1 diffs are working-tree-vs-HEAD,
   * project-wide) — kept so per-turn scoping can be added later without a
   * schema change. Null if the project wasn't a git repo at creation time.
   */
  headShaAtStart: string | null
  createdAt: number
  updatedAt: number
}

// Attachment as displayed/stored (no local path needed for the UI).
export interface StoredAttachment {
  name: string
  mime: string
  /** data: URL for images (preview + chat display). */
  dataUrl?: string
}

export interface StoredMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  tools: { name: string; detail?: unknown }[]
  attachments: StoredAttachment[]
  error?: string
  createdAt: number
}

// Attachment as picked (carries the local path for the adapter to read).
export interface AttachmentRef {
  path: string
  mime: string
  /** data: URL for images, filled at pick time for instant preview. */
  dataUrl?: string
}

// Read-only filesystem entry (project tree).
export interface FsEntry {
  name: string
  /** Path relative to the project root (POSIX-style separators). */
  path: string
  type: 'dir' | 'file'
}

export interface FilePreview {
  path: string
  content: string
  truncated: boolean
  tooLarge: boolean
}

export interface ShellRunResult {
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
}

// Model option surfaced to the UI (mapped from the SDK's ModelInfo).
export interface ModelOption {
  value: string
  displayName: string
  supportsEffort: boolean
  effortLevels: string[]
}

// Context window size for Claude Code conversations.
// '1m' is activated via the SDK 'context-1m-2025-08-07' beta (Sonnet 4/4.5 only).
export type ContextWindow = '200k' | '1m'

// Slash command surfaced to the UI (mapped from the SDK's SlashCommand). These
// are the built-in Claude Code commands (e.g. /goal, /loop), fetched live via
// the SDK and offered as an autocomplete menu when typing "/" in the composer.
export interface SlashCommandInfo {
  /** Command name without the leading slash. */
  name: string
  description: string
  /** Hint for arguments (e.g. "[interval] [prompt]"); may be empty. */
  argumentHint: string
  /** Alternate names that resolve to the same command. */
  aliases?: string[]
}

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

// Claude Code permission mode (composer pill). SAFE default = 'default' (prompts
// before any non-read-only tool). 'bypassPermissions' = exécution directe.
export type PermissionMode = 'default' | 'bypassPermissions'

export interface PermissionRequest {
  requestId: string
  toolName: string
  title?: string
  description?: string
  input: Record<string, unknown>
}

export interface PermissionResponse {
  requestId: string
  approved: boolean
}

// Claude Code auth state surfaced to the UI.
export interface ClaudeAuthStatus {
  ok: boolean
  method: 'cli' | 'apiKey' | 'none'
  message?: string
}

export interface PresenceActivity {
  agentId: AgentId
  agentLabel?: string
  workspaceName?: string
  workspaceCwd?: string
}

// --- Version control (git + gh) --------------------------------------------
// Read-only status for the active project's working directory. git is the
// SOLE source of truth for diffs/changes — never derived from SDK tool events.

export interface GhStatus {
  /** gh CLI found on PATH. */
  installed: boolean
  /** `gh auth status` exited 0 (only meaningful when installed). */
  authenticated: boolean
  /** Logged-in account, parsed from `gh auth status`, when available. */
  account?: string
}

export interface GitStatus {
  /** False if the project's cwd is not inside a git repo. */
  isRepo: boolean
  /** Current branch name, or null if detached/not a repo. */
  branch: string | null
  hasUncommittedChanges: boolean
  /** Commits ahead/behind the upstream tracking branch (0 if no upstream). */
  ahead: number
  behind: number
  hasUpstream: boolean
  hasRemote: boolean
  gh: GhStatus
}

// --- Modification review (Phase 2) — git is the source of truth -----------
// Scope v1: working tree vs HEAD, untracked files included. Read-only.

export type ChangedFileStatus = 'modified' | 'added' | 'deleted' | 'untracked'

export interface ChangedFile {
  /** Repo-relative path, POSIX-style separators. */
  path: string
  status: ChangedFileStatus
  additions: number
  deletions: number
  binary: boolean
}

export interface FileDiff {
  path: string
  status: ChangedFileStatus
  binary: boolean
  /** Unified diff text (empty when binary). */
  diffText: string
}

// --- Push + PR (Phase 4) — remote writes, explicit confirmation required ----

export interface GitPushResult {
  branch: string
  remote: string
  /** True when --set-upstream was used (first push of this branch). */
  setUpstream: boolean
}

export interface GhPrResult {
  /** Pull request URL returned by `gh pr create`. */
  url: string
}

export interface CommitInfo {
  hash: string
  subject: string
  body: string
}

// --- Commit (Phase 3) — local write, git is the source of truth -----------
// Staging + commit are the ONLY writes in Phase 3. Each requires an explicit
// user confirmation (the Commit button in the modal is that confirmation).

export interface CommitResult {
  /** Short commit hash. */
  hash: string
  /** Branch the commit landed on. */
  branch: string
  /** Number of files staged + committed. */
  filesCommitted: number
}

// --- IPC payloads ----------------------------------------------------------

export interface AgentStreamMessage {
  streamId: string
  event: AgentEvent
}

export interface SendResult {
  streamId: string
}
