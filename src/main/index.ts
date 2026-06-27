// ---------------------------------------------------------------------------
// Electron main process entry. Owns the window, security posture, and startup:
// wires IPC, configures the OpenClaw adapter, and opens the SSH tunnel
// automatically — no manual action required.
// ---------------------------------------------------------------------------

// MUST be first: install globalThis.WebSocket (from `ws`) for openclaw-node,
// since Electron's Node 20 main process has no native WebSocket.
import './ws-polyfill'

import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import {
  registerIpc,
  reconfigureOpenClaw,
  reconfigureClaudeCode,
  reconfigureDiscordPresence,
} from './ipc'
import { tunnel } from './tunnel'
import { initDb } from './db'
import { discordPresence } from './discord-presence'

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 820,
    minHeight: 560,
    show: false,
    backgroundColor: '#0c0c0e',
    title: 'GL Code',
    icon: join(__dirname, '../../resources/icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0c0c0e',        // --bg-panel : fond du header sombre
      symbolColor: '#e8e8ea',  // icônes Min/Max/Close lisibles sur fond sombre
      height: 52,              // hauteur du chat-head (padding 12×2 + icon 28px)
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // --- Security: renderer never touches Node ---------------------------
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Fallback: ready-to-show is unreliable on Windows with titleBarStyle:'hidden'
  // + titleBarOverlay (Electron 33 bug — first paint not always detected).
  // did-finish-load fires after the document is loaded; we wait one frame for
  // React to render, then show the window if ready-to-show hasn't already.
  win.webContents.once('did-finish-load', () => {
    setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show() }, 50)
  })

  // External links open in the OS browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// Single-instance lock: if another GL Code is already running, focus it and quit.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    initDb()
    registerIpc()
    reconfigureOpenClaw()
    reconfigureClaudeCode()
    reconfigureDiscordPresence()

    createWindow()

    // Open the tunnel automatically at launch. Never ask the user to run ssh.
    void tunnel.start()

    // TEMP diagnostic (GL_CODE_DIAG=1): connect like the app and dump chunks.
    if (process.env.GL_CODE_DIAG === '1') {
      setTimeout(() => {
        void import('./diag').then((m) => m.runDiag()).catch((e) => console.error('[diag] error', e))
      }, 1500)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    void tunnel.stop().finally(() => app.quit())
  }
})

app.on('before-quit', () => {
  discordPresence.shutdown()
  void tunnel.stop()
})
