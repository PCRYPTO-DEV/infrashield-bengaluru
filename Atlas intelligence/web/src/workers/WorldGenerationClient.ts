import type { ChunkSource } from '../engine/chunks/CityChunkManager'
import type { ChunkData, ChunkRequest } from '../engine/world/chunkTypes'
import { handleGenerationAsync, type ChunkMessage, type ErrorMessage, type GenerateMessage, type GenerationTier, type InkMessage, type InkReply } from './handlers'
import { createPort, type Port } from './port'

interface Job { resolve: (c: ChunkData) => void; reject: (e: Error) => void }
interface InkJob { resolve: (svg: string) => void; reject: (e: Error) => void }
const TIER_INDEX: Record<GenerationTier, number> = { street: 0, district: 1, osm: 2, 'osm-district': 3 }

/** Pool of generation workers behind the ChunkSource interface. */
export class WorldGenerationClient implements ChunkSource {
  private workers: Port[] = []
  private jobs = new Map<number, Job>()
  private inkJobs = new Map<number, InkJob>()
  private next = 0
  private rr = 0

  constructor(size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1)), private tier: GenerationTier = 'street', shared?: Port[], private baseUrl = '', private fallbackToProcedural = false) {
    if (shared) { this.workers = shared; this.attach(); return }
    for (let i = 0; i < size; i++) {
      this.workers.push(createPort(() => new Worker(new URL('./worldGeneration.worker.ts', import.meta.url), { type: 'module' }), (m) => handleGenerationAsync(m as GenerateMessage)))
    }
    this.attach()
  }

  /** Jobs from several clients can share one worker pool; ids are namespaced by tier. */
  private attach(): void {
    for (const w of this.workers) w.onMessage((raw) => {
      const data = raw as ChunkMessage | ErrorMessage | InkReply
      const ink = this.inkJobs.get(data.id)
      if (ink) { this.inkJobs.delete(data.id); if (data.type === 'inkDone') ink.resolve(data.svg); else if (data.type === 'error') ink.reject(new Error(data.message)); return }
      const job = this.jobs.get(data.id)
      if (!job) return
      this.jobs.delete(data.id)
      if (data.type === 'chunk') job.resolve(data.chunk)
      else if (data.type === 'error') job.reject(new Error(data.message))
    })
  }

  /** A second client sharing this pool (e.g. the district tier). */
  fork(tier: GenerationTier, baseUrl = '', fallbackToProcedural = false): WorldGenerationClient { return new WorldGenerationClient(0, tier, this.workers, baseUrl, fallbackToProcedural) }

  /** Count of real-data tiles that could not be fetched (left empty, or filled procedurally only when a demo asks for it). */
  fallbacks = 0
  /** The last reason a real-data tile could not be fetched, for the screen. */
  lastError: string | null = null

  generate(req: ChunkRequest, signal: AbortSignal): Promise<ChunkData> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('aborted', 'AbortError')); return }
      const id = (++this.next) * 4 + TIER_INDEX[this.tier]
      const fallbackTier: GenerationTier | null = this.tier === 'osm' ? 'street' : this.tier === 'osm-district' ? 'district' : null
      const job: Job = {
        resolve,
        reject: (e) => {
          if (!fallbackTier || signal.aborted) { reject(e); return }
          this.fallbacks++
          this.lastError = e.message
          console.warn(e.message)
          // Real data unavailable for this tile. The real product leaves it empty: nothing is ever made up in its place.
          if (!this.fallbackToProcedural) { reject(e); return }
          const id2 = (++this.next) * 4 + TIER_INDEX[fallbackTier]
          this.jobs.set(id2, { resolve, reject })
          this.workers[this.rr++ % this.workers.length].postMessage({ type: 'generate', id: id2, req, tier: fallbackTier })
        },
      }
      this.jobs.set(id, job)
      signal.addEventListener('abort', () => { if (this.jobs.delete(id)) reject(new DOMException('aborted', 'AbortError')) }, { once: true })
      const w = this.workers[this.rr++ % this.workers.length]
      w.postMessage({ type: 'generate', id, req, tier: this.tier, baseUrl: this.baseUrl })
    })
  }

  /** The Ink 3D string for a chunk, built off the main thread on demand. */
  ink(chunk: ChunkData, unitPerMetre: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = (++this.next) * 4 + TIER_INDEX[this.tier]
      this.inkJobs.set(id, { resolve, reject })
      const m: InkMessage = { type: 'ink', id, key: chunk.key, render: chunk.render, unitPerMetre }
      this.workers[this.rr++ % this.workers.length].postMessage(m)
    })
  }

  /** 'worker' when generation runs off the main thread, 'inline' on fallback. */
  get mode(): 'worker' | 'inline' { return this.workers.some((w) => w.mode === 'worker') ? 'worker' : 'inline' }

  dispose(): void { if (this.tier === 'street') for (const w of this.workers) w.terminate(); this.jobs.clear() }
}
