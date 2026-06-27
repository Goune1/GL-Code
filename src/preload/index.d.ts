import type { GlCodeApi } from './index'

declare global {
  interface Window {
    api: GlCodeApi
  }
}

export {}
