// ---------------------------------------------------------------------------
// IPC layer — the typed bridge between the renderer (pure UI) and the main
// process (all Node logic). Streaming is event-driven and incremental: each
// AgentEvent is forwarded to the renderer the moment the adapter yields it, via
// webContents.send — never one awaited blob.
// ---------------------------------------------------------------------------

import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import type { AppSettings, SecretsInput, ClaudeAuthStatus } from '../shared/types'
import { getSettings, saveSettings } from './settings'
import {
  secretsPresence,
  applySecrets,
  importKeyFromPath,
  getSecret,
} from './secrets'
import { registry, configureOpenClaw, configureClaudeCode } from './adapters/registry'
import {
  detectAuth,
  fetchSupportedModels,
  fetchSupportedCommands,
} from './adapters/claude-code-adapter'
import { fsListDir, fsReadFile, fsStat } from './fsapi'
import { shellRun } from './shellapi'
import { getGitStatus, getChangedFiles, getFileDiff, getHeadSha, gitCommit, gitPush, getCommitsSinceUpstream, ghCreatePr } from './git'
import { tunnel } from './tunnel'
import { discordPresence } from './discord-presence'
import {
  listConversations,
  getConversation,
  createConversation,
  renameConversation,
  deleteConversation,
  setConversationSettings,
  getMessages,
  addMessage,
  markSessionStarted,
  listProjects,
  getProject,
  createProject,
  deleteProject,
  listConversationsByProject,
} from './db'
import type {
  AgentId,
  ModelOption,
  SlashCommandInfo,
  StoredAttachment,
  AttachmentRef,
  PresenceActivity,
} from '../shared/types'
import { extname } from 'node:path'
import { readFileSync } from 'node:fs'

// Active streams: streamId -> cancel flag.
const activeStreams = new Map<string, { cancelled: boolean }>()

// Pending Claude Code permission prompts: requestId -> resolver.
const pendingPermissions = new Map<string, (approved: boolean) => void>()

// Cached Claude Code model list (fetched once via the SDK).
let modelsCache: ModelOption[] | null = null

// Cached Claude Code slash command list (fetched once via the SDK).
let commandsCache: SlashCommandInfo[] | null = null

// Used only if the SDK call fails — a minimal set of well-known built-ins so the
// "/" menu is never empty. The live SDK list is always preferred.
const FALLBACK_COMMANDS: SlashCommandInfo[] = [
  { name: 'goal', description: 'Set a goal — keep working until the condition is met', argumentHint: '' },
  { name: 'loop', description: 'Run a prompt or slash command on a recurring interval', argumentHint: '[interval] [prompt]' },
  { name: 'compact', description: 'Free up context by summarizing the conversation so far', argumentHint: '' },
  { name: 'clear', description: 'Start a new session with empty context', argumentHint: '[name]' },
  { name: 'context', description: 'Show current context usage', argumentHint: '' },
  { name: 'usage', description: 'Show session cost and plan usage', argumentHint: '' },
  { name: 'init', description: 'Initialize a new CLAUDE.md file with codebase documentation', argumentHint: '' },
  { name: 'review', description: 'Review a GitHub pull request', argumentHint: '[pr number]' },
  { name: 'code-review', description: 'Review the current diff for bugs and cleanups', argumentHint: '[low|medium|high|max] [--fix]' },
  { name: 'security-review', description: 'Security review of the pending changes on the current branch', argumentHint: '' },
]

const FALLBACK_MODELS: ModelOption[] = [
  { value: 'default', displayName: 'Default (recommandé)', supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'max'] },
  { value: 'opus', displayName: 'Opus', supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'sonnet', displayName: 'Sonnet', supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'max'] },
  { value: 'haiku', displayName: 'Haiku', supportsEffort: false, effortLevels: [] },
]

const AUTH_HELP =
  "Aucune authentification Claude détectée. Connecte-toi avec « claude login » " +
  '(compte Claude Pro), ou renseigne une clé ANTHROPIC_API_KEY dans les Réglages.'

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

/** Push a permission prompt to the UI and await the user's decision. */
function requestPermissionFromUI(ask: {
  toolName: string
  title?: string
  description?: string
  input: Record<string, unknown>
}): Promise<boolean> {
  const requestId = randomUUID()
  return new Promise<boolean>((resolve) => {
    pendingPermissions.set(requestId, resolve)
    broadcast('agent:permission', { requestId, ...ask })
  })
}

/** (Re)build the OpenClaw adapter from current settings + stored token. */
export function reconfigureOpenClaw(): void {
  const cfg = getSettings()
  configureOpenClaw({ url: cfg.openclaw.url, token: getSecret('gatewayToken') })
}

/** Register the Claude Code adapter (its deps read live state via getters). */
export function reconfigureClaudeCode(): void {
  configureClaudeCode({
    getCwd: () => getSettings().claudeCode.cwd,
    getModel: () => getSettings().claudeCode.model,
    getApiKey: () => getSecret('anthropicApiKey'),
    requestPermission: requestPermissionFromUI,
  })
}

export function reconfigureDiscordPresence(): void {
  discordPresence.configure(getSettings().discord)
}

export function registerIpc(): void {
  // --- Shell (open URLs in system browser) -------------------------------
  // Only http/https — no file:// or javascript: shenanigans.
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.handle('shell:run', (_e, projectId: string, command: string) =>
    shellRun(projectId, command),
  )

  // --- Settings ----------------------------------------------------------
  ipcMain.handle('settings:get', () => getSettings())

  ipcMain.handle('settings:set', async (_e, next: AppSettings) => {
    const saved = saveSettings(next)
    reconfigureOpenClaw()
    reconfigureDiscordPresence()
    // Settings can change SSH params or url — restart the tunnel.
    await tunnel.start()
    return saved
  })

  ipcMain.handle('presence:updateActivity', (_e, activity: PresenceActivity) => {
    discordPresence.setActivity(activity)
    return true
  })

  // --- Secrets -----------------------------------------------------------
  ipcMain.handle('secrets:presence', () => secretsPresence())

  ipcMain.handle('secrets:set', async (_e, input: SecretsInput) => {
    applySecrets(input)
    // Token may have changed -> rebuild OpenClaw adapter.
    reconfigureOpenClaw()
    return secretsPresence()
  })

  ipcMain.handle('secrets:importKey', async (_e, path: string) => {
    importKeyFromPath(path)
    return secretsPresence()
  })

  ipcMain.handle('dialog:pickKey', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choisir la clé privée SSH',
      properties: ['openFile', 'showHiddenFiles'],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  // --- Tunnel ------------------------------------------------------------
  ipcMain.handle('tunnel:status', () => tunnel.getStatus())
  ipcMain.handle('tunnel:restart', async () => {
    await tunnel.restart()
    return tunnel.getStatus()
  })

  // --- Projects (Claude Code workspaces) ---------------------------------
  ipcMain.handle('project:list', () => listProjects())
  ipcMain.handle('project:add', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Ajouter un projet (dossier)',
      properties: ['openDirectory'],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const cwd = res.filePaths[0]
    const name = cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
    return createProject(name, cwd)
  })
  ipcMain.handle('project:delete', (_e, id: string) => {
    deleteProject(id)
    return true
  })
  ipcMain.handle('project:conversations', (_e, projectId: string) =>
    listConversationsByProject(projectId),
  )

  // --- Read-only filesystem (project tree) -------------------------------
  ipcMain.handle('fs:listDir', (_e, projectId: string, relPath: string) =>
    fsListDir(projectId, relPath ?? ''),
  )
  ipcMain.handle('fs:readFile', (_e, projectId: string, relPath: string) =>
    fsReadFile(projectId, relPath),
  )
  ipcMain.handle('fs:stat', (_e, projectId: string, relPath: string) =>
    fsStat(projectId, relPath),
  )

  // --- Git + gh status, modification review (read-only, git = source of truth) ---
  ipcMain.handle('git:status', (_e, projectId: string) => getGitStatus(projectId))
  ipcMain.handle('git:changedFiles', (_e, projectId: string) => getChangedFiles(projectId))
  ipcMain.handle('git:fileDiff', (_e, projectId: string, relPath: string) =>
    getFileDiff(projectId, relPath),
  )

  // --- Git commit (Phase 3, local write) — requires explicit user confirmation
  // in the modal before this IPC call is ever invoked. Bounded to project cwd.
  ipcMain.handle(
    'git:commit',
    (_e, projectId: string, relPaths: string[], message: string) =>
      gitCommit(projectId, relPaths, message),
  )

  // --- Push + PR (Phase 4, remote writes) — each requires explicit confirmation.
  // gh auth belongs to the gh CLI; no token is stored or logged here.
  ipcMain.handle('git:push', (_e, projectId: string) => gitPush(projectId))
  ipcMain.handle('git:commitsSinceUpstream', (_e, projectId: string) =>
    getCommitsSinceUpstream(projectId),
  )
  ipcMain.handle(
    'git:ghPrCreate',
    (_e, projectId: string, title: string, body: string) =>
      ghCreatePr(projectId, title, body),
  )

  // --- Conversations (persistence) ---------------------------------------
  ipcMain.handle('conv:list', (_e, agentId: AgentId) => listConversations(agentId))
  ipcMain.handle(
    'conv:create',
    async (_e, agentId: AgentId, title: string, projectId?: string | null) => {
      // Snapshot HEAD at creation — not used for scoping yet (see Conversation type).
      const project = projectId ? getProject(projectId) : undefined
      const headSha = project ? await getHeadSha(project.cwd) : null
      return createConversation(agentId, title || 'Nouvelle conversation', projectId ?? null, headSha)
    },
  )
  ipcMain.handle('conv:rename', (_e, id: string, title: string) => {
    renameConversation(id, title)
    return getConversation(id)
  })
  ipcMain.handle('conv:delete', (_e, id: string) => {
    deleteConversation(id)
    return true
  })
  ipcMain.handle('conv:messages', (_e, conversationId: string) => getMessages(conversationId))
  ipcMain.handle(
    'conv:setModelEffort',
    (_e, id: string, model: string, effort: string, contextWindow: string) => {
      setConversationSettings(id, model, effort, contextWindow ?? '200k')
      return getConversation(id)
    },
  )

  // --- Claude Code model list -------------------------------------------
  ipcMain.handle('claude:models', async (): Promise<ModelOption[]> => {
    if (modelsCache) return modelsCache
    try {
      const infos = await fetchSupportedModels(getSecret('anthropicApiKey'))
      modelsCache = infos.map((m) => ({
        value: m.value,
        displayName: m.displayName,
        supportsEffort: !!m.supportsEffort,
        effortLevels: m.supportedEffortLevels ?? [],
      }))
      if (modelsCache.length === 0) modelsCache = FALLBACK_MODELS
    } catch {
      modelsCache = FALLBACK_MODELS
    }
    return modelsCache
  })

  // --- Claude Code slash command list (built-in commands) ----------------
  ipcMain.handle('claude:commands', async (): Promise<SlashCommandInfo[]> => {
    if (commandsCache) return commandsCache
    try {
      const cmds = await fetchSupportedCommands(getSecret('anthropicApiKey'))
      commandsCache = cmds.map((c) => ({
        name: c.name,
        description: c.description ?? '',
        argumentHint: c.argumentHint ?? '',
        aliases: c.aliases,
      }))
      if (commandsCache.length === 0) commandsCache = FALLBACK_COMMANDS
    } catch {
      commandsCache = FALLBACK_COMMANDS
    }
    return commandsCache
  })

  // --- Attachments: pick files (with image preview data) -----------------
  ipcMain.handle('dialog:pickAttachments', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Joindre des fichiers',
      properties: ['openFile', 'multiSelections'],
    })
    if (res.canceled) return []
    return res.filePaths.map((p) => {
      const mime = mimeFromPath(p)
      return { path: p, mime, dataUrl: imageDataUrl(p, mime) }
    })
  })

  // --- Agent streaming (persisted, session-aware) ------------------------
  ipcMain.handle(
    'agent:send',
    async (
      _e,
      args: {
        agentId: string
        text: string
        conversationId: string
        streamId?: string
        attachments?: AttachmentRef[]
        permissionMode?: 'default' | 'bypassPermissions'
      },
    ) => {
      const adapter = registry.get(args.agentId as never)
      const streamId = args.streamId ?? randomUUID()
      const conv = getConversation(args.conversationId)

      if (!adapter || !conv) {
        queueMicrotask(() => {
          broadcast('agent:event', {
            streamId,
            event: {
              type: 'error',
              message: !adapter
                ? `Agent « ${args.agentId} » indisponible.`
                : 'Conversation introuvable.',
            },
          })
        })
        return { streamId }
      }

      // Persist the user message immediately (with attachment previews).
      const storedAttachments: StoredAttachment[] = (args.attachments ?? []).map((a) => ({
        name: (a.path.split(/[\\/]/).pop() ?? a.path),
        mime: a.mime,
        dataUrl: a.dataUrl,
      }))
      addMessage({
        conversationId: conv.id,
        role: 'user',
        content: args.text,
        attachments: storedAttachments,
      })

      const handle = { cancelled: false }
      activeStreams.set(streamId, handle)

      // Accumulate the assistant reply to persist it once the turn ends.
      let acc = ''
      const tools: { name: string; detail?: unknown }[] = []
      let errMsg: string | undefined

      void (async () => {
        let terminated = false
        try {
          for await (const event of adapter.send(args.text, args.attachments, {
            sessionKey: conv.sessionKey,
            sessionStarted: conv.sessionStarted === 1,
            model: conv.model || undefined,
            effort: conv.effort || undefined,
            contextWindow: conv.contextWindow || '200k',
            permissionMode: args.permissionMode ?? 'default',
            cwd: conv.projectId ? getProject(conv.projectId)?.cwd : undefined,
          })) {
            if (handle.cancelled) break
            if (event.type === 'text') acc += event.text
            else if (event.type === 'tool') tools.push({ name: event.name, detail: event.detail })
            else if (event.type === 'error') errMsg = event.message
            broadcast('agent:event', { streamId, event })
            if (event.type === 'done' || event.type === 'error') {
              terminated = true
              break
            }
          }
        } catch (err) {
          errMsg = err instanceof Error ? err.message : String(err)
          broadcast('agent:event', { streamId, event: { type: 'error', message: errMsg } })
          terminated = true
        } finally {
          if (!terminated && !handle.cancelled) {
            broadcast('agent:event', { streamId, event: { type: 'done' } })
          }
          // Persist the assistant turn (text + tool blocks + any error).
          if (acc || tools.length || errMsg) {
            addMessage({
              conversationId: conv.id,
              role: 'assistant',
              content: acc,
              tools,
              error: errMsg,
            })
          }
          // The backend session now exists -> resume it next turn.
          markSessionStarted(conv.id)
          activeStreams.delete(streamId)
        }
      })()

      return { streamId }
    },
  )

  ipcMain.handle('agent:cancel', (_e, streamId: string) => {
    const handle = activeStreams.get(streamId)
    if (handle) handle.cancelled = true
    // Abort an in-flight Claude Code SDK query, if any.
    const cc = registry.get('claude-code') as { cancel?: () => void } | undefined
    cc?.cancel?.()
    return true
  })

  // --- Claude Code permissions + auth ------------------------------------
  ipcMain.on('agent:permission:respond', (_e, res: { requestId: string; approved: boolean }) => {
    const resolve = pendingPermissions.get(res.requestId)
    if (resolve) {
      pendingPermissions.delete(res.requestId)
      resolve(res.approved)
    }
  })

  ipcMain.handle('claude:authStatus', (): ClaudeAuthStatus => {
    const a = detectAuth(getSecret('anthropicApiKey'))
    return { ok: a.ok, method: a.method, message: a.ok ? undefined : AUTH_HELP }
  })

  // --- Tunnel status -> renderer (live push) -----------------------------
  tunnel.on('status', (status) => broadcast('tunnel:status', status))
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
}

function mimeFromPath(p: string): string {
  return MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'
}

// Build a data: URL for image files (for preview + chat display). Skips
// non-images and oversized files to keep payloads sane.
function imageDataUrl(p: string, mime: string): string | undefined {
  if (!mime.startsWith('image/')) return undefined
  try {
    const buf = readFileSync(p)
    if (buf.length > 12 * 1024 * 1024) return undefined
    return `data:${mime};base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}
