import { describe, it, expect } from 'vitest'
import { PRNG } from '../engine/seed/prng'
import { hashMix, fnv1a } from '../engine/seed/hash'
import { worldSeed, parseWorldUri, formatWorldUri } from '../engine/seed/worldSeed'
import { Noise } from '../engine/procedural/noise'

describe('seed determinism', () => {
  it('PRNG streams are reproducible and independent', () => {
    const a = new PRNG(42), b = new PRNG(42), c = new PRNG(43)
    const sa = Array.from({ length: 50 }, () => a.next())
    const sb = Array.from({ length: 50 }, () => b.next())
    const sc = Array.from({ length: 50 }, () => c.next())
    expect(sa).toEqual(sb)
    expect(sa).not.toEqual(sc)
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true)
  })
  it('forks are deterministic', () => {
    expect(new PRNG(7).fork('x').next()).toBe(new PRNG(7).fork('x').next())
    expect(new PRNG(7).fork('x').next()).not.toBe(new PRNG(7).fork('y').next())
  })
  it('hash is stable and sensitive', () => {
    expect(fnv1a('cityatlas')).toBe(fnv1a('cityatlas'))
    expect(hashMix('a', 1, 'b')).not.toBe(hashMix('a', 2, 'b'))
    expect(hashMix('s', 1)).not.toBe(hashMix('s', 1.0000001))
  })
  it('worldSeed depends on every component', () => {
    const base = { globalSeed: 'g', tileId: '16/1/1', simulationTime: 0, datasetVersion: 'v1' }
    const s = worldSeed(base)
    expect(worldSeed({ ...base })).toBe(s)
    expect(worldSeed({ ...base, globalSeed: 'h' })).not.toBe(s)
    expect(worldSeed({ ...base, tileId: '16/1/2' })).not.toBe(s)
    expect(worldSeed({ ...base, simulationTime: 1 })).not.toBe(s)
    expect(worldSeed({ ...base, datasetVersion: 'v2' })).not.toBe(s)
  })
  it('parses world URIs', () => {
    expect(parseWorldUri('atlas://world/blr-2026')).toEqual({ seed: 'blr-2026' })
    expect(parseWorldUri('cityatlas://world/blr-2026')).toEqual({ seed: 'blr-2026' })
    expect(parseWorldUri(formatWorldUri('a b'))).toEqual({ seed: 'a b' })
    expect(parseWorldUri('')).toBeNull()
  })
  it('noise is seeded, continuous and bounded', () => {
    const n1 = new Noise(1), n2 = new Noise(1), n3 = new Noise(2)
    expect(n1.noise3(1.3, 2.7)).toBe(n2.noise3(1.3, 2.7))
    expect(n1.noise3(1.3, 2.7)).not.toBe(n3.noise3(1.3, 2.7))
    const a = n1.unit(10.0, 10.0), b = n1.unit(10.001, 10.0)
    expect(Math.abs(a - b)).toBeLessThan(0.01)
    for (let i = 0; i < 200; i++) { const v = n1.fbm(i * 0.37, i * 0.11); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
  })
})
