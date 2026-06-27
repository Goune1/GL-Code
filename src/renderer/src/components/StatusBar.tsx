import type { TunnelStatus } from '@shared/types'

const LABEL: Record<TunnelStatus['state'], string> = {
  connecting: 'Connexion…',
  connected: 'Connecté',
  reconnecting: 'Reconnexion…',
  down: 'Coupé',
  disabled: 'Repli',
}

const DOT: Record<TunnelStatus['state'], string> = {
  connecting: 'warn',
  connected: 'ok',
  reconnecting: 'warn',
  down: 'down',
  disabled: 'warn',
}

export function StatusBar({ tunnel }: { tunnel: TunnelStatus }) {
  const detail =
    tunnel.state === 'reconnecting' && tunnel.attempt
      ? `tunnel · retry ${tunnel.attempt}`
      : tunnel.mode === 'probe'
        ? 'repli · :18789'
        : 'tunnel · :18789'

  return (
    <div className="statusbar" title={tunnel.error ?? ''}>
      <span className={`status-dot ${DOT[tunnel.state]}`} />
      <span className="status-label">{LABEL[tunnel.state]}</span>
      <span className="status-detail">{detail}</span>
    </div>
  )
}
