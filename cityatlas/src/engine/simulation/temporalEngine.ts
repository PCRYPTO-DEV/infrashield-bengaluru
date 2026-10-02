export type TemporalMode = 'live' | 'historical' | 'simulation'

export interface TemporalState {
  mode: TemporalMode
  /** epoch milliseconds in world time */
  timestamp: number
  /** multiplier of real time */
  speed: number
  paused: boolean
  /**
   * True when the clock is in the past but no recording exists for that
   * time, so what is shown is a re-simulation, not history.
   */
  resimulated: boolean
}

export type TemporalListener = (state: TemporalState, prev: TemporalState) => void

/**
 * Time is a first-class dimension. The TemporalEngine owns the world clock.
 *
 *  live        — the clock follows real time from `liveStart`
 *  historical  — the clock is behind the live clock (replay)
 *  simulation  — the clock is ahead of the live clock (fast-forward)
 *
 * The engine never fabricates data: it only reports *when* the world is.
 * What exists at that time is the world model's responsibility, and
 * anything beyond observations must be labelled accordingly.
 */
export class TemporalEngine {
  private state: TemporalState
  private listeners = new Set<TemporalListener>()
  private liveStartWorld: number
  private liveStartReal: number

  constructor(startTimestamp: number, nowReal: () => number = () => Date.now()) {
    this.nowReal = nowReal
    this.liveStartWorld = startTimestamp
    this.liveStartReal = nowReal()
    this.state = { mode: 'live', timestamp: startTimestamp, speed: 1, paused: false, resimulated: false }
    this.recordedFrom = startTimestamp
  }

  private nowReal: () => number
  private recordedFrom: number

  /** Earliest world time for which a recording exists (set by the recorder). */
  setRecordedFrom(ts: number): void { this.recordedFrom = ts }
  get recordedFromTimestamp(): number { return this.recordedFrom }

  get current(): TemporalState { return this.state }

  /** What time the live feed is at right now. */
  liveTimestamp(): number {
    return this.liveStartWorld + (this.nowReal() - this.liveStartReal)
  }

  subscribe(fn: TemporalListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(patch: Partial<TemporalState>): void {
    const prev = this.state
    this.state = { ...prev, ...patch }
    if (this.state.mode === 'live') { this.state.speed = 1; this.state.resimulated = false }
    for (const fn of this.listeners) fn(this.state, prev)
  }

  /** Advance the clock by a real elapsed interval. */
  tick(realDtMs: number): void {
    if (this.state.paused) return
    if (this.state.mode === 'live') {
      this.set({ timestamp: this.liveTimestamp() })
      return
    }
    const next = this.state.timestamp + realDtMs * this.state.speed
    const live = this.liveTimestamp()
    // Playback that catches up with live rejoins the live clock.
    if (next >= live && (this.state.mode === 'historical' || this.state.resimulated)) this.set({ mode: 'live', timestamp: live })
    else if (this.state.mode === 'historical' || this.state.resimulated) this.set({ timestamp: next, mode: next >= this.recordedFrom ? 'historical' : 'simulation', resimulated: next < this.recordedFrom })
    else this.set({ timestamp: next })
  }

  seek(timestamp: number): void {
    const live = this.liveTimestamp()
    const past = timestamp < live
    const recorded = past && timestamp >= this.recordedFrom
    const mode: TemporalMode = Math.abs(timestamp - live) < 500 ? 'live' : recorded ? 'historical' : 'simulation'
    this.set({ mode, timestamp: mode === 'live' ? live : timestamp, resimulated: past && !recorded })
  }

  goLive(): void { this.set({ mode: 'live', timestamp: this.liveTimestamp(), paused: false }) }
  pause(): void { this.set({ paused: true }) }
  play(): void { this.set({ paused: false }) }
  togglePause(): void { this.set({ paused: !this.state.paused }) }
  setSpeed(speed: number): void {
    if (this.state.mode === 'live') this.set({ mode: 'simulation', speed, timestamp: this.state.timestamp })
    else this.set({ speed })
  }
}
