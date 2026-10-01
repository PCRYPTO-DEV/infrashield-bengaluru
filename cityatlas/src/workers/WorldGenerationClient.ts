import type { ChunkSource } from '../engine/chunks/CityChunkManager'
import type { ChunkData, ChunkRequest } from '../engine/world/chunkTypes'
import type { ChunkMessage, ErrorMessage } from './worldGeneration.worker'

interface Job { resolve: (c: ChunkData) => void; reject: (e: Error) => void }

/** Pool of generation workers behind the ChunkSource interface. */
export class WorldGenerationClient implements ChunkSource {
  private workers: Worker[] = []
  private jobs = new Map<number, Job>()
  private next = 0
  private rr = 0

  constructor(size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1)), private tier: 'street' | 'district' = 'street', shared?: Worker[]) {
    if (shared) { this.workers = shared; this.attach(); return }
    for (let i = 0; i < size; i++) {
      this.workers.push(new Worker(new URL('./worldGeneration.worker.ts', import.meta.url), { type: 'module' }))
    }
    this.attach()
  }

  /** Jobs from several clients can share one worker pool; ids are namespaced by tier. */
  private attach(): void {
    for (const w of this.workers) w.addEventListener('message', (e: MessageEvent<ChunkMessage | ErrorMessage>) => {
      const job = this.jobs.get(e.data.id)
      if (!job) return
      this.jobs.delete(e.data.id)
      if (e.data.type === 'chunk') job.resolve(e.data.chunk)
      else job.reject(new Error(e.data.message))
    })
  }

  /** A second client sharing this pool (e.g. the district tier). */
  fork(tier: 'street' | 'district'): WorldGenerationClient { return new WorldGenerationClient(0, tier, this.workers) }

  generate(req: ChunkRequest, signal: AbortSignal): Promise<ChunkData> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new DOMException('aborted', 'AbortError')); return }
      const id = (++this.next) * 2 + (this.tier === 'district' ? 1 : 0)
      this.jobs.set(id, { resolve, reject })
      signal.addEventListener('abort', () => { if (this.jobs.delete(id)) reject(new DOMException('aborted', 'AbortError')) }, { once: true })
      const w = this.workers[this.rr++ % this.workers.length]
      w.postMessage({ type: 'generate', id, req, tier: this.tier })
    })
  }

  dispose(): void { if (this.tier === 'street') for (const w of this.workers) w.terminate(); this.jobs.clear() }
}
