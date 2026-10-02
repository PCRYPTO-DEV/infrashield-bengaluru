import { EARTH_CIRCUMFERENCE_M, HALF_WORLD, type WorldBounds, type WorldPoint } from '../projection/mercator'

/**
 * Chunks are Web Mercator XYZ tiles at a fixed zoom. Tile ids are stable
 * strings used as part of the world seed, so the same tile always
 * regenerates identically for a given global seed.
 */
export interface TileId { z: number; x: number; y: number }

export const CHUNK_ZOOM = 16

export function tileKey(t: TileId): string {
  return `${t.z}/${t.x}/${t.y}`
}

export function parseTileKey(key: string): TileId {
  const [z, x, y] = key.split('/').map(Number)
  return { z, x, y }
}

export function tileSizeWorld(z: number): number {
  return EARTH_CIRCUMFERENCE_M / Math.pow(2, z)
}

export function worldToTile(p: WorldPoint, z = CHUNK_ZOOM): TileId {
  const size = tileSizeWorld(z)
  return {
    z,
    x: Math.floor((p.x + HALF_WORLD) / size),
    y: Math.floor((p.y + HALF_WORLD) / size),
  }
}

export function tileBounds(t: TileId): WorldBounds {
  const size = tileSizeWorld(t.z)
  const minX = t.x * size - HALF_WORLD
  const minY = t.y * size - HALF_WORLD
  return { minX, minY, maxX: minX + size, maxY: minY + size }
}

export function tileCenter(t: TileId): WorldPoint {
  const b = tileBounds(t)
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
}

/** All tiles intersecting a world bounds, optionally padded by N tiles. */
export function tilesInBounds(b: WorldBounds, z = CHUNK_ZOOM, pad = 0): TileId[] {
  const min = worldToTile({ x: b.minX, y: b.minY }, z)
  const max = worldToTile({ x: b.maxX, y: b.maxY }, z)
  const out: TileId[] = []
  const limit = Math.pow(2, z)
  for (let y = min.y - pad; y <= max.y + pad; y++) {
    if (y < 0 || y >= limit) continue
    for (let x = min.x - pad; x <= max.x + pad; x++) {
      if (x < 0 || x >= limit) continue
      out.push({ z, x, y })
    }
  }
  return out
}
