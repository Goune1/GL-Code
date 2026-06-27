import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Main + preload run in Node (Electron); renderer is pure browser UI.
// externalizeDepsPlugin keeps native/node deps (ssh2, openclaw-node, ...) out of
// the bundle so they load from node_modules at runtime in the main process.
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        // package.json is "type":"module", but Electron's main process loads via
        // Node's standard require() for its entry point. A plain ".js" output
        // would be parsed as ESM (picking up "type":"module") and crashes on
        // `import { app } from 'electron'` — Electron's built-in module isn't a
        // real file Node's ESM/CJS interop can pre-parse (TypeError: Cannot read
        // properties of undefined (reading 'exports') in cjsPreparseModuleExports,
        // reproduced even with that single import line in isolation). Force
        // ".cjs" so Node always loads it as CommonJS, same fix already applied
        // to the preload below.
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
          chunkFileNames: '[name].cjs'
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // sandbox:true requires a CommonJS preload (ESM preloads don't load in a
        // sandboxed renderer). Force .js + cjs even though package is type:module.
        output: {
          format: 'cjs',
          entryFileNames: '[name].js'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})
