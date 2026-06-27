// Electron 33's main process embeds Node 20, which has NO global `WebSocket`.
// openclaw-node falls back to `require("ws")`, but that internal require does not
// resolve reliably through Electron's ESM loader for the externalized package.
//
// Fix: provide the global ourselves from the `ws` package (resolved from our own
// main bundle, which is reliable) BEFORE any OpenClaw connect runs. The library's
// getWebSocket() then returns globalThis.WebSocket directly and never needs its
// own require. Import this module first in the main entry.
import WebSocket from 'ws'

const g = globalThis as unknown as { WebSocket?: unknown }
if (typeof g.WebSocket === 'undefined') {
  g.WebSocket = WebSocket
  console.error('[ws-polyfill] installed globalThis.WebSocket from `ws`')
} else {
  console.error('[ws-polyfill] native globalThis.WebSocket present, no-op')
}
