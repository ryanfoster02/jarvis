import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanForSpeech, takeSpeakable } from '../src/shared/speech.ts'
import { describeElevenLabsError, isAuthenticatedButRestricted } from '../src/shared/elevenlabs.ts'
import { buildInstructions, buildRealtimeSession } from '../src/shared/realtime.ts'
import {
  DEFAULT_SETTINGS,
  ELEVEN_PRESET,
  ELEVEN_VOICES,
  IpcValidationError,
  normalizeSettings,
  validateElevenLabsKey,
  validateProviderKey,
  validateSettingsPatch,
  validateTtsText,
} from '../src/shared/ipc.ts'

test('chunker: waits for a sentence end, then speaks whole sentences', () => {
  assert.deepEqual(takeSpeakable('Good evening. I have', false), { chunks: [], rest: 'Good evening. I have' })
  const r = takeSpeakable("Good evening. I'm afraid that isn't connected yet. Shall I", false)
  assert.deepEqual(r.chunks, ["Good evening. I'm afraid that isn't connected yet."])
  assert.equal(r.rest, 'Shall I')
})

test('chunker: short first sentence is merged with the next to avoid choppy clips', () => {
  const r = takeSpeakable('Certainly. One moment while I check that for you. Next', false)
  assert.deepEqual(r.chunks, ['Certainly. One moment while I check that for you.'])
})

test('chunker: final flush returns the remainder; no empty chunks', () => {
  assert.deepEqual(takeSpeakable('Right away', true), { chunks: ['Right away'], rest: '' })
  assert.deepEqual(takeSpeakable('   ', true), { chunks: [], rest: '' })
})

test('chunker: abbreviations-like decimals are not split mid-number', () => {
  const r = takeSpeakable('The total comes to 3.75 pounds for the month, sir. Anything else', false)
  assert.deepEqual(r.chunks, ['The total comes to 3.75 pounds for the month, sir.'])
})

test('chunker: very long run-on text is broken at a comma before the max length', () => {
  const long = 'This is a long clause that keeps going, ' + 'and then it continues with more words '.repeat(8)
  const r = takeSpeakable(long, false)
  assert.ok(r.chunks.length >= 1)
  assert.ok(r.chunks.every((c) => c.length <= 220))
  assert.equal(r.chunks[0], 'This is a long clause that keeps going,')
})

test('chunker: closing quotes stay with their sentence', () => {
  const r = takeSpeakable('He said "rather well, I think." Then', false)
  assert.deepEqual(r.chunks, ['He said "rather well, I think."'])
})

test('cleanForSpeech removes markdown, URLs and emoji', () => {
  assert.equal(cleanForSpeech('**Done** 👍 see https://example.com/x now'), 'Done see the link now')
})

test('ElevenLabs errors are actionable and never leak keys', () => {
  assert.match(describeElevenLabsError(401, '{"detail":{"status":"invalid_api_key","message":"Invalid API key"}}'), /rejected the API key/)
  assert.match(describeElevenLabsError(401, '{"detail":{"status":"missing_permissions","message":"x"}}'), /Text to Speech permission/)
  assert.match(describeElevenLabsError(404, '{"detail":{"status":"voice_not_found","message":"Voice not found"}}'), /My Voices/)
  assert.match(describeElevenLabsError(429, '{"detail":{"status":"quota_exceeded","message":"Quota exceeded"}}'), /quota/)
  assert.doesNotMatch(describeElevenLabsError(400, '{"detail":{"message":"bad key sk_abcdef123456"}}'), /abcdef/)
  assert.equal(isAuthenticatedButRestricted(401, '{"detail":{"status":"missing_permissions"}}'), true)
  assert.equal(isAuthenticatedButRestricted(401, '{"detail":{"status":"invalid_api_key"}}'), false)
})

test('text-mode session: text output only, no OpenAI voice, spoken-text rules, accent rules dropped', () => {
  const s = buildRealtimeSession({ model: 'gpt-realtime-2.1-mini', voice: 'ballad', workspaceName: 'Personal', transcription: true, persona: 'british-butler', honorific: 'sir', output: 'text' })
  assert.deepEqual(s.output_modalities, ['text'])
  assert.equal('output' in (s.audio as object), false)
  const ins = String(s.instructions)
  assert.match(ins, /read aloud by a separate British text-to-speech voice/)
  assert.doesNotMatch(ins, /Non-rhotic/)
  assert.match(ins, /dry, understated wit/i)
  assert.match(ins, /Certainly, sir/)
  assert.match(ins, /Never pretend/)
  assert.match(buildInstructions({ workspaceName: 'X', persona: 'british-butler', honorific: 'none', output: 'audio' }), /Non-rhotic/)
})

test('ElevenLabs settings: defaults, validation, preset', () => {
  assert.equal(DEFAULT_SETTINGS.speechEngine, 'elevenlabs')
  assert.equal(DEFAULT_SETTINGS.elevenVoiceId, ELEVEN_VOICES[0].id)
  assert.equal(ELEVEN_VOICES[0].name, 'Eldrin')
  assert.deepEqual(validateSettingsPatch({ ...ELEVEN_PRESET }), { ...ELEVEN_PRESET })
  assert.deepEqual(validateSettingsPatch({ elevenVoiceId: 'JBFqnCBsd6RMkjVDRZzb', bargeIn: true }), { elevenVoiceId: 'JBFqnCBsd6RMkjVDRZzb', bargeIn: true })
  assert.throws(() => validateSettingsPatch({ elevenVoiceId: '../../x' }), /voice ID/)
  assert.throws(() => validateSettingsPatch({ elevenModel: 'eleven_turbo_v2_5' }), /invalid ElevenLabs model/)
  assert.throws(() => validateSettingsPatch({ speechEngine: 'polly' }), /invalid speech engine/)
  assert.equal(normalizeSettings({ elevenVoiceId: 'bad id!' }).elevenVoiceId, ELEVEN_VOICES[0].id)
  for (const v of ELEVEN_VOICES) assert.ok(/^[A-Za-z0-9]{16,32}$/.test(v.id), v.name)
})

test('ElevenLabs key + TTS text validation', () => {
  const key = 'sk_' + 'a1'.repeat(24)
  assert.equal(validateElevenLabsKey(` ${key} `), key)
  assert.equal(validateProviderKey('elevenlabs', key), key)
  assert.throws(() => validateElevenLabsKey('short'), IpcValidationError)
  assert.throws(() => validateElevenLabsKey('sk_has a space ' + 'x'.repeat(30)), IpcValidationError)
  assert.throws(() => validateProviderKey('openai', key), IpcValidationError)
  assert.equal(validateTtsText('  Hello.  '), 'Hello.')
  assert.throws(() => validateTtsText(''), /Nothing to say/)
  assert.throws(() => validateTtsText('x'.repeat(1001)), /exceeds/)
})
