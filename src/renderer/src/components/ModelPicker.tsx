import { useEffect, useRef, useState } from 'react'
import { Cube, MagnifyingGlass, Star, CaretDown } from '@phosphor-icons/react'
import { MODEL_REGISTRY, getModelConfig, clampEffort, clampContextWindow } from '../modelConfig'
import type { ModelConfig } from '../modelConfig'
import type { ContextWindow } from '@shared/types'

interface Props {
  model: string
  effort: string
  contextWindow: ContextWindow
  onSetConvSettings: (model: string, effort: string, contextWindow: string) => void
}

// Persist favorite model IDs in localStorage.
function useFavorites() {
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('wrapper.modelFavorites') || '[]')
    } catch {
      return []
    }
  })
  const toggle = (id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      try {
        localStorage.setItem('wrapper.modelFavorites', JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }
  return { favorites, toggle }
}

function sortedModels(favorites: string[], query: string): ModelConfig[] {
  const q = query.trim().toLowerCase()
  const matches = MODEL_REGISTRY.filter(
    (m) =>
      !q ||
      m.displayName.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q),
  )
  return matches.sort((a, b) => {
    const aFav = favorites.includes(a.id) ? 0 : 1
    const bFav = favorites.includes(b.id) ? 0 : 1
    if (aFav !== bFav) return aFav - bFav
    return a.shortcut - b.shortcut
  })
}

export function ModelPicker({ model, effort, contextWindow, onSetConvSettings }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hi, setHi] = useState(0)
  const anchorRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const { favorites, toggle } = useFavorites()

  const filtered = sortedModels(favorites, query)

  // Close on outside click or Escape.
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

  // Focus search when opened; reset when closed.
  useEffect(() => {
    if (open) {
      setQuery('')
      setHi(0)
      setTimeout(() => searchRef.current?.focus(), 10)
    }
  }, [open])

  // Keyboard navigation inside the search input.
  const onSearchKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((i) => (i + 1) % filtered.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((i) => (i - 1 + filtered.length) % filtered.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[hi]) accept(filtered[hi])
    }
  }

  const accept = (cfg: ModelConfig) => {
    const newEffort = clampEffort(cfg, effort)
    const newCw = clampContextWindow(cfg, contextWindow)
    onSetConvSettings(cfg.id, newEffort, newCw)
    setOpen(false)
  }

  const currentCfg = getModelConfig(model)
  const label = currentCfg.displayName

  return (
    <div className="pill-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`pill pill-btn ${open ? 'open' : ''}`}
        onClick={() => setOpen((o) => !o)}
        title="Choisir le modèle"
      >
        <Cube className="ico" size={14} />
        <span>{label}</span>
        <CaretDown className="pill-caret" size={11} />
      </button>

      {open && (
        <div className="popover popover-model">
          <div className="popover-head">
            <Cube size={13} />
            <span>Modèle</span>
          </div>

          <div className="popover-search">
            <MagnifyingGlass className="ico" size={13} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search models…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHi(0)
              }}
              onKeyDown={onSearchKey}
            />
          </div>

          <div className="popover-list">
            {filtered.map((m, i) => (
              <div key={m.id} className={`popover-item ${m.id === model ? 'sel' : ''} ${i === hi ? 'hi' : ''}`}>
                {/* Star toggle — onMouseDown to keep focus on search input */}
                <button
                  type="button"
                  className={`star-btn ${favorites.includes(m.id) ? 'on' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    toggle(m.id)
                  }}
                  title={favorites.includes(m.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                >
                  <Star size={13} weight={favorites.includes(m.id) ? 'fill' : 'regular'} />
                </button>

                {/* Row click → select model */}
                <button
                  type="button"
                  className="item-row"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    accept(m)
                  }}
                  onMouseEnter={() => setHi(i)}
                >
                  <span className="item-name">{m.displayName}</span>
                  <span className="item-shortcut">Ctrl+{m.shortcut}</span>
                </button>
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="popover-empty">Aucun résultat</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
