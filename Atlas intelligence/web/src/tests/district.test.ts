import { describe, it, expect } from 'vitest'
import { generateDistrict, DISTRICT_ZOOM } from '../engine/procedural/generateDistrict'
import { FRAME, BENGALURU } from './helpers'
import { DATASET_VERSION } from '../engine/seed/worldSeed'
import { tileKey, worldToTile } from '../geo/tiles/tiles'
import { lngLatToWorld } from '../geo/projection/mercator'

describe('district tier', () => {
  it('is deterministic, cheap and carries no simulation payload', () => {
    const key = tileKey(worldToTile(lngLatToWorld(BENGALURU), DISTRICT_ZOOM))
    const req = { key, globalSeed: 'd', datasetVersion: DATASET_VERSION, hourBucket: 0, frame: FRAME }
    const t0 = performance.now()
    const a = generateDistrict(req), b = generateDistrict(req)
    const ms = performance.now() - t0
    expect(a.svg.city).toBe(b.svg.city)
    expect(a.graph.edges.length).toBe(0)
    expect(a.meta.vehicleBudget).toBe(0)
    expect(a.svg.city.length).toBeGreaterThan(1000)
    expect(ms).toBeLessThan(200)
    expect(generateDistrict({ ...req, globalSeed: 'e' }).svg.city).not.toBe(a.svg.city)
  })
})
