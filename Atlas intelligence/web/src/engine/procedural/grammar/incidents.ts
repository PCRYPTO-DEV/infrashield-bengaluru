import { PRNG } from '../../seed/prng'
import { hashMix } from '../../seed/hash'
import type { GraphEdge } from '../../world/chunkTypes'
import type { IncidentKind, IncidentProperties } from '../../../entities/types'

const KINDS: IncidentKind[] = ['collision', 'breakdown', 'roadworks', 'flooding', 'crowd', 'closure']
const DESCRIPTIONS: Record<IncidentKind, string> = {
  collision: 'Two-vehicle collision reported, one lane obstructed',
  breakdown: 'Stalled vehicle in the kerb-side lane',
  roadworks: 'Utility trench works, single-lane working',
  flooding: 'Standing water after rain; reduced carriageway width',
  crowd: 'Crowd spilling onto carriageway near venue',
  closure: 'Temporary closure for an event; diversion in place',
}

/**
 * Incident grammar. Incidents are generated per (tile, hour bucket) so that
 * scrubbing time reproduces the same incidents. They are *simulated* and
 * labelled as such; a real feed would arrive via a DataAdapter instead.
 */
export function generateIncidents(
  chunkKey: string,
  globalSeed: string,
  datasetVersion: string,
  hourBucket: number,
  edges: GraphEdge[],
  density: number,
): Array<{ id: string; edge: GraphEdge; props: IncidentProperties }> {
  const out: Array<{ id: string; edge: GraphEdge; props: IncidentProperties }> = []
  const candidates = edges.filter((e) => e.id < e.from + '>' + e.to + '~' && e.from < e.to) // one direction per road segment
  if (candidates.length === 0) return out
  for (const bucket of [hourBucket - 1, hourBucket, hourBucket + 1]) {
    const rng = new PRNG(hashMix(globalSeed, datasetVersion, 'incident', chunkKey, bucket))
    const expected = 0.35 + density * 0.6
    const n = rng.next() < expected ? (rng.chance(0.25) ? 2 : 1) : 0
    for (let i = 0; i < n; i++) {
      const edge = rng.choice(candidates)
      const kind = rng.choice(KINDS)
      const start = bucket * 3600_000 + rng.range(0, 3600) * 1000
      const durationMin = kind === 'roadworks' || kind === 'closure' ? rng.range(90, 240) : rng.range(12, 45)
      out.push({
        id: `i:${chunkKey}:${bucket}:${i}`,
        edge,
        props: {
          kind,
          severity: Math.round(rng.range(0.2, 0.95) * 100) / 100,
          startTime: start,
          endTime: start + durationMin * 60_000,
          edgeId: edge.id,
          description: DESCRIPTIONS[kind],
        },
      })
    }
  }
  return out
}
