import { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import type { AppSettings, SecretsPresence, Project } from '@shared/types'
import { VersionControlPanel } from './VersionControlPanel'

type SettingsTab = 'openclaw' | 'claude-code' | 'git' | 'general'

const SETTINGS_TABS: Array<{
  id: SettingsTab
  label: string
  hint: string
}> = [
  { id: 'general', label: 'Général', hint: 'Réglages globaux' },
  { id: 'openclaw', label: 'OpenClaw', hint: 'Gateway + tunnel SSH' },
  { id: 'claude-code', label: 'Claude Code', hint: 'Cwd, modèle, clé API' },
  { id: 'git', label: 'Git', hint: 'Statut du dépôt' },
]

export function SettingsModal({
  project,
  onClose,
}: {
  project?: Project
  onClose: () => void
}) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [presence, setPresence] = useState<SecretsPresence | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('openclaw')
  const [gatewayToken, setGatewayToken] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    void window.api.settings.get().then(setSettings)
    void window.api.secrets.presence().then(setPresence)
  }, [])

  if (!settings) return null

  const ssh = settings.ssh
  const setSsh = (patch: Partial<AppSettings['ssh']>) =>
    setSettings({ ...settings, ssh: { ...settings.ssh, ...patch } })
  const setDiscord = (patch: Partial<AppSettings['discord']>) =>
    setSettings({ ...settings, discord: { ...settings.discord, ...patch } })

  const pickKey = async () => {
    const path = await window.api.dialog.pickKey()
    if (path) {
      setSsh({ keyPath: path })
      const p = await window.api.secrets.importKey(path)
      setPresence(p)
      setMsg('Clé privée importée et chiffrée (safeStorage).')
    }
  }

  const save = async () => {
    setSaving(true)
    setMsg(null)
    try {
      const secretInput: {
        gatewayToken?: string
        sshPassphrase?: string
        anthropicApiKey?: string
      } = {}
      if (gatewayToken) secretInput.gatewayToken = gatewayToken
      if (passphrase) secretInput.sshPassphrase = passphrase
      if (apiKey) secretInput.anthropicApiKey = apiKey
      if (Object.keys(secretInput).length) {
        const p = await window.api.secrets.set(secretInput)
        setPresence(p)
        setGatewayToken('')
        setPassphrase('')
        setApiKey('')
      }
      await window.api.settings.set(settings)
      setMsg('Réglages enregistrés. Tunnel relancé.')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>Réglages</h2>
            <p className="modal-subtitle">OpenClaw, Claude Code, Git et paramètres généraux.</p>
          </div>
          <button className="icon-btn" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body settings-body">
          <aside className="settings-sidebar" aria-label="Navigation des réglages">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                className={`settings-tab${activeTab === tab.id ? ' active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
                type="button"
              >
                <span className="settings-tab-label">{tab.label}</span>
                <span className="settings-tab-hint">{tab.hint}</span>
              </button>
            ))}
          </aside>

          <div className="settings-content">
            {activeTab === 'openclaw' && (
              <section className="settings-section">
                <div className="settings-section-head">
                  <h3>OpenClaw</h3>
                  <p>Configuration du gateway et du tunnel SSH.</p>
                </div>

                <label className="field">
                  URL WebSocket (côté local du tunnel)
                  <input
                    className="mono"
                    value={settings.openclaw.url}
                    onChange={(e) => setSettings({ ...settings, openclaw: { url: e.target.value } })}
                  />
                </label>

                <label className="field">
                  Token gateway {presence?.gatewayToken && <span className="stored">✓ stocké</span>}
                  <input
                    type="password"
                    placeholder={
                      presence?.gatewayToken ? '•••••••• (inchangé)' : 'OPENCLAW_GATEWAY_TOKEN'
                    }
                    value={gatewayToken}
                    onChange={(e) => setGatewayToken(e.target.value)}
                  />
                </label>

                <div className="settings-subsection">
                  <h4>Tunnel SSH</h4>
                  <label className="field row">
                    <input
                      type="checkbox"
                      checked={ssh.enabled}
                      onChange={(e) => setSsh({ enabled: e.target.checked })}
                    />
                    Ouvrir le tunnel automatiquement (décoché = mode repli "port déjà ouvert")
                  </label>

                  <div className="grid2">
                    <label className="field">
                      Hôte VPS
                      <input
                        value={ssh.host}
                        onChange={(e) => setSsh({ host: e.target.value })}
                        placeholder="mon-vps.example.com"
                        disabled={!ssh.enabled}
                      />
                    </label>
                    <label className="field">
                      Utilisateur
                      <input
                        value={ssh.user}
                        onChange={(e) => setSsh({ user: e.target.value })}
                        placeholder="root"
                        disabled={!ssh.enabled}
                      />
                    </label>
                    <label className="field">
                      Port SSH
                      <input
                        type="number"
                        value={ssh.port}
                        onChange={(e) => setSsh({ port: Number(e.target.value) })}
                        disabled={!ssh.enabled}
                      />
                    </label>
                    <label className="field">
                      Port local
                      <input
                        type="number"
                        value={ssh.localPort}
                        onChange={(e) => setSsh({ localPort: Number(e.target.value) })}
                      />
                    </label>
                    <label className="field">
                      Hôte distant
                      <input
                        value={ssh.remoteHost}
                        onChange={(e) => setSsh({ remoteHost: e.target.value })}
                        disabled={!ssh.enabled}
                      />
                    </label>
                    <label className="field">
                      Port distant
                      <input
                        type="number"
                        value={ssh.remotePort}
                        onChange={(e) => setSsh({ remotePort: Number(e.target.value) })}
                        disabled={!ssh.enabled}
                      />
                    </label>
                  </div>

                  <label className="field">
                    Clé privée {presence?.sshPrivateKey && <span className="stored">✓ chiffrée</span>}
                    <div className="row-inline">
                      <input
                        className="mono"
                        value={ssh.keyPath}
                        onChange={(e) => setSsh({ keyPath: e.target.value })}
                        placeholder="C:\\Users\\moi\\.ssh\\id_ed25519"
                        disabled={!ssh.enabled}
                      />
                      <button className="btn" onClick={pickKey} disabled={!ssh.enabled} type="button">
                        Parcourir...
                      </button>
                    </div>
                  </label>

                  <label className="field">
                    Passphrase de la clé (optionnelle){' '}
                    {presence?.sshPassphrase && <span className="stored">✓ stockée</span>}
                    <input
                      type="password"
                      placeholder={presence?.sshPassphrase ? '•••••••• (inchangée)' : 'vide si aucune'}
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      disabled={!ssh.enabled}
                    />
                  </label>
                </div>
              </section>
            )}

            {activeTab === 'claude-code' && (
              <section className="settings-section">
                <div className="settings-section-head">
                  <h3>Claude Code</h3>
                  <p>Répertoire de travail, modèle par défaut et clé API.</p>
                </div>

                <label className="field">
                  Répertoire de travail (cwd)
                  <input
                    className="mono"
                    value={settings.claudeCode.cwd}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        claudeCode: { ...settings.claudeCode, cwd: e.target.value },
                      })
                    }
                    placeholder="(vide = dossier personnel)"
                  />
                </label>

                <label className="field">
                  Modèle par défaut
                  <input
                    className="mono"
                    value={settings.claudeCode.model}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        claudeCode: { ...settings.claudeCode, model: e.target.value },
                      })
                    }
                    placeholder="(vide = défaut) — sélecteur par conversation prioritaire"
                  />
                </label>

                <label className="field">
                  Clé ANTHROPIC_API_KEY (optionnelle){' '}
                  {presence?.anthropicApiKey && <span className="stored">✓ stockée</span>}
                  <input
                    type="password"
                    placeholder={
                      presence?.anthropicApiKey
                        ? '•••••••• (inchangée)'
                        : 'vide = login Claude Pro (claude login)'
                    }
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </label>
              </section>
            )}

            {activeTab === 'git' && (
              <section className="settings-section">
                <div className="settings-section-head">
                  <h3>Git</h3>
                  <p>Lecture seule pour l’état du dépôt et l’intégration gh.</p>
                </div>
                <VersionControlPanel project={project} />
              </section>
            )}

            {activeTab === 'general' && (
              <section className="settings-section">
                <div className="settings-section-head">
                  <h3>Général</h3>
                  <p>Réglages globaux de l’application, pour l’instant centrés sur Discord.</p>
                </div>
                <label className="field row">
                  <input
                    type="checkbox"
                    checked={settings.discord.enabled}
                    onChange={(e) => setDiscord({ enabled: e.target.checked })}
                  />
                  Afficher l’activité dans Discord
                </label>
              </section>
            )}

            {msg && <div className="modal-msg">{msg}</div>}
          </div>
        </div>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose} type="button">
            Fermer
          </button>
          <button className="btn primary" onClick={save} disabled={saving} type="button">
            {saving ? 'Enregistrement...' : 'Enregistrer & relancer le tunnel'}
          </button>
        </div>
      </div>
    </div>
  )
}
