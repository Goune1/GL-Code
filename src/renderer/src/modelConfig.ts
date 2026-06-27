// Static model registry — the SINGLE source of truth for model capabilities,
// keyboard shortcuts, reasoning levels, and 1M context support.
// Edit this file to add models, change shortcuts, or update capabilities.
//
// IDs must match the short aliases accepted by the Claude Code CLI/SDK (the
// same values stored in the DB's `model` column). 'default' means "let the
// CLI pick" and is sent to the SDK as an empty string.

import type { ContextWindow } from '@shared/types'

export type ReasoningLevel = 'low' | 'medium' | 'high' | 'extra' | 'max' | 'ultracode'

export interface ModelConfig {
  /** Short alias stored in the DB and passed to the Claude Code CLI/SDK. */
  id: string
  displayName: string
  /** Keyboard shortcut digit for Ctrl+1…N (1-based). */
  shortcut: number
  supportsReasoning: boolean
  /** Available reasoning levels (ordered low → max). */
  reasoningLevels: ReasoningLevel[]
  /** Level pre-selected when the user hasn't made a choice yet. */
  defaultReasoning: ReasoningLevel | null
  /**
   * Whether this model supports the 1M-token context window.
   * Activated via the SDK 'context-1m-2025-08-07' beta flag.
   * Per SDK docs: "Sonnet 4/4.5 only" — adjust when Anthropic expands it.
   */
  supports1M: boolean
}

export const REASONING_LABELS: Record<ReasoningLevel, string> = {
  low: 'Faible',
  medium: 'Moyen',
  high: 'Élevé',
  extra: 'Extra',
  max: 'Max',
  ultracode: 'Ultracode',
}

export const DEFAULT_MODEL_ID = 'claude-sonnet-4-6'

// ─── Adjust here when models or capabilities change ──────────────────────────
export const MODEL_REGISTRY: ModelConfig[] = [
  {
    id: 'claude-sonnet-4-6',
    displayName: 'Sonnet 4.6',
    shortcut: 1,
    supportsReasoning: true,
    reasoningLevels: ['low', 'medium', 'high', 'max'],
    defaultReasoning: 'medium',
    supports1M: true,  // confirmed via 'context-1m-2025-08-07' beta
  },
  {
    id: 'claude-opus-4-8',
    displayName: 'Opus 4.8',
    shortcut: 2,
    supportsReasoning: true,
    reasoningLevels: ['low', 'medium', 'high', 'extra', 'max', 'ultracode'],
    defaultReasoning: 'high',
    // TODO verify — 'context-1m-2025-08-07' is documented as "Sonnet 4/4.5 only"
    // in the SDK; Opus 1M may depend on billing tier or a future separate beta.
    supports1M: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    shortcut: 3,
    supportsReasoning: false,
    reasoningLevels: [],
    defaultReasoning: null,
    supports1M: false,
  },
]
// ─────────────────────────────────────────────────────────────────────────────

export function getModelConfig(id: string): ModelConfig {
  return MODEL_REGISTRY.find((m) => m.id === id) ?? MODEL_REGISTRY[0]
}

/**
 * Return a valid effort value for the model.
 * Falls back to the model's defaultReasoning, or '' if the model has no reasoning.
 */
export function clampEffort(model: ModelConfig, effort: string): string {
  if (!model.supportsReasoning || model.reasoningLevels.length === 0) return ''
  if (model.reasoningLevels.includes(effort as ReasoningLevel)) return effort
  return model.defaultReasoning ?? ''
}

/**
 * Return a valid context window for the model.
 * Falls back to '200k' when the model doesn't support 1M.
 */
export function clampContextWindow(model: ModelConfig, cw: string): ContextWindow {
  if (cw === '1m' && !model.supports1M) return '200k'
  return cw === '1m' ? '1m' : '200k'
}
