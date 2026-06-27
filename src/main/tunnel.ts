// ---------------------------------------------------------------------------
// SSH tunnel manager — automatic, no manual ssh ever.
//
// Forwards 127.0.0.1:<localPort> (this machine) to <remoteHost>:<remotePort>
// on the VPS, THROUGH an SSH connection opened with the ssh2 library (NOT a
// spawned ssh binary). Because the gateway then sees the connection arriving on
// its own loopback, it treats us as a local client: auto-approved, no device
// pairing.
//
//   local app  --TCP-->  127.0.0.1:18789 (this server)
//                         |  ssh2 forwardOut over the SSH connection
//                         v
//   VPS sshd   --TCP-->  127.0.0.1:18789 (the gateway, loopback on the VPS)
//
// Supervised: auto-start, status events, backoff reconnect. Fallback "probe"
// mode (ssh.enabled = false) just checks that 127.0.0.1:<localPort> already
// answers, for when a tunnel is opened by other means.
// ---------------------------------------------------------------------------

import { EventEmitter } from 'node:events'
import net from 'node:net'
import { Client } from 'ssh2'
import type { AppSettings, TunnelStatus } from '../shared/types'
import { getSettings } from './settings'
import { getSecret, resolvePrivateKey } from './secrets'

const MAX_BACKOFF_MS = 30_000
const BASE_BACKOFF_MS = 1_000
const PROBE_INTERVAL_MS = 5_000
const PROBE_TIMEOUT_MS = 2_000
const READY_TIMEOUT_MS = 15_000
const KEEPALIVE_MS = 10_000

function probePort(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

export class TunnelManager extends EventEmitter {
  private status: TunnelStatus = { state: 'down', mode: 'tunnel' }
  private conn: Client | null = null
  private server: net.Server | null = null
  private shouldRun = false
  private attempt = 0
  private reconnectTimer: NodeJS.Timeout | null = null
  private probeTimer: NodeJS.Timeout | null = null

  getStatus(): TunnelStatus {
    return this.status
  }

  private setStatus(s: TunnelStatus): void {
    this.status = { ...s, since: Date.now() }
    this.emit('status', this.status)
  }

  /** Start (or restart) the tunnel from current settings. */
  async start(): Promise<void> {
    await this.stop()
    this.shouldRun = true
    this.attempt = 0
    const cfg = getSettings()

    if (!cfg.ssh.enabled) {
      this.startProbeMode(cfg)
      return
    }
    this.connectTunnel(cfg)
  }

  async stop(): Promise<void> {
    this.shouldRun = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.probeTimer) {
      clearInterval(this.probeTimer)
      this.probeTimer = null
    }
    if (this.server) {
      const srv = this.server
      this.server = null
      await new Promise<void>((res) => srv.close(() => res()))
    }
    if (this.conn) {
      try {
        this.conn.end()
      } catch {
        /* ignore */
      }
      this.conn = null
    }
  }

  /** Force a manual reconnect (from the UI). */
  async restart(): Promise<void> {
    await this.start()
  }

  // --- Probe (fallback) mode ----------------------------------------------

  private startProbeMode(cfg: AppSettings): void {
    this.setStatus({ state: 'connecting', mode: 'probe' })
    const tick = async () => {
      if (!this.shouldRun) return
      const ok = await probePort(cfg.ssh.localPort)
      if (!this.shouldRun) return
      this.setStatus(
        ok
          ? { state: 'connected', mode: 'probe' }
          : {
              state: 'down',
              mode: 'probe',
              error: `Port 127.0.0.1:${cfg.ssh.localPort} ne répond pas (mode repli).`,
            },
      )
    }
    void tick()
    this.probeTimer = setInterval(tick, PROBE_INTERVAL_MS)
  }

  // --- SSH tunnel mode -----------------------------------------------------

  private connectTunnel(cfg: AppSettings): void {
    if (!this.shouldRun) return

    const { host, port, user, keyPath } = cfg.ssh
    if (!host || !user) {
      this.setStatus({
        state: 'down',
        mode: 'tunnel',
        error: 'Réglages SSH incomplets (host / user manquants).',
      })
      return
    }

    const privateKey = resolvePrivateKey(keyPath)
    if (!privateKey) {
      this.setStatus({
        state: 'down',
        mode: 'tunnel',
        error: 'Clé privée SSH introuvable (importe-la ou renseigne un chemin valide).',
      })
      return
    }
    const passphrase = getSecret('sshPassphrase')

    this.setStatus({
      state: this.attempt === 0 ? 'connecting' : 'reconnecting',
      mode: 'tunnel',
      attempt: this.attempt,
    })

    const conn = new Client()
    this.conn = conn

    conn.on('ready', () => {
      if (!this.shouldRun) {
        conn.end()
        return
      }
      this.attempt = 0
      this.startForwardServer(conn, cfg)
    })

    conn.on('error', (err) => {
      this.scheduleReconnect(cfg, err?.message || 'Erreur SSH inconnue')
    })

    conn.on('close', () => {
      // 'error' may have already scheduled a reconnect; guard against double.
      if (this.shouldRun && this.status.state === 'connected') {
        this.scheduleReconnect(cfg, 'Connexion SSH fermée')
      }
    })

    try {
      conn.connect({
        host,
        port: port || 22,
        username: user,
        privateKey,
        passphrase,
        readyTimeout: READY_TIMEOUT_MS,
        keepaliveInterval: KEEPALIVE_MS,
      })
    } catch (err) {
      this.scheduleReconnect(cfg, err instanceof Error ? err.message : String(err))
    }
  }

  private startForwardServer(conn: Client, cfg: AppSettings): void {
    const { localPort, remoteHost, remotePort } = cfg.ssh

    const server = net.createServer((socket) => {
      conn.forwardOut('127.0.0.1', localPort, remoteHost, remotePort, (err, stream) => {
        if (err) {
          socket.destroy()
          return
        }
        socket.pipe(stream).pipe(socket)
        const cleanup = () => {
          stream.destroy?.()
          socket.destroy()
        }
        socket.on('error', cleanup)
        stream.on('error', cleanup)
      })
    })

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Something already listens on the local port — likely an existing
        // forward. Don't fight it: report connected via probe semantics.
        this.setStatus({
          state: 'connected',
          mode: 'probe',
          error: `Port ${localPort} déjà ouvert — réutilisation du forward existant.`,
        })
        return
      }
      this.scheduleReconnect(cfg, `Serveur local: ${err.message}`)
    })

    server.listen(localPort, '127.0.0.1', () => {
      this.server = server
      this.setStatus({ state: 'connected', mode: 'tunnel' })
    })
  }

  private scheduleReconnect(cfg: AppSettings, error: string): void {
    if (!this.shouldRun) return
    // Tear down current attempt's resources.
    if (this.server) {
      this.server.close()
      this.server = null
    }
    if (this.conn) {
      try {
        this.conn.end()
      } catch {
        /* ignore */
      }
      this.conn = null
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)

    this.attempt += 1
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** (this.attempt - 1), MAX_BACKOFF_MS)
    this.setStatus({ state: 'reconnecting', mode: 'tunnel', attempt: this.attempt, error })
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connectTunnel(cfg)
    }, delay)
  }
}

export const tunnel = new TunnelManager()
