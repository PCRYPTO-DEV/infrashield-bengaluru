import type { SimChunkPayload } from '../engine/simulation/roadGraph'
import type { SimSnapshot } from '../engine/simulation/snapshot'
import type { SimCommand, SimReply } from './simulation.worker'

/**
 * Main-thread handle on the simulation worker. Ticks are request/response
 * with back-pressure: a new tick is only sent after the previous snapshot
 * arrived, and at most every `minIntervalMs`.
 */
export class SimulationClient {
  private worker: Worker
  private awaiting = false
  private lastSent = 0
  private listeners = new Set<(s: SimSnapshot, stats: SimReply['stats']) => void>()
  stats: SimReply['stats'] = { agents: 0, edges: 0, stepMs: 0, lagS: 0 }

  constructor(private minIntervalMs = 80) {
    this.worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (e: MessageEvent<SimReply>) => {
      if (e.data.type !== 'snapshot') return
      this.awaiting = false
      this.stats = e.data.stats
      for (const l of this.listeners) l(e.data.snapshot, e.data.stats)
    }
  }

  private send(cmd: SimCommand): void { this.worker.postMessage(cmd) }
  init(globalSeed: string, unitPerMetre: number, time: number): void { this.send({ type: 'init', globalSeed, unitPerMetre, time }) }
  addChunk(payload: SimChunkPayload): void { this.send({ type: 'addChunk', payload }) }
  removeChunk(key: string): void { this.send({ type: 'removeChunk', key }) }
  reset(time: number): void { this.awaiting = false; this.send({ type: 'reset', time }) }

  /** Request the engine to advance to `time`; returns false if throttled. */
  tick(time: number, now: number): boolean {
    // While catching up on a time jump, tick as fast as replies arrive.
    const interval = this.stats.lagS > 5 ? 0 : this.minIntervalMs
    if (this.awaiting || now - this.lastSent < interval) return false
    this.awaiting = true
    this.lastSent = now
    this.send({ type: 'tick', time })
    return true
  }

  onSnapshot(fn: (s: SimSnapshot, stats: SimReply['stats']) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  dispose(): void { this.worker.terminate() }
}
