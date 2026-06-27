// Polls the git-sourced changed-files list for a project: on mount, on window
// focus, every ~15s, and on demand via refresh() (e.g. after an agent turn).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangedFile } from '@shared/types'

const POLL_MS = 15_000

export function useChangedFiles(projectId: string | undefined) {
  const [files, setFiles] = useState<ChangedFile[]>([])
  const [error, setError] = useState<string | null>(null)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  const refresh = useCallback(() => {
    const id = projectIdRef.current
    if (!id) {
      setFiles([])
      setError(null)
      return
    }
    window.api.git
      .changedFiles(id)
      .then((f) => {
        if (projectIdRef.current === id) {
          setFiles(f)
          setError(null)
        }
      })
      .catch((err) => {
        if (projectIdRef.current === id) {
          setFiles([])
          setError(err instanceof Error ? err.message : String(err))
        }
      })
  }, [])

  useEffect(() => {
    refresh()
  }, [projectId, refresh])

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  return { files, error, refresh }
}
