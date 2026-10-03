import type { WorldModel } from '../../engine/world/WorldModel'
import type { IntelligenceState } from '../types'
import type { WorldBounds, WorldPoint } from '../../geo/projection/mercator'
import type { BuildingProperties, EvidenceMetadata } from '../../entities/types'

export interface SiteFactor { id: string; label: string; value: number; weight: number; note: string }
export interface SiteCandidate { point: WorldPoint; score: number; factors: SiteFactor[]; evidence: EvidenceMetadata }

export interface ScoringModule {
  id: string
  label: string
  weight: number
  /** value in 0..1 for a candidate cell */
  score(ctx: SiteContext, cell: WorldPoint, radius: number): { value: number; note: string }
}

export interface SiteContext { world: WorldModel; intel: IntelligenceState; time: number; unitPerMetre: number }

const countNearby = (ctx: SiteContext, p: WorldPoint, r: number, pred: (e: { entity: { type: string; properties: Record<string, unknown> } }) => boolean) =>
  ctx.world.entitiesIn({ minX: p.x - r, minY: p.y - r, maxX: p.x + r, maxY: p.y + r }).filter(pred).length

/** Built-in scoring modules for the "where should a café open?" family of questions. */
export const CAFE_MODULES: ScoringModule[] = [
  { id: 'footfall', label: 'Footfall proxy', weight: 0.3, score(ctx, p, r) {
    const d = ctx.intel.density
    let peds = 0
    if (d) for (const c of d.cells.values()) if (Math.hypot(c.x - p.x, c.y - p.y) <= r) peds += c.pedestrians
    return { value: Math.min(1, peds / 25), note: `${peds} pedestrians within ${Math.round(r / ctx.unitPerMetre)} m (derived)` } } },
  { id: 'access', label: 'Road accessibility', weight: 0.15, score(ctx, p, r) {
    const road = ctx.world.nearestRoad(p, r)
    const cls = (road?.entity.properties as { roadClass?: string } | undefined)?.roadClass
    const v = cls === 'arterial' ? 1 : cls === 'collector' ? 0.75 : cls ? 0.45 : 0
    return { value: v, note: road ? `nearest road is ${cls} (${(road.entity.properties as { name: string }).name})` : 'no road nearby' } } },
  { id: 'competition', label: 'Nearby competition', weight: 0.15, score(ctx, p, r) {
    const n = countNearby(ctx, p, r, (e) => e.entity.type === 'building' && (e.entity.properties as BuildingProperties).landUse === 'commercial')
    return { value: Math.max(0, 1 - n / 12), note: `${n} commercial buildings within radius (more = more competition)` } } },
  { id: 'office', label: 'Office density', weight: 0.15, score(ctx, p, r) {
    const n = countNearby(ctx, p, r, (e) => e.entity.type === 'building' && (e.entity.properties as BuildingProperties).landUse === 'office')
    return { value: Math.min(1, n / 10), note: `${n} office buildings within radius` } } },
  { id: 'residential', label: 'Residential density', weight: 0.1, score(ctx, p, r) {
    const n = countNearby(ctx, p, r, (e) => e.entity.type === 'building' && (e.entity.properties as BuildingProperties).landUse === 'residential')
    return { value: Math.min(1, n / 25), note: `${n} residential buildings within radius` } } },
  { id: 'transit', label: 'Transit access', weight: 0.1, score(ctx, p, r) {
    const n = countNearby(ctx, p, r * 1.5, (e) => e.entity.type === 'transit')
    return { value: Math.min(1, n), note: n ? `${n} transit stop(s) within ${Math.round((r * 1.5) / ctx.unitPerMetre)} m` : 'no transit stop nearby' } } },
  { id: 'activity', label: 'Time-of-day activity', weight: 0.05, score(ctx, p, r) {
    const a = ctx.intel.activity
    let best = 0
    if (a) for (const c of a.cells.values()) if (Math.hypot(c.x - p.x, c.y - p.y) <= r) best = Math.max(best, c.activity)
    return { value: best, note: `peak activity index ${best.toFixed(2)} nearby (derived)` } } },
]

/**
 * Score candidate cells across a bounds. New business questions register
 * new ScoringModule lists; the world engine is untouched.
 */
export function scoreSites(ctx: SiteContext, bounds: WorldBounds, modules: ScoringModule[] = CAFE_MODULES, cellM = 120, top = 5): SiteCandidate[] {
  const cell = cellM * ctx.unitPerMetre
  const radius = cell
  const out: SiteCandidate[] = []
  const totalW = modules.reduce((s, m) => s + m.weight, 0)
  for (let y = bounds.minY + cell / 2; y < bounds.maxY; y += cell) {
    for (let x = bounds.minX + cell / 2; x < bounds.maxX; x += cell) {
      const p = { x, y }
      const factors: SiteFactor[] = modules.map((m) => { const r = m.score(ctx, p, radius); return { id: m.id, label: m.label, value: r.value, weight: m.weight, note: r.note } })
      const score = factors.reduce((s, f) => s + f.value * f.weight, 0) / totalW
      out.push({ point: p, score, factors, evidence: { classification: 'derived', model: 'site-scorer/1', timestamp: ctx.time, confidence: 0.5 } })
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, top)
}
