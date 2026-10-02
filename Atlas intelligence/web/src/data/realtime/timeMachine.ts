import type { UrbanEntity } from '../../entities/types'
import type { WorldModel } from '../../engine/world/WorldModel'
import type { WorldBounds } from '../../geo/projection/mercator'
import { localToLngLat } from '../../geo/projection/frame'
import { attachIncidentToEdge } from './liveFeeds'

export type TimeKind = 'past' | 'future'

export interface TimeMachineState {
  kind: TimeKind | null
  /** the instant shown, epoch ms */
  at: number
  /** roads with a reading (past) or a prediction (future) on screen */
  count: number
  /** roads the memory knows in this area, and since when */
  roadsRemembered: number
  memorySince: number | null
  confidence: number
  model: string
  busy: boolean
  error: string | null
}

interface Reading { segment: string; level: number; lng: number | null; lat: number | null; confidence?: number }
interface AtResponse {
  at: number; kind: 'recorded' | 'predicted'
  flow: { segments: Reading[]; count: number; roadsRemembered?: number }
  incidents: Array<{ id: string; ts: number; kind: string; severity: number | null; lng: number; lat: number; description: string | null; firstSeen: number }>
  coverage: { from: number | null; to: number | null; segments: number; readings: number }
  evidence: { classification: string; source: string; timestamp: number; confidence: number; model: string }
}

/**
 * The time machine. PAST shows what the city actually read at that instant (the server's memory);
 * FUTURE shows what the same roads usually read at that hour, with what is unusual now fading out,
 * labelled PREDICTED with a confidence. Roads the memory does not know are left blank: nothing is
 * simulated. Readings land in the world model through the same door as the live feed, so the map,
 * the inspector and Ask the City all see the chosen time.
 */
export class TimeMachine {
  state: TimeMachineState = { kind: null, at: 0, count: 0, roadsRemembered: 0, memorySince: null, confidence: 0, model: '', busy: false, error: null }
  private fetchImpl: typeof fetch
  private seq = 0
  private lastKey = ''

  constructor(private world: WorldModel, private edgeSegment: () => Map<string, string>, private baseUrl: string, fetchImpl?: typeof fetch) {
    this.fetchImpl = fetchImpl ?? ((...a) => fetch(...a))
  }

  /** Bucket of the instant (5 min) and the view: only a change of either asks the server again. */
  key(at: number, view: WorldBounds): string {
    const b = this.bbox(view)
    return `${Math.floor(at / 300_000)}:${b}`
  }

  private bbox(view: WorldBounds): string {
    const f = this.world.frame
    const sw = localToLngLat(f, { x: view.minX, y: view.maxY }), ne = localToLngLat(f, { x: view.maxX, y: view.minY })
    return [sw.lng, sw.lat, ne.lng, ne.lat].map((v) => v.toFixed(3)).join(',')
  }

  async show(kind: TimeKind, at: number, view: WorldBounds): Promise<boolean> {
    const key = `${kind}:${this.key(at, view)}`
    if (key === this.lastKey) return false
    this.lastKey = key
    const seq = ++this.seq
    this.state = { ...this.state, kind, at, busy: true, error: null }
    try {
      const path = kind === 'past' ? '/api/history/at' : '/api/forecast/at'
      const r = await this.fetchImpl(`${this.baseUrl}${path}?bbox=${this.bbox(view)}&at=${(at / 1000).toFixed(0)}`)
      if (!r.ok) throw new Error(`${kind}: HTTP ${r.status}`)
      const data = (await r.json()) as AtResponse
      if (seq !== this.seq) return false
      this.apply(kind, at, data)
      return true
    } catch (e) {
      if (seq !== this.seq) return false
      this.state = { ...this.state, busy: false, error: (e as Error).message }
      return true
    }
  }

  private apply(kind: TimeKind, at: number, data: AtResponse): void {
    // segment id → the edges it was matched to live; the memory keys readings by the same segment id
    const bySegment = new Map<string, string[]>()
    for (const [edge, seg] of this.edgeSegment()) { const l = bySegment.get(seg); if (l) l.push(edge); else bySegment.set(seg, [edge]) }
    const levels = new Map<string, number>()
    for (const s of data.flow.segments) for (const edge of bySegment.get(s.segment) ?? []) levels.set(edge, s.level)
    this.world.setObservedFlow(levels, at, kind === 'past' ? 'memory' : 'forecast', data.flow.count)
    const incidents: UrbanEntity[] = data.incidents.map((i) => {
      const e: UrbanEntity = { id: i.id, type: 'incident', geometry: { type: 'Point', coordinates: [i.lng, i.lat] }, properties: { kind: i.kind, severity: i.severity ?? 0.5, startTime: i.firstSeen * 1000, endTime: i.ts * 1000 + 900_000, edgeId: '', description: i.description ?? i.kind }, evidence: { classification: 'observed', source: 'atlas-memory', timestamp: i.ts * 1000, confidence: 1 } }
      e.properties.edgeId = attachIncidentToEdge(this.world, e)
      return e
    })
    this.world.setLiveIncidents(incidents)
    this.state = { kind, at, count: levels.size, roadsRemembered: data.coverage.segments, memorySince: data.coverage.from ? data.coverage.from * 1000 : null, confidence: data.evidence.confidence, model: data.evidence.model, busy: false, error: null }
  }

  /** Back to live: forget the shown instant so the next visit asks again. */
  reset(): void { this.seq++; this.lastKey = ''; this.state = { ...this.state, kind: null, busy: false, error: null } }
}
