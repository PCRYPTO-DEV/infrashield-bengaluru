/// <reference lib="webworker" />
import { handleGenerationAsync, type GenerateMessage, type InkMessage } from './handlers'

export type { GenerateMessage, ChunkMessage, ErrorMessage, InkMessage, InkReply } from './handlers'

self.onmessage = (e: MessageEvent<GenerateMessage | InkMessage>) => {
  void handleGenerationAsync(e.data).then((reply) => { if (reply) self.postMessage(reply) })
}
