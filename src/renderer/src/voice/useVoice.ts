import { useCallback, useEffect, useRef, useState } from 'react'
import type { RealtimeModelId } from '../../../shared/ipc.ts'
import { EV, isOneOf, type RealtimeUsage } from '../../../shared/realtime.ts'

export type VoicePhase = 'off' | 'connecting' | 'live' | 'error'
export type VoiceActivity = 'idle' | 'listening' | 'thinking' | 'speaking'

export interface VoiceHandlers {
  onUserText: (text: string) => void
  onAssistantDelta: (key: string, delta: string) => void
  onAssistantDone: (key: string, text: string) => void
  onUsage: (model: RealtimeModelId, usage: RealtimeUsage | undefined) => void
  onLatency: (ms: number) => void
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
 * Audio flows directly between the peer connection and OpenAI; events use the "oai-events" channel.
 */
export function useVoice(handlers: VoiceHandlers) {
  const [phase, setPhase] = useState<VoicePhase>('off')
  const [activity, setActivity] = useState<VoiceActivity>('idle')
  const [muted, setMutedState] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcription, setTranscription] = useState(true)

  const h = useRef(handlers)
  h.current = handlers
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const modelRef = useRef<RealtimeModelId>('gpt-realtime-2.1-mini')
  const turnStart = useRef<number | null>(null)
  const generation = useRef(0) // invalidates late callbacks from a previous session

  const teardown = useCallback(() => {
    generation.current++
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
    setActivity('idle')
    setMutedState(false)
  }, [])

  const fail = useCallback(
    (message: string) => {
      teardown()
      setError(message)
      setPhase('error')
    },
    [teardown],
  )

  const markLatency = (): void => {
    if (turnStart.current !== null) {
      h.current.onLatency(Math.round(performance.now() - turnStart.current))
      turnStart.current = null
    }
  }

  const onEvent = useCallback(
    (ev: ServerEvent) => {
      const key = ev.item_id ?? ev.response_id ?? 'response'
      if (ev.type === EV.speechStarted) {
        setActivity('listening')
      } else if (ev.type === EV.speechStopped) {
        turnStart.current = performance.now()
        setActivity('thinking')
      } else if (ev.type === EV.userTranscript) {
        if (ev.transcript?.trim()) h.current.onUserText(ev.transcript.trim())
      } else if (isOneOf(ev.type, EV.assistantTranscriptDelta) || isOneOf(ev.type, EV.assistantTextDelta)) {
        markLatency()
        if (ev.delta) h.current.onAssistantDelta(key, ev.delta)
      } else if (isOneOf(ev.type, EV.assistantTranscriptDone)) {
        h.current.onAssistantDone(key, ev.transcript ?? '')
      } else if (isOneOf(ev.type, EV.assistantTextDone)) {
        h.current.onAssistantDone(key, ev.text ?? '')
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
        setActivity((a) => (a === 'thinking' ? 'idle' : a))
      } else if (ev.type === EV.error) {
        setError(ev.error?.message ?? 'OpenAI reported an error.')
      }
    },
    [],
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
      return fail(name === 'NotAllowedError' ? MIC_DENIED : name === 'NotFoundError' ? 'No microphone was found.' : `Couldn't open the microphone: ${String(err)}`)
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
    pc.onconnectionstatechange = () => {
      if (gen !== generation.current) return
      if (pc.connectionState === 'failed') fail('The voice connection dropped. Start voice again.')
      if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        // 'disconnected' can recover; only treat it as fatal if it persists.
        if (pc.connectionState === 'closed') fail('The voice connection closed.')
      }
    }

    try {
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const res = await window.jarvis.voice.connect(offer.sdp ?? '')
      if (gen !== generation.current) return
      if (!res.ok) return fail(res.message)
      modelRef.current = res.model
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
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !m))
    setMutedState(m)
  }, [])

  const send = (event: Record<string, unknown>): boolean => {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') return false
    dc.send(JSON.stringify(event))
    return true
  }

  /** Cut Jarvis off mid-sentence. */
  const interrupt = useCallback(() => {
    send({ type: 'response.cancel' })
    send({ type: 'output_audio_buffer.clear' })
    setActivity('idle')
  }, [])

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

  useEffect(() => teardown, [teardown])

  return { phase, activity, muted, error, transcription, start, stop, setMuted, interrupt, sendText, clearError: () => setError(null) }
}
