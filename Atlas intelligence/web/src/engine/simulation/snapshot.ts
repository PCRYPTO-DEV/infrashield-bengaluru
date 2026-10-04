/**
 * Simulation snapshot: the only thing that crosses from the simulation
 * worker to the main thread per tick. Numeric columns are typed arrays so
 * they can be transferred rather than copied.
 */
export interface SimSnapshot {
  /** world time, epoch ms */
  time: number
  count: number
  ids: Int32Array
  /** 0 = vehicle, 1 = pedestrian */
  kinds: Uint8Array
  xs: Float32Array
  ys: Float32Array
  headings: Float32Array
  /** local units per second */
  speeds: Float32Array
  edgeIds: string[]
  /** [edgeId, vehicleCount, meanSpeed] */
  edgeStats: Array<[string, number, number]>
  /** 'simulated' always for the procedural engine; a real feed would say 'observed' */
  classification: 'simulated' | 'observed'
}

export function snapshotTransferables(s: SimSnapshot): Transferable[] {
  return [s.ids.buffer, s.kinds.buffer, s.xs.buffer, s.ys.buffer, s.headings.buffer, s.speeds.buffer] as Transferable[]
}

export function emptySnapshot(time: number): SimSnapshot {
  return { time, count: 0, ids: new Int32Array(0), kinds: new Uint8Array(0), xs: new Float32Array(0), ys: new Float32Array(0), headings: new Float32Array(0), speeds: new Float32Array(0), edgeIds: [], edgeStats: [], classification: 'simulated' }
}
