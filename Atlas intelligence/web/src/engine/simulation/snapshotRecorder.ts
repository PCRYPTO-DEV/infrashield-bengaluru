import type { SimSnapshot } from './snapshot'

/**
 * Ring buffer of recorded snapshots for honest history: scrubbing into the
 * past replays what was actually shown, never a re-simulation. Edge ids are
 * dropped (they are not needed to replay positions), keeping memory small.
 */
export class SnapshotRecorder {
  private frames: SimSnapshot[] = []
  constructor(private intervalMs = 2000, private maxFrames = 300) {}

  record(s: SimSnapshot): void {
    const last = this.frames[this.frames.length - 1]
    if (last && s.time - last.time < this.intervalMs) return
    if (last && s.time < last.time) this.frames = this.frames.filter((f) => f.time < s.time)
    this.frames.push({ ...s, edgeIds: [], edgeStats: [] })
    if (this.frames.length > this.maxFrames) this.frames.shift()
  }

  /** Earliest recorded time, or Infinity when empty. */
  get from(): number { return this.frames.length ? this.frames[0].time : Infinity }
  get to(): number { return this.frames.length ? this.frames[this.frames.length - 1].time : -Infinity }
  get size(): number { return this.frames.length }

  /** Latest recorded frame at or before `time`. */
  at(time: number): SimSnapshot | undefined {
    let lo = 0, hi = this.frames.length - 1, best: SimSnapshot | undefined
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (this.frames[mid].time <= time) { best = this.frames[mid]; lo = mid + 1 } else hi = mid - 1 }
    return best
  }

  clear(): void { this.frames = [] }
}
