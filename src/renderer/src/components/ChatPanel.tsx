import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import {
  Paperclip,
  ArrowUp,
  X,
  Warning,
  Robot,
  Terminal,
  FileText,
  PencilSimple,
  Wrench,
  FolderOpen,
  ChatsCircle,
  GitDiff,
  ListChecks,
  CheckCircle,
  Circle,
  CircleDashed,
  Sidebar as SidebarIcon,
  Command,
  Trash,
  MagnifyingGlass,
  CaretRight,
} from '@phosphor-icons/react'
import { FileTree } from './FileTree'
import { FilePreviewModal } from './FilePreviewModal'
import { MarkdownContent } from './MarkdownContent'
import { ModelPicker } from './ModelPicker'
import { ReasoningContextPicker } from './ReasoningContextPicker'
import { PermissionPicker } from './PermissionPicker'
import { GitStatusBadge } from './GitStatusBadge'
import { ReviewPanel } from './ReviewPanel'
import { VcActions } from './VcActions'
import { MODEL_REGISTRY, DEFAULT_MODEL_ID, getModelConfig, clampEffort, clampContextWindow } from '../modelConfig'
import type {
  AgentDescriptor,
  TunnelStatus,
  ClaudeAuthStatus,
  AttachmentRef,
  SlashCommandInfo,
  Conversation,
  StoredAttachment,
  PermissionMode,
  ContextWindow,
  ShellRunResult,
  Project,
} from '@shared/types'
import type { ChatMessage } from '../chat'

interface Props {
  agent: AgentDescriptor
  messages: ChatMessage[]
  tunnel: TunnelStatus
  claudeAuth: ClaudeAuthStatus | null
  commands: SlashCommandInfo[]
  conversation?: Conversation
  project?: Project
  projectId?: string
  projectCwd?: string
  permissionMode: PermissionMode
  onSetPermissionMode: (m: PermissionMode) => void
  onSetConvSettings: (model: string, effort: string, contextWindow: string) => void
  onSend: (text: string, attachments?: AttachmentRef[]) => void
}

interface CmdEntry {
  id: string
  command: string
  result?: ShellRunResult
  error?: string
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}

// If the composer holds only a slash command being typed (a leading "/" followed
// by no whitespace yet), return the command-name fragment after the slash so we
// can drive the autocomplete menu. Returns null otherwise (incl. once a space is
// typed to start arguments — matching Claude Code's terminal behavior).
function matchSlashQuery(input: string): string | null {
  const m = /^\/(\S*)$/.exec(input)
  return m ? m[1] : null
}

// Rank: exact prefix matches on the name come first, then alias-prefix, then the
// rest (substring matches), each group kept alphabetical.
function filterCommands(commands: SlashCommandInfo[], query: string): SlashCommandInfo[] {
  const q = query.toLowerCase()
  if (!q) return [...commands].sort((a, b) => a.name.localeCompare(b.name))
  const scored = commands
    .map((c) => {
      const name = c.name.toLowerCase()
      const aliasHit = c.aliases?.some((a) => a.toLowerCase().includes(q)) ?? false
      let score = -1
      if (name.startsWith(q)) score = 0
      else if (c.aliases?.some((a) => a.toLowerCase().startsWith(q))) score = 1
      else if (name.includes(q)) score = 2
      else if (aliasHit) score = 3
      return { c, score }
    })
    .filter((s) => s.score >= 0)
  scored.sort((a, b) => a.score - b.score || a.c.name.localeCompare(b.c.name))
  return scored.map((s) => s.c)
}

function AgentAvatar({ id }: { id: string }) {
  return (
    <span className={`msg-avatar ${id}`}>
      {id === 'openclaw' ? <Robot size={14} /> : <Terminal size={14} />}
    </span>
  )
}

// --- Rich rendering helpers (display-only, derived from tool events) -------
interface FileDelta {
  path: string
  add: number
  rem: number
}
function lineCount(s: unknown): number {
  if (typeof s !== 'string' || s.length === 0) return 0
  return s.split('\n').length
}
function baseFile(p: string): string {
  return p.split(/[\\/]/).pop() ?? p
}
function deriveModifiedFiles(tools: { name: string; detail?: unknown }[]): FileDelta[] {
  const map = new Map<string, FileDelta>()
  const bump = (path: string, add: number, rem: number) => {
    const e = map.get(path) ?? { path, add: 0, rem: 0 }
    e.add += add
    e.rem += rem
    map.set(path, e)
  }
  for (const t of tools) {
    const d = t.detail as Record<string, unknown> | undefined
    if (!d || typeof d !== 'object') continue
    const p = d.file_path
    if (typeof p !== 'string') continue
    if (t.name === 'Write') bump(p, lineCount(d.content), 0)
    else if (t.name === 'Edit') bump(p, lineCount(d.new_string), lineCount(d.old_string))
    else if (t.name === 'MultiEdit' && Array.isArray(d.edits)) {
      for (const e of d.edits as Array<Record<string, unknown>>)
        bump(p, lineCount(e.new_string), lineCount(e.old_string))
    } else if (t.name === 'NotebookEdit') bump(p, lineCount(d.new_source), 0)
  }
  return [...map.values()]
}
interface TodoItem {
  content: string
  status: string
}
function deriveWorkLog(tools: { name: string; detail?: unknown }[]): TodoItem[] | null {
  for (let i = tools.length - 1; i >= 0; i--) {
    if (tools[i].name === 'TodoWrite') {
      const d = tools[i].detail as Record<string, unknown> | undefined
      if (d && Array.isArray(d.todos)) return d.todos as TodoItem[]
    }
  }
  return null
}

function ModifiedFiles({ files }: { files: FileDelta[] }) {
  return (
    <details className="files-block" open>
      <summary className="files-head">
        <GitDiff className="ico" size={15} />
        <span>Fichiers modifiés</span>
        <span className="files-count">{files.length}</span>
      </summary>
      <div className="files-list">
        {files.map((f) => (
          <div className="file-row" key={f.path} title={f.path}>
            <span className="file-name">{baseFile(f.path)}</span>
            <span className="file-delta">
              {f.add > 0 && <span className="d-add">+{f.add}</span>}
              {f.rem > 0 && <span className="d-rem">−{f.rem}</span>}
            </span>
          </div>
        ))}
      </div>
    </details>
  )
}

function WorkLog({ items }: { items: TodoItem[] }) {
  return (
    <div className="worklog">
      <div className="worklog-head">
        <ListChecks className="ico" size={15} />
        <span>Plan</span>
      </div>
      {items.map((it, i) => (
        <div className={`worklog-item ${it.status}`} key={i}>
          {it.status === 'completed' ? (
            <CheckCircle size={15} weight="fill" />
          ) : it.status === 'in_progress' ? (
            <CircleDashed size={15} />
          ) : (
            <Circle size={15} />
          )}
          <span>{it.content}</span>
        </div>
      ))}
    </div>
  )
}

// --- Tool work log — compact grouped view replacing individual tool-block cards ---

const TOOL_LOG_INITIAL = 6

function isImportantTool(name: string): boolean {
  const n = name.toLowerCase()
  return n === 'edit' || n === 'write' || n === 'multiedit' || n === 'bash' || n === 'notebookedit'
}

function toolSummary(name: string, detail: unknown): string {
  if (!detail || typeof detail !== 'object') return ''
  const d = detail as Record<string, unknown>
  const str = (k: string): string => (typeof d[k] === 'string' ? (d[k] as string) : '')
  const n = name.toLowerCase()
  if (n === 'read') return str('file_path')
  if (n === 'write') return str('file_path')
  if (n === 'edit' || n === 'multiedit') return str('file_path')
  if (n === 'notebookedit') return str('notebook_path')
  if (n === 'glob') return str('pattern')
  if (n === 'grep') {
    const pat = str('pattern')
    const p = str('path')
    return p ? `${pat}  ${p}` : pat
  }
  if (n === 'bash') return str('command').split('\n')[0]
  if (n === 'webfetch' || n === 'fetch') return str('url')
  if (n === 'websearch') return str('query')
  if (n === 'agent' || n === 'task') return str('description') || str('prompt')
  return ''
}

function ToolLogIcon({ name }: { name: string }) {
  const n = name.toLowerCase()
  if (n === 'bash' || n.includes('terminal')) return <Terminal className="tl-ico" size={13} />
  if (n === 'glob') return <FolderOpen className="tl-ico" size={13} />
  if (n === 'grep' || n === 'websearch') return <MagnifyingGlass className="tl-ico" size={13} />
  if (n === 'read') return <FileText className="tl-ico" size={13} />
  if (n === 'edit' || n === 'write' || n === 'multiedit' || n === 'notebookedit')
    return <PencilSimple className="tl-ico" size={13} />
  return <Wrench className="tl-ico" size={13} />
}

interface ToolEntry { name: string; detail?: unknown }

function ToolLogRow({ tool, open, onToggle }: { tool: ToolEntry; open: boolean; onToggle: () => void }) {
  const important = isImportantTool(tool.name)
  const summary = toolSummary(tool.name, tool.detail)
  return (
    <div className={`tl-item ${important ? 'important' : 'noise'}${open ? ' open' : ''}`}>
      <button type="button" className="tl-row" onClick={onToggle}>
        <ToolLogIcon name={tool.name} />
        <span className="tl-name">{tool.name}</span>
        {summary && <span className="tl-summary mono">{summary}</span>}
        <CaretRight className="tl-caret" size={11} />
      </button>
      {open && tool.detail != null && (
        <pre className="tl-detail">
          {typeof tool.detail === 'string' ? tool.detail : JSON.stringify(tool.detail, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ToolWorkLog({ tools, streaming }: { tools: ToolEntry[]; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const [openIdx, setOpenIdx] = useState<number | null>(null)
  if (tools.length === 0) return null

  const shouldTruncate = !expanded && tools.length > TOOL_LOG_INITIAL
  const visible = shouldTruncate ? tools.slice(0, TOOL_LOG_INITIAL) : tools
  const hidden = shouldTruncate ? tools.slice(TOOL_LOG_INITIAL) : []
  const hiddenImportant = hidden.filter((t) => isImportantTool(t.name))

  return (
    <div className="tool-log">
      <div className="tl-head">
        <ListChecks size={13} />
        <span>WORK LOG</span>
        <span className="tl-count">{tools.length}</span>
        {streaming && <span className="tl-pulse" />}
      </div>
      <div className="tl-body">
        {visible.map((t, i) => (
          <ToolLogRow
            key={i}
            tool={t}
            open={openIdx === i}
            onToggle={() => setOpenIdx((prev) => (prev === i ? null : i))}
          />
        ))}
        {shouldTruncate && (
          <button type="button" className="tl-more" onClick={() => setExpanded(true)}>
            voir {hidden.length} de plus
            {hiddenImportant.length > 0 && (
              <span className="tl-more-warn">
                {' '}· {hiddenImportant.length} modification{hiddenImportant.length > 1 ? 's' : ''}
              </span>
            )}
          </button>
        )}
        {expanded && tools.length > TOOL_LOG_INITIAL && (
          <button type="button" className="tl-more" onClick={() => { setExpanded(false); setOpenIdx(null) }}>
            réduire
          </button>
        )}
      </div>
    </div>
  )
}

export function ChatPanel({
  agent,
  messages,
  tunnel,
  claudeAuth,
  commands,
  conversation,
  project,
  projectId,
  projectCwd,
  permissionMode,
  onSetPermissionMode,
  onSetConvSettings,
  onSend,
}: Props) {
  const [input, setInput] = useState('')
  const [pending, setPending] = useState<AttachmentRef[]>([])
  const [treeOpen, setTreeOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [cmdInput, setCmdInput] = useState('')
  const [cmdRunning, setCmdRunning] = useState(false)
  const [cmdEntries, setCmdEntries] = useState<CmdEntry[]>([])
  const [previewPath, setPreviewPath] = useState<string | null>(null)
  // Slash-command autocomplete: highlighted row + an Escape-dismiss flag.
  const [slashHi, setSlashHi] = useState(0)
  const [slashDismissed, setSlashDismissed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const cmdInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  useEffect(() => {
    if (cmdOpen) cmdInputRef.current?.focus()
  }, [cmdOpen])

  const isClaude = agent.id === 'claude-code'

  // --- Slash command menu (Claude Code only) -----------------------------
  const slashQuery = isClaude ? matchSlashQuery(input) : null
  const slashMatches = useMemo(
    () => (slashQuery === null ? [] : filterCommands(commands, slashQuery)),
    [slashQuery, commands],
  )
  const slashOpen = slashQuery !== null && !slashDismissed && slashMatches.length > 0
  // Keep the highlight in range as the filtered list changes.
  useEffect(() => {
    setSlashHi(0)
  }, [slashQuery])

  const acceptCommand = (cmd: SlashCommandInfo) => {
    // Insert "/name " so the user can type arguments; menu closes (space typed).
    setInput(`/${cmd.name} `)
    setSlashDismissed(false)
    inputRef.current?.focus()
  }
  const cwd = projectCwd ?? ''
  // Claude Code requires a project (working directory) before chatting.
  const noProject = isClaude && !projectCwd

  const blocked = agent.id === 'openclaw' && tunnel.state !== 'connected'
  const currentModel = conversation?.model || DEFAULT_MODEL_ID
  const currentEffort = conversation?.effort || ''
  const currentContextWindow = (conversation?.contextWindow ?? '200k') as ContextWindow

  // Ctrl+1..N global shortcuts (Claude Code only): select model by shortcut number.
  useEffect(() => {
    if (!isClaude) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return
      const n = parseInt(e.key, 10)
      if (isNaN(n)) return
      const cfg = MODEL_REGISTRY.find((m) => m.shortcut === n)
      if (!cfg) return
      e.preventDefault()
      const newEffort = clampEffort(cfg, currentEffort)
      const newCw = clampContextWindow(cfg, currentContextWindow)
      onSetConvSettings(cfg.id, newEffort, newCw)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isClaude, currentEffort, currentContextWindow, onSetConvSettings])

  const submit = () => {
    const text = input.trim()
    if (!text && pending.length === 0) return
    onSend(text, pending.length ? pending : undefined)
    setInput('')
    setPending([])
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    // When the slash menu is open it captures navigation + selection keys so
    // Enter picks a command instead of sending the message.
    if (slashOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashHi((i) => (i + 1) % slashMatches.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashHi((i) => (i - 1 + slashMatches.length) % slashMatches.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        acceptCommand(slashMatches[slashHi])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashDismissed(true)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const pickAttachments = async () => {
    if (!agent.attachments) return
    const files = await window.api.dialog.pickAttachments()
    if (files.length) setPending((prev) => [...prev, ...files])
  }

  const runCmd = async () => {
    const command = cmdInput.trim()
    if (!command || !projectId || cmdRunning) return
    const id = `${Date.now()}-${cmdEntries.length}`
    setCmdEntries((prev) => [...prev, { id, command }])
    setCmdInput('')
    setCmdRunning(true)
    try {
      const result = await window.api.shell.run(projectId, command)
      setCmdEntries((prev) =>
        prev.map((entry) => (entry.id === id ? { ...entry, result } : entry)),
      )
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      setCmdEntries((prev) =>
        prev.map((entry) => (entry.id === id ? { ...entry, error } : entry)),
      )
    } finally {
      setCmdRunning(false)
      cmdInputRef.current?.focus()
    }
  }

  const canSend = (input.trim().length > 0 || pending.length > 0) && !noProject
  const showTree = isClaude && !!projectId && treeOpen

  const addTag = (relPath: string) => {
    setInput((prev) => {
      const sep = prev.length === 0 || /\s$/.test(prev) ? '' : ' '
      return `${prev}${sep}@${relPath} `
    })
  }

  return (
    <div className="workview">
      {showTree && projectId && (
        <FileTree projectId={projectId} onTag={addTag} onPreview={setPreviewPath} />
      )}
      <main className={`chat${isClaude ? ' chat--claude' : ''}`}>
        <header className="chat-head">
          {isClaude && projectId && (
            <button
              className="icon-btn"
              title="Afficher / masquer l'arbre"
              onClick={() => setTreeOpen((o) => !o)}
            >
              <SidebarIcon size={18} />
            </button>
          )}
          <AgentAvatar id={agent.id} />
          <span className="chat-title">{agent.label}</span>
          <span className="spacer" />
          {blocked && <span className="head-note warn">en attente du tunnel</span>}
          <button
            className={`icon-btn ${cmdOpen ? 'active' : ''}`}
            title={cmdOpen ? 'Masquer le cmd' : 'Ouvrir le cmd'}
            onClick={() => setCmdOpen((open) => !open)}
          >
            <Terminal size={18} />
          </button>
        </header>

      {agent.id === 'openclaw' && tunnel.state === 'down' && (
        <div className="inline-error">
          <Warning className="ico" size={16} />
          Tunnel coupé — vérifie les réglages SSH.
        </div>
      )}
      {isClaude && claudeAuth && !claudeAuth.ok && (
        <div className="inline-error">
          <Warning className="ico" size={16} />
          {claudeAuth.message}
        </div>
      )}

      <div className="messages" ref={scrollRef}>
        {noProject ? (
          <div className="empty">
            <FolderOpen className="empty-ico" size={34} weight="light" />
            <h3>Aucun projet sélectionné</h3>
            <p>Ajoute un dossier de travail dans le rail pour discuter avec Claude depuis ce projet.</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty">
            <ChatsCircle className="empty-ico" size={34} weight="light" />
            <h3>Session vide</h3>
            <p>Écris un message à {agent.label} pour commencer.</p>
          </div>
        ) : (
          isClaude ? (
            <div className="chat-col">
              {messages.map((m) => <Bubble key={m.id} message={m} agentId={agent.id} />)}
            </div>
          ) : (
            messages.map((m) => <Bubble key={m.id} message={m} agentId={agent.id} />)
          )
        )}
      </div>

      <div className="composer-wrap">
        {pending.length > 0 && (
          <div className="attachments-bar">
            {pending.map((a, i) => (
              <AttachThumb
                key={i}
                name={baseName(a.path)}
                mime={a.mime}
                dataUrl={a.dataUrl}
                onRemove={() => setPending((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}

        {slashOpen && (
          <SlashMenu
            matches={slashMatches}
            highlighted={slashHi}
            onHover={setSlashHi}
            onPick={acceptCommand}
          />
        )}

        <div className="composer">
          <button
            className="attach-btn"
            disabled={!agent.attachments}
            onClick={pickAttachments}
            title={
              agent.attachments
                ? 'Joindre des fichiers / images'
                : 'Pièces jointes pas encore supportées pour cet agent'
            }
          >
            <Paperclip size={18} />
          </button>
          <textarea
            ref={inputRef}
            className="composer-input"
            placeholder={`Message à ${agent.label}…`}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              // Typing more re-opens the menu after an Escape dismiss.
              setSlashDismissed(false)
            }}
            onKeyDown={onKeyDown}
            rows={1}
          />
          <button className="send-btn" onClick={submit} disabled={!canSend} title="Envoyer">
            <ArrowUp size={18} weight="bold" />
          </button>
        </div>

        {isClaude && (
          <div className="pills">
            <ModelPicker
              model={currentModel}
              effort={currentEffort}
              contextWindow={currentContextWindow}
              onSetConvSettings={onSetConvSettings}
            />

            <ReasoningContextPicker
              model={currentModel}
              effort={currentEffort}
              contextWindow={currentContextWindow}
              onSetConvSettings={onSetConvSettings}
            />

            <PermissionPicker value={permissionMode} onChange={onSetPermissionMode} />

            <span className="spacer" />

            {projectId && (
              <GitStatusBadge
                projectId={projectId}
                messages={messages}
                onOpenReview={project ? () => setReviewOpen(true) : undefined}
              />
            )}
            {project && <VcActions project={project} />}
          </div>
        )}

        {cmdOpen && (
          <MiniCmd
            cwd={cwd}
            hasProject={!!projectId}
            command={cmdInput}
            entries={cmdEntries}
            running={cmdRunning}
            inputRef={cmdInputRef}
            onCommandChange={setCmdInput}
            onRun={runCmd}
            onClear={() => setCmdEntries([])}
            onClose={() => setCmdOpen(false)}
          />
        )}
      </div>
      {reviewOpen && project && (
        <ReviewPanel project={project} onClose={() => setReviewOpen(false)} />
      )}
      </main>
      {previewPath && projectId && (
        <FilePreviewModal
          projectId={projectId}
          path={previewPath}
          onClose={() => setPreviewPath(null)}
          onTag={(p) => {
            addTag(p)
            setPreviewPath(null)
          }}
        />
      )}
    </div>
  )
}

function MiniCmd({
  cwd,
  hasProject,
  command,
  entries,
  running,
  inputRef,
  onCommandChange,
  onRun,
  onClear,
  onClose,
}: {
  cwd: string
  hasProject: boolean
  command: string
  entries: CmdEntry[]
  running: boolean
  inputRef: RefObject<HTMLInputElement | null>
  onCommandChange: (value: string) => void
  onRun: () => void
  onClear: () => void
  onClose: () => void
}) {
  return (
    <section className="mini-cmd">
      <div className="mini-cmd-head">
        <Terminal size={14} weight="bold" />
        <span className="mini-cmd-title">cmd</span>
        <span className="mini-cmd-cwd" title={cwd || 'aucun projet'}>
          {cwd || 'aucun projet'}
        </span>
        <button className="icon-btn" type="button" title="Vider" onClick={onClear}>
          <Trash size={14} />
        </button>
        <button className="icon-btn" type="button" title="Fermer" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className="mini-cmd-output">
        {!hasProject ? (
          <div className="mini-cmd-muted">Selectionne un projet Claude Code pour executer des commandes.</div>
        ) : entries.length === 0 ? (
          <div className="mini-cmd-muted">Pret.</div>
        ) : (
          entries.map((entry) => (
            <div className="mini-cmd-entry" key={entry.id}>
              <div className="mini-cmd-prompt">&gt; {entry.command}</div>
              {entry.result ? (
                <>
                  {entry.result.stdout && <pre>{entry.result.stdout}</pre>}
                  {entry.result.stderr && <pre className="stderr">{entry.result.stderr}</pre>}
                  <div className={`mini-cmd-code ${entry.result.exitCode === 0 ? 'ok' : 'err'}`}>
                    exit {entry.result.exitCode ?? 'null'}
                    {entry.result.timedOut ? ' - timeout' : ''}
                  </div>
                </>
              ) : entry.error ? (
                <pre className="stderr">{entry.error}</pre>
              ) : (
                <div className="mini-cmd-muted">execution...</div>
              )}
            </div>
          ))
        )}
      </div>

      <form
        className="mini-cmd-form"
        onSubmit={(e) => {
          e.preventDefault()
          void onRun()
        }}
      >
        <span className="mini-cmd-marker">&gt;</span>
        <input
          ref={inputRef}
          value={command}
          onChange={(e) => onCommandChange(e.target.value)}
          disabled={!hasProject || running}
          placeholder={hasProject ? 'dir, npm test, git status...' : 'Aucun projet'}
        />
        <button
          className="send-btn mini-cmd-run"
          type="submit"
          disabled={!hasProject || running || command.trim().length === 0}
          title="Executer"
        >
          <ArrowUp size={16} weight="bold" />
        </button>
      </form>
    </section>
  )
}

function AttachThumb({
  name,
  mime,
  dataUrl,
  onRemove,
}: {
  name: string
  mime: string
  dataUrl?: string
  onRemove: () => void
}) {
  const isImage = mime.startsWith('image/') && dataUrl
  return (
    <span className={`attach-chip ${isImage ? 'image' : ''}`} title={name}>
      {isImage ? (
        <img className="attach-thumb" src={dataUrl} alt={name} />
      ) : (
        <>
          <FileText size={14} />
          {name}
        </>
      )}
      <button className="attach-x" onClick={onRemove}>
        <X size={12} />
      </button>
    </span>
  )
}

function SlashMenu({
  matches,
  highlighted,
  onHover,
  onPick,
}: {
  matches: SlashCommandInfo[]
  highlighted: number
  onHover: (i: number) => void
  onPick: (cmd: SlashCommandInfo) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the highlighted row visible during keyboard navigation.
  useEffect(() => {
    const el = listRef.current?.children[highlighted] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  return (
    <div className="slash-menu">
      <div className="slash-menu-head">
        <Command size={13} weight="bold" />
        <span>Commandes</span>
        <span className="slash-menu-count">{matches.length}</span>
      </div>
      <div className="slash-menu-list" ref={listRef}>
        {matches.map((cmd, i) => (
          <button
            key={cmd.name}
            type="button"
            className={`slash-item ${i === highlighted ? 'active' : ''}`}
            // onMouseDown (not onClick) so the textarea keeps focus.
            onMouseDown={(e) => {
              e.preventDefault()
              onPick(cmd)
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span className="slash-item-name">
              /{cmd.name}
              {cmd.argumentHint && <span className="slash-item-hint">{cmd.argumentHint}</span>}
            </span>
            {cmd.description && <span className="slash-item-desc">{cmd.description}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

function MessageAttachments({ items }: { items: StoredAttachment[] }) {
  if (!items.length) return null
  return (
    <div className="msg-attachments">
      {items.map((a, i) =>
        a.mime.startsWith('image/') && a.dataUrl ? (
          <img key={i} className="msg-image" src={a.dataUrl} alt={a.name} title={a.name} />
        ) : (
          <span key={i} className="msg-file" title={a.name}>
            <FileText size={14} /> {a.name}
          </span>
        ),
      )}
    </div>
  )
}

function Bubble({ message, agentId }: { message: ChatMessage; agentId: string }) {
  if (message.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">
          <MessageAttachments items={message.attachments} />
          {message.text}
        </div>
      </div>
    )
  }
  const todos = deriveWorkLog(message.tools)
  const modified = deriveModifiedFiles(message.tools)
  const rawTools = message.tools.filter((t) => t.name !== 'TodoWrite')

  return (
    <div className="msg agent">
      <AgentAvatar id={agentId} />
      <div className="agent-body">
        {todos && <WorkLog items={todos} />}
        {rawTools.length > 0 && <ToolWorkLog tools={rawTools} streaming={message.streaming} />}
        {modified.length > 0 && <ModifiedFiles files={modified} />}
        {message.text && (
          <div className="agent-text">
            <MarkdownContent text={message.text} />
          </div>
        )}
        {message.streaming && <span className="caret">▍</span>}
        {message.error && <div className="bubble-error">⚠ {message.error}</div>}
      </div>
    </div>
  )
}
