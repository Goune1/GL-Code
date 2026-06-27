import { useEffect, useRef, useState } from 'react'
import { ShieldCheck, Lightning, CaretDown, Check } from '@phosphor-icons/react'
import type { PermissionMode } from '@shared/types'

interface Props {
  value: PermissionMode
  onChange: (mode: PermissionMode) => void
}

const OPTIONS: { value: PermissionMode; label: string; icon: React.ReactNode }[] = [
  { value: 'default', label: 'Confirmer', icon: <ShieldCheck size={13} /> },
  { value: 'bypassPermissions', label: 'Exécution directe', icon: <Lightning size={13} /> },
]

export function PermissionPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

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

  const current = OPTIONS.find((o) => o.value === value) ?? OPTIONS[0]

  return (
    <div className="pill-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`pill pill-btn ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Mode de permission"
      >
        <span className="ico">{current.icon}</span>
        <span>{current.label}</span>
        <CaretDown className="pill-caret" size={11} />
      </button>

      {open && (
        <div className="popover popover-permission">
          <div className="popover-section-head">Mode de permission</div>
          <div className="popover-list">
            {OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`popover-item item-row${value === opt.value ? ' sel' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  onChange(opt.value)
                  setOpen(false)
                }}
              >
                <span className="item-check">
                  {value === opt.value && <Check size={12} weight="bold" />}
                </span>
                <span className="item-name">
                  <span className="ico perm-icon">{opt.icon}</span>
                  {opt.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
