import { useEffect, useRef, useState } from 'react'
import { Gauge, CaretDown, Check } from '@phosphor-icons/react'
import { getModelConfig, REASONING_LABELS } from '../modelConfig'
import type { ReasoningLevel } from '../modelConfig'
import type { ContextWindow } from '@shared/types'

interface Props {
  model: string
  effort: string
  contextWindow: ContextWindow
  onSetConvSettings: (model: string, effort: string, contextWindow: string) => void
}

export function ReasoningContextPicker({ model, effort, contextWindow, onSetConvSettings }: Props) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)
  const cfg = getModelConfig(model)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const setEffort = (newEffort: string) => {
    onSetConvSettings(model, newEffort, contextWindow)
    setOpen(false)
  }

  const setContext = (newCw: ContextWindow) => {
    onSetConvSettings(model, effort, newCw)
    setOpen(false)
  }

  // When no effort is stored, treat the model's default as the active selection.
  const effectiveEffort = effort || cfg.defaultReasoning || ''
  const effortLabel = effectiveEffort
    ? (REASONING_LABELS[effectiveEffort as ReasoningLevel] ?? effectiveEffort)
    : ''
  const noControls = !cfg.supportsReasoning && !cfg.supports1M

  return (
    <div className="pill-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`pill pill-btn ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Raisonnement et fenêtre de contexte"
        disabled={noControls}
      >
        <Gauge className="ico" size={14} />
        <span>{effortLabel}</span>
        <span className={`pill-cw${contextWindow === '1m' ? ' pill-cw-1m' : ''}`}>
          {contextWindow === '1m' ? '1M' : '200k'}
        </span>
        <CaretDown className="pill-caret" size={11} />
      </button>

      {open && (
        <div className="popover popover-effort">
          {cfg.supportsReasoning && (
            <>
              <div className="popover-section-head">Raisonnement</div>
              <div className="popover-list">
                {cfg.reasoningLevels.map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    className={`popover-item item-row${effectiveEffort === lvl ? ' sel' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); setEffort(lvl) }}
                  >
                    <span className="item-check">{effectiveEffort === lvl && <Check size={12} weight="bold" />}</span>
                    <span className="item-name">
                      {REASONING_LABELS[lvl]}
                      {lvl === cfg.defaultReasoning && <span className="item-badge">défaut</span>}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="popover-section-head">Fenêtre de contexte</div>
          <div className="popover-list">
            {(['200k', '1m'] as ContextWindow[]).map((cw) => {
              const disabled = cw === '1m' && !cfg.supports1M
              return (
                <button
                  key={cw}
                  type="button"
                  className={`popover-item item-row${contextWindow === cw ? ' sel' : ''}${disabled ? ' disabled' : ''}`}
                  disabled={disabled}
                  title={disabled ? 'Non supporté par ce modèle' : undefined}
                  onMouseDown={disabled ? undefined : (e) => { e.preventDefault(); setContext(cw) }}
                >
                  <span className="item-check">
                    {contextWindow === cw && !disabled && <Check size={12} weight="bold" />}
                  </span>
                  <span className="item-name">
                    {cw === '200k' ? '200k' : '1M'}
                    {cw === '200k' && <span className="item-badge">défaut</span>}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
