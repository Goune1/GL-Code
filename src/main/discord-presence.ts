import { createServer, type Server } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import type { DiscordPresenceSettings, PresenceActivity } from '../shared/types'

const DISCORD_RPC_VERSION = 1
const RECONNECT_MS = 15_000
const DISCORD_CLIENT_ID = '1520110163464290535'
const DISCORD_APP_NAME = 'GL Code'
const DEFAULT_LARGE_IMAGE_PATH =
  process.env.WRAPPER_DISCORD_LARGE_IMAGE_PATH ?? 'C:\\Users\\goune\\Downloads\\6RaNwWvj_400x400.jpg'
const IMAGE_ROUTE = '/discord-presence-large-image'

const enum OpCode {
  Handshake = 0,
  Frame = 1,
  Close = 2,
  Ping = 3,
  Pong = 4,
}

interface RpcFrame {
  cmd?: string
  evt?: string
  nonce?: string
  data?: unknown
}

function ipcPath(index: number): string {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${index}`

  const candidates = [
    process.env.XDG_RUNTIME_DIR,
    process.env.TMPDIR,
    process.env.TMP,
    process.env.TEMP,
    '/tmp',
    join(homedir(), '.discord-ipc'),
  ].filter(Boolean) as string[]

  return join(candidates[0], `discord-ipc-${index}`)
}

function writeFrame(socket: Socket, op: OpCode, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const head = Buffer.allocUnsafe(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(body.length, 4)
  socket.write(Buffer.concat([head, body]))
}

function shortText(value: string | undefined, fallback: string, max = 120): string {
  const text = (value || fallback).trim() || fallback
  return text.length > max ? `${text.slice(0, max - 1)}...` : text
}

function agentLabel(activity: PresenceActivity): string {
  return shortText(
    activity.agentLabel ?? (activity.agentId === 'claude-code' ? 'Claude Code' : 'OpenClaw'),
    activity.agentId === 'claude-code' ? 'Claude Code' : 'OpenClaw',
  )
}

function workspaceLabel(activity: PresenceActivity): string {
  const fallback = activity.workspaceCwd ? basename(activity.workspaceCwd) : 'Aucun workspace'
  return shortText(activity.workspaceName ?? fallback, fallback)
}

function mimeForImage(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

export class DiscordPresence {
  private enabled = false
  private socket?: Socket
  private connected = false
  private connecting = false
  private pipeIndex = 0
  private reconnectTimer?: NodeJS.Timeout
  private buffer = Buffer.alloc(0)
  private startedAt = Date.now()
  private lastActivity: PresenceActivity = { agentId: 'openclaw' }
  private largeImageUrl?: string
  private largeImageUrlPromise?: Promise<string | undefined>
  private largeImageServer?: Server
  private largeImageBuffer?: Buffer
  private largeImageMime = 'image/jpeg'

  configure(settings: DiscordPresenceSettings): void {
    const changed = settings.enabled !== this.enabled
    this.enabled = settings.enabled

    if (!this.enabled) {
      this.clearReconnect()
      this.closeLargeImageServer()
      this.disconnect()
      return
    }

    if (changed) this.disconnect()
    this.ensureConnected()
    if (!this.largeImageUrl && !this.largeImageUrlPromise) {
      void this.ensureLargeImageUrl().then(() => {
        if (this.enabled && this.connected) this.sendActivity()
      })
    }
  }

  setActivity(activity: PresenceActivity): void {
    this.lastActivity = activity
    if (!this.enabled) return
    this.ensureConnected()
    if (!this.largeImageUrl && !this.largeImageUrlPromise) {
      void this.ensureLargeImageUrl().then(() => {
        if (this.enabled && this.connected) this.sendActivity()
      })
    }
    if (this.connected && this.socket) this.sendActivity()
  }

  shutdown(): void {
    this.clearReconnect()
    if (this.connected && this.socket) this.sendRawActivity(null)
    this.closeLargeImageServer()
    this.disconnect()
  }

  private ensureConnected(): void {
    if (!this.enabled || this.connected || this.connecting) return
    this.connecting = true
    this.tryPipe(0)
  }

  private tryPipe(index: number): void {
    if (!this.enabled) {
      this.connecting = false
      return
    }
    if (index > 9) {
      this.connecting = false
      this.scheduleReconnect()
      return
    }

    const socket = connect(ipcPath(index))
    let settled = false
    let timer: NodeJS.Timeout

    const fail = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      this.tryPipe(index + 1)
    }

    timer = setTimeout(fail, 750)

    socket.once('connect', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.off('error', fail)
      this.socket = socket
      this.pipeIndex = index
      this.buffer = Buffer.alloc(0)
      writeFrame(socket, OpCode.Handshake, {
        v: DISCORD_RPC_VERSION,
        client_id: DISCORD_CLIENT_ID,
      })
      socket.on('data', (chunk) => this.onData(chunk))
      socket.on('close', () => this.onClose())
      socket.on('error', () => this.onClose())
    })

    socket.once('error', fail)
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])

    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0)
      const len = this.buffer.readInt32LE(4)
      if (this.buffer.length < 8 + len) return

      const raw = this.buffer.subarray(8, 8 + len).toString('utf8')
      this.buffer = this.buffer.subarray(8 + len)

      if (op === OpCode.Ping) {
        try {
          writeFrame(this.socket!, OpCode.Pong, JSON.parse(raw))
        } catch {
          writeFrame(this.socket!, OpCode.Pong, {})
        }
        continue
      }

      if (op === OpCode.Close) {
        this.disconnect()
        this.scheduleReconnect()
        return
      }

      if (op !== OpCode.Frame) continue

      let frame: RpcFrame
      try {
        frame = JSON.parse(raw) as RpcFrame
      } catch {
        continue
      }

      if (frame.cmd === 'DISPATCH' && frame.evt === 'READY') {
        this.connected = true
        this.connecting = false
        this.clearReconnect()
        this.sendActivity()
      } else if (frame.evt === 'ERROR') {
        this.disconnect()
        this.scheduleReconnect()
      }
    }
  }

  private onClose(): void {
    const shouldReconnect = this.enabled
    this.connected = false
    this.connecting = false
    this.socket = undefined
    if (shouldReconnect) this.scheduleReconnect()
  }

  private disconnect(): void {
    this.connected = false
    this.connecting = false
    this.buffer = Buffer.alloc(0)
    const socket = this.socket
    this.socket = undefined
    socket?.destroy()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.enabled) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.ensureConnected()
    }, RECONNECT_MS)
  }

  private clearReconnect(): void {
    if (!this.reconnectTimer) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }

  private async ensureLargeImageUrl(): Promise<string | undefined> {
    if (this.largeImageUrl) return this.largeImageUrl
    if (this.largeImageUrlPromise) return this.largeImageUrlPromise

    this.largeImageUrlPromise = new Promise<string | undefined>((resolve) => {
      if (!existsSync(DEFAULT_LARGE_IMAGE_PATH)) {
        resolve(undefined)
        return
      }

      this.largeImageBuffer = readFileSync(DEFAULT_LARGE_IMAGE_PATH)
      this.largeImageMime = mimeForImage(DEFAULT_LARGE_IMAGE_PATH)

      const server = createServer((req, res) => {
        if (req.url !== IMAGE_ROUTE) {
          res.statusCode = 404
          res.end()
          return
        }

        if (!this.largeImageBuffer) {
          res.statusCode = 404
          res.end()
          return
        }

        res.setHeader('Content-Type', this.largeImageMime)
        res.setHeader('Cache-Control', 'no-store')
        res.end(this.largeImageBuffer)
      })

      server.once('error', () => resolve(undefined))
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (address && typeof address === 'object') {
          this.largeImageServer = server
          this.largeImageUrl = `http://127.0.0.1:${address.port}${IMAGE_ROUTE}`
          resolve(this.largeImageUrl)
          return
        }
        resolve(undefined)
      })
    })

    return this.largeImageUrlPromise.finally(() => {
      this.largeImageUrlPromise = undefined
    })
  }

  private closeLargeImageServer(): void {
    const server = this.largeImageServer
    this.largeImageServer = undefined
    this.largeImageBuffer = undefined
    this.largeImageUrl = undefined
    this.largeImageUrlPromise = undefined
    server?.close()
  }

  private sendActivity(): void {
    const agent = agentLabel(this.lastActivity)
    const workspace = workspaceLabel(this.lastActivity)
    const assets = this.largeImageUrl
      ? { large_image: this.largeImageUrl, large_text: agent }
      : undefined

    this.sendRawActivity({
      name: DISCORD_APP_NAME,
      details: agent,
      state: workspace,
      assets,
      timestamps: { start: this.startedAt },
      instance: false,
    })
  }

  private sendRawActivity(activity: Record<string, unknown> | null): void {
    if (!this.socket || !this.connected) return
    writeFrame(this.socket, OpCode.Frame, {
      cmd: 'SET_ACTIVITY',
      args: {
        pid: process.pid,
        activity,
      },
      nonce: `${Date.now()}-${this.pipeIndex}`,
    })
  }
}

export const discordPresence = new DiscordPresence()
