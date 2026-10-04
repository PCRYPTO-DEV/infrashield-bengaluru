import { describe, it, expect } from 'vitest'
import { CityChunkManager } from '../engine/chunks/CityChunkManager'
import { FRAME, syncSource, whenIdle } from './helpers'
import { DATASET_VERSION } from '../engine/seed/worldSeed'
import { tileSizeWorld, CHUNK_ZOOM } from '../geo/tiles/tiles'

const S = tileSizeWorld(CHUNK_ZOOM)

function manager(log: string[], opts: Partial<ConstructorParameters<typeof CityChunkManager>[1]> = {}) {
  return new CityChunkManager(syncSource(log), { frame: FRAME, globalSeed: 'cm', datasetVersion: DATASET_VERSION, concurrency: 4, prefetchPad: 1, unloadPad: 2, maxChunks: 50, ...opts })
}

describe('CityChunkManager', () => {
  it('loads visible chunks with padding, without duplicate requests', async () => {
    const log: string[] = []
    const m = manager(log)
    const view = { minX: -10, minY: -10, maxX: 10, maxY: 10 }
    m.update(view, { x: 0, y: 0 })
    m.update(view, { x: 0, y: 0 })
    m.update(view, { x: 0, y: 0 })
    await whenIdle(m)
    expect(m.loaded.size).toBe(m.requiredKeys(view).length)
    expect(new Set(log).size).toBe(log.length)
  })
  it('unloads distant chunks and keeps near ones', async () => {
    const log: string[] = []
    const m = manager(log)
    const unloaded: string[] = []
    m.on('unloaded', (k) => unloaded.push(k))
    m.update({ minX: -10, minY: -10, maxX: 10, maxY: 10 }, { x: 0, y: 0 })
    await whenIdle(m)
    const far = { minX: 10 * S, minY: 10 * S, maxX: 10 * S + 10, maxY: 10 * S + 10 }
    m.update(far, { x: 10 * S, y: 10 * S })
    await whenIdle(m)
    expect(unloaded.length).toBeGreaterThan(0)
    for (const k of m.loaded.keys()) expect(m.requiredKeys(far, 2)).toContain(k)
  })
  it('cancels requests that leave the prefetch area', async () => {
    const log: string[] = []
    const m = manager(log, { concurrency: 1 })
    m.update({ minX: -10, minY: -10, maxX: 10, maxY: 10 }, { x: 0, y: 0 })
    const inflightBefore = m.inFlight
    m.update({ minX: 20 * S, minY: 20 * S, maxX: 20 * S + 10, maxY: 20 * S + 10 }, { x: 20 * S, y: 20 * S })
    expect(inflightBefore).toBeGreaterThan(0)
    await whenIdle(m)
    for (const k of m.loaded.keys()) expect(k).not.toBe(undefined)
    const nearKeys = m.requiredKeys({ minX: -10, minY: -10, maxX: 10, maxY: 10 })
    expect(nearKeys.some((k) => m.loaded.has(k))).toBe(false)
  })
  it('respects the LRU cap', async () => {
    const log: string[] = []
    const m = manager(log, { maxChunks: 4, unloadPad: 5 })
    m.update({ minX: -10, minY: -10, maxX: 10, maxY: 10 }, { x: 0, y: 0 })
    await whenIdle(m)
    expect(m.loaded.size).toBeLessThanOrEqual(9)
    m.update({ minX: 3 * S, minY: 0, maxX: 3 * S + 10, maxY: 10 }, { x: 3 * S, y: 0 })
    await whenIdle(m)
    expect(m.loaded.size).toBeLessThanOrEqual(4 + 9)
  })
  it('loads nearest chunks first', async () => {
    const log: string[] = []
    const m = manager(log, { concurrency: 1 })
    m.update({ minX: -10, minY: -10, maxX: 10, maxY: 10 }, { x: 0, y: 0 })
    await whenIdle(m)
    const centreKey = m.requiredKeys({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0)[0]
    expect(log[0]).toBe(centreKey)
  })
})

describe('CityChunkManager budget and tiers', () => {
  it('never loads more than the budget, nearest first, when zoomed far out', async () => {
    const log: string[] = []
    const m = manager(log, { budget: 6, maxChunks: 9 })
    const huge = { minX: -20 * S, minY: -20 * S, maxX: 20 * S, maxY: 20 * S }
    m.update(huge, { x: 0, y: 0 })
    await whenIdle(m)
    expect(m.loaded.size).toBe(6)
    const centreKey = m.requiredKeys({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 0)[0]
    expect(m.loaded.has(centreKey)).toBe(true)
    expect(log.length).toBe(6)
  })
  it('district tier uses a coarser tile zoom', async () => {
    const log: string[] = []
    const m = new CityChunkManager(syncSource(log), { frame: FRAME, globalSeed: 'cm', datasetVersion: DATASET_VERSION, chunkZoom: 13, budget: 4 })
    const keys = m.requiredKeys({ minX: -10, minY: -10, maxX: 10, maxY: 10 }, 0)
    expect(keys.length).toBe(1)
    expect(keys[0].startsWith('13/')).toBe(true)
  })
})
