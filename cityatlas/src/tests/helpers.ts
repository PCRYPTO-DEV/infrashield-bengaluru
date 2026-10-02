import { createFrame } from '../geo/projection/frame'
import { generateChunk } from '../engine/procedural/generateChunk'
import type { ChunkData, ChunkRequest } from '../engine/world/chunkTypes'
import { DATASET_VERSION } from '../engine/seed/worldSeed'
import type { ChunkSource } from '../engine/chunks/CityChunkManager'
import { tileKey, worldToTile } from '../geo/tiles/tiles'
import { lngLatToWorld } from '../geo/projection/mercator'

export const BENGALURU = { lng: 77.6101, lat: 12.9719 }
export const FRAME = createFrame(BENGALURU)

export function chunkAt(dx = 0, dy = 0, seed = 'test-seed', hourBucket = 0): ChunkData {
  const base = worldToTile(lngLatToWorld(BENGALURU))
  const key = tileKey({ z: base.z, x: base.x + dx, y: base.y + dy })
  return generateChunk({ key, globalSeed: seed, datasetVersion: DATASET_VERSION, hourBucket, frame: FRAME })
}

export function baseTileKey(): string {
  return tileKey(worldToTile(lngLatToWorld(BENGALURU)))
}

export function syncSource(log: string[] = []): ChunkSource {
  return {
    generate: (req: ChunkRequest, signal: AbortSignal) =>
      new Promise<ChunkData>((resolve, reject) => {
        log.push(req.key)
        setTimeout(() => {
          if (signal.aborted) reject(new DOMException('aborted', 'AbortError'))
          else resolve(generateChunk(req))
        }, 1)
      }),
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function whenIdle(m: { inFlight: number }, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (m.inFlight > 0) {
    if (Date.now() - start > timeoutMs) throw new Error('chunk manager did not go idle')
    await sleep(5)
  }
}
