// Renderer-side store: conversation-aware + project-aware (Claude Code).
// OpenClaw: conversations keyed by agent. Claude Code: conversations keyed by
// the active project (a working directory on disk).
import { useCallback, useRef, useState } from 'react'
import type {
  AgentId,
  AgentStreamMessage,
  Conversation,
  Project,
  StoredMessage,
  StoredAttachment,
  AttachmentRef,
  PermissionMode,
} from '@shared/types'

export interface ToolCall {
  name: string
  detail?: unknown
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools: ToolCall[]
  attachments: StoredAttachment[]
  streaming: boolean
  error?: string
}

let counter = 0
const newId = () => `m${Date.now()}_${counter++}`

const fromStored = (m: StoredMessage): ChatMessage => ({
  id: m.id,
  role: m.role,
  text: m.content,
  tools: m.tools ?? [],
  attachments: m.attachments ?? [],
  streaming: false,
  error: m.error,
})

const DEFAULT_TITLE = 'Nouvelle session'

// Scope key: where a conversation list lives.
const scopeKey = (agentId: AgentId, projectId?: string): string =>
  agentId === 'claude-code' ? `p:${projectId ?? ''}` : `a:${agentId}`

export function useStore() {
  const [convsByScope, setConvsByScope] = useState<Record<string, Conversation[]>>({})
  const [activeByScope, setActiveByScope] = useState<Record<string, string>>({})
  const [messagesByConv, setMessagesByConv] = useState<Record<string, ChatMessage[]>>({})
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | undefined>(undefined)
  // Per-project expand/collapse state, persisted locally (no new dependency).
  const [expandedProjects, setExpandedProjects] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('wrapper.expandedProjects') || '[]')
    } catch {
      return []
    }
  })
  const streamMap = useRef(new Map<string, { convId: string; messageId: string }>())

  const setExpand = useCallback((id: string, on: boolean) => {
    setExpandedProjects((prev) => {
      const has = prev.includes(id)
      const next = on ? (has ? prev : [...prev, id]) : prev.filter((x) => x !== id)
      try {
        localStorage.setItem('wrapper.expandedProjects', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const loadMessages = useCallback(async (convId: string) => {
    const stored = await window.api.conv.messages(convId)
    setMessagesByConv((prev) => ({ ...prev, [convId]: stored.map(fromStored) }))
  }, [])

  // Load conversations for a given scope, ensuring at least one exists.
  const loadScope = useCallback(
    async (agentId: AgentId, projectId: string | undefined) => {
      const key = scopeKey(agentId, projectId)
      let convs =
        agentId === 'claude-code'
          ? projectId
            ? await window.api.project.conversations(projectId)
            : []
          : await window.api.conv.list(agentId)

      if (convs.length === 0 && (agentId !== 'claude-code' || projectId)) {
        convs = [await window.api.conv.create(agentId, DEFAULT_TITLE, projectId ?? null)]
      }
      setConvsByScope((prev) => ({ ...prev, [key]: convs }))
      if (convs.length > 0) {
        setActiveByScope((prev) => {
          const cur = prev[key]
          const active = cur && convs.some((c) => c.id === cur) ? cur : convs[0].id
          void loadMessages(active)
          return { ...prev, [key]: active }
        })
      }
    },
    [loadMessages],
  )

  // List a project's sessions WITHOUT auto-creating one (for the tree).
  const loadProjectConversations = useCallback(async (projectId: string) => {
    const convs = await window.api.project.conversations(projectId)
    setConvsByScope((prev) => ({ ...prev, [scopeKey('claude-code', projectId)]: convs }))
  }, [])

  const ensureLoaded = useCallback(
    async (agentId: AgentId) => {
      if (agentId !== 'claude-code') {
        await loadScope(agentId, undefined)
        return
      }
      // Claude Code: load projects, hydrate sessions for expanded ones.
      const list = await window.api.project.list()
      setProjects(list)
      for (const p of list) {
        if (expandedProjects.includes(p.id)) void loadProjectConversations(p.id)
      }
      setActiveProjectId((cur) => {
        const next = cur && list.some((p) => p.id === cur) ? cur : list[0]?.id
        if (next) {
          setExpand(next, true) // active project expanded by default
          void loadScope('claude-code', next)
        }
        return next
      })
    },
    [loadScope, loadProjectConversations, expandedProjects, setExpand],
  )

  // --- Projects ----------------------------------------------------------
  const addProject = useCallback(async () => {
    const p = await window.api.project.add()
    if (!p) return
    setProjects((prev) => [p, ...prev])
    setActiveProjectId(p.id)
    setExpand(p.id, true)
    await loadScope('claude-code', p.id)
  }, [loadScope, setExpand])

  // Click a project: select it (+ ensure a session). Re-clicking the active,
  // already-expanded project collapses it (it stays active).
  const clickProject = useCallback(
    (id: string) => {
      if (activeProjectId === id && expandedProjects.includes(id)) {
        setExpand(id, false)
        return
      }
      setActiveProjectId(id)
      setExpand(id, true)
      void loadScope('claude-code', id)
    },
    [activeProjectId, expandedProjects, loadScope, setExpand],
  )

  const deleteProject = useCallback(
    async (id: string) => {
      await window.api.project.delete(id)
      const rest = projects.filter((p) => p.id !== id)
      setProjects(rest)
      setExpand(id, false)
      setConvsByScope((prev) => {
        const next = { ...prev }
        delete next[scopeKey('claude-code', id)]
        return next
      })
      if (activeProjectId === id) {
        const next = rest[0]?.id
        setActiveProjectId(next)
        if (next) {
          setExpand(next, true)
          void loadScope('claude-code', next)
        }
      }
    },
    [projects, activeProjectId, loadScope, setExpand],
  )

  // --- Sessions under a specific project (nested tree) -------------------
  const newSession = useCallback(
    async (projectId: string) => {
      const key = scopeKey('claude-code', projectId)
      const c = await window.api.conv.create('claude-code', DEFAULT_TITLE, projectId)
      setConvsByScope((prev) => ({ ...prev, [key]: [c, ...(prev[key] ?? [])] }))
      setActiveProjectId(projectId)
      setExpand(projectId, true)
      setActiveByScope((prev) => ({ ...prev, [key]: c.id }))
      setMessagesByConv((prev) => ({ ...prev, [c.id]: [] }))
    },
    [setExpand],
  )

  const openSession = useCallback(
    (projectId: string, convId: string) => {
      const key = scopeKey('claude-code', projectId)
      setActiveProjectId(projectId)
      setExpand(projectId, true)
      setActiveByScope((prev) => ({ ...prev, [key]: convId }))
      void loadMessages(convId)
    },
    [loadMessages, setExpand],
  )

  const deleteSession = useCallback(
    async (projectId: string, convId: string) => {
      await window.api.conv.delete(convId)
      const key = scopeKey('claude-code', projectId)
      const rest = (convsByScope[key] ?? []).filter((c) => c.id !== convId)
      setConvsByScope((prev) => ({ ...prev, [key]: rest }))
      setActiveByScope((prev) => {
        if (prev[key] !== convId) return prev
        const next = { ...prev }
        if (rest[0]) {
          next[key] = rest[0].id
          void loadMessages(rest[0].id)
        } else {
          delete next[key]
        }
        return next
      })
    },
    [convsByScope, loadMessages],
  )

  // --- Conversations -----------------------------------------------------
  const selectConversation = useCallback(
    (agentId: AgentId, convId: string) => {
      const key = scopeKey(agentId, activeProjectId)
      setActiveByScope((prev) => ({ ...prev, [key]: convId }))
      void loadMessages(convId)
    },
    [activeProjectId, loadMessages],
  )

  const newConversation = useCallback(
    async (agentId: AgentId) => {
      if (agentId === 'claude-code' && !activeProjectId) return
      const key = scopeKey(agentId, activeProjectId)
      const c = await window.api.conv.create(agentId, DEFAULT_TITLE, activeProjectId ?? null)
      setConvsByScope((prev) => ({ ...prev, [key]: [c, ...(prev[key] ?? [])] }))
      setActiveByScope((prev) => ({ ...prev, [key]: c.id }))
      setMessagesByConv((prev) => ({ ...prev, [c.id]: [] }))
    },
    [activeProjectId],
  )

  const deleteConversation = useCallback(
    async (agentId: AgentId, convId: string) => {
      await window.api.conv.delete(convId)
      const key = scopeKey(agentId, activeProjectId)
      const rest = (convsByScope[key] ?? []).filter((c) => c.id !== convId)
      if (rest.length === 0) {
        if (agentId === 'claude-code' && !activeProjectId) {
          setConvsByScope((prev) => ({ ...prev, [key]: [] }))
          return
        }
        const c = await window.api.conv.create(agentId, DEFAULT_TITLE, activeProjectId ?? null)
        setConvsByScope((prev) => ({ ...prev, [key]: [c] }))
        setActiveByScope((prev) => ({ ...prev, [key]: c.id }))
        setMessagesByConv((prev) => ({ ...prev, [c.id]: [] }))
        return
      }
      setConvsByScope((prev) => ({ ...prev, [key]: rest }))
      setActiveByScope((prev) => {
        if (prev[key] !== convId) return prev
        void loadMessages(rest[0].id)
        return { ...prev, [key]: rest[0].id }
      })
    },
    [convsByScope, activeProjectId, loadMessages],
  )

  const setModelEffort = useCallback(
    async (agentId: AgentId, convId: string, model: string, effort: string, contextWindow: string) => {
      const updated = await window.api.conv.setModelEffort(convId, model, effort, contextWindow)
      const key = scopeKey(agentId, activeProjectId)
      setConvsByScope((prev) => ({
        ...prev,
        [key]: (prev[key] ?? []).map((c) => (c.id === convId ? updated : c)),
      }))
    },
    [activeProjectId],
  )

  const updateMsg = useCallback(
    (convId: string, id: string, fn: (m: ChatMessage) => ChatMessage) => {
      setMessagesByConv((prev) => {
        const list = prev[convId] ?? []
        return { ...prev, [convId]: list.map((m) => (m.id === id ? fn(m) : m)) }
      })
    },
    [],
  )

  const send = useCallback(
    async (
      agentId: AgentId,
      convId: string,
      text: string,
      attachments?: AttachmentRef[],
      permissionMode?: PermissionMode,
    ) => {
      const atts: StoredAttachment[] = (attachments ?? []).map((a) => ({
        name: a.path.split(/[\\/]/).pop() ?? a.path,
        mime: a.mime,
        dataUrl: a.dataUrl,
      }))
      const userMsg: ChatMessage = {
        id: newId(),
        role: 'user',
        text,
        tools: [],
        attachments: atts,
        streaming: false,
      }
      const asst: ChatMessage = {
        id: newId(),
        role: 'assistant',
        text: '',
        tools: [],
        attachments: [],
        streaming: true,
      }
      setMessagesByConv((prev) => ({
        ...prev,
        [convId]: [...(prev[convId] ?? []), userMsg, asst],
      }))

      const streamId = crypto.randomUUID()
      streamMap.current.set(streamId, { convId, messageId: asst.id })
      await window.api.agent.send(agentId, text, convId, streamId, attachments, permissionMode)

      // Auto-title a fresh session from the first message.
      const key = scopeKey(agentId, activeProjectId)
      const conv = (convsByScope[key] ?? []).find((c) => c.id === convId)
      if (conv && conv.title === DEFAULT_TITLE) {
        const title = text.slice(0, 40) + (text.length > 40 ? '…' : '')
        const updated = await window.api.conv.rename(convId, title || DEFAULT_TITLE)
        setConvsByScope((prev) => ({
          ...prev,
          [key]: (prev[key] ?? []).map((c) => (c.id === convId ? updated : c)),
        }))
      }
    },
    [convsByScope, activeProjectId],
  )

  const onStreamEvent = useCallback(
    ({ streamId, event }: AgentStreamMessage) => {
      const target = streamMap.current.get(streamId)
      if (!target) return
      const { convId, messageId } = target
      switch (event.type) {
        case 'text':
          updateMsg(convId, messageId, (m) => ({ ...m, text: m.text + event.text }))
          break
        case 'tool':
          updateMsg(convId, messageId, (m) => ({
            ...m,
            tools: [...m.tools, { name: event.name, detail: event.detail }],
          }))
          break
        case 'error':
          updateMsg(convId, messageId, (m) => ({ ...m, streaming: false, error: event.message }))
          streamMap.current.delete(streamId)
          break
        case 'done':
          updateMsg(convId, messageId, (m) => ({ ...m, streaming: false }))
          streamMap.current.delete(streamId)
          break
      }
    },
    [updateMsg],
  )

  return {
    // OpenClaw + Claude Code conversations (scope-aware)
    conversations: (agentId: AgentId): Conversation[] =>
      convsByScope[scopeKey(agentId, activeProjectId)] ?? [],
    activeConv: (agentId: AgentId): string | undefined =>
      activeByScope[scopeKey(agentId, activeProjectId)],
    messages: (convId: string | undefined): ChatMessage[] =>
      convId ? (messagesByConv[convId] ?? []) : [],
    // Projects (Claude Code) — nested tree
    projects,
    activeProjectId,
    expandedProjects,
    isExpanded: (id: string): boolean => expandedProjects.includes(id),
    conversationsForProject: (projectId: string): Conversation[] =>
      convsByScope[scopeKey('claude-code', projectId)] ?? [],
    addProject,
    clickProject,
    deleteProject,
    newSession,
    openSession,
    deleteSession,
    // actions
    ensureLoaded,
    selectConversation,
    newConversation,
    deleteConversation,
    setModelEffort,
    send,
    onStreamEvent,
  }
}
