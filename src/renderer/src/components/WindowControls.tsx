import { useEffect, useState } from 'react'
import { Minus, CornersOut, CornersIn, X } from '@phosphor-icons/react'

export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    void window.api.win.isMaximized().then(setMaximized)
    const off = window.api.win.onMaximizeChange(setMaximized)
    return off
  }, [])

  return (
    <div className="win-controls">
      <button
        className="win-btn minimize"
        title="Réduire"
        onClick={() => void window.api.win.minimize()}
      >
        <Minus size={10} />
      </button>
      <button
        className="win-btn maximize"
        title={maximized ? 'Restaurer' : 'Agrandir'}
        onClick={() => void window.api.win.maximize()}
      >
        {maximized ? <CornersIn size={10} /> : <CornersOut size={10} />}
      </button>
      <button
        className="win-btn close"
        title="Fermer"
        onClick={() => void window.api.win.close()}
      >
        <X size={10} />
      </button>
    </div>
  )
}
