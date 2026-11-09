import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeModelId, SpeechEngineId } from '../../../shared/ipc.ts'
import { EV, isOneOf, type RealtimeUsage } from '../../../shared/realtime.ts'
import { cleanForSpeech, takeSpeakable } from '../../../shared/speech.ts'
import { SpeechQueue } from './speechQueue.ts'

export type VoicePhase = 'off' | 'connecting' | 'live' | 'error'
export type VoiceActivity = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface VoiceHandlers {
  onUserText: (text: string) => void
  onAssistantDelta: (key: string, delta: string) => void
  onAssistantDone: (key: string, text: string) => void
  onUsage: (model: RealtimeModelId, usage: RealtimeUsage | undefined) => void
  onLatency: (ms: number) => void
  onTtsCharacters: (n: number) => void
}

interface ServerEvent {
  type: string
  transcript?: string
  delta?: string
  text?: string
  item_id?: string
  response_id?: string
  error?: { message?: string }
  response?: { id?: string; status?: string; usage?: RealtimeUsage; status_details?: { error?: { message?: string } } }
}

const MIC_DENIED =
  'Microphone access is off for Jarvis. Turn it on in System Settings → Privacy & Security → Microphone (in development the app is listed as "Electron"), then try again.'

/**
 * Realtime voice over WebRTC. The SDP offer goes to the main process, which relays it to OpenAI
 * with the stored key and returns the answer — this renderer never holds a credential.
 *
 * Two speech engines:
 *  - openai:     OpenAI speaks; audio arrives as a WebRTC track.
 *  - elevenlabs: OpenAI replies in text; sentences are sent (via main) to ElevenLabs and played in order.
 *                Unless barge-in is on, the mic pauses while Jarvis speaks so it doesn't hear itself.
 */
export function useVoice(handlers: VoiceHandlers) {
  const [phase, setPhase] = useState<VoicePhase>('off')
  const [activity, setActivity] = useState<VoiceActivity>('idle')
  const [muted, setMutedState] = useState(false)
  const [micPaused, setMicPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcription, setTranscription] = useState(true)
  const [engine, setEngine] = useState<SpeechEngineId | null>(null)

  const h = useRef(handlers)
  h.current = handlers
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const modelRef = useRef<RealtimeModelId>('gpt-realtime-2.1-mini')
  const engineRef = useRef<SpeechEngineId>('openai')
  const bargeInRef = useRef(false)
  const userMuted = useRef(false)
  const autoPaused = useRef(false)
  const textBuffers = useRef(new Map<string, string>())
  const turnStart = useRef<number | null>(null)
  const generation = useRef(0) // invalidates late callbacks from a previous session

  const applyMic = (): void => {
    const enabled = !userMuted.current && !autoPaused.current
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = enabled))
  }

  const markLatency = (): void => {
    if (turnStart.current !== null) {
      h.current.onLatency(Math.round(performance.now() - turnStart.current))
      turnStart.current = null
    }
  }

  const speechRef = useRef<SpeechQueue | null>(null)
  if (!speechRef.current) {
    speechRef.current = new SpeechQueue({
      onStart: () => {
        markLatency()
        setActivity('speaking')
        if (!bargeInRef.current) {
          autoPaused.current = true
          setMicPaused(true)
          applyMic()
        }
      },
      onIdle: () => {
        setActivity((a) => (a === 'speaking' ? 'idle' : a))
        if (autoPaused.current) {
          autoPaused.current = false
          setMicPaused(false)
          applyMic()
        }
      },
      onError: (m) => setError(m),
      onCharacters: (n) => h.current.onTtsCharacters(n),
    })
  }
  const speech = speechRef.current

  const teardown = useCallback(() => {
    generation.current++
    speech.stop()
    dcRef.current?.close()
    pcRef.current?.getSenders().forEach((s) => s.track?.stop())
    pcRef.current?.close()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.srcObject = null
    }
    dcRef.current = null
    pcRef.current = null
    streamRef.current = null
    audioRef.current = null
    turnStart.current = null
    textBuffers.current.clear()
    userMuted.current = false
    autoPaused.current = false
    setActivity('idle')
    setMutedState(false)
    setMicPaused(false)
    setEngine(null)
  }, [speech])

  const fail = useCallback(
    (message: string) => {
      teardown()
      setError(message)
      setPhase('error')
    },
    [teardown],
  )

  /** Feed streamed reply text to ElevenLabs sentence by sentence. */
  const speakText = (key: string, delta: string, final: boolean): void => {
    if (engineRef.current !== 'elevenlabs') return
    const buf = (textBuffers.current.get(key) ?? '') + delta
    const { chunks, rest } = takeSpeakable(buf, final)
    for (const c of chunks) {
      const clean = cleanForSpeech(c)
      if (clean) speech.enqueue(clean)
    }
    if (final) textBuffers.current.delete(key)
    else textBuffers.current.set(key, rest)
  }

  const onEvent = useCallback(
    (ev: ServerEvent) => {
      const key = ev.item_id ?? ev.response_id ?? 'response'
      if (ev.type === EV.speechStarted) {
        // You started talking: if Jarvis is speaking through ElevenLabs, cut it off (barge-in).
        if (engineRef.current === 'elevenlabs' && speech.active) {
          speech.stop()
          textBuffers.current.clear()
        }
        setActivity('listening')
      } else if (ev.type === EV.speechStopped) {
        turnStart.current = performance.now()
        setActivity('thinking')
      } else if (ev.type === EV.userTranscript) {
        if (ev.transcript?.trim()) h.current.onUserText(ev.transcript.trim())
      } else if (isOneOf(ev.type, EV.assistantTranscriptDelta)) {
        markLatency()
        if (ev.delta) h.current.onAssistantDelta(key, ev.delta)
      } else if (isOneOf(ev.type, EV.assistantTextDelta)) {
        if (engineRef.current === 'openai') markLatency() // with ElevenLabs, latency = first audio
        if (ev.delta) {
          h.current.onAssistantDelta(key, ev.delta)
          speakText(key, ev.delta, false)
        }
      } else if (isOneOf(ev.type, EV.assistantTranscriptDone)) {
        h.current.onAssistantDone(key, ev.transcript ?? '')
      } else if (isOneOf(ev.type, EV.assistantTextDone)) {
        h.current.onAssistantDone(key, ev.text ?? '')
        speakText(key, '', true)
      } else if (ev.type === EV.audioStarted) {
        markLatency()
        setActivity('speaking')
      } else if (isOneOf(ev.type, EV.audioStopped)) {
        setActivity('idle')
      } else if (ev.type === EV.responseDone) {
        h.current.onUsage(modelRef.current, ev.response?.usage)
        if (ev.response?.status === 'failed') {
          setError(ev.response.status_details?.error?.message ?? 'The response failed.')
        }
        setActivity((a) => (a === 'thinking' && !speech.active ? 'idle' : a))
      } else if (ev.type === EV.error) {
        setError(ev.error?.message ?? 'OpenAI reported an error.')
      }
    },
    // speakText/markLatency only touch refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [speech],
  )

  const start = useCallback(async () => {
    if (pcRef.current) return
    setError(null)
    setPhase('connecting')
    const gen = ++generation.current

    const access = await window.jarvis.voice.micAccess()
    if (gen !== generation.current) return
    if (access === 'denied' || access === 'restricted') return fail(MIC_DENIED)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      return fail(
        name === 'NotAllowedError'
          ? MIC_DENIED
          : name === 'NotFoundError'
            ? 'No microphone was found.'
            : `Couldn't open the microphone: ${String(err)}`,
      )
    }
    if (gen !== generation.current) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    streamRef.current = stream

    const pc = new RTCPeerConnection()
    pcRef.current = pc
    const audio = new Audio()
    audio.autoplay = true
    audioRef.current = audio
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? null
    }
    const track = stream.getAudioTracks()[0]
    if (!track) return fail('No microphone track is available.')
    pc.addTrack(track, stream)

    const dc = pc.createDataChannel('oai-events')
    dcRef.current = dc
    dc.onmessage = (m: MessageEvent<string>) => {
      try {
        onEvent(JSON.parse(m.data) as ServerEvent)
      } catch {
        /* ignore malformed */
      }
    }
    dc.onopen = () => {
      if (gen === generation.current) setPhase('live')
    }
    // 'disconnected' often recovers on its own (Wi-Fi blips); give it a few seconds before giving up.
    let dropTimer: ReturnType<typeof setTimeout> | null = null
    pc.onconnectionstatechange = () => {
      if (gen !== generation.current) return
      if (pc.connectionState === 'connected' && dropTimer) {
        clearTimeout(dropTimer)
        dropTimer = null
      } else if (pc.connectionState === 'disconnected' && !dropTimer) {
        dropTimer = setTimeout(() => {
          if (gen === generation.current && pc.connectionState !== 'connected') {
            fail('The voice connection was lost. Check your internet connection and start voice again.')
          }
        }, 8000)
      } else if (pc.connectionState === 'failed') {
        fail('The voice connection dropped. Start voice again.')
      }
    }
    dc.onclose = () => {
      if (gen === generation.current && pcRef.current === pc) fail('The voice session ended. Start voice again.')
    }

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const res = await window.jarvis.voice.connect(offer.sdp ?? '')
      if (gen !== generation.current) return
      if (!res.ok) return fail(res.message)
      modelRef.current = res.model
      engineRef.current = res.speechEngine
      bargeInRef.current = res.bargeIn
      setEngine(res.speechEngine)
      setTranscription(res.transcription)
      await pc.setRemoteDescription({ type: 'answer', sdp: res.answerSdp })
    } catch (err) {
      if (gen === generation.current) fail(`Couldn't start voice: ${String(err)}`)
    }
  }, [fail, onEvent])

  const stop = useCallback(() => {
    teardown()
    setError(null)
    setPhase('off')
  }, [teardown])

  const setMuted = useCallback((m: boolean) => {
    userMuted.current = m
    setMutedState(m)
    applyMic()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const send = (event: Record<string, unknown>): boolean => {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') return false
    dc.send(JSON.stringify(event))
    return true
  }

  /** Cut Jarvis off mid-sentence. */
  const interrupt = useCallback(() => {
    speech.stop()
    textBuffers.current.clear()
    send({ type: 'response.cancel' })
    if (engineRef.current === 'openai') send({ type: 'output_audio_buffer.clear' })
    setActivity('idle')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech])

  /** Typed message into the live voice session; Jarvis answers by voice. */
  const sendText = useCallback((text: string): boolean => {
    const ok = send({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    })
    if (ok) {
      send({ type: 'response.create' })
      turnStart.current = performance.now()
      setActivity('thinking')
    }
    return ok
  }, [])

  useEffect(
    () => () => {
      teardown()
      void speech.close()
    },
    [teardown, speech],
  )

  return {
    phase,
    activity,
    muted,
    micPaused,
    error,
    transcription,
    engine,
    start,
    stop,
    setMuted,
    interrupt,
    sendText,
  }
}
