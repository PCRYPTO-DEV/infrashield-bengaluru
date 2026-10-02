import { generateChunk } from '../engine/procedural/generateChunk'
import { generateDistrict } from '../engine/procedural/generateDistrict'
import { MovementEngine } from '../engine/simulation/movementEngine'
import type { ChunkRequest } from '../engine/world/chunkTypes'
import type { SimChunkPayload } from '../engine/simulation/roadGraph'
import type { SimSnapshot } from '../engine/simulation/snapshot'

/**
 * Message handlers shared by the real workers and the in-thread fallback.
 * Keeping the logic here means a host that refuses workers still gets the
 * identical, deterministic engine, only on the main thread.
 */

export interface GenerateMessage { type: 'generate'; id: number; req: ChunkRequest; tier?: 'street' | 'district' }
export interface ChunkMessage { type: 'chunk'; id: number; chunk: ReturnType<typeof generateChunk> }
export interface ErrorMessage { type: 'error'; id: number; message: string }

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

export type SimCommand =
  | { type: 'init'; globalSeed: string; unitPerMetre: number; time: number }
  | { type: 'addChunk'; payload: SimChunkPayload }
  | { type: 'removeChunk'; key: string }
  | { type: 'reset'; time: number }
  | { type: 'tick'; time: number }

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
