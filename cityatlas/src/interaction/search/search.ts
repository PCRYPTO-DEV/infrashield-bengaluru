import type { WorldModel } from '../../engine/world/WorldModel'
import type { WorldPoint } from '../../geo/projection/mercator'
import type { Selection } from '../selection/hitTest'

export interface SearchResult { label: string; sub: string; selection: Selection; point: WorldPoint }

/** Search entities by name, type or id; agents by numeric id. */
export function search(world: WorldModel, query: string, limit = 12): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: SearchResult[] = []
  if (/^\d+$/.test(q)) { const a = world.agents.get(Number(q)); if (a) out.push({ label: `${a.kind} #${a.id}`, sub: a.evidence.classification, selection: { kind: 'agent', id: a.id }, point: a }) }
  for (const ie of world.entities.values()) {
    const name = String((ie.entity.properties as { name?: unknown }).name ?? '')
    const hay = `${name} ${ie.entity.type} ${ie.entity.id}`.toLowerCase()
    if (!hay.includes(q)) continue
    const c = { x: (ie.bounds.minX + ie.bounds.maxX) / 2, y: (ie.bounds.minY + ie.bounds.maxY) / 2 }
    out.push({ label: name || ie.entity.id, sub: `${ie.entity.type} · ${ie.entity.evidence.classification}`, selection: { kind: 'entity', id: ie.entity.id }, point: c })
    if (out.length >= limit) break
  }
  return out
}
