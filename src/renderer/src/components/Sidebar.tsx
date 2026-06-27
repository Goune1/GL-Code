import {
  GearSix,
  Plus,
  X,
  Robot,
  Terminal,
  ChatCircle,
  FolderPlus,
  Folder,
  CaretRight,
  CaretDown,
} from '@phosphor-icons/react'
import logo from '../assets/logo.png'
import type { AgentId, TunnelStatus, Conversation, Project } from '@shared/types'
import { AGENTS } from '@shared/types'
import { StatusBar } from './StatusBar'

interface Props {
  activeAgent: AgentId
  onSelectAgent: (id: AgentId) => void
  // OpenClaw conversations (flat)
  conversations: Conversation[]
  activeConvId?: string
  onSelectConversation: (id: string) => void
  onNewConversation: () => void
  onDeleteConversation: (id: string) => void
  // Claude Code projects → sessions (nested tree)
  projects: Project[]
  activeProjectId?: string
  isExpanded: (id: string) => boolean
  conversationsForProject: (projectId: string) => Conversation[]
  onAddProject: () => void
  onProjectClick: (id: string) => void
  onDeleteProject: (id: string) => void
  onNewSession: (projectId: string) => void
  onOpenSession: (projectId: string, convId: string) => void
  onDeleteSession: (projectId: string, convId: string) => void
  tunnel: TunnelStatus
  onOpenSettings: () => void
}

function AgentIcon({ id }: { id: AgentId }) {
  if (id === 'openclaw') return <Robot size={15} />
  if (id === 'claude-code') return <Terminal size={15} />
  return <Terminal size={15} />
}

// Compact relative time (T3 Code style): now / 5m / 3h / 21d / 4mo / 2y
function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(mo / 12)}y`
}

export function Sidebar(props: Props) {
  const { activeAgent, onSelectAgent, tunnel, onOpenSettings } = props
  const isClaude = activeAgent === 'claude-code'

  return (
    <aside className="rail">
      <div className="rail-head">
        <span className="brand">
          <img src={logo} className="brand-logo" alt="GL Code" />
          GL Code
        </span>
        <button className="icon-btn" title="Réglages" onClick={onOpenSettings}>
          <GearSix size={18} />
        </button>
      </div>

      <div className="rail-scroll">
        <div className="rail-group">
          <div className="group-head">
            <span className="section-label">Agents</span>
          </div>
          {AGENTS.map((a) => (
            <button
              key={a.id}
              className={`agent-row ${a.id === activeAgent ? 'active' : ''} ${
                a.enabled ? '' : 'disabled'
              }`}
              onClick={() => a.enabled && onSelectAgent(a.id)}
              disabled={!a.enabled}
              title={a.enabled ? a.label : `${a.label} — bientôt`}
            >
              <span className={`agent-avatar ${a.id}`}>
                <AgentIcon id={a.id} />
              </span>
              <span className="agent-name">{a.label}</span>
            </button>
          ))}
        </div>

        {isClaude ? <ProjectTree {...props} /> : <ConversationGroup {...props} />}
      </div>

      <StatusBar tunnel={tunnel} />
    </aside>
  )
}

function ConversationGroup({
  conversations,
  activeConvId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
}: Props) {
  return (
    <div className="rail-group">
      <div className="group-head">
        <span className="section-label">Conversations</span>
        <button className="icon-btn" title="Nouvelle conversation" onClick={onNewConversation}>
          <Plus size={16} />
        </button>
      </div>
      {conversations.length === 0 && <div className="conv-empty">Aucune conversation</div>}
      {conversations.map((c) => (
        <div
          key={c.id}
          className={`conv-row ${c.id === activeConvId ? 'active' : ''}`}
          onClick={() => onSelectConversation(c.id)}
        >
          <ChatCircle className="conv-ico" size={15} />
          <span className="conv-title">{c.title}</span>
          <button
            className="conv-del"
            title="Supprimer"
            onClick={(e) => {
              e.stopPropagation()
              onDeleteConversation(c.id)
            }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}

function ProjectTree({
  projects,
  activeProjectId,
  activeConvId,
  isExpanded,
  conversationsForProject,
  onAddProject,
  onProjectClick,
  onDeleteProject,
  onNewSession,
  onOpenSession,
  onDeleteSession,
}: Props) {
  return (
    <div className="rail-group">
      <div className="group-head">
        <span className="section-label">Projets</span>
        <button className="icon-btn" title="Ajouter un projet" onClick={onAddProject}>
          <FolderPlus size={16} />
        </button>
      </div>
      {projects.length === 0 && (
        <div className="conv-empty">Aucun projet — ajoute un dossier.</div>
      )}
      {projects.map((p) => {
        const expanded = isExpanded(p.id)
        const sessions = conversationsForProject(p.id)
        const projectActive = p.id === activeProjectId && !activeConvId
        return (
          <div key={p.id}>
            <div
              className={`conv-row project ${projectActive ? 'active' : ''}`}
              onClick={() => onProjectClick(p.id)}
              title={p.cwd}
            >
              {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
              <Folder className="conv-ico" size={15} />
              <span className="conv-title">{p.name}</span>
              <button
                className="conv-add"
                title="Nouvelle session dans ce projet"
                onClick={(e) => {
                  e.stopPropagation()
                  onNewSession(p.id)
                }}
              >
                <Plus size={14} />
              </button>
              <button
                className="conv-del"
                title="Supprimer le projet"
                onClick={(e) => {
                  e.stopPropagation()
                  onDeleteProject(p.id)
                }}
              >
                <X size={13} />
              </button>
            </div>

            {expanded && (
              <div className="session-children">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`conv-row session ${s.id === activeConvId ? 'active' : ''}`}
                    onClick={() => onOpenSession(p.id, s.id)}
                    title={s.title}
                  >
                    <ChatCircle className="conv-ico" size={14} />
                    <span className="conv-title">{s.title}</span>
                    <span className="conv-time mono">{relTime(s.updatedAt)}</span>
                    <button
                      className="conv-del"
                      title="Supprimer la session"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDeleteSession(p.id, s.id)
                      }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
                {sessions.length === 0 && <div className="conv-empty nested">Aucune session</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
