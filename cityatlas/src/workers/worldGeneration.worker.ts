/// <reference lib="webworker" />
import { handleGeneration, type GenerateMessage } from './handlers'

export type { GenerateMessage, ChunkMessage, ErrorMessage } from './handlers'

self.onmessage = (e: MessageEvent<GenerateMessage>) => {
  const reply = handleGeneration(e.data)
  if (reply) self.postMessage(reply)
}
