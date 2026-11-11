process.env.TZ = 'America/Chicago'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyLeadPatch, pipelineSummary, todayIso, validateDate, validateLeadInput } from '../src/shared/leads.ts'
import { parseWebhookData, validateWebhookInput, validateWebhookMessage, validateWebhookUrl, webhookHost, webhookPayload } from '../src/shared/webhooks.ts'
import { enabledTools, parseToolArgs, specsForRequest, summarizeToolCall, ToolArgsError, TOOLS } from '../src/shared/tools.ts'
import { decide } from '../src/shared/permissions.ts'
import { workflowTools, WORKFLOW_TEMPLATES } from '../src/shared/workflows.ts'
import { IpcValidationError, type Lead } from '../src/shared/ipc.ts'

const NOW = new Date('2026-11-10T20:00:00-06:00').getTime()
const lead = (o: Partial<Lead>): Lead => ({
  id: '3f2b8a3e-1c2d-4e5f-8a9b-0c1d2e3f4a5b',
  workspaceId: 'foster-automation',
  name: 'Ada',
  company: 'Acme',
  email: '',
  status: 'new',
  value: 0,
  notes: '',
  nextStep: '',
  nextDate: null,
  createdAt: 0,
  updatedAt: 0,
  ...o,
})

test('leads: validation, values, dates, secrets', () => {
  assert.deepEqual(validateLeadInput({ name: ' Ada  Lovelace ', company: 'Acme', email: 'ada@acme.io', status: 'qualified', value: '$12,500', notes: '', nextStep: 'Call', nextDate: '2026-11-20' }), {
    name: 'Ada Lovelace',
    company: 'Acme',
    email: 'ada@acme.io',
    status: 'qualified',
    value: 12500,
    notes: '',
    nextStep: 'Call',
    nextDate: '2026-11-20',
  })
  assert.equal(validateLeadInput({ name: 'X' }).status, 'new', 'defaults')
  assert.throws(() => validateLeadInput({ name: '' }), /Name is required/)
  assert.throws(() => validateLeadInput({ name: 'X', email: 'nope' }), /email/)
  assert.throws(() => validateLeadInput({ name: 'X', status: 'hot' }), /Status/)
  assert.throws(() => validateLeadInput({ name: 'X', value: -5 }), /Value/)
  assert.throws(() => validateLeadInput({ name: 'X', notes: 'their password is hunter22' }), /credentials/)
  assert.throws(() => validateLeadInput({ name: 'X', owner: 'me' }), IpcValidationError)
  assert.throws(() => validateDate('2026-02-30'), /doesn't exist/)
  assert.equal(todayIso(NOW), '2026-11-10')
  assert.deepEqual(applyLeadPatch(lead({}), { status: 'won', value: 900 }).status, 'won')
})

test('pipeline summary: stages, open value, overdue next steps', () => {
  const s = pipelineSummary(
    [
      lead({ status: 'new', value: 100, nextDate: '2026-11-01' }),
      lead({ status: 'proposal', value: 5000, nextDate: '2026-11-09' }),
      lead({ status: 'qualified', value: 200, nextDate: '2026-11-10' }),
      lead({ status: 'won', value: 9000, nextDate: '2026-10-01' }),
    ],
    NOW,
  )
  assert.equal(s.byStatus.won.value, 9000)
  assert.equal(s.openCount, 3)
  assert.equal(s.openValue, 5300)
  assert.deepEqual(s.overdue.map((l) => l.nextDate), ['2026-11-01', '2026-11-09'], 'today is not overdue; won leads never are')
})

test('webhooks: https, localhost-only http, no credentials in URLs, names', () => {
  assert.equal(validateWebhookUrl('https://n8n.example.com/webhook/abc#x'), 'https://n8n.example.com/webhook/abc')
  assert.equal(validateWebhookUrl('http://localhost:5678/webhook/abc'), 'http://localhost:5678/webhook/abc')
  assert.throws(() => validateWebhookUrl('http://n8n.example.com/webhook'), /https/)
  assert.throws(() => validateWebhookUrl('https://user:pw@example.com/h'), /username or password/)
  assert.throws(() => validateWebhookUrl('ftp://example.com'), /https/)
  assert.equal(webhookHost('https://n8n.example.com:8443/webhook/secret-path'), 'n8n.example.com:8443')
  assert.deepEqual(validateWebhookInput({ name: ' CRM  sync ', url: 'https://hooks.zapier.com/x', secret: '' }), { name: 'CRM sync', url: 'https://hooks.zapier.com/x', secret: null })
  assert.throws(() => validateWebhookInput({ name: 'bad/name', url: 'https://x.io' }), /letters/)
  assert.throws(() => validateWebhookInput({ name: 'ok', url: 'https://x.io', secret: 'a\nb' }), /one line/)
})

test('webhook payload: data must be JSON object/array; secrets never sent', () => {
  assert.deepEqual(parseWebhookData('{"lead":"Ada"}'), { lead: 'Ada' })
  assert.equal(parseWebhookData(null), null)
  assert.throws(() => parseWebhookData('42'), /object or array/)
  assert.throws(() => parseWebhookData('{oops'), /valid JSON/)
  assert.throws(() => validateWebhookMessage('Here is the key sk-proj-abcdefghijklmnopqrstuvwx', null), /credentials/)
  assert.throws(() => validateWebhookMessage('Hi', { token: 'ghp_' + 'a'.repeat(36) }), /credentials/)
  assert.deepEqual(webhookPayload({ webhook: 'CRM', message: 'Hi', data: null, workspace: 'Personal', now: Date.UTC(2026, 10, 11) }), {
    source: 'jarvis',
    webhook: 'CRM',
    workspace: 'Personal',
    sentAt: '2026-11-11T00:00:00.000Z',
    message: 'Hi',
    data: null,
  })
})

test('tools: risk levels, read-only routines, arg parsing, summaries, webhook enum', () => {
  assert.equal(TOOLS.send_webhook.risk, 'high')
  assert.equal(TOOLS.add_lead.risk, 'medium')
  assert.equal(TOOLS.list_leads.risk, 'low')
  const ctx = { halted: false, disabled: [], grantedScopes: ['webhooks:send' as const, 'leads:write' as const], mandates: ['webhooks:send' as const, 'leads:write' as const] }
  assert.equal(decide(TOOLS.send_webhook, ctx).kind, 'ask', 'high risk asks even with a mandate')
  const scheduled = workflowTools(enabledTools([]), 'schedule').map((t) => t.name)
  assert.ok(scheduled.includes('list_leads') && !scheduled.includes('send_webhook') && !scheduled.includes('add_lead'))
  assert.deepEqual(parseToolArgs('add_lead', { name: 'Ada', company: null, email: null, status: 'new', value: null, notes: null, next_step: null, next_date: null }), {
    name: 'Ada',
    company: '',
    email: '',
    status: 'new',
    value: 0,
    notes: '',
    nextStep: '',
    nextDate: null,
  })
  assert.deepEqual(parseToolArgs('update_lead', { id: lead({}).id, status: 'won', value: null, notes: null, next_step: null, next_date: null }), {
    id: lead({}).id,
    patch: { status: 'won' },
  })
  assert.throws(() => parseToolArgs('update_lead', { id: lead({}).id, status: null, value: null, notes: null, next_step: null, next_date: null }), /Nothing to change/)
  assert.throws(() => parseToolArgs('send_webhook', { webhook: 'CRM', message: 'x', data_json: '[1' }), ToolArgsError)
  const sw = parseToolArgs('send_webhook', { webhook: 'CRM', message: 'New lead: Ada', data_json: '{"name":"Ada"}' })
  assert.equal(summarizeToolCall('send_webhook', sw, { webhookHost: 'n8n.example.com' }), 'Send to CRM (n8n.example.com): "New lead: Ada" + data')
  assert.equal(summarizeToolCall('update_lead', { id: 'x', patch: { status: 'won', nextDate: '2026-11-20' } }, { leadName: 'Ada' }), 'Update lead "Ada" → status: won, next date: 2026-11-20')
  const offered = specsForRequest([TOOLS.send_webhook], [], ['CRM', 'Slack via n8n'])
  assert.deepEqual((offered[0]?.parameters as { properties: { webhook: { enum: string[] } } }).properties.webhook.enum, ['CRM', 'Slack via n8n'])
  assert.ok(WORKFLOW_TEMPLATES.some((t) => t.name === 'Weekly pipeline report'))
})
