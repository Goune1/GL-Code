// Modification review panel — READ ONLY. Git is the source of truth (working
// tree vs HEAD, untracked files included). No editor, no writes here; writes
// land in phase 3 (commit) / phase 4 (push + PR).
import { useEffect, useMemo, useState } from 'react'
import { X, GitDiff, ArrowsClockwise, Rows, Columns } from '@phosphor-icons/react'
import { Diff, Hunk, parseDiff, type ViewType } from 'react-diff-view'
import 'react-diff-view/style/index.css'
import type { ChangedFile, ChangedFileStatus, FileDiff, Project } from '@shared/types'
import { useChangedFiles } from '../useChangedFiles'

interface Props {
  project: Project
  onClose: () => void
}

const STATUS_LETTER: Record<ChangedFileStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  untracked: 'U',
}

function baseName(p: string): string {
  return p.split('/').pop() ?? p
}

function dirOf(p: string): string {
  const idx = p.lastIndexOf('/')
  return idx === -1 ? '' : p.slice(0, idx)
}

function groupByDir(files: ChangedFile[]): Array<{ dir: string; files: ChangedFile[] }> {
  const map = new Map<string, ChangedFile[]>()
  for (const f of files) {
    const dir = dirOf(f.path)
    const arr = map.get(dir) ?? []
    arr.push(f)
    map.set(dir, arr)
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, dirFiles]) => ({ dir, files: dirFiles }))
}

export function ReviewPanel({ project, onClose }: Props) {
  const { files, error, refresh } = useChangedFiles(project.id)
  const [selected, setSelected] = useState<string | null>(null)
  const [viewType, setViewType] = useState<ViewType>('unified')

  useEffect(() => {
    if (files.length === 0) {
      setSelected(null)
      return
    }
    if (!selected || !files.some((f) => f.path === selected)) setSelected(files[0].path)
  }, [files, selected])

  const groups = useMemo(() => groupByDir(files), [files])
  const totals = useMemo(
    () => files.reduce((acc, f) => ({ add: acc.add + f.additions, rem: acc.rem + f.deletions }), { add: 0, rem: 0 }),
    [files],
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="review-panel" onClick={(e) => e.stopPropagation()}>
        <div className="review-head">
          <GitDiff size={16} />
          <span className="review-title">Revue des modifications</span>
          <span className="review-summary mono">
            {files.length} fichier{files.length === 1 ? '' : 's'} · +{totals.add} / −{totals.rem}
          </span>
          <span className="spacer" />
          <button className="icon-btn" title="Rafraîchir" onClick={refresh}>
            <ArrowsClockwise size={16} />
          </button>
          <button className="icon-btn" title="Fermer" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {error && <div className="vc-error" style={{ margin: '10px 18px' }}>{error}</div>}

        <div className="review-body">
          <div className="review-tree">
            {files.length === 0 ? (
              <div className="conv-empty">Aucune modification (working tree vs HEAD).</div>
            ) : (
              groups.map(({ dir, files: dirFiles }) => (
                <div className="review-group" key={dir || '.'}>
                  <div className="review-group-head mono" title={dir || project.cwd}>
                    {dir || '.'}
                  </div>
                  {dirFiles.map((f) => (
                    <button
                      key={f.path}
                      type="button"
                      className={`review-file-row ${f.path === selected ? 'active' : ''}`}
                      onClick={() => setSelected(f.path)}
                      title={f.path}
                    >
                      <span className={`review-status ${f.status}`}>{STATUS_LETTER[f.status]}</span>
                      <span className="review-file-name">{baseName(f.path)}</span>
                      <span className="review-file-delta">
                        {f.binary ? (
                          <span className="review-binary">bin</span>
                        ) : (
                          <>
                            {f.additions > 0 && <span className="d-add">+{f.additions}</span>}
                            {f.deletions > 0 && <span className="d-rem">−{f.deletions}</span>}
                          </>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>

          <div className="review-diff">
            {selected ? (
              <FileDiffView
                key={selected}
                projectId={project.id}
                path={selected}
                viewType={viewType}
                onSetViewType={setViewType}
              />
            ) : (
              <div className="review-diff-empty">Sélectionne un fichier pour voir son diff.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function FileDiffView({
  projectId,
  path,
  viewType,
  onSetViewType,
}: {
  projectId: string
  path: string
  viewType: ViewType
  onSetViewType: (v: ViewType) => void
}) {
  const [diff, setDiff] = useState<FileDiff | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setDiff(null)
    setErr(null)
    window.api.git
      .fileDiff(projectId, path)
      .then((d) => alive && setDiff(d))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
  }, [projectId, path])

  if (err) return <div className="vc-error" style={{ padding: '14px 18px' }}>{err}</div>
  if (!diff) return <div className="review-diff-empty">Chargement…</div>
  if (diff.binary || !diff.diffText.trim()) {
    return <div className="review-diff-empty">Aperçu indisponible (fichier binaire ou trop volumineux).</div>
  }

  let parsed
  try {
    parsed = parseDiff(diff.diffText)
  } catch {
    return <div className="review-diff-empty">Diff illisible.</div>
  }

  return (
    <>
      <div className="review-diff-head">
        <span className="review-diff-path mono" title={diff.path}>{diff.path}</span>
        <span className="spacer" />
        <button
          type="button"
          className={`icon-btn ${viewType === 'unified' ? 'active' : ''}`}
          title="Vue unifiée"
          onClick={() => onSetViewType('unified')}
        >
          <Rows size={15} />
        </button>
        <button
          type="button"
          className={`icon-btn ${viewType === 'split' ? 'active' : ''}`}
          title="Vue côte à côte"
          onClick={() => onSetViewType('split')}
        >
          <Columns size={15} />
        </button>
      </div>
      <div className="review-diff-scroll">
        {parsed.map((file) => (
          <Diff
            key={`${file.oldRevision}-${file.newRevision}`}
            viewType={viewType}
            diffType={file.type}
            hunks={file.hunks}
          >
            {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
          </Diff>
        ))}
      </div>
    </>
  )
}
