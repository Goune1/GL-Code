import { useCallback, useEffect, useState } from 'react'
import { IconContext } from '@phosphor-icons/react'
import type {
  AgentId,
  TunnelStatus,
  ClaudeAuthStatus,
  AttachmentRef,
  SlashCommandInfo,
  PermissionMode,
  PermissionRequest,
} from '@shared/types'
import { AGENTS } from '@shared/types'
import { useStore } from './chat'
import { Sidebar } from './components/Sidebar'
import { ChatPanel } from './components/ChatPanel'
import { SettingsModal } from './components/SettingsModal'
import { PermissionModal } from './components/PermissionModal'

export function App() {
  const [activeAgent, setActiveAgent] = useState<AgentId>('openclaw')
  const [tunnel, setTunnel] = useState<TunnelStatus>({ state: 'connecting', mode: 'tunnel' })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [claudeAuth, setClaudeAuth] = useState<ClaudeAuthStatus | null>(null)
  const [commands, setCommands] = useState<SlashCommandInfo[]>([])
  // Permission mode for Claude Code. SAFE default: prompt before tool use.
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default')
  const [permQueue, setPermQueue] = useState<PermissionRequest[]>([])
  const store = useStore()

  useEffect(() => {
    const offEvent = window.api.agent.onEvent(store.onStreamEvent)
    const offTunnel = window.api.tunnel.onStatus(setTunnel)
    const offPerm = window.api.agent.onPermissionRequest((req) =>
      setPermQueue((q) => [...q, req]),
    )
    void window.api.tunnel.status().then(setTunnel)
    return () => {
      offEvent()
      offTunnel()
      offPerm()
    }
  }, [store.onStreamEvent])

  const respondPermission = useCallback((requestId: string, approved: boolean) => {
    window.api.agent.respondPermission(requestId, approved)
    setPermQueue((q) => q.filter((r) => r.requestId !== requestId))
  }, [])

  useEffect(() => {
    void store.ensureLoaded(activeAgent)
    if (activeAgent === 'claude-code') {
      void window.api.claude.authStatus().then(setClaudeAuth)
      if (commands.length === 0) void window.api.claude.commands().then(setCommands)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAgent])

  const agent = AGENTS.find((a) => a.id === activeAgent)!
  const activeConvId = store.activeConv(activeAgent)
  const activeConversation = store.conversations(activeAgent).find((c) => c.id === activeConvId)
  const activeProject = store.projects.find((p) => p.id === store.activeProjectId)

  useEffect(() => {
    void window.api.presence.updateActivity({
      agentId: activeAgent,
      agentLabel: agent.label,
      workspaceName: activeProject?.name,
      workspaceCwd: activeProject?.cwd,
    })
  }, [
    activeAgent,
    agent.label,
    activeProject?.name,
    activeProject?.cwd,
  ])

  return (
    <IconContext.Provider value={{ weight: 'regular', size: 18 }}>
      <div className="app">
        <Sidebar
          activeAgent={activeAgent}
          onSelectAgent={setActiveAgent}
          conversations={store.conversations(activeAgent)}
          activeConvId={activeConvId}
          onSelectConversation={(id) => store.selectConversation(activeAgent, id)}
          onNewConversation={() => store.newConversation(activeAgent)}
          onDeleteConversation={(id) => store.deleteConversation(activeAgent, id)}
          projects={store.projects}
          activeProjectId={store.activeProjectId}
          isExpanded={store.isExpanded}
          conversationsForProject={store.conversationsForProject}
          onAddProject={() => store.addProject()}
          onProjectClick={(id) => store.clickProject(id)}
          onDeleteProject={(id) => store.deleteProject(id)}
          onNewSession={(projectId) => store.newSession(projectId)}
          onOpenSession={(projectId, convId) => store.openSession(projectId, convId)}
          onDeleteSession={(projectId, convId) => store.deleteSession(projectId, convId)}
          tunnel={tunnel}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <ChatPanel
          agent={agent}
          messages={store.messages(activeConvId)}
          tunnel={tunnel}
          claudeAuth={activeAgent === 'claude-code' ? claudeAuth : null}
          commands={commands}
          conversation={activeConversation}
          project={activeProject}
          projectId={store.activeProjectId}
          projectCwd={activeProject?.cwd}
          permissionMode={permissionMode}
          onSetPermissionMode={setPermissionMode}
          onSetConvSettings={(model: string, effort: string, contextWindow: string) => {
            if (activeConvId) void store.setModelEffort(activeAgent, activeConvId, model, effort, contextWindow)
          }}
          onSend={(text: string, attachments?: AttachmentRef[]) => {
            if (activeConvId)
              void store.send(activeAgent, activeConvId, text, attachments, permissionMode)
          }}
        />
        {settingsOpen && (
          <SettingsModal project={activeProject} onClose={() => setSettingsOpen(false)} />
        )}
        {permQueue.length > 0 && (
          <PermissionModal request={permQueue[0]} onRespond={respondPermission} />
        )}
      </div>
    </IconContext.Provider>
  )
}
