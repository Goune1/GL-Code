// Commit modal — Phase 3, first local write. Stages the selected files and
// creates a commit. Each commit requires an explicit click on the Commit button
// (that IS the confirmation). No token is stored, no remote operation here.
import { useEffect, useMemo, useState } from 'react'
import { X, GitCommit, CheckSquare, Square, Warning } from '@phosphor-icons/react'
import type { ChangedFile, ChangedFileStatus, CommitResult, Project } from '@shared/types'
import { useChangedFiles } from '../useChangedFiles'

interface Props {
  project: Project
  onClose: () => void
  onCommitted: (result: CommitResult) => void
}

const STATUS_LETTER: Record<ChangedFileStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'U',
}

function baseName(p: string) {
  return p.split('/').pop() ?? p
}

export function CommitModal({ project, onClose, onCommitted }: Props) {
  const { files, error: loadError, refresh } = useChangedFiles(project.id)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [result, setResult] = useState<CommitResult | null>(null)

  // Select all files by default when the list loads.
  useEffect(() => {
    if (files.length > 0) setSelected(new Set(files.map((f) => f.path)))
  }, [files])

  const toggleFile = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === files.length) setSelected(new Set())
    else setSelected(new Set(files.map((f) => f.path)))
  }

  const selectedCount = selected.size
  const canCommit = selectedCount > 0 && message.trim().length > 0 && !committing

  const totals = useMemo(
    () =>
      files
        .filter((f) => selected.has(f.path))
        .reduce((acc, f) => ({ add: acc.add + f.additions, rem: acc.rem + f.deletions }), {
          add: 0,
          rem: 0,
        }),
    [files, selected],
  )

  const handleCommit = async () => {
    if (!canCommit) return
    setCommitting(true)
    setCommitError(null)
    try {
      const r = await window.api.git.commit(project.id, [...selected], message.trim())
      setResult(r)
      onCommitted(r)
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : String(err))
    } finally {
      setCommitting(false)
    }
  }

  // Success view — shows commit hash, closes after a moment or on click.
  if (result) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal commit-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <GitCommit size={16} />
            <h2>Commit créé</h2>
            <button className="icon-btn" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          <div className="modal-body commit-success">
            <div className="commit-hash-row">
              <span className="commit-hash-label">Hash</span>
              <code className="commit-hash mono">{result.hash}</code>
            </div>
            <div className="commit-hash-row">
              <span className="commit-hash-label">Branche</span>
              <span className="mono">{result.branch}</span>
            </div>
            <div className="commit-hash-row">
              <span className="commit-hash-label">Fichiers</span>
              <span>{result.filesCommitted} fichier{result.filesCommitted === 1 ? '' : 's'}</span>
            </div>
            <div className="commit-message-preview">{message}</div>
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
          <GitCommit size={16} />
          <h2>Commit</h2>
          <span className="modal-subtitle">
            {project.name} · {selectedCount} sélectionné{selectedCount === 1 ? '' : 's'}
            {selectedCount > 0 && !files.every((f) => f.binary) && (
              <span className="commit-totals mono">
                {' '}+{totals.add} / −{totals.rem}
              </span>
            )}
          </span>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body commit-body">
          {loadError && <div className="vc-error commit-load-error">{loadError}</div>}

          {files.length === 0 && !loadError ? (
            <div className="commit-empty">Aucune modification dans le working tree — rien à commit.</div>
          ) : (
            <>
              <div className="commit-section-head">
                <span className="commit-section-label">Fichiers</span>
                <button
                  type="button"
                  className="link-btn commit-toggle-all"
                  onClick={toggleAll}
                >
                  {selected.size === files.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                </button>
              </div>

              <div className="commit-file-list">
                {files.map((f) => (
                  <CommitFileRow
                    key={f.path}
                    file={f}
                    checked={selected.has(f.path)}
                    onToggle={() => toggleFile(f.path)}
                  />
                ))}
              </div>

              <div className="commit-section-head commit-msg-head">
                <span className="commit-section-label">Message</span>
                <span className="commit-chars mono">{message.length}</span>
              </div>

              <textarea
                className="commit-msg-input"
                placeholder="feat: ..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                autoFocus
              />
            </>
          )}

          {commitError && (
            <div className="commit-error">
              <Warning size={14} />
              <pre className="commit-error-text">{commitError}</pre>
            </div>
          )}
        </div>

        {files.length > 0 && (
          <div className="modal-foot">
            <button
              type="button"
              className="btn ghost"
              onClick={() => { refresh(); setCommitError(null) }}
              disabled={committing}
            >
              Rafraîchir
            </button>
            <span className="spacer" />
            <button type="button" className="btn" onClick={onClose} disabled={committing}>
              Annuler
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!canCommit}
              onClick={handleCommit}
            >
              {committing ? 'Commit…' : 'Commit'}
            </button>
          </div>
        )}
        {files.length === 0 && (
          <div className="modal-foot">
            <button type="button" className="btn" onClick={onClose}>Fermer</button>
          </div>
        )}
      </div>
    </div>
  )
}

function CommitFileRow({
  file,
  checked,
  onToggle,
}: {
  file: ChangedFile
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={`commit-file-row ${checked ? 'checked' : ''}`}
      onClick={onToggle}
    >
      <span className="commit-file-check">
        {checked ? <CheckSquare size={14} weight="fill" /> : <Square size={14} />}
      </span>
      <span className={`review-status ${file.status}`}>{STATUS_LETTER[file.status]}</span>
      <span className="commit-file-name">{baseName(file.path)}</span>
      <span className="commit-file-dir mono">{file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''}</span>
      <span className="review-file-delta">
        {file.binary ? (
          <span className="review-binary">bin</span>
        ) : (
          <>
            {file.additions > 0 && <span className="d-add">+{file.additions}</span>}
            {file.deletions > 0 && <span className="d-rem">−{file.deletions}</span>}
          </>
        )}
      </span>
    </button>
  )
}
