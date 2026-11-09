import type { TtsResult } from '../../../shared/ipc.ts'

export interface SpeechCallbacks {
  /** First audio of a run starts playing. */
  onStart: () => void
  /** Queue drained (or stopped). */
  onIdle: () => void
  onError: (message: string) => void
  onCharacters: (n: number) => void
}

interface Item {
  result: Promise<TtsResult>
}

/**
 * Plays ElevenLabs speech chunks in order. Each chunk's audio is requested as soon as it is queued
 * (so the next sentence is ready while the current one plays), but playback is strictly sequential.
 * stop() silences immediately and discards anything still in flight.
 */
export class SpeechQueue {
  private ctx: AudioContext | null = null
  private queue: Item[] = []
  private current: AudioBufferSourceNode | null = null
  private playing = false
  private generation = 0
  private readonly cb: SpeechCallbacks
  private readonly speak: (text: string) => Promise<TtsResult>

  constructor(cb: SpeechCallbacks, speak: (text: string) => Promise<TtsResult> = (t) => window.jarvis.tts.speak(t)) {
    this.cb = cb
    this.speak = speak
  }

  get active(): boolean {
    return this.playing || this.queue.length > 0
  }

  enqueue(text: string): void {
    if (!text.trim()) return
    this.queue.push({ result: this.speak(text) })
    if (!this.playing) void this.run(this.generation)
  }

  stop(): void {
    this.generation++
    this.queue = []
    try {
      this.current?.stop()
    } catch {
      /* already stopped */
    }
    this.current = null
    if (this.playing) {
      this.playing = false
      this.cb.onIdle()
    }
  }

  async close(): Promise<void> {
    this.stop()
    await this.ctx?.close().catch(() => undefined)
    this.ctx = null
  }

  private audio(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new AudioContext()
    return this.ctx
  }

  private async run(gen: number): Promise<void> {
    this.playing = true
    let started = false
    while (this.queue.length > 0 && gen === this.generation) {
      const item = this.queue.shift()
      if (!item) break
      const res = await item.result
      if (gen !== this.generation) return
      if (!res.ok) {
        if (res.code !== 'halted') this.cb.onError(res.message)
        continue
      }
      this.cb.onCharacters(res.characters)
      try {
        const ctx = this.audio()
        if (ctx.state === 'suspended') await ctx.resume()
        const bytes = res.audio
        const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
        if (gen !== this.generation) return
        const src = ctx.createBufferSource()
        src.buffer = buf
        src.connect(ctx.destination)
        this.current = src
        const ended = new Promise<void>((resolve) => (src.onended = () => resolve()))
        src.start()
        if (!started) {
          started = true
          this.cb.onStart()
        }
        await ended
        this.current = null
      } catch (err) {
        if (gen === this.generation) this.cb.onError(`Couldn't play Jarvis's voice: ${String(err)}`)
      }
    }
    if (gen === this.generation) {
      this.playing = false
      this.cb.onIdle()
    }
  }
}
