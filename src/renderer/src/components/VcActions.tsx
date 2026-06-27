// VcActions — "Commit & Push ▾" dropdown + Push modal + PR modal.
// Commit modal is Phase 3 (CommitModal.tsx). Push and PR are Phase 4
// (remote writes, each requires an explicit confirmation click).
// gh auth belongs to the gh CLI; no token flows through this component.
import { useEffect, useRef, useState } from 'react'
import {
  CaretDown,
  GitCommit,
  Upload,
  GitPullRequest,
  X,
  Warning,
  ArrowSquareOut,
  Check,
} from '@phosphor-icons/react'
import type { CommitInfo, GhPrResult, GitPushResult, GitStatus, Project } from '@shared/types'
import { CommitModal } from './CommitModal'
import { useGitStatus } from '../useGitStatus'

interface Props {
  project: Project
}

// ---------------------------------------------------------------------------
// Main dropdown button
// ---------------------------------------------------------------------------
export function VcActions({ project }: Props) {
  const { status, refresh } = useGitStatus(project.id)
  const [menuOpen, setMenuOpen] = useState(false)
  const [commitOpen, setCommitOpen] = useState(false)
  const [pushOpen, setPushOpen] = useState(false)
  const [prOpen, setPrOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  // Close menu on outside click.
  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (!anchorRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  if (!status?.isRepo) return null

  const pick = (action: () => void) => {
    setMenuOpen(false)
    action()
  }

  return (
    <>
      <div className="vc-anchor" ref={anchorRef}>
        <button
          className={`vc-action-btn${menuOpen ? ' open' : ''}`}
          onClick={() => setMenuOpen((o) => !o)}
          title="Actions version control"
        >
          <GitCommit size={13} />
          <span>Commit &amp; Push</span>
          <CaretDown size={11} className="vc-caret" />
        </button>

        {menuOpen && (
          <div className="vc-menu">
            <button className="vc-menu-item" onClick={() => pick(() => setCommitOpen(true))}>
              <GitCommit size={14} className="vc-menu-ico" />
              <span className="vc-menu-label">Commit</span>
            </button>
            <button className="vc-menu-item" onClick={() => pick(() => setPushOpen(true))}>
              <Upload size={14} className="vc-menu-ico" />
              <span className="vc-menu-label">Push</span>
            </button>
            <div className="vc-menu-sep" />
            <button
              className="vc-menu-item"
              onClick={() => pick(() => setPrOpen(true))}
              disabled={!status.gh.installed || !status.gh.authenticated}
              title={
                !status.gh.installed
                  ? 'gh CLI introuvable'
                  : !status.gh.authenticated
                    ? 'gh non authentifié — lance : gh auth login'
                    : undefined
              }
            >
              <GitPullRequest size={14} className="vc-menu-ico" />
              <span className="vc-menu-label">Créer PR</span>
            </button>
          </div>
        )}
      </div>

      {commitOpen && (
        <CommitModal
          project={project}
          onClose={() => setCommitOpen(false)}
          onCommitted={() => { setCommitOpen(false); refresh() }}
        />
      )}
      {pushOpen && status && (
        <PushModal
          project={project}
          gitStatus={status}
          onClose={() => { setPushOpen(false); refresh() }}
        />
      )}
      {prOpen && (
        <PrModal project={project} onClose={() => setPrOpen(false)} />
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Push modal — single-step confirmation + result
// ---------------------------------------------------------------------------
function PushModal({
  project,
  gitStatus,
  onClose,
}: {
  project: Project
  gitStatus: GitStatus
  onClose: () => void
}) {
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GitPushResult | null>(null)

  const handlePush = async () => {
    setPushing(true)
    setError(null)
    try {
      const r = await window.api.git.push(project.id)
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPushing(false)
    }
  }

  if (result) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal commit-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <Upload size={16} />
            <h2>Push réussi</h2>
            <span className="spacer" />
            <button className="icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
          <div className="modal-body commit-success">
            <div className="commit-hash-row">
              <span className="commit-hash-label">Branche</span>
              <code className="commit-hash mono">{result.branch}</code>
            </div>
            <div className="commit-hash-row">
              <span className="commit-hash-label">Remote</span>
              <span className="mono">{result.remote}</span>
            </div>
            {result.setUpstream && (
              <div className="push-note">
                <Check size={13} /> Upstream configuré : <code className="mono">{result.remote}/{result.branch}</code>
              </div>
            )}
          </div>
          <div className="modal-foot">
            <button className="btn primary" onClick={onClose}>Fermer</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal commit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Upload size={16} />
          <h2>Push</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="commit-hash-row">
            <span className="commit-hash-label">Projet</span>
            <span className="mono" style={{ fontSize: 12 }}>{project.name}</span>
          </div>
          <div className="commit-hash-row">
            <span className="commit-hash-label">Branche</span>
            <code className="commit-hash mono">{gitStatus.branch ?? '—'}</code>
          </div>
          <div className="commit-hash-row">
            <span className="commit-hash-label">Remote</span>
            <span style={{ fontSize: 12, color: gitStatus.hasRemote ? 'var(--success)' : 'var(--danger)' }}>
              {gitStatus.hasRemote ? 'configuré' : 'aucun remote — ajoute-en un avec git remote add'}
            </span>
          </div>
          <div className="commit-hash-row">
            <span className="commit-hash-label">Upstream</span>
            <span style={{ fontSize: 12 }}>
              {gitStatus.hasUpstream
                ? `${gitStatus.ahead} commit${gitStatus.ahead === 1 ? '' : 's'} en avance`
                : 'aucun — sera créé lors du push'}
            </span>
          </div>

          {!gitStatus.hasRemote && (
            <div className="commit-error">
              <Warning size={14} />
              <pre className="commit-error-text">git remote add origin &lt;url-github&gt;</pre>
            </div>
          )}

          {error && (
            <div className="commit-error">
              <Warning size={14} />
              <pre className="commit-error-text">{error}</pre>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={pushing}>Annuler</button>
          <button
            className="btn primary"
            disabled={pushing || !gitStatus.hasRemote}
            onClick={handlePush}
          >
            {pushing ? 'Push…' : 'Push ↑'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PR modal — pre-filled from commits, creates via gh pr create
// ---------------------------------------------------------------------------
function PrModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GhPrResult | null>(null)

  useEffect(() => {
    window.api.git
      .commitsSinceUpstream(project.id)
      .then((commits: CommitInfo[]) => {
        if (commits.length === 1) {
          setTitle(commits[0].subject)
          setBody(commits[0].body)
        } else if (commits.length > 1) {
          setTitle(commits[0].subject)
          setBody(commits.map((c) => `- ${c.subject}`).join('\n'))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [project.id])

  const handleCreate = async () => {
    if (!title.trim()) return
    setCreating(true)
    setError(null)
    try {
      const r = await window.api.git.ghPrCreate(project.id, title.trim(), body.trim())
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  if (result) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal commit-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <GitPullRequest size={16} />
            <h2>PR créée</h2>
            <span className="spacer" />
            <button className="icon-btn" onClick={onClose}><X size={18} /></button>
          </div>
          <div className="modal-body commit-success">
            <div className="commit-hash-row">
              <span className="commit-hash-label">URL</span>
              <button
                className="pr-url-btn"
                onClick={() => window.api.shell.openExternal(result.url)}
                title={result.url}
              >
                <ArrowSquareOut size={13} />
                {result.url}
              </button>
            </div>
          </div>
          <div className="modal-foot">
            <button className="btn ghost" onClick={() => window.api.shell.openExternal(result.url)}>
              <ArrowSquareOut size={14} /> Ouvrir dans le navigateur
            </button>
            <button className="btn primary" onClick={onClose}>Fermer</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal commit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <GitPullRequest size={16} />
          <h2>Créer une Pull Request</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="modal-body commit-body">
          <div className="commit-section-head">
            <span className="commit-section-label">Titre</span>
          </div>
          <input
            className="commit-msg-input pr-title-input"
            style={{ margin: '0 16px 0', height: 38 }}
            placeholder={loading ? 'Chargement…' : 'feat: …'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={loading}
            autoFocus
          />

          <div className="commit-section-head commit-msg-head">
            <span className="commit-section-label">Description</span>
            <span className="commit-chars mono">{body.length}</span>
          </div>
          <textarea
            className="commit-msg-input"
            style={{ minHeight: 120 }}
            placeholder={loading ? 'Chargement…' : 'Décris les changements…'}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={loading}
            rows={6}
          />

          {error && (
            <div className="commit-error">
              <Warning size={14} />
              <pre className="commit-error-text">{error}</pre>
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={creating}>Annuler</button>
          <button
            className="btn primary"
            disabled={creating || loading || !title.trim()}
            onClick={handleCreate}
          >
            {creating ? 'Création…' : 'Créer la PR →'}
          </button>
        </div>
      </div>
    </div>
  )
}
