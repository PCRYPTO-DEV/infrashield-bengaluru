import type { DataAdapter } from './DataAdapter'
import type { UrbanEntity } from '../../entities/types'
import type { GeoBounds } from '../../geo/coordinates/lngLat'
import type { ChunkData } from '../../engine/world/chunkTypes'
import { generateChunk } from '../../engine/procedural/generateChunk'
import { lngLatToWorld } from '../../geo/projection/mercator'
import { tilesInBounds, tileKey, CHUNK_ZOOM } from '../../geo/tiles/tiles'
import type { WorldFrame } from '../../geo/projection/frame'

/** The procedural engine exposed through the same adapter interface as real sources. */
export class SyntheticDataAdapter implements DataAdapter<ChunkData[]> {
  id = 'synthetic'
  constructor(private frame: WorldFrame, private globalSeed: string, private datasetVersion: string, private hourBucket = 0) {}
  async connect(): Promise<void> {}
  async fetch(bounds: GeoBounds): Promise<ChunkData[]> {
    const a = lngLatToWorld({ lng: bounds.west, lat: bounds.north }), b = lngLatToWorld({ lng: bounds.east, lat: bounds.south })
    return tilesInBounds({ minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }, CHUNK_ZOOM).map((t) => generateChunk({ key: tileKey(t), globalSeed: this.globalSeed, datasetVersion: this.datasetVersion, hourBucket: this.hourBucket, frame: this.frame }))
  }
  normalize(data: ChunkData[]): UrbanEntity[] { return data.flatMap((c) => c.entities) }
}
