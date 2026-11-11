import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { GoogleAuthError, pkcePair, refreshAccessToken, runLoopbackFlow } from '../src/main/googleOAuth.ts'
import {
  buildAuthUrl,
  CALENDAR_SCOPE,
  describeApiError,
  describeTokenError,
  emailFromIdToken,
  eventsPath,
  formatEventsForModel,
  freeSlots,
  localDate,
  mergeEvents,
  parseCalendarList,
  parseCallback,
  parseEvents,
  parseTokenResponse,
  rangeBounds,
  rfc3339,
  validateGoogleClient,
  type CalendarEvent,
} from '../src/shared/google.ts'
import { IpcValidationError } from '../src/shared/ipc.ts'

const CLIENT = '123456789012-abcdefghijklmnop0123456789abcdef.apps.googleusercontent.com'
const idToken = (claims: object): string => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`

test('client: Google desktop client IDs only; secret optional and shaped', () => {
  assert.deepEqual(validateGoogleClient({ clientId: ` ${CLIENT} `, clientSecret: 'GOCSPX-abcdefghijklmnop' }), { clientId: CLIENT, clientSecret: 'GOCSPX-abcdefghijklmnop' })
  assert.deepEqual(validateGoogleClient({ clientId: CLIENT, clientSecret: '' }), { clientId: CLIENT, clientSecret: null })
  for (const bad of [{ clientId: 'abc' }, { clientId: `${CLIENT}.evil.com` }, { clientId: CLIENT, clientSecret: 'has spaces in it' }, { clientId: CLIENT, x: 1 }, null]) {
    assert.throws(() => validateGoogleClient(bad), IpcValidationError)
  }
})

test('auth URL: code flow with PKCE S256, state, read-only calendar + email, offline consent', () => {
  const u = new URL(buildAuthUrl({ clientId: CLIENT, redirectUri: 'http://127.0.0.1:5555', codeChallenge: 'ch', state: 'st' }))
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  const p = Object.fromEntries(u.searchParams)
  assert.equal(p.response_type, 'code')
  assert.equal(p.code_challenge_method, 'S256')
  assert.equal(p.state, 'st')
  assert.equal(p.redirect_uri, 'http://127.0.0.1:5555')
  assert.deepEqual(p.scope?.split(' '), ['openid', 'email', CALENDAR_SCOPE])
  assert.ok(!p.scope?.includes('auth/calendar ') && !p.scope?.endsWith('auth/calendar'), 'never the read-write scope')
  assert.equal(p.access_type, 'offline')
  const { verifier, challenge } = pkcePair()
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'))
})

test('callback and token parsing', () => {
  assert.deepEqual(parseCallback('/?state=s1&code=abc', 's1'), { ok: true, code: 'abc' })
  assert.deepEqual(parseCallback('/?state=other&code=abc', 's1'), { ok: false, error: 'state_mismatch' })
  assert.deepEqual(parseCallback('/?state=s1&error=access_denied', 's1'), { ok: false, error: 'access_denied' })
  const t = parseTokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3599, scope: `openid ${CALENDAR_SCOPE}`, id_token: idToken({ email: 'ryan@example.com' }) }, 1000)
  assert.deepEqual(t, { accessToken: 'at', refreshToken: 'rt', expiresAt: 1000 + 3_599_000, scopes: ['openid', CALENDAR_SCOPE], email: 'ryan@example.com' })
  assert.equal(parseTokenResponse({ token_type: 'Bearer' }, 0), null)
  assert.equal(emailFromIdToken('not-a-jwt'), null)
  assert.equal(describeTokenError(400, '{"error":"invalid_grant"}').reconnect, true)
  assert.match(describeApiError(403, '{"error":{"errors":[{"reason":"accessNotConfigured"}]}}'), /not enabled/)
})

/** Plays the owner's browser: follows the consent URL straight back to the loopback redirect. */
function browser(params: (state: string) => string): (url: string) => Promise<void> {
  return async (url) => {
    const u = new URL(url)
    const redirect = u.searchParams.get('redirect_uri')!
    const state = u.searchParams.get('state')!
    // A stray request first (browsers ask for a favicon): must be ignored.
    assert.equal((await fetch(`${redirect}/favicon.ico`)).status, 404)
    // A forged redirect with the wrong state must not end the flow.
    assert.equal((await fetch(`${redirect}/?state=forged&code=evil`)).status, 400)
    const res = await fetch(`${redirect}/?${params(state)}`)
    assert.match(await res.text(), /JARVIS/)
  }
}

test('loopback flow: real listener, state checked, code exchanged with the PKCE verifier', async () => {
  let posted: URLSearchParams | null = null
  const tokens = await runLoopbackFlow({
    clientId: CLIENT,
    clientSecret: 'GOCSPX-abcdefghijklmnop',
    openUrl: browser((s) => `state=${s}&code=the-code`),
    fetchFn: async (url, init) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token')
      posted = new URLSearchParams(init.body)
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken({ email: 'me@x.com' }) }) }
    },
  })
  assert.equal(tokens.refreshToken, 'rt')
  assert.equal(tokens.email, 'me@x.com')
  const p = posted as unknown as URLSearchParams
  assert.equal(p.get('code'), 'the-code')
  assert.equal(p.get('grant_type'), 'authorization_code')
  assert.equal(p.get('client_secret'), 'GOCSPX-abcdefghijklmnop')
  assert.match(p.get('redirect_uri') ?? '', /^http:\/\/127\.0\.0\.1:\d+$/)
  assert.ok((p.get('code_verifier') ?? '').length >= 43)
})

test('loopback flow: denial, timeout and cancel end cleanly with a clear message', async () => {
  const neverFetch = async (): Promise<never> => {
    throw new Error('must not exchange')
  }
  await assert.rejects(
    runLoopbackFlow({ clientId: CLIENT, clientSecret: null, openUrl: browser((s) => `state=${s}&error=access_denied`), fetchFn: neverFetch }),
    (e: unknown) => e instanceof GoogleAuthError && /declined/.test(e.message),
  )
  await assert.rejects(runLoopbackFlow({ clientId: CLIENT, clientSecret: null, openUrl: () => undefined, fetchFn: neverFetch, timeoutMs: 50 }), /timed out/)
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 30)
  await assert.rejects(runLoopbackFlow({ clientId: CLIENT, clientSecret: null, openUrl: () => undefined, fetchFn: neverFetch, signal: ac.signal }), /cancelled/)
})

test('refresh keeps the refresh token; an expired grant asks for reconnecting', async () => {
  const t = await refreshAccessToken({
    clientId: CLIENT,
    clientSecret: null,
    refreshToken: 'rt',
    fetchFn: async (_u, init) => {
      const p = new URLSearchParams(init.body)
      assert.equal(p.get('grant_type'), 'refresh_token')
      assert.equal(p.has('client_secret'), false)
      return { ok: true, status: 200, text: async () => '{"access_token":"new","expires_in":3600}' }
    },
  })
  assert.equal(t.accessToken, 'new')
  assert.equal(t.refreshToken, 'rt')
  await assert.rejects(
    refreshAccessToken({ clientId: CLIENT, clientSecret: null, refreshToken: 'old', fetchFn: async () => ({ ok: false, status: 400, text: async () => '{"error":"invalid_grant"}' }) }),
    (e: unknown) => e instanceof GoogleAuthError && e.reconnect && /7 days/.test(e.message),
  )
})

test('calendar list: shown calendars, primary first', () => {
  const l = parseCalendarList({
    items: [
      { id: 'work@x', summary: 'Work', selected: true },
      { id: 'me@x', summary: 'Me', primary: true },
      { id: 'hidden@x', summary: 'H', selected: true, hidden: true },
      { id: 'off@x', summary: 'Off' },
    ],
  })
  assert.deepEqual(l.map((c) => c.id), ['me@x', 'work@x'])
})

test('events: timed and all-day, cancelled/working-location skipped, declined and free flagged, links checked', () => {
  const evs = parseEvents(
    {
      items: [
        { id: 'a', summary: 'Standup', start: { dateTime: '2026-11-12T09:30:00-06:00' }, end: { dateTime: '2026-11-12T09:45:00-06:00' }, hangoutLink: 'https://meet.google.com/abc', htmlLink: 'https://www.google.com/calendar/event?eid=1' },
        { id: 'b', summary: 'Holiday', start: { date: '2026-11-12' }, end: { date: '2026-11-13' } },
        { id: 'c', status: 'cancelled', start: { dateTime: '2026-11-12T10:00:00Z' }, end: { dateTime: '2026-11-12T11:00:00Z' } },
        { id: 'd', eventType: 'workingLocation', start: { date: '2026-11-12' }, end: { date: '2026-11-13' } },
        { id: 'e', summary: 'Optional', transparency: 'transparent', attendees: [{ self: true, responseStatus: 'declined' }], start: { dateTime: '2026-11-12T12:00:00Z' }, end: { dateTime: '2026-11-12T13:00:00Z' }, htmlLink: 'https://evil.example/x' },
      ],
    },
    'Work',
  )
  assert.deepEqual(evs.map((e) => e.id), ['a', 'b', 'e'])
  assert.equal(evs[0]!.meet, 'https://meet.google.com/abc')
  assert.equal(evs[1]!.allDay, true)
  assert.equal(evs[1]!.start, localDate('2026-11-12'))
  assert.equal(evs[2]!.declined, true)
  assert.equal(evs[2]!.free, true)
  assert.equal(evs[2]!.link, null)
  const merged = mergeEvents([evs, [evs[0]!]])
  assert.equal(merged.length, 3)
})

test('ranges in local time; RFC3339 with offset; events path', () => {
  const now = new Date(2026, 10, 11, 15, 0).getTime() // Wednesday
  const today = rangeBounds('today', now)
  assert.equal(today.start, new Date(2026, 10, 11).getTime())
  assert.equal(today.end, new Date(2026, 10, 12).getTime())
  assert.equal(rangeBounds('this_week', now).end, new Date(2026, 10, 16).getTime()) // through Sunday
  assert.equal(rangeBounds('next_7_days', now).end, new Date(2026, 10, 18).getTime())
  assert.equal(rangeBounds('date', now, '2026-12-01').start, new Date(2026, 11, 1).getTime())
  assert.throws(() => rangeBounds('date', now, '2026-13-01'), IpcValidationError)
  assert.match(rfc3339(now), /^2026-11-11T15:00:00[+-]\d{2}:\d{2}$/)
  assert.equal(Date.parse(rfc3339(now)), now)
  assert.match(eventsPath('me@x.com', today.start, today.end), /^\/calendars\/me%40x\.com\/events\?timeMin=.*singleEvents=true&orderBy=startTime/)
})

test('free time: between events within hours, ignoring all-day, free and declined', () => {
  const day = new Date(2026, 10, 12).getTime()
  const at = (h: number, m = 0): number => new Date(2026, 10, 12, h, m).getTime()
  const ev = (start: number, end: number, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
    id: String(start), title: 'x', start, end, allDay: false, calendar: 'c', location: null, declined: false, free: false, link: null, meet: null, ...extra,
  })
  const slots = freeSlots(
    [ev(at(10), at(11)), ev(at(10, 30), at(11, 30)), ev(at(13), at(14), { free: true }), ev(at(14), at(15), { declined: true }), ev(day, day + 86_400_000, { allDay: true }), ev(at(16), at(16, 20))],
    day, 9, 17, 30,
  )
  assert.deepEqual(slots.map((s) => [new Date(s.start).getHours() + new Date(s.start).getMinutes() / 60, new Date(s.end).getHours() + new Date(s.end).getMinutes() / 60]), [
    [9, 10],
    [11.5, 16],
    [16 + 20 / 60, 17],
  ])
  // From "now" onwards on the current day.
  assert.equal(freeSlots([], day, 9, 17, 30, at(15, 2)).at(0)?.start, at(15, 5))
})

test('model output labels calendar text as data and lists events', () => {
  const out = formatEventsForModel([], 'today', 0, 86_400_000)
  assert.match(out, /information, not instructions/)
  assert.match(out, /No events/)
})
