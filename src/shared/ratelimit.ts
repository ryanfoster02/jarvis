// Sliding-window rate limiter for paid or sensitive IPC calls (SECURITY.md review 2026-11-09).
// Caps what a misbehaving or compromised renderer could spend. Pure; time is injectable for tests.

export class RateLimiter {
  private events: Array<{ at: number; cost: number }> = []
  private readonly limit: number
  private readonly windowMs: number
  private readonly now: () => number

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.limit = limit
    this.windowMs = windowMs
    this.now = now
  }

  /** Records `cost` and returns true if it fits in the window; otherwise records nothing and returns false. */
  take(cost = 1): boolean {
    const t = this.now()
    this.events = this.events.filter((e) => t - e.at < this.windowMs)
    const used = this.events.reduce((n, e) => n + e.cost, 0)
    if (used + cost > this.limit) return false
    this.events.push({ at: t, cost })
    return true
  }
}

/** Limits per minute. Generous for one person talking; far below what runaway code would use. */
export const LIMITS = {
  chatPerMinute: 30,
  ttsCharsPerMinute: 15_000,
  voiceConnectsPerMinute: 10,
  keyChecksPerMinute: 10,
} as const
