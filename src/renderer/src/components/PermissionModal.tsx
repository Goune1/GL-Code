import { Warning, X } from '@phosphor-icons/react'
import type { PermissionRequest } from '@shared/types'

interface Props {
  request: PermissionRequest
  onRespond: (requestId: string, approved: boolean) => void
}

function inputSummary(req: PermissionRequest): string {
  const i = req.input as Record<string, unknown>
  if (typeof i.command === 'string') return i.command
  if (typeof i.file_path === 'string') return String(i.file_path)
  if (typeof i.path === 'string') return String(i.path)
  if (typeof i.url === 'string') return String(i.url)
  try {
    return JSON.stringify(i, null, 2)
  } catch {
    return ''
  }
}

export function PermissionModal({ request, onRespond }: Props) {
  const title = request.title ?? `Claude veut utiliser l'outil « ${request.toolName} »`
  const summary = inputSummary(request)

  return (
    <div className="modal-backdrop">
      <div className="modal perm">
        <div className="modal-head">
          <h2>Autorisation requise</h2>
          <span className="pill mono">{request.toolName}</span>
        </div>
        <div className="modal-body">
          <p className="perm-title">{title}</p>
          {request.description && <p className="perm-desc">{request.description}</p>}
          {summary && <pre className="tool-detail perm-input">{summary}</pre>}
          <p className="perm-warn">
            <Warning size={15} />
            Action non lecture-seule. Approuve seulement si tu comprends ce qu'elle fait.
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={() => onRespond(request.requestId, false)}>
            <X size={15} /> Refuser
          </button>
          <button className="btn primary" onClick={() => onRespond(request.requestId, true)}>
            Autoriser
          </button>
        </div>
      </div>
    </div>
  )
}
