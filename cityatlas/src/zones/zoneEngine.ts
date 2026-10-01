import type { AgentView } from '../engine/world/WorldModel'
import type { MonitoringZone, ZoneEvent, ZoneShape, ZoneRule, ZoneStats } from './types'
import { shapeToRing, zoneContains, ringAreaM2 } from './geometry'

interface Presence { enteredAt: number; lastMovedAt: number; x: number; y: number; dwellFired: boolean }

/**
 * Evaluates user-drawn monitoring zones against the agent population each
 * tick and emits entry / exit / dwell / count / direction / speed / density
 * events. Pure with respect to its inputs; the app feeds it agents from the
 * world model.
 */
export class ZoneEngine {
  readonly zones = new Map<string, MonitoringZone>()
  private presence = new Map<string, Map<number, Presence>>()
  private counter = 0

  constructor(private unitPerMetre: number, private groundScale: number) {}

  create(name: string, shape: ZoneShape, rules: ZoneRule[], restricted = false, now = Date.now()): MonitoringZone {
    const id = `z${++this.counter}`
    const z: MonitoringZone = { id, name, shape, ring: shapeToRing(shape, this.unitPerMetre), rules, restricted, createdAt: now }
    this.zones.set(id, z)
    this.presence.set(id, new Map())
    return z
  }

  remove(id: string): void { this.zones.delete(id); this.presence.delete(id) }
  list(): MonitoringZone[] { return [...this.zones.values()] }

  /** Evaluate all zones. Returns events raised this tick and stats per zone. */
  evaluate(agents: Iterable<AgentView>, time: number): { events: ZoneEvent[]; stats: Map<string, ZoneStats> } {
    const events: ZoneEvent[] = []
    const stats = new Map<string, ZoneStats>()
    const agentList = [...agents]
    for (const z of this.zones.values()) {
      const pres = this.presence.get(z.id)!
      const seen = new Set<number>()
      const count = { vehicle: 0, pedestrian: 0 }
      let speedSum = 0, n = 0, longestDwell = 0
      const direction = new Array(8).fill(0)
      for (const a of agentList) {
        const inside = zoneContains(z, a)
        const p = pres.get(a.id)
        if (inside) {
          seen.add(a.id)
          count[a.kind]++
          speedSum += a.speed; n++
          direction[(Math.round(((a.heading % (Math.PI * 2)) + Math.PI * 2) / (Math.PI / 4)) % 8)]++
          if (!p) {
            pres.set(a.id, { enteredAt: time, lastMovedAt: time, x: a.x, y: a.y, dwellFired: false })
            if (this.has(z, 'entry', a.kind)) events.push(this.ev(z, 'entry', a, time, undefined, `${a.kind} entered "${z.name}"`))
          } else {
            if (Math.hypot(a.x - p.x, a.y - p.y) > 1.5 * this.unitPerMetre) { p.lastMovedAt = time; p.x = a.x; p.y = a.y }
            const dwellS = (time - p.lastMovedAt) / 1000
            longestDwell = Math.max(longestDwell, dwellS)
            const rule = this.rule(z, 'dwell', a.kind)
            if (rule && !p.dwellFired && dwellS >= (rule.threshold ?? 60)) { p.dwellFired = true; events.push(this.ev(z, 'dwell', a, time, dwellS, `${a.kind} dwelling ${Math.round(dwellS)} s in "${z.name}"`)) }
            const sRule = this.rule(z, 'speed', a.kind)
            if (sRule && a.speed / this.unitPerMetre > (sRule.threshold ?? 15)) events.push(this.ev(z, 'speed', a, time, a.speed / this.unitPerMetre, `${a.kind} at ${(a.speed / this.unitPerMetre).toFixed(1)} m/s in "${z.name}"`))
          }
        } else if (p) {
          pres.delete(a.id)
          if (this.has(z, 'exit', a.kind)) events.push(this.ev(z, 'exit', a, time, (time - p.enteredAt) / 1000, `${a.kind} left "${z.name}" after ${Math.round((time - p.enteredAt) / 1000)} s`))
        }
      }
      for (const id of [...pres.keys()]) if (!seen.has(id)) pres.delete(id)
      const areaHa = Math.max(0.01, ringAreaM2(z.ring, this.groundScale) / 10_000)
      const total = count.vehicle + count.pedestrian
      const st: ZoneStats = { zoneId: z.id, time, count, meanSpeed: n ? speedSum / n / this.unitPerMetre : 0, density: total / areaHa, direction, longestDwellS: longestDwell }
      stats.set(z.id, st)
      const cRule = this.rule(z, 'count')
      if (cRule && total > (cRule.threshold ?? 20)) events.push({ id: `e${++this.counter}`, zoneId: z.id, type: 'count', agentId: -1, kind: 'vehicle', timestamp: time, value: total, description: `${total} agents in "${z.name}" (threshold ${cRule.threshold ?? 20})` })
      const dRule = this.rule(z, 'density')
      if (dRule && st.density > (dRule.threshold ?? 50)) events.push({ id: `e${++this.counter}`, zoneId: z.id, type: 'density', agentId: -1, kind: 'pedestrian', timestamp: time, value: st.density, description: `${st.density.toFixed(0)} agents/ha in "${z.name}"` })
    }
    return { events, stats }
  }

  private has(z: MonitoringZone, type: ZoneRule['type'], kind: 'vehicle' | 'pedestrian'): boolean { return !!this.rule(z, type, kind) }
  private rule(z: MonitoringZone, type: ZoneRule['type'], kind?: 'vehicle' | 'pedestrian'): ZoneRule | undefined {
    return z.rules.find((r) => r.type === type && (!kind || !r.kinds || r.kinds.includes(kind)))
  }
  private ev(z: MonitoringZone, type: ZoneRule['type'], a: AgentView, time: number, value: number | undefined, description: string): ZoneEvent {
    return { id: `e${++this.counter}`, zoneId: z.id, type, agentId: a.id, kind: a.kind, timestamp: time, value, description }
  }
}
