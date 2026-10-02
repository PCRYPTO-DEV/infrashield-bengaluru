import type { WorldModel } from '../../engine/world/WorldModel'
import type { Camera, ScreenPoint } from '../camera/Camera'
import type { Lod } from '../../rendering/lod'

export type Selection = { kind: 'agent'; id: number } | { kind: 'entity'; id: string }

/** Topmost thing under a screen point: agents first (they are on top), then static entities. */
export function hitTest(world: WorldModel, camera: Camera, s: ScreenPoint, lod: Lod): Selection | null {
  const p = camera.screenToWorld(s)
  const tol = 8 / camera.scale
  if (lod === 'street') {
    const a = world.nearestAgent(p, tol * 1.5)
    if (a) return { kind: 'agent', id: a.id }
  }
  const e = world.entityAt(p, tol)
  if (e) {
    // At coarse LOD buildings are not drawn individually; prefer roads/zones.
    if (lod !== 'street' && e.entity.type === 'building') { const r = world.nearestRoad(p, tol * 2); return r ? { kind: 'entity', id: r.entity.id } : null }
    return { kind: 'entity', id: e.entity.id }
  }
  return null
}
