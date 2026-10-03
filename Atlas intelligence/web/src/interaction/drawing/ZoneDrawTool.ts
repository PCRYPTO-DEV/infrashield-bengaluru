import type { WorldPoint } from '../../geo/projection/mercator'
import type { ZoneShape } from '../../zones/types'

export type DrawKind = ZoneShape['kind'] | 'route'

export interface DrawState { kind: DrawKind; points: WorldPoint[]; cursor: WorldPoint | null; width: number }

/**
 * State machine for drawing polygon / line / radius / corridor zones and
 * picking route endpoints. Pure: feed it world points, read back a shape.
 */
export class ZoneDrawTool {
  state: DrawState | null = null
  private listeners = new Set<() => void>()
  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  private changed(): void { for (const l of this.listeners) l() }

  start(kind: DrawKind, width = 30): void { this.state = { kind, points: [], cursor: null, width }; this.changed() }
  cancel(): void { this.state = null; this.changed() }
  get active(): boolean { return this.state !== null }

  move(p: WorldPoint): void { if (this.state) { this.state.cursor = p; this.changed() } }

  /** Add a vertex. Returns a finished shape for shapes that complete on click. */
  click(p: WorldPoint): ZoneShape | { kind: 'route'; points: WorldPoint[] } | null {
    if (!this.state) return null
    const s = this.state
    s.points.push(p)
    if (s.kind === 'radius' && s.points.length === 2) return this.finishAndReturn()
    if (s.kind === 'route' && s.points.length === 2) return this.finishAndReturn()
    this.changed()
    return null
  }

  /** Finish a polygon/line/corridor (double-click or Enter). */
  finish(): ZoneShape | { kind: 'route'; points: WorldPoint[] } | null {
    if (!this.state) return null
    const s = this.state
    const need = s.kind === 'polygon' ? 3 : 2
    if (s.points.length < need) { this.cancel(); return null }
    return this.finishAndReturn()
  }

  private finishAndReturn(): ZoneShape | { kind: 'route'; points: WorldPoint[] } {
    const s = this.state!
    this.state = null
    this.changed()
    switch (s.kind) {
      case 'polygon': return { kind: 'polygon', points: s.points }
      case 'line': return { kind: 'line', points: s.points }
      case 'corridor': return { kind: 'corridor', points: s.points, width: s.width }
      case 'radius': return { kind: 'radius', centre: s.points[0], radius: Math.max(5, Math.hypot(s.points[1].x - s.points[0].x, s.points[1].y - s.points[0].y)) }
      case 'route': return { kind: 'route', points: s.points }
    }
  }
}
