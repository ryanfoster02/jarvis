import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

// Strict CSP for the packaged renderer (loaded from file://, where response headers
// can't be set). In development the main process sets a relaxed CSP header instead,
// because Vite's HMR needs inline scripts and a websocket.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'", // Sprint 3 adds https://api.openai.com for realtime voice
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

const injectProdCsp = (): Plugin => ({
  name: 'jarvis-prod-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${PROD_CSP}" />`),
})

// Default entries: src/main/index.ts, src/preload/index.ts, src/renderer/index.html.
// Main and preload have no runtime npm deps besides electron (always external).
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), injectProdCsp()],
  },
})
