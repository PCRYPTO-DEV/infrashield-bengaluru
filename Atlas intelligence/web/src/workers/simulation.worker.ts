/// <reference lib="webworker" />
import { createSimulationHandler, type SimCommand } from './handlers'
import { snapshotTransferables } from '../engine/simulation/snapshot'

export type { SimCommand, SimReply } from './handlers'

const handle = createSimulationHandler()

self.onmessage = (e: MessageEvent<SimCommand>) => {
  const reply = handle(e.data)
  if (reply) (self as unknown as Worker).postMessage(reply, snapshotTransferables(reply.snapshot))
}
