// ---------------------------------------------------------------------------
// Secrets store — gateway token, SSH private key + passphrase.
//
// Encrypted at rest with Electron safeStorage (DPAPI on Windows). Values are
// written to a JSON file in userData as base64 ciphertext; they are decrypted
// only inside the main process, on demand. Secrets NEVER cross IPC to the
// renderer (the renderer only ever learns presence booleans).
// ---------------------------------------------------------------------------

import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import type { SecretsPresence, SecretsInput } from '../shared/types'

type SecretKey = 'gatewayToken' | 'sshPassphrase' | 'sshPrivateKey' | 'anthropicApiKey'

interface SecretsFile {
  // base64(ciphertext) per key
  [k: string]: string
}

function storeDir(): string {
  return join(app.getPath('userData'), 'secure')
}

function storePath(): string {
  return join(storeDir(), 'secrets.json')
}

function readFile(): SecretsFile {
  try {
    if (!existsSync(storePath())) return {}
    return JSON.parse(readFileSync(storePath(), 'utf8')) as SecretsFile
  } catch {
    return {}
  }
}

function writeFile(data: SecretsFile): void {
  mkdirSync(storeDir(), { recursive: true })
  writeFileSync(storePath(), JSON.stringify(data), { encoding: 'utf8', mode: 0o600 })
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

function setSecret(key: SecretKey, value: string | undefined): void {
  const data = readFile()
  if (value === undefined || value === '') {
    delete data[key]
  } else {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error(
        'safeStorage indisponible: impossible de chiffrer les secrets sur ce système.',
      )
    }
    data[key] = safeStorage.encryptString(value).toString('base64')
  }
  writeFile(data)
}

export function getSecret(key: SecretKey): string | undefined {
  const data = readFile()
  const enc = data[key]
  if (!enc) return undefined
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return undefined
  }
}

/** Apply a partial set of secrets coming from the settings screen. */
export function applySecrets(
  input: SecretsInput & { sshPrivateKey?: string },
): void {
  if ('gatewayToken' in input) setSecret('gatewayToken', input.gatewayToken)
  if ('sshPassphrase' in input) setSecret('sshPassphrase', input.sshPassphrase)
  if ('sshPrivateKey' in input) setSecret('sshPrivateKey', input.sshPrivateKey)
  if ('anthropicApiKey' in input) setSecret('anthropicApiKey', input.anthropicApiKey)
}

export function secretsPresence(): SecretsPresence {
  const data = readFile()
  return {
    gatewayToken: !!data.gatewayToken,
    sshPassphrase: !!data.sshPassphrase,
    sshPrivateKey: !!data.sshPrivateKey,
    anthropicApiKey: !!data.anthropicApiKey,
  }
}

/**
 * Import a private key FROM a path into the encrypted store. We read the user's
 * own key file once and persist only the encrypted copy (safeStorage / DPAPI) —
 * we never keep a clear copy of the key inside the app.
 */
export function importKeyFromPath(path: string): void {
  const contents = readFileSync(path, 'utf8')
  setSecret('sshPrivateKey', contents)
}

/**
 * Resolve the private key material for the tunnel. Prefers the encrypted store;
 * falls back to reading the configured keyPath in memory (never persisted clear).
 */
export function resolvePrivateKey(keyPath: string | undefined): Buffer | undefined {
  const stored = getSecret('sshPrivateKey')
  if (stored) return Buffer.from(stored, 'utf8')
  if (keyPath && existsSync(keyPath)) {
    return readFileSync(keyPath)
  }
  return undefined
}
