#!/usr/bin/env node
// Sunset: writes sessions/YYYY-MM-DD_HH-mm.md (local time) with the session's
// narrative (from flags) plus git facts gathered automatically.
//
//   npm run sunset -- --done "Built IPC layer" --done "Added tests" \
//     --decision "Plain CSS themes before Tailwind" --issue "Launch unverified on macOS" \
//     --todo "Sprint 2 dashboard" --next "Run npm run dev on the Mac"
//
// Flags are repeatable. Missing sections are written as _none_.
import { writeFileSync, mkdirSync, readdirSync, existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sessionsDir = join(root, 'sessions')
mkdirSync(sessionsDir, { recursive: true })

const FLAGS = { '--done': 'done', '--decision': 'decisions', '--issue': 'issues', '--todo': 'todo', '--next': 'next', '--title': 'title' }
const data = { done: [], decisions: [], issues: [], todo: [], next: [], title: [] }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const key = FLAGS[argv[i]]
  if (!key) {
    console.error(`Unknown argument: ${argv[i]}\nValid: ${Object.keys(FLAGS).join(' ')}`)
    process.exit(1)
  }
  const val = argv[++i]
  if (val === undefined) {
    console.error(`Missing value for ${argv[i - 1]}`)
    process.exit(1)
  }
  data[key].push(val)
}

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const pad = (n) => String(n).padStart(2, '0')
const now = new Date()
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`
let file = join(sessionsDir, `${stamp}.md`)
if (existsSync(file)) file = join(sessionsDir, `${stamp}-${pad(now.getSeconds())}.md`)

// Commits since the previous report (by file mtime order = name order)
const prev = readdirSync(sessionsDir).filter((f) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}/.test(f)).sort().at(-1)
const prevCommit = prev ? readFileSync(join(sessionsDir, prev), 'utf8').match(/^HEAD at end: `([0-9a-f]+)`/m)?.[1] : undefined
const isRepo = git('rev-parse', '--is-inside-work-tree') === 'true'
const head = isRepo ? git('rev-parse', '--short', 'HEAD') : ''
const commits = isRepo ? git('log', '--oneline', ...(prevCommit ? [`${prevCommit}..HEAD`] : ['-15'])) : ''
const changed = isRepo
  ? git('diff', '--stat', '--stat-width=100', ...(prevCommit ? [`${prevCommit}..HEAD`] : ['--root', head || 'HEAD'])).split('\n').slice(-25).join('\n')
  : ''
const uncommitted = isRepo ? git('status', '--short') : ''

const phase = (() => {
  try {
    return readFileSync(join(root, 'IMPLEMENTATION.md'), 'utf8').match(/^Current phase:\s*(.+)$/m)?.[1] ?? 'unknown'
  } catch {
    return 'unknown'
  }
})()

const list = (items) => (items.length ? items.map((s) => `- ${s}`).join('\n') : '_none_')
const block = (s) => (s ? '```\n' + s + '\n```' : '_none_')

const md = `# Session ${stamp.replace('_', ' ').replace(/-(\d{2})$/, ':$1')}${data.title.length ? ` — ${data.title.join(' ')}` : ''}

Phase: ${phase}
HEAD at end: \`${head || 'n/a'}\`

## Completed
${list(data.done)}

## Decisions
${list(data.decisions)}

## Open problems
${list(data.issues)}

## Remaining tasks
${list(data.todo)}

## Next actions
${list(data.next)}

## Commits this session
${block(commits)}

## Files changed
${block(changed)}

## Uncommitted at sunset
${block(uncommitted)}
`

writeFileSync(file, md)
console.log(`Session report written: ${file.replace(root + '/', '')}`)
