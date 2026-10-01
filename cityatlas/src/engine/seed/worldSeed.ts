import { hashMix } from './hash'
import { PRNG } from './prng'

export const DATASET_VERSION = '2026.10-synthetic-1'

export interface WorldSeedInput {
  globalSeed: string
  tileId: string
  /** Simulation time bucket (e.g. hour index) for time-varying generation. */
  simulationTime?: number
  datasetVersion?: string
  /** Optional sub-stream label (e.g. 'roads', 'buildings'). */
  stream?: string
}

/**
 * WorldSeed = hash(globalSeed + tileID + simulationTime + datasetVersion).
 * Every procedural generator must obtain its PRNG through here.
 */
export function worldSeed(input: WorldSeedInput): number {
  return hashMix(
    input.globalSeed,
    input.tileId,
    input.simulationTime ?? 0,
    input.datasetVersion ?? DATASET_VERSION,
    input.stream ?? '',
  )
}

export function worldPRNG(input: WorldSeedInput): PRNG {
  return new PRNG(worldSeed(input))
}

/** Parse `cityatlas://world/{seed}` or a bare seed string. */
export function parseWorldUri(value: string): { seed: string } | null {
  const m = /^cityatlas:\/\/world\/([^/?#]+)/.exec(value.trim())
  if (m) return { seed: decodeURIComponent(m[1]) }
  if (value.trim().length > 0) return { seed: value.trim() }
  return null
}

export function formatWorldUri(seed: string): string {
  return `cityatlas://world/${encodeURIComponent(seed)}`
}
