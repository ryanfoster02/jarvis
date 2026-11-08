#!/usr/bin/env node
// Sunrise: concise development briefing from the latest session report, the
// current phase, open IMPLEMENTATION items and git state. Reads only what it needs.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sessionsDir = join(root, 'sessions')

const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const section = (md, heading) => {
  const part = md.split(/^## /m).find((p) => p.startsWith(heading))
  return part ? part.slice(heading.length).trim() : ''
}

const out = []
out.push('# ☀️  JARVIS sunrise briefing', '')

// 1. Phase
const implPath = join(root, 'IMPLEMENTATION.md')
const impl = existsSync(implPath) ? readFileSync(implPath, 'utf8') : ''
const phase = impl.match(/^Current phase:\s*(.+)$/m)?.[1] ?? 'unknown (add "Current phase:" to IMPLEMENTATION.md)'
out.push(`**Phase:** ${phase}`, '')

// 2. Latest session report
const reports = existsSync(sessionsDir)
  ? readdirSync(sessionsDir).filter((f) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.md$/.test(f)).sort()
  : []
const latest = reports.at(-1)
if (latest) {
  const md = readFileSync(join(sessionsDir, latest), 'utf8')
  out.push(`**Last session:** sessions/${latest}`)
  for (const h of ['Next actions', 'Open problems', 'Remaining tasks']) {
    const body = section(md, h)
    if (body && !/^_none_$/i.test(body)) out.push('', `### ${h}`, body)
  }
  out.push('')
} else {
  out.push('**Last session:** none yet — this is the first session.', '')
}

// 3. Open items in the current phase (🟡 / ⬜ lines under the first non-✅ sprint heading)
const blocks = impl.split(/^### /m).slice(1)
const active = blocks.find((b) => !/^[^\n]*✅/.test(b))
if (active) {
  const title = active.split('\n')[0].trim()
  const open = active.split('\n').filter((l) => /^- (🟡|⬜)/.test(l))
  if (open.length) out.push(`### Open in "${title}"`, ...open, '')
  const acc = active.match(/\*\*Acceptance:\*\*([^\n]+)/)?.[1]
  if (acc) out.push(`**Acceptance:**${acc}`, '')
}

// 4. Git
if (git('rev-parse', '--is-inside-work-tree') === 'true') {
  const branch = git('branch', '--show-current') || '(detached)'
  const status = git('status', '--short')
  const log = git('log', '--oneline', '-5')
  out.push(`### Git — branch \`${branch}\``)
  out.push(status ? `Uncommitted changes:\n\`\`\`\n${status}\n\`\`\`` : 'Working tree clean.')
  if (log) out.push(`Recent commits:\n\`\`\`\n${log}\n\`\`\``)
  const remote = git('remote')
  out.push(remote ? `Remote: ${remote}` : 'Remote: none (first push needs owner approval).')
} else {
  out.push('### Git', 'Not a git repository.')
}

console.log(out.join('\n'))
