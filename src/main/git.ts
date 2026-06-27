// ---------------------------------------------------------------------------
// Git + gh detection — READ ONLY. Git is the SOLE source of truth for a
// project's status/diffs (never derived from SDK Edit/Write events, which miss
// changes made via Bash, lockfiles, etc.). Bounded to the active project's cwd,
// same pattern as fsapi.ts / shellapi.ts.
//
// gh is a SYSTEM dependency (not npm): we spawn it and detect its absence
// cleanly. The app never stores a GitHub token — auth belongs to `gh`.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import simpleGit from 'simple-git'
import type { ChangedFile, ChangedFileStatus, CommitInfo, CommitResult, FileDiff, GhPrResult, GhStatus, GitPushResult, GitStatus } from '../shared/types'
import { getProject } from './db'

const GH_TIMEOUT_MS = 8_000
const GH_PR_TIMEOUT_MS = 30_000
const MAX_DIFF_BYTES = 2 * 1024 * 1024

function cwdOf(projectId: string): string {
  const project = getProject(projectId)
  if (!project) throw new Error('Projet introuvable.')
  if (!existsSync(project.cwd)) throw new Error('Dossier du projet introuvable sur le disque.')
  return project.cwd
}

/** Resolve + validate a repo-relative path against the project root. Throws on escape. */
function safeResolve(root: string, relPath: string): string {
  const target = resolve(root, relPath)
  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..') || rel.startsWith(`..${sep}`) || resolve(rel) === rel) {
    throw new Error('Chemin hors du projet refusé.')
  }
  return target
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/')
}

/** `gh auth status` — detects install + auth without ever touching a token. */
function getGhStatus(): Promise<GhStatus> {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn('gh', ['auth', 'status'], { windowsHide: true })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolve({ installed: true, authenticated: false })
    }, GH_TIMEOUT_MS)

    let out = ''
    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))

    child.on('error', () => {
      // ENOENT (gh not on PATH) lands here on both win32 and posix.
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ installed: false, authenticated: false })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const m = /Logged in to .* as ([^\s]+)/.exec(out)
      resolve({ installed: true, authenticated: code === 0, account: m?.[1] })
    })
  })
}

export async function getGitStatus(projectId: string): Promise<GitStatus> {
  const cwd = cwdOf(projectId)
  const gh = await getGhStatus()

  const empty: GitStatus = {
    isRepo: false,
    branch: null,
    hasUncommittedChanges: false,
    ahead: 0,
    behind: 0,
    hasUpstream: false,
    hasRemote: false,
    gh,
  }

  try {
    const git = simpleGit(cwd)
    const isRepo = await git.checkIsRepo()
    if (!isRepo) return empty

    const status = await git.status()
    const remotes = await git.getRemotes()

    return {
      isRepo: true,
      branch: status.current,
      hasUncommittedChanges: status.files.length > 0,
      ahead: status.ahead,
      behind: status.behind,
      hasUpstream: !!status.tracking,
      hasRemote: remotes.length > 0,
      gh,
    }
  } catch {
    return empty
  }
}

/** HEAD sha at the time a conversation is created — snapshotted, not used for
 * scoping yet. Null if there's no commit yet or the cwd isn't a repo. */
export async function getHeadSha(cwd: string): Promise<string | null> {
  try {
    const git = simpleGit(cwd)
    if (!(await git.checkIsRepo())) return null
    const sha = await git.revparse(['HEAD'])
    return sha.trim() || null
  } catch {
    return null
  }
}

function classify(index: string, workingDir: string): ChangedFileStatus | null {
  if (index === '?' && workingDir === '?') return 'untracked'
  if (workingDir === 'D' || index === 'D') return 'deleted'
  if (index === 'A') return 'added'
  return 'modified'
}

/** Best-effort line count for a file with no committed baseline to diff
 * against (untracked, or a repo with no HEAD yet). Binary files get 0/0. */
function countLinesOrBinary(absPath: string): { lines: number; binary: boolean } {
  try {
    const buf = readFileSync(absPath)
    if (buf.subarray(0, 4096).includes(0)) return { lines: 0, binary: true }
    const text = buf.toString('utf8')
    return { lines: text.length === 0 ? 0 : text.split('\n').length, binary: false }
  } catch {
    return { lines: 0, binary: true }
  }
}

/** Working tree vs HEAD, untracked files included. Read-only, git is the
 * source of truth (never derived from SDK Edit/Write tool events). */
export async function getChangedFiles(projectId: string): Promise<ChangedFile[]> {
  const cwd = cwdOf(projectId)
  const git = simpleGit(cwd)
  if (!(await git.checkIsRepo())) return []

  const status = await git.status()

  let summaryByPath = new Map<string, { insertions: number; deletions: number; binary: boolean }>()
  try {
    const summary = await git.diffSummary(['HEAD'])
    summaryByPath = new Map(
      summary.files.map((f) => [
        f.file,
        'insertions' in f
          ? { insertions: f.insertions, deletions: f.deletions, binary: false }
          : { insertions: 0, deletions: 0, binary: true },
      ]),
    )
  } catch {
    // No HEAD yet (fresh repo, zero commits) — fall through, per-file fallback below.
  }

  const out: ChangedFile[] = []

  for (const f of status.files) {
    const fileStatus = classify(f.index, f.working_dir)
    if (fileStatus === 'untracked') continue // handled below from status.not_added
    if (!fileStatus) continue

    const sf = summaryByPath.get(f.path)
    if (sf) {
      out.push({ path: toPosix(f.path), status: fileStatus, additions: sf.insertions, deletions: sf.deletions, binary: sf.binary })
    } else {
      // No committed baseline yet — best-effort: count the file's lines as additions.
      const { lines, binary } = countLinesOrBinary(resolve(cwd, f.path))
      out.push({ path: toPosix(f.path), status: fileStatus, additions: binary ? 0 : lines, deletions: 0, binary })
    }
  }

  for (const relPath of status.not_added) {
    const { lines, binary } = countLinesOrBinary(resolve(cwd, relPath))
    out.push({ path: toPosix(relPath), status: 'untracked', additions: binary ? 0 : lines, deletions: 0, binary })
  }

  out.sort((a, b) => a.path.localeCompare(b.path))
  return out
}

// ---------------------------------------------------------------------------
// Phase 3 — local commit (FIRST WRITE).  Bounded to the project cwd.
// Each call requires an explicit user confirmation in the modal before it
// reaches this function. No token is ever stored or logged.
// ---------------------------------------------------------------------------

/** Stage the selected files and create a commit. Returns short hash + branch. */
export async function gitCommit(
  projectId: string,
  relPaths: string[],
  message: string,
): Promise<CommitResult> {
  if (relPaths.length === 0) throw new Error('Aucun fichier sélectionné.')
  if (!message.trim()) throw new Error('Le message de commit est requis.')

  const cwd = cwdOf(projectId)
  // Path validation — no escape outside the project root.
  for (const p of relPaths) safeResolve(cwd, p)

  const git = simpleGit(cwd)
  if (!(await git.checkIsRepo())) throw new Error('Pas un dépôt git.')

  // Check git identity — required for every commit.
  const nameRaw = await git.raw(['config', '--get', 'user.name']).catch(() => '')
  const emailRaw = await git.raw(['config', '--get', 'user.email']).catch(() => '')
  if (!nameRaw.trim() || !emailRaw.trim()) {
    throw new Error(
      'Identité git non configurée.\n' +
        'Lance dans un terminal :\n' +
        '  git config user.name "Ton Nom"\n' +
        '  git config user.email "ton@email.com"',
    )
  }

  // Stage selected files (covers modified, added, deleted, untracked).
  await git.add(relPaths)

  // Commit — simple-git throws a GitError if there is nothing to commit.
  let summary
  try {
    summary = await git.commit(message.trim())
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // git exits 1 with "nothing to commit" when the index has no changes.
    if (msg.includes('nothing to commit')) throw new Error("Rien à commit — les fichiers sélectionnés n'ont peut-être pas de modification.")
    throw err
  }

  if (!summary.commit) {
    throw new Error("Le commit n'a produit aucun hash — vérifie l'état du dépôt.")
  }

  return {
    hash: summary.commit,
    branch: summary.branch,
    filesCommitted: relPaths.length,
  }
}

/** Unified diff for a single file, working tree vs HEAD. Read-only. */
export async function getFileDiff(projectId: string, relPath: string): Promise<FileDiff> {
  const cwd = cwdOf(projectId)
  const abs = safeResolve(cwd, relPath)
  const git = simpleGit(cwd)
  if (!(await git.checkIsRepo())) throw new Error('Pas un dépôt git.')

  const status = await git.status()
  const entry = status.files.find((f) => f.path === relPath || resolve(cwd, f.path) === abs)
  const fileStatus: ChangedFileStatus = entry
    ? classify(entry.index, entry.working_dir) ?? 'modified'
    : 'modified'

  if (fileStatus === 'untracked') {
    const { lines, binary } = countLinesOrBinary(abs)
    if (binary) return { path: relPath, status: fileStatus, binary: true, diffText: '' }
    const content = readFileSync(abs, 'utf8')
    const body = content.length ? content.replace(/\n$/, '').split('\n').map((l) => `+${l}`).join('\n') : ''
    const diffText =
      `diff --git a/${relPath} b/${relPath}\n` +
      `new file mode 100644\n` +
      `index 0000000..0000000\n` +
      `--- /dev/null\n` +
      `+++ b/${relPath}\n` +
      `@@ -0,0 +1,${lines} @@\n${body}\n`
    return { path: relPath, status: fileStatus, binary: false, diffText }
  }

  try {
    const st = readFileSync(abs).subarray(0, 4096)
    if (st.includes(0)) return { path: relPath, status: fileStatus, binary: true, diffText: '' }
  } catch {
    // deleted files can't be read — fall through to git diff, which handles it fine.
  }

  const diffText = await git.diff(['HEAD', '--', relPath])
  if (Buffer.byteLength(diffText, 'utf8') > MAX_DIFF_BYTES) {
    return { path: relPath, status: fileStatus, binary: false, diffText: '' }
  }
  return { path: relPath, status: fileStatus, binary: false, diffText }
}

// ---------------------------------------------------------------------------
// Phase 4 — push + PR (remote writes). Each requires explicit confirmation in
// the UI before reaching here. gh auth belongs to the CLI, never to this app.
// ---------------------------------------------------------------------------

/** git push — handles first push (--set-upstream) and normal push. */
export async function gitPush(projectId: string): Promise<GitPushResult> {
  const cwd = cwdOf(projectId)
  const git = simpleGit(cwd)
  if (!(await git.checkIsRepo())) throw new Error('Pas un dépôt git.')

  const status = await git.status()
  const branch = status.current
  if (!branch) throw new Error('Branche courante introuvable (HEAD détaché ?).')

  const remotes = await git.getRemotes()
  if (remotes.length === 0) {
    throw new Error(
      'Aucun remote configuré.\nAjoute-en un :\n  git remote add origin <url-github>',
    )
  }

  const remote = remotes.some((r) => r.name === 'origin') ? 'origin' : remotes[0].name
  const hasUpstream = !!status.tracking

  try {
    if (!hasUpstream) {
      await git.push(['--set-upstream', remote, branch])
    } else {
      await git.push()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('rejected') || msg.includes('non-fast-forward')) {
      throw new Error(
        "Push rejeté — la branche distante a des commits que tu n'as pas en local.\n" +
          'Tente : git pull --rebase, puis push à nouveau.',
      )
    }
    throw err
  }

  return { branch, remote, setUpstream: !hasUpstream }
}

/** Commits since the upstream tracking branch (for PR pre-fill).
 *  Falls back to the last 10 commits when there's no upstream yet. */
export async function getCommitsSinceUpstream(projectId: string): Promise<CommitInfo[]> {
  const cwd = cwdOf(projectId)
  const git = simpleGit(cwd)
  if (!(await git.checkIsRepo())) return []

  try {
    const status = await git.status()
    const range = status.tracking ? [`${status.tracking}..HEAD`] : ['-10']
    const log = await git.log(range)
    return log.all.map((c) => ({
      hash: c.hash.slice(0, 7),
      subject: c.message,
      body: c.body ?? '',
    }))
  } catch {
    return []
  }
}

/** Create a PR via `gh pr create`. Requires gh installed + authenticated.
 *  Returns the PR URL printed by gh on stdout. */
export function ghCreatePr(
  projectId: string,
  title: string,
  body: string,
): Promise<GhPrResult> {
  return new Promise(async (resolve, reject) => {
    const cwd = cwdOf(projectId)
    const gh = await getGhStatus()
    if (!gh.installed) {
      return reject(new Error('gh CLI introuvable. Installe GitHub CLI : https://cli.github.com/'))
    }
    if (!gh.authenticated) {
      return reject(new Error("gh non authentifié.\nLance : gh auth login"))
    }

    let out = ''
    let errOut = ''
    let settled = false

    const child = spawn('gh', ['pr', 'create', '--title', title, '--body', body], {
      cwd,
      windowsHide: true,
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('Timeout lors de la création de la PR (30 s).'))
    }, GH_PR_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => (out += chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => (errOut += chunk.toString('utf8')))

    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(e)
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        return reject(new Error(errOut.trim() || `gh pr create a échoué (code ${code}).`))
      }
      // gh outputs the PR URL as the last non-empty line.
      const url = out.trim().split('\n').filter(Boolean).pop() ?? ''
      resolve({ url })
    })
  })
}
