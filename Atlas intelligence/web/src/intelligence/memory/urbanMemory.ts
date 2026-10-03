import type { WorldPoint } from '../../geo/projection/mercator'
import type { EvidenceMetadata } from '../../entities/types'

export interface MemoryEvent {
  id: string
  type: string
  timestamp: number
  location: WorldPoint
  /** location cell key for grouping */
  cell: string
  severity: number
  description: string
  entityIds: string[]
  evidence: EvidenceMetadata
}

/**
 * Urban memory: a time-series of events keyed by location cell. Enables
 * replay, comparison and "what happened here in the last hour".
 */
export class UrbanMemory {
  private events: MemoryEvent[] = []
  private byCell = new Map<string, MemoryEvent[]>()
  private ids = new Set<string>()

  constructor(public readonly cellSize: number, private maxEvents = 5000) {}

  cellKey(p: WorldPoint): string { return `${Math.floor(p.x / this.cellSize)},${Math.floor(p.y / this.cellSize)}` }

  record(e: Omit<MemoryEvent, 'cell'>): boolean {
    if (this.ids.has(e.id)) return false
    const ev: MemoryEvent = { ...e, cell: this.cellKey(e.location) }
    this.events.push(ev)
    this.ids.add(ev.id)
    const l = this.byCell.get(ev.cell) ?? []
    l.push(ev); this.byCell.set(ev.cell, l)
    if (this.events.length > this.maxEvents) {
      const old = this.events.shift()!
      this.ids.delete(old.id)
      const cl = this.byCell.get(old.cell); if (cl) { const i = cl.indexOf(old); if (i >= 0) cl.splice(i, 1) }
    }
    return true
  }

  /** Events within radius of a point, in a time range, newest first. */
  near(p: WorldPoint, radius: number, from = -Infinity, to = Infinity): MemoryEvent[] {
    const out: MemoryEvent[] = []
    const c0 = Math.floor((p.x - radius) / this.cellSize), c1 = Math.floor((p.x + radius) / this.cellSize)
    const r0 = Math.floor((p.y - radius) / this.cellSize), r1 = Math.floor((p.y + radius) / this.cellSize)
    for (let cy = r0; cy <= r1; cy++) for (let cx = c0; cx <= c1; cx++) {
      for (const e of this.byCell.get(`${cx},${cy}`) ?? []) {
        if (e.timestamp < from || e.timestamp > to) continue
        if (Math.hypot(e.location.x - p.x, e.location.y - p.y) <= radius) out.push(e)
      }
    }
    return out.sort((a, b) => b.timestamp - a.timestamp)
  }

  between(from: number, to: number): MemoryEvent[] { return this.events.filter((e) => e.timestamp >= from && e.timestamp <= to) }
  all(): readonly MemoryEvent[] { return this.events }
  get size(): number { return this.events.length }

  /** Timeline for a location: grouped by minute, oldest first. */
  timeline(p: WorldPoint, radius: number, from: number, to: number): Array<{ minute: number; events: MemoryEvent[] }> {
    const groups = new Map<number, MemoryEvent[]>()
    for (const e of this.near(p, radius, from, to)) { const m = Math.floor(e.timestamp / 60000); const l = groups.get(m) ?? []; l.push(e); groups.set(m, l) }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([minute, events]) => ({ minute, events }))
  }

  /** Count of events by type in a window — the basis for pattern detection. */
  patterns(from: number, to: number): Map<string, number> {
    const m = new Map<string, number>()
    for (const e of this.between(from, to)) m.set(e.type, (m.get(e.type) ?? 0) + 1)
    return m
  }
}
