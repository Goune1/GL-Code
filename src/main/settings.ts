// ---------------------------------------------------------------------------
// Non-secret settings store (SSH host/user/port/keyPath, OpenClaw url, ...).
// Plain JSON in userData. Secrets live separately in secrets.ts (encrypted).
// ---------------------------------------------------------------------------

import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import type { AppSettings } from '../shared/types'
import { DEFAULT_SETTINGS } from '../shared/types'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

let cache: AppSettings | null = null

function deepMerge<T>(base: T, over: Partial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base }
  for (const k of Object.keys(over ?? {})) {
    const ov = (over as any)[k]
    const bv = (base as any)[k]
    if (ov && typeof ov === 'object' && !Array.isArray(ov) && bv && typeof bv === 'object') {
      out[k] = deepMerge(bv, ov)
    } else if (ov !== undefined) {
      out[k] = ov
    }
  }
  return out
}

export function getSettings(): AppSettings {
  if (cache) return cache
  try {
    if (existsSync(settingsPath())) {
      const raw = JSON.parse(readFileSync(settingsPath(), 'utf8')) as Partial<AppSettings>
      cache = deepMerge(DEFAULT_SETTINGS, raw)
    } else {
      cache = DEFAULT_SETTINGS
    }
  } catch {
    cache = DEFAULT_SETTINGS
  }
  return cache
}

export function saveSettings(next: AppSettings): AppSettings {
  cache = deepMerge(DEFAULT_SETTINGS, next)
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(cache, null, 2), 'utf8')
  return cache
}
