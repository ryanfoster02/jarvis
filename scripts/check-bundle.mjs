#!/usr/bin/env node
// Renderer bundle report + budget (Sprint 16). Run after `electron-vite build`.
// "Startup" = what index.html loads up front: the entry script, scripts it preloads, and CSS.
// Screens loaded on demand (lazy chunks) are listed but don't count against the budget.
// Fails (exit 1) if startup JavaScript exceeds the budget, so the bundle can't silently regress.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const OUT = join(process.cwd(), 'out', 'renderer')
const BUDGET_KB = Number(process.env.JARVIS_STARTUP_JS_BUDGET_KB ?? 320)

let html
try {
  html = readFileSync(join(OUT, 'index.html'), 'utf8')
} catch {
  console.error('check-bundle: out/renderer/index.html not found — run `npx electron-vite build` first.')
  process.exit(2)
}

const refs = (re) => [...html.matchAll(re)].map((m) => m[1].replace(/^\.?\//, ''))
const startupJs = new Set([
  ...refs(/<script[^>]+src="([^"]+\.js)"/g),
  ...refs(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g),
])
const startupCss = new Set(refs(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g))

const kb = (n) => (n / 1024).toFixed(1)
const size = (rel) => {
  const buf = readFileSync(join(OUT, rel))
  return { raw: buf.length, gz: gzipSync(buf).length }
}
const assets = readdirSync(join(OUT, 'assets'))
  .filter((f) => /\.(js|css)$/.test(f))
  .map((f) => `assets/${f}`)
  .filter((f) => statSync(join(OUT, f)).isFile())

let jsRaw = 0
let jsGz = 0
const rows = []
for (const f of assets) {
  const s = size(f)
  const kind = startupJs.has(f) || startupCss.has(f) ? 'startup' : f.endsWith('.js') ? 'on demand' : 'css (lazy)'
  if (startupJs.has(f)) {
    jsRaw += s.raw
    jsGz += s.gz
  }
  rows.push({ f, kind, ...s })
}
rows.sort((a, b) => (a.kind === b.kind ? b.raw - a.raw : a.kind === 'startup' ? -1 : 1))
console.log('Renderer bundle')
for (const r of rows) console.log(`  ${r.kind.padEnd(10)} ${kb(r.raw).padStart(8)} kB  (${kb(r.gz).padStart(6)} kB gzip)  ${r.f}`)
console.log(`Startup JavaScript: ${kb(jsRaw)} kB (${kb(jsGz)} kB gzip) — budget ${BUDGET_KB} kB`)
if (startupJs.size === 0) {
  console.error('check-bundle: no entry script found in index.html')
  process.exit(1)
}
if (jsRaw > BUDGET_KB * 1024) {
  console.error(`check-bundle: startup JavaScript is over budget by ${kb(jsRaw - BUDGET_KB * 1024)} kB`)
  process.exit(1)
}
