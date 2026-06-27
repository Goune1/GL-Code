import { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import type { FilePreview } from '@shared/types'

interface Props {
  projectId: string
  path: string
  onClose: () => void
  onTag: (relPath: string) => void
}

export function FilePreviewModal({ projectId, path, onClose, onTag }: Props) {
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.api.fs
      .readFile(projectId, path)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(e?.message ?? 'Erreur'))
    return () => {
      alive = false
    }
  }, [projectId, path])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal preview" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="mono preview-path">{path}</h2>
          <span className="pill mono">lecture seule</span>
          <button className="icon-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="modal-body preview-body">
          {error && <div className="modal-msg">{error}</div>}
          {!error && !preview && <div className="conv-empty">Chargement…</div>}
          {preview?.tooLarge && (
            <div className="conv-empty">Fichier binaire ou trop volumineux pour l'aperçu.</div>
          )}
          {preview && !preview.tooLarge && <pre className="preview-code">{preview.content}</pre>}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            Fermer
          </button>
          <button className="btn primary" onClick={() => onTag(path)}>
            Référencer (@) dans le message
          </button>
        </div>
      </div>
    </div>
  )
}
