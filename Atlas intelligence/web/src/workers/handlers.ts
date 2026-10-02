import { generateChunk } from '../engine/procedural/generateChunk'
import { generateDistrict } from '../engine/procedural/generateDistrict'
import { MovementEngine } from '../engine/simulation/movementEngine'
import type { ChunkRequest } from '../engine/world/chunkTypes'
import type { SimChunkPayload } from '../engine/simulation/roadGraph'
import type { SimSnapshot } from '../engine/simulation/snapshot'
import { buildOsmChunk, buildOsmDistrict, type OsmTile } from '../data/sources/osmChunk'
import { buildInkSvg } from '../rendering/svg/inkSvg'
import type { RenderChunk } from '../engine/world/chunkTypes'

/**
 * Message handlers shared by the real workers and the in-thread fallback.
 * Keeping the logic here means a host that refuses workers still gets the
 * identical, deterministic engine, only on the main thread.
 */

export type GenerationTier = 'street' | 'district' | 'osm' | 'osm-district'
export interface GenerateMessage { type: 'generate'; id: number; req: ChunkRequest; tier?: GenerationTier; baseUrl?: string }
export interface ChunkMessage { type: 'chunk'; id: number; chunk: ReturnType<typeof generateChunk> }
export interface ErrorMessage { type: 'error'; id: number; message: string }
/** Ink 3D tier for a chunk already on the main thread: ln hidden-line render + Shan Shui strokes. */
export interface InkMessage { type: 'ink'; id: number; key: string; render: RenderChunk; unitPerMetre: number }
export interface InkReply { type: 'inkDone'; id: number; key: string; svg: string }

export function handleGeneration(m: GenerateMessage): ChunkMessage | ErrorMessage | null {
  if (m.type !== 'generate') return null
  try {
    const chunk = m.tier === 'district' ? generateDistrict(m.req) : generateChunk(m.req)
    chunk.generatedAt = Date.now()
    return { type: 'chunk', id: m.id, chunk }
  } catch (err) {
    return { type: 'error', id: m.id, message: (err as Error).message }
  }
}

/** Real-geography tiers fetch from the Atlas server; the message also works in the in-thread fallback. */
export async function handleGenerationAsync(m: GenerateMessage | InkMessage): Promise<ChunkMessage | ErrorMessage | InkReply | null> {
  if (m.type === 'ink') {
    try { return { type: 'inkDone', id: m.id, key: m.key, svg: buildInkSvg(m.key, m.render, m.unitPerMetre) } }
    catch (err) { return { type: 'error', id: m.id, message: `ink ${m.key}: ${(err as Error).message}` } }
  }
  if (m.type !== 'generate') return null
  if (m.tier !== 'osm' && m.tier !== 'osm-district') return handleGeneration(m)
  try {
    const district = m.tier === 'osm-district'
    const url = `${m.baseUrl ?? ''}/api/tiles/osm/${m.req.key}.json?tier=${district ? 'district' : 'street'}`
    const r = await fetch(url)
    if (!r.ok) return { type: 'error', id: m.id, message: `osm tile ${m.req.key}: HTTP ${r.status}` }
    const tile = (await r.json()) as OsmTile
    const chunk = district ? buildOsmDistrict(m.req, tile) : buildOsmChunk(m.req, tile)
    return { type: 'chunk', id: m.id, chunk }
  } catch (err) {
    return { type: 'error', id: m.id, message: `osm tile ${m.req.key}: ${(err as Error).message}` }
  }
}

export type SimCommand =
  | { type: 'init'; globalSeed: string; unitPerMetre: number; time: number }
  | { type: 'addChunk'; payload: SimChunkPayload }
  | { type: 'removeChunk'; key: string }
  | { type: 'reset'; time: number }
  | { type: 'tick'; time: number }
  | { type: 'observedFlow'; levels: Array<[string, number]> }
  | { type: 'liveIncidents'; incidents: Array<{ id: string; props: import('../entities/types').IncidentProperties }> }

export interface SimReply { type: 'snapshot'; snapshot: SimSnapshot; stats: { agents: number; edges: number; stepMs: number; lagS: number } }

/** Stateful simulation handler: one per worker (or per in-thread fallback). */
export function createSimulationHandler(): (m: SimCommand) => SimReply | null {
  let engine: MovementEngine | null = null
  return (m) => {
    switch (m.type) {
      case 'init':
        engine = new MovementEngine({ globalSeed: m.globalSeed, unitPerMetre: m.unitPerMetre })
        engine.reset(m.time)
        return null
      case 'addChunk': engine?.addChunk(m.payload); return null
      case 'removeChunk': engine?.removeChunk(m.key); return null
      case 'reset': engine?.reset(m.time); return null
      case 'observedFlow': engine?.graph.setObservedLevels(m.levels); return null
      case 'liveIncidents': engine?.graph.setLiveIncidents(m.incidents); return null
      case 'tick': {
        if (!engine) return null
        const t0 = performance.now()
        engine.advanceTo(m.time)
        const snapshot = engine.snapshot()
        return { type: 'snapshot', snapshot, stats: { agents: engine.agentCount, edges: engine.graph.edgeCount, stepMs: performance.now() - t0, lagS: engine.lag(m.time) } }
      }
    }
  }
}
