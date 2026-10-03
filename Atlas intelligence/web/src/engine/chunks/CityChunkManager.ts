import type { ChunkData, ChunkRequest } from '../world/chunkTypes'
import type { WorldBounds, WorldPoint } from '../../geo/projection/mercator'
import type { WorldFrame } from '../../geo/projection/frame'
import { CHUNK_ZOOM, tileKey, parseTileKey, tilesInBounds, tileCenter, tileSizeWorld } from '../../geo/tiles/tiles'

/**
 * Something that can produce a chunk for a request. In the app this is a
 * worker pool; in tests it is a plain function. Must honour the AbortSignal.
 */
export interface ChunkSource {
  generate(req: ChunkRequest, signal: AbortSignal): Promise<ChunkData>
}

export interface ChunkManagerOptions {
  frame: WorldFrame
  globalSeed: string
  datasetVersion: string
  /** Tiles of padding around the viewport to prefetch. */
  prefetchPad?: number
  /** Chunks beyond this many tiles from the viewport are unloaded. */
  unloadPad?: number
  /** Hard cap on resident chunks (LRU beyond this). */
  maxChunks?: number
  /** Max simultaneous generation requests. */
  concurrency?: number
  /** Tile zoom this manager works at (default CHUNK_ZOOM). */
  chunkZoom?: number
  /**
   * Hard budget of tiles to keep resident for a viewport. When the viewport
   * needs more (zoomed out), only the nearest `budget` tiles are loaded; a
   * coarser tier is expected to cover the rest.
   */
  budget?: number
}

export interface ChunkManagerEvents {
  loaded: (chunk: ChunkData) => void
  unloaded: (key: string) => void
  error: (key: string, err: unknown) => void
}

interface Pending { key: string; controller: AbortController; priority: number }

/**
 * CityChunkManager — the heart of the infinite city.
 *
 * Responsibilities (see docs/CITYATLAS_ARCHITECTURE.md):
 *  - determine visible chunks for a viewport
 *  - load missing chunks asynchronously with priority (centre first)
 *  - never issue duplicate requests for a key
 *  - cancel requests that are no longer needed
 *  - cache resident chunks and unload distant ones (LRU)
 *  - stay deterministic: chunk content never depends on load order
 */
export class CityChunkManager {
  private chunks = new Map<string, ChunkData>()
  private lastUsed = new Map<string, number>()
  private pending = new Map<string, Pending>()
  private queue: Pending[] = []
  private active = 0
  private tick = 0
  private hourBucket = 0
  private listeners: { [K in keyof ChunkManagerEvents]: Set<ChunkManagerEvents[K]> } = { loaded: new Set(), unloaded: new Set(), error: new Set() }
  private readonly prefetchPad: number
  private readonly unloadPad: number
  private readonly maxChunks: number
  private readonly concurrency: number
  private readonly chunkZoom: number
  private readonly budget: number
  private stale = new Set<string>()

  constructor(private source: ChunkSource, private opts: ChunkManagerOptions) {
    this.prefetchPad = opts.prefetchPad ?? 1
    this.unloadPad = opts.unloadPad ?? 3
    this.maxChunks = opts.maxChunks ?? 64
    this.concurrency = opts.concurrency ?? 3
    this.chunkZoom = opts.chunkZoom ?? CHUNK_ZOOM
    this.budget = opts.budget ?? Infinity
  }

  on<K extends keyof ChunkManagerEvents>(event: K, fn: ChunkManagerEvents[K]): () => void {
    this.listeners[event].add(fn)
    return () => this.listeners[event].delete(fn)
  }

  get globalSeed(): string { return this.opts.globalSeed }
  get frame(): WorldFrame { return this.opts.frame }
  get loaded(): ReadonlyMap<string, ChunkData> { return this.chunks }
  get inFlight(): number { return this.pending.size }
  get(key: string): ChunkData | undefined { return this.chunks.get(key) }

  /** Required tile keys for a local-coordinate viewport. */
  requiredKeys(view: WorldBounds, pad = this.prefetchPad): string[] {
    return this.tilesFor(view, pad).map(tileKey)
  }

  private tilesFor(view: WorldBounds, pad: number, centre?: WorldPoint) {
    const f = this.opts.frame
    let v = view
    if (centre && Number.isFinite(this.budget)) {
      // Only tiles within the budget disc can ever be chosen, so never enumerate more than that.
      const span = (Math.ceil(Math.sqrt(this.budget)) + 2 * pad + 1) * tileSizeWorld(this.chunkZoom)
      if (view.maxX - view.minX > span || view.maxY - view.minY > span) {
        v = { minX: Math.max(view.minX, centre.x - span / 2), minY: Math.max(view.minY, centre.y - span / 2), maxX: Math.min(view.maxX, centre.x + span / 2), maxY: Math.min(view.maxY, centre.y + span / 2) }
      }
    }
    return tilesInBounds({ minX: v.minX + f.originX, minY: v.minY + f.originY, maxX: v.maxX + f.originX, maxY: v.maxY + f.originY }, this.chunkZoom, pad)
  }

  /** Change the simulation hour; chunks with time-dependent content are regenerated lazily. */
  setHourBucket(bucket: number): void {
    if (bucket === this.hourBucket) return
    this.hourBucket = bucket
    for (const key of this.chunks.keys()) this.stale.add(key)
    for (const p of [...this.pending.values()]) this.cancel(p.key)
  }

  /**
   * Reconcile resident chunks with the viewport. Call on every camera
   * change (cheap: O(visible tiles)).
   */
  update(view: WorldBounds, centre: WorldPoint): void {
    this.tick++
    const f = this.opts.frame
    let needed = this.tilesFor(view, this.prefetchPad, centre).map((t) => { const c = tileCenter(t); return { t, priority: Math.hypot(c.x - f.originX - centre.x, c.y - f.originY - centre.y) } })
    if (needed.length > this.budget) needed = needed.sort((a, b) => a.priority - b.priority).slice(0, this.budget)
    const neededKeys = new Set<string>()
    for (const { t, priority } of needed) {
      const key = tileKey(t)
      neededKeys.add(key)
      this.lastUsed.set(key, this.tick)
      const have = this.chunks.has(key) && !this.stale.has(key)
      if (!have && !this.pending.has(key)) this.enqueue(key, priority)
      else if (this.pending.has(key)) this.pending.get(key)!.priority = priority
    }

    // Cancel pending requests that fell out of the prefetch area.
    for (const p of [...this.pending.values()]) if (!neededKeys.has(p.key)) this.cancel(p.key)

    // Unload chunks beyond the unload pad, then enforce LRU cap.
    const keep = new Set(this.tilesFor(view, this.unloadPad, centre).map(tileKey))
    for (const key of [...this.chunks.keys()]) if (!keep.has(key)) this.unload(key)
    if (Number.isFinite(this.budget)) {
      // Beyond the budget, keep only the nearest resident chunks.
      const resident = [...this.chunks.keys()].filter((k) => !neededKeys.has(k)).map((k) => { const c = tileCenter(parseTileKey(k)); return { k, d: Math.hypot(c.x - f.originX - centre.x, c.y - f.originY - centre.y) } }).sort((a, b) => b.d - a.d)
      while (this.chunks.size > this.budget * 1.5 && resident.length) this.unload(resident.shift()!.k)
    }
    if (this.chunks.size > this.maxChunks) {
      const byAge = [...this.chunks.keys()].filter((k) => !neededKeys.has(k)).sort((a, b) => (this.lastUsed.get(a) ?? 0) - (this.lastUsed.get(b) ?? 0))
      while (this.chunks.size > this.maxChunks && byAge.length) this.unload(byAge.shift()!)
    }
    this.pump()
  }

  private enqueue(key: string, priority: number): void {
    const p: Pending = { key, controller: new AbortController(), priority }
    this.pending.set(key, p)
    this.queue.push(p)
  }

  private cancel(key: string): void {
    const p = this.pending.get(key)
    if (!p) return
    p.controller.abort()
    this.pending.delete(key)
    this.queue = this.queue.filter((q) => q !== p)
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length) {
      this.queue.sort((a, b) => a.priority - b.priority)
      const p = this.queue.shift()!
      this.active++
      const req: ChunkRequest = { key: p.key, globalSeed: this.opts.globalSeed, datasetVersion: this.opts.datasetVersion, hourBucket: this.hourBucket, frame: this.opts.frame }
      this.source.generate(req, p.controller.signal).then(
        (chunk) => {
          this.active--
          if (p.controller.signal.aborted || this.pending.get(p.key) !== p) { this.pump(); return }
          this.pending.delete(p.key)
          this.stale.delete(p.key)
          const existed = this.chunks.has(p.key)
          if (existed) for (const fn of this.listeners.unloaded) fn(p.key)
          this.chunks.set(p.key, chunk)
          for (const fn of this.listeners.loaded) fn(chunk)
          this.pump()
        },
        (err) => {
          this.active--
          if (this.pending.get(p.key) === p) this.pending.delete(p.key)
          if (!p.controller.signal.aborted) for (const fn of this.listeners.error) fn(p.key, err)
          this.pump()
        },
      )
    }
  }

  private unload(key: string): void {
    if (!this.chunks.delete(key)) return
    this.lastUsed.delete(key)
    this.stale.delete(key)
    for (const fn of this.listeners.unloaded) fn(key)
  }

  dispose(): void {
    for (const p of [...this.pending.values()]) this.cancel(p.key)
    for (const key of [...this.chunks.keys()]) this.unload(key)
  }
}
