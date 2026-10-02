import type { UrbanEntity } from '../../entities/types'
import type { GeoBounds } from '../../geo/coordinates/lngLat'

export interface TimeRange { from: number; to: number }

/**
 * Every data source implements this. `fetch` returns the source's native
 * payload; `normalize` turns it into canonical UrbanEntities. Keeping the
 * two apart makes normalisation testable offline with fixtures.
 */
export interface DataAdapter<T> {
  id: string
  connect(): Promise<void>
  fetch(bounds: GeoBounds, time?: TimeRange): Promise<T>
  normalize(data: T): UrbanEntity[]
  disconnect?(): Promise<void>
}
