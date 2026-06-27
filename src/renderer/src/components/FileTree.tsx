import { useEffect, useState, type CSSProperties } from 'react'
import {
  CaretRight,
  CaretDown,
  Folder,
  FileText,
  Eye,
  TreeStructure,
} from '@phosphor-icons/react'
import type { FsEntry } from '@shared/types'

interface Props {
  projectId: string
  onTag: (relPath: string) => void
  onPreview: (relPath: string) => void
}

export function FileTree({ projectId, onTag, onPreview }: Props) {
  return (
    <div className="tree">
      <div className="tree-head">
        <TreeStructure size={15} />
        <span className="section-label">Fichiers</span>
        <span className="tree-ro mono">lecture seule</span>
      </div>
      <div className="tree-body">
        <DirChildren projectId={projectId} relPath="" depth={0} onTag={onTag} onPreview={onPreview} />
      </div>
    </div>
  )
}

function DirChildren({
  projectId,
  relPath,
  depth,
  onTag,
  onPreview,
}: {
  projectId: string
  relPath: string
  depth: number
  onTag: (p: string) => void
  onPreview: (p: string) => void
}) {
  const [entries, setEntries] = useState<FsEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.api.fs
      .listDir(projectId, relPath)
      .then((e) => alive && setEntries(e))
      .catch((err) => alive && setError(err?.message ?? 'Erreur'))
    return () => {
      alive = false
    }
  }, [projectId, relPath])

  if (error) return <div className="tree-error" style={indent(depth)}>{error}</div>
  if (!entries) return <TreeSkeleton depth={depth} />
  if (entries.length === 0)
    return (
      <div className="tree-empty" style={indent(depth)}>
        (vide)
      </div>
    )

  return (
    <>
      {entries.map((e) =>
        e.type === 'dir' ? (
          <DirNode
            key={e.path}
            projectId={projectId}
            entry={e}
            depth={depth}
            onTag={onTag}
            onPreview={onPreview}
          />
        ) : (
          <FileNode key={e.path} entry={e} depth={depth} onTag={onTag} onPreview={onPreview} />
        ),
      )}
    </>
  )
}

function DirNode({
  projectId,
  entry,
  depth,
  onTag,
  onPreview,
}: {
  projectId: string
  entry: FsEntry
  depth: number
  onTag: (p: string) => void
  onPreview: (p: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <div
        className="tree-row dir"
        style={indent(depth)}
        onClick={() => setOpen((o) => !o)}
        title={entry.path}
      >
        {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
        <Folder className="t-ico" size={15} />
        <span className="tree-name">{entry.name}</span>
        <button
          className="tree-tag"
          title="Référencer ce dossier (@)"
          onClick={(ev) => {
            ev.stopPropagation()
            onTag(entry.path)
          }}
        >
          @
        </button>
      </div>
      {open && (
        <DirChildren
          projectId={projectId}
          relPath={entry.path}
          depth={depth + 1}
          onTag={onTag}
          onPreview={onPreview}
        />
      )}
    </>
  )
}

function FileNode({
  entry,
  depth,
  onTag,
  onPreview,
}: {
  entry: FsEntry
  depth: number
  onTag: (p: string) => void
  onPreview: (p: string) => void
}) {
  return (
    <div className="tree-row file" style={indent(depth)} onClick={() => onTag(entry.path)} title={entry.path}>
      <span className="t-caret-spacer" />
      <FileText className="t-ico" size={15} />
      <span className="tree-name">{entry.name}</span>
      <button
        className="tree-eye"
        title="Aperçu (lecture seule)"
        onClick={(ev) => {
          ev.stopPropagation()
          onPreview(entry.path)
        }}
      >
        <Eye size={14} />
      </button>
      <button
        className="tree-tag"
        title="Référencer ce fichier (@)"
        onClick={(ev) => {
          ev.stopPropagation()
          onTag(entry.path)
        }}
      >
        @
      </button>
    </div>
  )
}

function TreeSkeleton({ depth }: { depth: number }) {
  return (
    <div className="tree-skeleton" style={indent(depth)}>
      {[70, 52, 60].map((w, i) => (
        <div key={i} className="skeleton" style={{ width: `${w}%`, margin: '7px 0' }} />
      ))}
    </div>
  )
}

function indent(depth: number): CSSProperties {
  return { paddingLeft: `${8 + depth * 14}px` }
}
