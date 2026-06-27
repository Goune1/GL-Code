// ---------------------------------------------------------------------------
// Read-only filesystem access for the project tree. STRICTLY read-only and
// bounded to the active project's root. The renderer never sees an arbitrary FS:
// it passes a projectId (resolved to a root here) + a relative path, which we
// validate cannot escape the root. There is NO writeFile — by design.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, resolve, relative, sep } from 'node:path'
import type { FsEntry, FilePreview } from '../shared/types'
import { getProject } from './db'

const ALWAYS_IGNORE = new Set(['.git', 'node_modules'])
const MAX_PREVIEW_BYTES = 512 * 1024

/** Resolve + validate a relative path against the project root. Throws on escape. */
function safeResolve(root: string, relPath: string): string {
  const target = resolve(root, relPath || '.')
  const rel = relative(root, target)
  if (rel === '') return target // the root itself
  if (rel.startsWith('..') || rel.startsWith(`..${sep}`) || resolve(rel) === rel) {
    // starts with .. (escapes) OR is absolute (path.relative returns abs only
    // when on different drives) -> reject.
    throw new Error('Chemin hors du projet refusé.')
  }
  return target
}

function rootOf(projectId: string): string {
  const p = getProject(projectId)
  if (!p) throw new Error('Projet introuvable.')
  if (!existsSync(p.cwd)) throw new Error('Dossier du projet introuvable sur le disque.')
  return p.cwd
}

/** Very small .gitignore support: bare names / dir names, no globs. */
function loadIgnoredNames(root: string): Set<string> {
  const names = new Set(ALWAYS_IGNORE)
  try {
    const gi = readFileSync(join(root, '.gitignore'), 'utf8')
    for (const raw of gi.split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || line.startsWith('!')) continue
      if (line.includes('*') || line.includes('/')) {
        // skip globs / nested patterns (keep it "simple" per spec), but allow a
        // trailing-slash dir name like "dist/".
        if (line.endsWith('/') && !line.slice(0, -1).includes('/')) {
          names.add(line.slice(0, -1))
        }
        continue
      }
      names.add(line)
    }
  } catch {
    /* no .gitignore */
  }
  return names
}

export function fsListDir(projectId: string, relPath: string): FsEntry[] {
  const root = rootOf(projectId)
  const dir = safeResolve(root, relPath)
  const ignored = loadIgnoredNames(root)
  const entries = readdirSync(dir, { withFileTypes: true })
  const out: FsEntry[] = []
  for (const e of entries) {
    if (ignored.has(e.name)) continue
    const childRel = (relPath ? `${relPath}/` : '') + e.name
    const isDir = e.isDirectory()
    if (!isDir && !e.isFile()) continue // skip symlinks/sockets/etc.
    out.push({ name: e.name, path: childRel, type: isDir ? 'dir' : 'file' })
  }
  // Dirs first, then files; alphabetical within each.
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  return out
}

export function fsReadFile(projectId: string, relPath: string): FilePreview {
  const root = rootOf(projectId)
  const target = safeResolve(root, relPath)
  const st = statSync(target)
  if (st.size > MAX_PREVIEW_BYTES) {
    return { path: relPath, content: '', truncated: false, tooLarge: true }
  }
  const buf = readFileSync(target)
  // Heuristic binary check: NUL byte in the first chunk.
  const slice = buf.subarray(0, 4096)
  if (slice.includes(0)) {
    return { path: relPath, content: '', truncated: false, tooLarge: true }
  }
  return { path: relPath, content: buf.toString('utf8'), truncated: false, tooLarge: false }
}

export function fsStat(projectId: string, relPath: string): { type: 'dir' | 'file'; size: number } {
  const root = rootOf(projectId)
  const target = safeResolve(root, relPath)
  const st = statSync(target)
  return { type: st.isDirectory() ? 'dir' : 'file', size: st.size }
}
