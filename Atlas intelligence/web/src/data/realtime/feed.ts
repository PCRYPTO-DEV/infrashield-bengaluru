import type { UrbanEntity } from '../../entities/types'
import { PRNG } from '../../engine/seed/prng'

export type FeedStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error'
export type FeedListener = (entities: UrbanEntity[]) => void

/** Transport-agnostic live feed. WebSocket, EventSource and mock share it. */
export interface FeedConnection {
  id: string
  status: FeedStatus
  open(): void
  close(): void
  onMessage(fn: FeedListener): () => void
  onStatus(fn: (s: FeedStatus) => void): () => void
}

abstract class BaseFeed implements FeedConnection {
  status: FeedStatus = 'idle'
  private listeners = new Set<FeedListener>()
  private statusListeners = new Set<(s: FeedStatus) => void>()
  constructor(public id: string, protected normalize: (payload: unknown) => UrbanEntity[]) {}
  abstract open(): void
  abstract close(): void
  onMessage(fn: FeedListener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  onStatus(fn: (s: FeedStatus) => void): () => void { this.statusListeners.add(fn); return () => this.statusListeners.delete(fn) }
  protected emit(payload: unknown): void { let ents: UrbanEntity[]; try { ents = this.normalize(payload) } catch { return } if (ents.length) for (const l of this.listeners) l(ents) }
  protected setStatus(s: FeedStatus): void { this.status = s; for (const l of this.statusListeners) l(s) }
}

export class WebSocketFeed extends BaseFeed {
  private ws?: WebSocket
  constructor(id: string, private url: string, normalize: (p: unknown) => UrbanEntity[]) { super(id, normalize) }
  open(): void {
    this.setStatus('connecting')
    this.ws = new WebSocket(this.url)
    this.ws.onopen = () => this.setStatus('open')
    this.ws.onclose = () => this.setStatus('closed')
    this.ws.onerror = () => this.setStatus('error')
    this.ws.onmessage = (e) => { try { this.emit(JSON.parse(String(e.data))) } catch { /* ignore malformed */ } }
  }
  close(): void { this.ws?.close(); this.setStatus('closed') }
}

export class EventSourceFeed extends BaseFeed {
  private es?: EventSource
  constructor(id: string, private url: string, normalize: (p: unknown) => UrbanEntity[]) { super(id, normalize) }
  open(): void {
    this.setStatus('connecting')
    this.es = new EventSource(this.url)
    this.es.onopen = () => this.setStatus('open')
    this.es.onerror = () => this.setStatus('error')
    this.es.onmessage = (e) => { try { this.emit(JSON.parse(String(e.data))) } catch { /* ignore */ } }
  }
  close(): void { this.es?.close(); this.setStatus('closed') }
}

/** Seeded mock feed producing incident reports at intervals (for development and tests). */
export class MockRealtimeFeed extends BaseFeed {
  private timer?: ReturnType<typeof setInterval>
  private rng: PRNG
  private n = 0
  constructor(id: string, seed: number, private centre: { lng: number; lat: number }, private intervalMs = 15000, private now: () => number = () => Date.now()) {
    super(id, (p) => p as UrbanEntity[])
    this.rng = new PRNG(seed)
  }
  open(): void { this.setStatus('open'); this.timer = setInterval(() => this.tick(), this.intervalMs) }
  close(): void { if (this.timer) clearInterval(this.timer); this.setStatus('closed') }
  /** Emit one report now (exposed for tests). */
  tick(): UrbanEntity[] {
    const kinds = ['collision', 'breakdown', 'crowd'] as const
    const kind = this.rng.choice(kinds)
    const t = this.now()
    const e: UrbanEntity = {
      id: `${this.id}:${this.n++}`, type: 'incident', timestamp: t,
      geometry: { type: 'Point', coordinates: [this.centre.lng + this.rng.range(-0.01, 0.01), this.centre.lat + this.rng.range(-0.01, 0.01)] },
      properties: { kind, severity: Math.round(this.rng.range(0.2, 0.9) * 100) / 100, startTime: t, endTime: t + this.rng.range(5, 30) * 60000, edgeId: '', description: `Mock live report: ${kind}` },
      evidence: { classification: 'observed', source: this.id, timestamp: t, confidence: 0.5 },
    }
    this.emit([e])
    return [e]
  }
}

export class MockRealtimeAdapter {
  constructor(public feed: MockRealtimeFeed) {}
  async connect(): Promise<void> { this.feed.open() }
}
