import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { ShellRunResult } from '../shared/types'
import { getProject } from './db'

const MAX_OUTPUT = 64 * 1024
const RUN_TIMEOUT_MS = 30_000

function cwdOf(projectId: string): string {
  const project = getProject(projectId)
  if (!project) throw new Error('Projet introuvable.')
  if (!existsSync(project.cwd)) throw new Error('Dossier du projet introuvable sur le disque.')
  return project.cwd
}

function trimOutput(value: string): string {
  if (value.length <= MAX_OUTPUT) return value
  return `${value.slice(0, MAX_OUTPUT)}\n\n[sortie tronquee]`
}

export function shellRun(projectId: string, command: string): Promise<ShellRunResult> {
  const cwd = cwdOf(projectId)
  const cmd = command.trim()
  if (!cmd) throw new Error('Commande vide.')

  return new Promise((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/d', '/s', '/c', cmd], { cwd, windowsHide: true })
        : spawn('/bin/sh', ['-lc', cmd], { cwd })

    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const finish = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        command: cmd,
        cwd,
        stdout: trimOutput(stdout),
        stderr: trimOutput(stderr),
        exitCode,
        timedOut,
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, RUN_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = trimOutput(stdout + chunk.toString('utf8'))
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = trimOutput(stderr + chunk.toString('utf8'))
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => finish(code))
  })
}
