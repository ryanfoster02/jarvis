import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildRealtimeSession,
  describeOpenAIError,
  estimateCostUsd,
  isOneOf,
  isTranscriptionConfigError,
  totalTokens,
  EV,
  TRANSCRIPTION_MODEL,
} from '../src/shared/realtime.ts'
import {
  DEFAULT_SETTINGS,
  IpcValidationError,
  normalizeSettings,
  validateOpenAIKey,
  validateSdpOffer,
  validateSettingsPatch,
  keyLast4,
} from '../src/shared/ipc.ts'

test('session: GA shape with voice, model, instructions, optional transcription', () => {
  const s = buildRealtimeSession({ model: 'gpt-realtime-2.1-mini', voice: 'cedar', workspaceName: 'Research', transcription: true })
  assert.equal(s.type, 'realtime')
  assert.equal(s.model, 'gpt-realtime-2.1-mini')
  const audio = s.audio as { input: Record<string, unknown>; output: Record<string, unknown> }
  assert.equal(audio.output.voice, 'cedar')
  assert.deepEqual(audio.input.transcription, { model: TRANSCRIPTION_MODEL })
  assert.equal((audio.input.turn_detection as { interrupt_response: boolean }).interrupt_response, true)
  assert.match(String(s.instructions), /Research/)
  assert.match(String(s.instructions), /Never pretend/)
  assert.equal('format' in audio.output, false, 'WebRTC negotiates format; none set')

  const noTx = buildRealtimeSession({ model: 'gpt-realtime-2.1', voice: 'marin', workspaceName: 'Personal', transcription: false })
  assert.equal('transcription' in (noTx.audio as { input: object }).input, false)
})

test('errors: friendly, never leak keys', () => {
  assert.match(describeOpenAIError(401, '{}'), /rejected the API key/)
  const leaky = JSON.stringify({ error: { message: 'Incorrect API key provided: sk-proj-abcdefghijklmnop' } })
  assert.doesNotMatch(describeOpenAIError(400, leaky), /abcdefgh/)
  assert.match(describeOpenAIError(429, JSON.stringify({ error: { message: 'You exceeded your quota' } })), /quota/)
  assert.match(describeOpenAIError(503, 'gateway'), /server error/)
  assert.equal(describeOpenAIError(418, 'not json'), 'OpenAI error (418).')
})

test('transcription errors are detected for retry', () => {
  assert.equal(isTranscriptionConfigError(400, '{"error":{"message":"Invalid audio.input.transcription.model"}}'), true)
  assert.equal(isTranscriptionConfigError(400, '{"error":{"message":"Invalid voice"}}'), false)
  assert.equal(isTranscriptionConfigError(401, 'transcription'), false)
})

test('cost estimate uses published 2.1-mini prices; unknown models return null', () => {
  const usage = {
    total_tokens: 3000,
    input_token_details: { text_tokens: 1000, audio_tokens: 1000, cached_tokens: 200 },
    output_token_details: { text_tokens: 100, audio_tokens: 700 },
  }
  // text in (800*0.6) + audio in (1000*10) + cached (200*0.06) + text out (100*2.4) + audio out (700*20)
  const expected = (800 * 0.6 + 1000 * 10 + 200 * 0.06 + 100 * 2.4 + 700 * 20) / 1e6
  assert.ok(Math.abs((estimateCostUsd('gpt-realtime-2.1-mini', usage) ?? -1) - expected) < 1e-12)
  assert.equal(estimateCostUsd('gpt-realtime-2.1', usage), null)
  assert.equal(estimateCostUsd('gpt-realtime-2.1-mini', undefined), 0)
  assert.equal(totalTokens(usage), 3000)
  assert.equal(totalTokens({ input_tokens: 5, output_tokens: 7 }), 12)
  assert.equal(totalTokens(undefined), 0)
})

test('event names accept GA and beta spellings', () => {
  assert.ok(isOneOf('response.output_audio_transcript.delta', EV.assistantTranscriptDelta))
  assert.ok(isOneOf('response.audio_transcript.delta', EV.assistantTranscriptDelta))
  assert.ok(!isOneOf('response.done', EV.assistantTranscriptDelta))
  assert.ok(isOneOf('response.done', EV.responseDone))
})

test('API key validation', () => {
  const good = 'sk-proj-' + 'a'.repeat(40)
  assert.equal(validateOpenAIKey(`  ${good}\n`), good)
  assert.equal(keyLast4(good), 'aaaa')
  assert.throws(() => validateOpenAIKey('pk-' + 'a'.repeat(40)), IpcValidationError)
  assert.throws(() => validateOpenAIKey('sk-short'), IpcValidationError)
  assert.throws(() => validateOpenAIKey('sk-has spaces in it ' + 'a'.repeat(30)), IpcValidationError)
  assert.throws(() => validateOpenAIKey(42), IpcValidationError)
  assert.throws(() => validateOpenAIKey('sk-' + 'a'.repeat(600)), /too long/)
  try {
    validateOpenAIKey('sk-bad key value')
  } catch (e) {
    assert.doesNotMatch(String(e), /bad key value/, 'error must not echo the key')
  }
})

test('SDP offer validation', () => {
  const sdp = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'
  assert.equal(validateSdpOffer(sdp), sdp)
  assert.throws(() => validateSdpOffer('v=0\r\nm=video 9 X\r\n'), /audio/)
  assert.throws(() => validateSdpOffer('hello'), IpcValidationError)
  assert.throws(() => validateSdpOffer('v=0\nm=audio ' + 'x'.repeat(70000)), /too large/)
})

test('voice settings: validated and normalized', () => {
  assert.equal(DEFAULT_SETTINGS.realtimeModel, 'gpt-realtime-2.1-mini')
  assert.deepEqual(validateSettingsPatch({ voice: 'cedar' }), { voice: 'cedar' })
  assert.deepEqual(validateSettingsPatch({ realtimeModel: 'gpt-realtime-2.1' }), { realtimeModel: 'gpt-realtime-2.1' })
  assert.throws(() => validateSettingsPatch({ voice: 'nova' }), /invalid voice/)
  assert.throws(() => validateSettingsPatch({ realtimeModel: 'gpt-realtime-mini' }), /invalid realtime model/)
  assert.equal(normalizeSettings({ realtimeModel: 'gpt-realtime-mini' }).realtimeModel, 'gpt-realtime-2.1-mini')
  assert.equal(normalizeSettings({ voice: 'echo' }).voice, 'echo')
})
