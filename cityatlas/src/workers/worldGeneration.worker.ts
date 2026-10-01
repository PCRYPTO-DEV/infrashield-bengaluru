/// <reference lib="webworker" />
import { generateChunk } from '../engine/procedural/generateChunk'
import { generateDistrict } from '../engine/procedural/generateDistrict'
import type { ChunkRequest } from '../engine/world/chunkTypes'

export interface GenerateMessage { type: 'generate'; id: number; req: ChunkRequest; tier?: 'street' | 'district' }
export interface ChunkMessage { type: 'chunk'; id: number; chunk: ReturnType<typeof generateChunk> }
export interface ErrorMessage { type: 'error'; id: number; message: string }

self.onmessage = (e: MessageEvent<GenerateMessage>) => {
  const m = e.data
  if (m.type !== 'generate') return
  try {
    const chunk = m.tier === 'district' ? generateDistrict(m.req) : generateChunk(m.req)
    chunk.generatedAt = Date.now()
    const out: ChunkMessage = { type: 'chunk', id: m.id, chunk }
    self.postMessage(out)
  } catch (err) {
    const out: ErrorMessage = { type: 'error', id: m.id, message: (err as Error).message }
    self.postMessage(out)
  }
}
