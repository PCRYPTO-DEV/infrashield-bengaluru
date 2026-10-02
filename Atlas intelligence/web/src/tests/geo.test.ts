import { describe, it, expect } from 'vitest'
import { lngLatToWorld, worldToLngLat, pixelsPerWorldUnit, zoomForPixelsPerWorldUnit } from '../geo/projection/mercator'
import { createFrame, lngLatToLocal, localToLngLat } from '../geo/projection/frame'
import { tileBounds, tileKey, parseTileKey, tilesInBounds, worldToTile, CHUNK_ZOOM } from '../geo/tiles/tiles'
import { haversineM } from '../geo/coordinates/lngLat'
import { GridIndex } from '../geo/spatial-index/gridIndex'
import { pointInPolygon, pointAlong, polylineLength, pointToSegment } from '../geo/geometry'

describe('coordinate conversion', () => {
  it('round-trips lng/lat through Mercator', () => {
    for (const p of [{ lng: 77.6, lat: 12.97 }, { lng: -0.12, lat: 51.5 }, { lng: 139.7, lat: -35.6 }]) {
      const back = worldToLngLat(lngLatToWorld(p))
      expect(back.lng).toBeCloseTo(p.lng, 9)
      expect(back.lat).toBeCloseTo(p.lat, 9)
    }
  })
  it('north is negative y, east is positive x', () => {
    const a = lngLatToWorld({ lng: 77, lat: 12 }), b = lngLatToWorld({ lng: 78, lat: 13 })
    expect(b.x).toBeGreaterThan(a.x)
    expect(b.y).toBeLessThan(a.y)
  })
  it('local frame round-trips and ground scale matches haversine', () => {
    const f = createFrame({ lng: 77.61, lat: 12.97 })
    const p = { lng: 77.62, lat: 12.98 }
    const l = lngLatToLocal(f, p)
    const back = localToLngLat(f, l)
    expect(back.lng).toBeCloseTo(p.lng, 9)
    expect(back.lat).toBeCloseTo(p.lat, 9)
    const east = lngLatToLocal(f, { lng: 77.62, lat: 12.97 })
    const ground = haversineM({ lng: 77.61, lat: 12.97 }, { lng: 77.62, lat: 12.97 })
    expect(east.x * f.groundScale).toBeCloseTo(ground, -1)
  })
  it('zoom <-> pixels per unit', () => {
    expect(zoomForPixelsPerWorldUnit(pixelsPerWorldUnit(16))).toBeCloseTo(16, 9)
  })
})

describe('tiles', () => {
  it('tile keys round trip and bounds contain the point', () => {
    const w = lngLatToWorld({ lng: 77.61, lat: 12.97 })
    const t = worldToTile(w)
    expect(parseTileKey(tileKey(t))).toEqual(t)
    const b = tileBounds(t)
    expect(w.x).toBeGreaterThanOrEqual(b.minX); expect(w.x).toBeLessThan(b.maxX)
    expect(w.y).toBeGreaterThanOrEqual(b.minY); expect(w.y).toBeLessThan(b.maxY)
    expect(t.z).toBe(CHUNK_ZOOM)
  })
  it('tilesInBounds covers the bounds with padding', () => {
    const w = lngLatToWorld({ lng: 77.61, lat: 12.97 })
    const tiles = tilesInBounds({ minX: w.x - 10, minY: w.y - 10, maxX: w.x + 10, maxY: w.y + 10 }, CHUNK_ZOOM, 1)
    expect(tiles.length).toBeGreaterThanOrEqual(9)
  })
})

describe('spatial index and geometry', () => {
  it('grid index inserts, queries and removes', () => {
    const idx = new GridIndex<string>(50)
    idx.insert('a', { minX: 0, minY: 0, maxX: 10, maxY: 10 })
    idx.insert('b', { minX: 200, minY: 200, maxX: 210, maxY: 210 })
    expect(idx.query({ minX: -5, minY: -5, maxX: 5, maxY: 5 })).toEqual(['a'])
    expect(idx.queryPoint({ x: 205, y: 205 })).toEqual(['b'])
    idx.remove('a')
    expect(idx.query({ minX: -5, minY: -5, maxX: 5, maxY: 5 })).toEqual([])
  })
  it('polygon and polyline helpers', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true)
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false)
    const line = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]
    expect(polylineLength(line)).toBe(20)
    expect(pointAlong(line, 0.75)).toEqual({ x: 10, y: 5 })
    expect(pointToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }).d).toBe(3)
  })
})
