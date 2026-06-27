// Polls git/gh status for a project: on mount, on window focus, every ~15s,
// and on demand via the returned `refresh()` (e.g. after an agent turn ends).
import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatus } from '@shared/types'

const POLL_MS = 15_000

export function useGitStatus(projectId: string | undefined) {
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const projectIdRef = useRef(projectId)
  projectIdRef.current = projectId

  const refresh = useCallback(() => {
    const id = projectIdRef.current
    if (!id) {
      setStatus(null)
      setError(null)
      return
    }
    window.api.git
      .status(id)
      .then((s) => {
        if (projectIdRef.current === id) {
          setStatus(s)
          setError(null)
        }
      })
      .catch((err) => {
        if (projectIdRef.current === id) {
          setStatus(null)
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

  return { status, error, refresh }
}
