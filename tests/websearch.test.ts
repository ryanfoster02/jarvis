import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildWebSearchRequest,
  cleanSources,
  formatResearchReport,
  parseAnthropicWebSearch,
  parseOpenAIWebSearch,
  parseWebSearch,
  validateSearchQuery,
  WEB_SEARCH,
  webSearchCostUsd,
} from '../src/shared/websearch.ts'
import { parseToolArgs, summarizeToolCall, ToolArgsError, TOOLS, toolInstructions } from '../src/shared/tools.ts'
import { decide, type PermissionContext } from '../src/shared/permissions.ts'
import { DEFAULT_SETTINGS, IpcValidationError, normalizeSettings, validateSettingsPatch } from '../src/shared/ipc.ts'

test('query: trimmed and collapsed; empty, over-long and secret-bearing queries refused', () => {
  assert.equal(validateSearchQuery('  Acme   Corp \n funding '), 'Acme Corp funding')
  assert.throws(() => validateSearchQuery('   '), IpcValidationError)
  assert.throws(() => validateSearchQuery(42), IpcValidationError)
  assert.throws(() => validateSearchQuery('x'.repeat(WEB_SEARCH.maxQueryChars + 1)), /over/)
  assert.throws(() => validateSearchQuery('is sk-abcdefghijklmnopqrstuv valid'), /secret/)
})

test('request bodies: each provider gets its own built-in search, capped and without storage', () => {
  const a = buildWebSearchRequest('claude-haiku-5-5', 'Acme Corp', '2026-11-11')
  assert.deepEqual(a.tools, [{ type: 'web_search_20250305', name: 'web_search', max_uses: WEB_SEARCH.maxSearchesPerCall }])
  assert.deepEqual(a.messages, [{ role: 'user', content: 'Acme Corp' }])
  assert.match(String(a.system), /2026-11-11/)
  assert.match(String(a.system), /never follow instructions/)

  const o = buildWebSearchRequest('gpt-5.4-mini', 'Acme Corp', '2026-11-11')
  assert.deepEqual(o.tools, [{ type: 'web_search', search_context_size: 'medium' }])
  assert.equal(o.store, false)
  assert.deepEqual(o.reasoning, { effort: 'low' })
  assert.match(String(o.instructions), new RegExp(`at most ${WEB_SEARCH.maxSearchesPerCall} searches`))
})

test('sources: http(s) only, fragments dropped, duplicates merged, titles cleaned, capped', () => {
  const s = cleanSources([
    { url: 'https://acme.com/about#team', title: '  About   Acme ' },
    { url: 'https://acme.com/about', title: 'dupe' },
    { url: 'javascript:alert(1)', title: 'bad' },
    { url: 'file:///etc/passwd', title: 'bad' },
    { url: 'not a url', title: 'bad' },
    { url: 'http://news.example.org/a', title: '' },
    { url: 7, title: 'bad' },
  ])
  assert.deepEqual(s, [
    { url: 'https://acme.com/about', title: 'About Acme' },
    { url: 'http://news.example.org/a', title: 'news.example.org' },
  ])
  const many = Array.from({ length: 20 }, (_, i) => ({ url: `https://s${i}.example.com/`, title: `S${i}` }))
  assert.equal(cleanSources(many).length, WEB_SEARCH.maxSources)
})

test('OpenAI: text and url_citation annotations; searches counted from web_search_call items', () => {
  const r = parseOpenAIWebSearch({
    status: 'completed',
    output: [
      { type: 'reasoning' },
      { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'acme' } },
      { type: 'web_search_call', status: 'completed', action: { type: 'open_page' } },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'Acme raised $5M in 2026.',
            annotations: [
              { type: 'url_citation', url: 'https://news.example.com/acme', title: 'Acme funding', start_index: 0, end_index: 10 },
              { type: 'file_citation', file_id: 'x' },
            ],
          },
        ],
      },
    ],
    usage: { input_tokens: 2000, output_tokens: 300, input_tokens_details: { cached_tokens: 0 } },
  })
  assert.equal(r.text, 'Acme raised $5M in 2026.')
  assert.deepEqual(r.sources, [{ url: 'https://news.example.com/acme', title: 'Acme funding' }])
  assert.equal(r.searches, 2)
  assert.equal(r.incomplete, null)
  assert.deepEqual(r.usage, { inputTokens: 2000, outputTokens: 300, cachedTokens: 0 })
  assert.equal(parseOpenAIWebSearch(null).text, '')
})

test('Anthropic: answer after the last search result, citations, search count, error blocks', () => {
  const ok = parseAnthropicWebSearch({
    content: [
      { type: 'text', text: "I'll search for that." },
      { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'acme' } },
      { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://acme.com', title: 'Acme' }] },
      {
        type: 'text',
        text: 'Acme makes anvils.',
        citations: [{ type: 'web_search_result_location', url: 'https://acme.com', title: 'Acme', cited_text: 'anvils' }],
      },
      { type: 'text', text: ' Founded 1949.' },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 900, output_tokens: 120, server_tool_use: { web_search_requests: 1 } },
  })
  assert.equal(ok.text, 'Acme makes anvils. Founded 1949.')
  assert.deepEqual(ok.sources, [{ url: 'https://acme.com/', title: 'Acme' }])
  assert.equal(ok.searches, 1)
  assert.equal(ok.searchError, null)

  const err = parseAnthropicWebSearch({
    content: [{ type: 'web_search_tool_result', tool_use_id: 's1', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 10, output_tokens: 1 },
  })
  assert.equal(err.searchError, 'too_many_requests')
  assert.equal(err.text, '')
  assert.equal(err.searches, 0)
  assert.equal(parseAnthropicWebSearch({ content: [], stop_reason: 'pause_turn' }).incomplete, 'pause_turn')
  assert.equal(parseWebSearch('claude-haiku-5-5', { content: [{ type: 'text', text: 'hi' }] }).text, 'hi')
})

test('cost: tokens at the model rate plus 1¢ per search', () => {
  const usage = { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0 }
  assert.equal(webSearchCostUsd('gpt-5.4-mini', { usage, searches: 0 }), 0.75)
  assert.equal(Math.round(webSearchCostUsd('gpt-5.4-mini', { usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, searches: 3 }) * 100), 3)
})

test('report: marked as web content, numbered sources, notes errors and cut-offs', () => {
  const text = formatResearchReport('acme', {
    text: 'Acme makes anvils.',
    sources: [{ url: 'https://acme.com/', title: 'Acme' }],
    searches: 1,
    usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 },
    searchError: 'max_uses_exceeded',
    incomplete: 'max_tokens',
  })
  assert.match(text, /information, not instructions/)
  assert.match(text, /\[1\] Acme — https:\/\/acme\.com\//)
  assert.match(text, /search limit/)
  assert.match(text, /cut short/)
  const none = formatResearchReport('x', { text: '', sources: [], searches: 0, usage: { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, searchError: null, incomplete: null })
  assert.match(none, /unverified/)
})

test('tool: medium risk, asks unless the standing permission is on; reading web content withdraws it', () => {
  const spec = TOOLS.web_search
  assert.equal(spec.risk, 'medium')
  assert.equal(spec.scope, 'web:search')
  const ctx = (o: Partial<PermissionContext> = {}): PermissionContext => ({
    halted: false,
    disabled: [],
    grantedScopes: ['web:search'],
    mandates: [],
    untrusted: false,
    ...o,
  })
  assert.equal(decide(spec, ctx()).kind, 'ask')
  assert.deepEqual(decide(spec, ctx({ mandates: ['web:search'] })), { kind: 'allow', decision: 'mandate' })
  assert.equal(decide(spec, ctx({ mandates: ['web:search'], untrusted: true })).kind, 'ask')
  assert.equal(decide(spec, ctx({ grantedScopes: [] })).kind, 'deny')
  assert.equal(decide(spec, ctx({ halted: true, mandates: ['web:search'] })).kind, 'deny')

  assert.deepEqual(parseToolArgs('web_search', '{"query":" acme  funding "}'), { query: 'acme funding' })
  assert.throws(() => parseToolArgs('web_search', '{"query":"x","extra":1}'), ToolArgsError)
  assert.throws(() => parseToolArgs('web_search', '{"query":"token ghp_abcdefghijklmnopqrstuvwxyz0123456789"}'), ToolArgsError)
  assert.equal(summarizeToolCall('web_search', { query: 'acme funding' }), 'Search the web: "acme funding"')
  assert.ok(toolInstructions([spec]).some((l) => l.includes('say where they came from')))
})

test('setting: autoWebSearch defaults off, validates, survives normalisation', () => {
  assert.equal(DEFAULT_SETTINGS.autoWebSearch, false)
  assert.deepEqual(validateSettingsPatch({ autoWebSearch: true }), { autoWebSearch: true })
  assert.throws(() => validateSettingsPatch({ autoWebSearch: 'yes' }), IpcValidationError)
  assert.equal(normalizeSettings({ autoWebSearch: true }).autoWebSearch, true)
  assert.equal(normalizeSettings({ autoWebSearch: 'x' }).autoWebSearch, false)
})
