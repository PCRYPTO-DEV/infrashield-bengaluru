/// <reference lib="webworker" />
import { MovementEngine } from '../engine/simulation/movementEngine'
import type { SimChunkPayload } from '../engine/simulation/roadGraph'
import { snapshotTransferables, type SimSnapshot } from '../engine/simulation/snapshot'

export type SimCommand =
  | { type: 'init'; globalSeed: string; unitPerMetre: number; time: number }
  | { type: 'addChunk'; payload: SimChunkPayload }
  | { type: 'removeChunk'; key: string }
  | { type: 'reset'; time: number }
  | { type: 'tick'; time: number }

export interface SimReply { type: 'snapshot'; snapshot: SimSnapshot; stats: { agents: number; edges: number; stepMs: number; lagS: number } }

let engine: MovementEngine | null = null

self.onmessage = (e: MessageEvent<SimCommand>) => {
  const m = e.data
  switch (m.type) {
    case 'init':
      engine = new MovementEngine({ globalSeed: m.globalSeed, unitPerMetre: m.unitPerMetre })
      engine.reset(m.time)
      break
    case 'addChunk': engine?.addChunk(m.payload); break
    case 'removeChunk': engine?.removeChunk(m.key); break
    case 'reset': engine?.reset(m.time); break
    case 'tick': {
      if (!engine) return
      const t0 = performance.now()
      engine.advanceTo(m.time)
      const snapshot = engine.snapshot()
      const reply: SimReply = { type: 'snapshot', snapshot, stats: { agents: engine.agentCount, edges: engine.graph.edgeCount, stepMs: performance.now() - t0, lagS: engine.lag(m.time) } }
      ;(self as unknown as Worker).postMessage(reply, snapshotTransferables(snapshot))
      break
    }
  }
}
