import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildReport, describeN8nError, executionLink, formatReportForModel, n8nPaths, normalizeN8nUrl, parseExecutions, parseWorkflows, validateN8nConnection } from '../src/shared/n8n.ts'
import { parseToolArgs, summarizeToolCall, ToolArgsError, TOOLS, toolInstructions } from '../src/shared/tools.ts'
import { WORKFLOW_TEMPLATES, workflowTools } from '../src/shared/workflows.ts'
import { IpcValidationError } from '../src/shared/ipc.ts'

test('address: normalised; https anywhere, http only on this computer or the local network', () => {
  assert.equal(normalizeN8nUrl(' https://n8n.example.com/ '), 'https://n8n.example.com')
  assert.equal(normalizeN8nUrl('https://n8n.example.com/api/v1/'), 'https://n8n.example.com')
  assert.equal(normalizeN8nUrl('https://n8n.example.com/home/workflows'), 'https://n8n.example.com')
  assert.equal(normalizeN8nUrl('https://example.com/n8n'), 'https://example.com/n8n')
  for (const ok of ['http://localhost:5678', 'http://127.0.0.1:5678', 'http://192.168.1.20:5678', 'http://10.0.0.5', 'http://172.20.1.1:5678', 'http://n8n.local:5678']) {
    assert.equal(normalizeN8nUrl(ok), ok.replace(/\/$/, ''))
  }
  for (const bad of ['http://n8n.example.com', 'http://172.32.0.1', 'ftp://x.com', 'https://user:pw@n8n.example.com', 'n8n.example.com', '']) {
    assert.throws(() => normalizeN8nUrl(bad), IpcValidationError, bad)
  }
  assert.deepEqual(validateN8nConnection({ url: 'https://n8n.example.com', apiKey: ' eyJhbGciOiJIUzI1NiJ9.payload.sig ' }), { url: 'https://n8n.example.com', apiKey: 'eyJhbGciOiJIUzI1NiJ9.payload.sig' })
  assert.throws(() => validateN8nConnection({ url: 'https://n8n.example.com', apiKey: 'short' }), IpcValidationError)
  assert.throws(() => validateN8nConnection({ url: 'https://n8n.example.com', apiKey: 'x'.repeat(30), extra: 1 }), IpcValidationError)
})

test('paths: only list endpoints, failed runs since a time', () => {
  assert.equal(n8nPaths.workflows(), '/api/v1/workflows?limit=250&excludePinnedData=true')
  assert.equal(n8nPaths.failed('2026-11-10T12:00:00.000Z'), '/api/v1/executions?status=error&startedAfter=2026-11-10T12%3A00%3A00.000Z&limit=100')
})

test('parsing and the report: archived skipped, active from activeVersionId, recovered retries left out', () => {
  const wfs = parseWorkflows({
    data: [
      { id: 'a', name: 'Lead sync', activeVersionId: 'v1' },
      { id: 'b', name: 'Invoices', activeVersionId: null, active: false },
      { id: 'c', name: 'Old', isArchived: true, activeVersionId: 'v' },
      { id: 'd', name: 'Legacy', active: true },
    ],
    nextCursor: null,
  })
  assert.deepEqual(wfs.map((w) => [w.id, w.active]), [['a', true], ['b', false], ['d', true]])
  const ex = parseExecutions({
    data: [
      { id: 10, workflowId: 'a', status: 'error', mode: 'trigger', startedAt: '2026-11-11T06:00:00.000Z' },
      { id: 11, workflowId: 'a', status: 'error', mode: 'trigger', startedAt: '2026-11-11T07:12:00.000Z' },
      { id: 12, workflowId: 'b', status: 'error', mode: 'trigger', startedAt: '2026-11-11T05:00:00.000Z', retrySuccessId: '13' },
      { id: 14, workflowId: 'zz', status: 'error', startedAt: '2026-11-11T04:00:00.000Z' },
      { workflowId: 'x' },
    ],
  })
  const r = buildReport('n8n.example.com', 24, wfs, ex, false)
  assert.deepEqual(r.workflows, { total: 3, active: 2 })
  assert.deepEqual(r.failing.map((f) => [f.name, f.failures, f.lastExecutionId]), [['Lead sync', 2, '11'], ['Workflow zz', 1, '14']])
  const text = formatReportForModel(r)
  assert.match(text, /3 workflows \(2 active\)/)
  assert.match(text, /Lead sync: 2 failed runs/)
  assert.match(text, /cannot run, fix/)
  assert.match(formatReportForModel(buildReport('h', 24, wfs, [], false)), /- None\./)
  assert.equal(executionLink('https://n8n.example.com', 'a', '11'), 'https://n8n.example.com/workflow/a/executions/11')
  assert.equal(executionLink('http://192.168.1.2:5678', 'a', '11'), null)
  assert.match(describeN8nError(401), /API key/)
})

test('tool: low risk, read-only, hours bounded; briefing guidance appears with enough sources', () => {
  const spec = TOOLS.n8n_check_automations
  assert.equal(spec.risk, 'low')
  assert.deepEqual(parseToolArgs('n8n_check_automations', '{"hours":24}'), { hours: 24 })
  assert.throws(() => parseToolArgs('n8n_check_automations', '{"hours":500}'), ToolArgsError)
  assert.throws(() => parseToolArgs('n8n_check_automations', '{"hours":1.5}'), ToolArgsError)
  assert.equal(summarizeToolCall('n8n_check_automations', { hours: 24 }), 'Check n8n automations (last 1 day)')
  assert.equal(summarizeToolCall('n8n_check_automations', { hours: 168 }), 'Check n8n automations (last 7 days)')
  const lines = toolInstructions([TOOLS.calendar_list_events, TOOLS.list_reminders, spec])
  assert.ok(lines.some((l) => l.includes('Morning briefing') && l.includes('n8n_check_automations')))
  assert.ok(!toolInstructions([TOOLS.get_time]).some((l) => l.includes('Morning briefing')))
})

test('morning briefing template: valid, weekday mornings, all its tools usable by a scheduled (read-only) run', () => {
  const t = WORKFLOW_TEMPLATES.find((w) => w.name === 'Morning briefing')
  assert.ok(t)
  assert.deepEqual(t.schedule, { days: [1, 2, 3, 4, 5], time: '07:30' })
  const scheduled = workflowTools(Object.values(TOOLS), 'schedule').map((s) => s.name)
  for (const n of ['calendar_list_events', 'list_reminders', 'list_leads', 'n8n_check_automations'] as const) assert.ok(scheduled.includes(n), n)
  assert.ok(!scheduled.includes('gmail_create_draft'))
})

test('the n8n client can only read: one fetch, method GET', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'n8n.ts'), 'utf8')
  assert.equal((src.match(/\bfetch\(/g) ?? []).length, 1)
  assert.match(src, /method: 'GET'/)
  assert.ok(!/method: '(POST|PUT|PATCH|DELETE)'/.test(src))
})
