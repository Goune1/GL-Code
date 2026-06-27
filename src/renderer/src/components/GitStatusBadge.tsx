// Discreet bottom-of-chat badge: branch · dot · file count (when changes exist).
// Clicking opens the review panel. Refreshes once per agent turn.
import { useEffect, useMemo, useRef } from 'react'
import { GitBranch } from '@phosphor-icons/react'
import { useGitStatus } from '../useGitStatus'
import { useChangedFiles } from '../useChangedFiles'
import type { ChatMessage } from '../chat'

interface Props {
  projectId: string
  messages: ChatMessage[]
  onOpenReview?: () => void
}

export function GitStatusBadge({ projectId, messages, onOpenReview }: Props) {
  const { status, refresh: refreshStatus } = useGitStatus(projectId)
  const { files, refresh: refreshFiles } = useChangedFiles(projectId)

  const turnKey = `${messages.length}:${messages[messages.length - 1]?.streaming ?? ''}`
  const prevTurnKey = useRef(turnKey)
  useEffect(() => {
    if (prevTurnKey.current === turnKey) return
    prevTurnKey.current = turnKey
    const last = messages[messages.length - 1]
    if (last && last.role === 'assistant' && !last.streaming) {
      refreshStatus()
      refreshFiles()
    }
  }, [turnKey, messages, refreshStatus, refreshFiles])

  const totals = useMemo(
    () => files.reduce((acc, f) => ({ add: acc.add + f.additions, rem: acc.rem + f.deletions }), { add: 0, rem: 0 }),
    [files],
  )

  if (!status || !status.isRepo) return null

  const hasChanges = files.length > 0
  const clickable = hasChanges && !!onOpenReview

  return (
    <div
      className={`git-badge${clickable ? ' clickable' : ''}`}
      title={clickable ? 'Ouvrir la revue des modifications' : hasChanges ? 'Modifications non commitées' : 'Aucune modification'}
      onClick={clickable ? onOpenReview : undefined}
      role={clickable ? 'button' : undefined}
    >
      <GitBranch className="ico" size={13} />
      <span className="git-badge-branch mono">{status.branch ?? '—'}</span>
      {hasChanges && <span className="git-badge-dot" />}
      {hasChanges && (
        <>
          <span className="git-badge-sep">·</span>
          <span className="git-badge-files mono">
            {files.length} fichier{files.length === 1 ? '' : 's'} · +{totals.add} / −{totals.rem}
          </span>
        </>
      )}
    </div>
  )
}
