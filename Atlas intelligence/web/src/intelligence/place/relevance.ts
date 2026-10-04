import type { Dimension, PlaceState } from '../../data/adapters/placeAdapter'

/**
 * The same facts, different relevance. A family, a student, a young
 * professional and a retired person weigh the dimensions of a place
 * differently; nothing is re-measured, only re-ordered and re-weighted.
 */
export type LifeView = 'everyone' | 'family' | 'student' | 'professional' | 'retired'

export const VIEW_WEIGHTS: Record<LifeView, Record<string, number>> = {
  everyone: { traffic: 1, safety: 1, air: 1, access_health: 1, access_transport: 1, green: 0.6, walkability: 0.6, access_school: 0.5, connectivity: 0.5, rain: 0.5, shopping: 0.4, noise: 0.3, built: 0.3, access_pharmacy: 0.3, access_police: 0.2, access_fire: 0.2 },
  family: { access_school: 1.2, access_health: 1.1, safety: 1.1, air: 1, green: 1, walkability: 0.9, traffic: 0.7, access_transport: 0.6, shopping: 0.5, noise: 0.5, rain: 0.5, access_pharmacy: 0.5, built: 0.2, connectivity: 0.4, access_police: 0.3, access_fire: 0.3 },
  student: { access_transport: 1.2, shopping: 0.9, connectivity: 0.9, safety: 0.9, walkability: 0.8, air: 0.6, traffic: 0.6, access_health: 0.5, green: 0.4, noise: 0.3, rain: 0.4, built: 0.3, access_school: 0.4, access_pharmacy: 0.3, access_police: 0.2, access_fire: 0.1 },
  professional: { traffic: 1.2, access_transport: 1.2, connectivity: 1, shopping: 0.7, safety: 0.8, air: 0.8, walkability: 0.6, noise: 0.5, green: 0.4, access_health: 0.5, rain: 0.5, built: 0.3, access_school: 0.1, access_pharmacy: 0.3, access_police: 0.2, access_fire: 0.1 },
  retired: { access_health: 1.3, access_pharmacy: 1, walkability: 1, green: 1, noise: 0.9, air: 1, safety: 1, traffic: 0.5, access_transport: 0.7, shopping: 0.6, rain: 0.5, built: 0.2, connectivity: 0.3, access_school: 0.1, access_police: 0.3, access_fire: 0.3 },
}

export const ALWAYS_LAST = new Set(['flood', 'population', 'crowd'])

/** Dimensions in the order that matters for the view; "no data" rows stay, at the end of their group. */
export function orderDimensions(dims: Dimension[], view: LifeView): Dimension[] {
  const w = VIEW_WEIGHTS[view]
  return [...dims].sort((a, b) => {
    const la = ALWAYS_LAST.has(a.key) ? 1 : 0, lb = ALWAYS_LAST.has(b.key) ? 1 : 0
    if (la !== lb) return la - lb
    const na = a.score === null ? 1 : 0, nb = b.score === null ? 1 : 0
    if (na !== nb) return na - nb
    return (w[b.key] ?? 0) - (w[a.key] ?? 0)
  })
}

/** The view's own score: a weighted mean of the dimensions that have data. */
export function viewScore(dims: Dimension[], view: LifeView): number | null {
  const w = VIEW_WEIGHTS[view]
  let num = 0, den = 0
  for (const d of dims) { const k = w[d.key] ?? 0; if (k && d.score !== null) { num += k * d.score; den += k } }
  return den ? Math.round(num / den) : null
}

/** Two strongest and two weakest measured dimensions, for the one-sentence summary. */
export function strengthsAndWeaknesses(dims: Dimension[], view: LifeView): { strong: Dimension[]; weak: Dimension[] } {
  const w = VIEW_WEIGHTS[view]
  const measured = dims.filter((d) => d.score !== null && (w[d.key] ?? 0) > 0.25)
  const strong = measured.filter((d) => d.score! >= 60).sort((a, b) => b.score! - a.score!).slice(0, 2)
  const weak = measured.filter((d) => d.score! < 45).sort((a, b) => a.score! - b.score!).slice(0, 2)
  return { strong, weak }
}

/** "Before you rent or buy": what the data cannot answer becomes a question to ask in person. */
export function questionsWorthAsking(dims: Dimension[]): string[] {
  const q: string[] = []
  const by = Object.fromEntries(dims.map((d) => [d.key, d]))
  if (!by.flood || by.flood.score === null) q.push('q.flood')
  if (by.traffic && (by.traffic.score === null || by.traffic.score < 50)) q.push('q.peak')
  if (by.built && by.built.score !== null && by.built.score > 60) q.push('q.construction')
  if (by.noise && by.noise.score !== null && by.noise.score < 50) q.push('q.noise')
  if (by.access_health && by.access_health.score !== null && by.access_health.score < 50) q.push('q.hospital')
  if (by.air && by.air.score !== null && by.air.score < 50) q.push('q.air')
  if (q.length < 3) q.push('q.water')
  return q.slice(0, 4)
}

/** Compare up to three places on the priorities a person picked; never a universal winner. */
export function bestMatch(places: Array<{ name: string; state: PlaceState }>, priorities: string[]): { name: string; score: number | null; perPriority: Record<string, number | null> }[] {
  return places.map((p) => {
    const by = Object.fromEntries(p.state.dimensions.map((d) => [d.key, d.score]))
    const perPriority: Record<string, number | null> = {}
    let num = 0, den = 0
    for (const k of priorities) { const v = by[k] ?? null; perPriority[k] = v; if (v !== null) { num += v; den += 1 } }
    return { name: p.name, score: den ? Math.round(num / den) : null, perPriority }
  })
}
