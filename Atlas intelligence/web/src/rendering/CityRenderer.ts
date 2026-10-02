import type { WorldModel } from '../engine/world/WorldModel'
import type { IntelligenceState } from '../intelligence/types'
import type { MonitoringZone } from '../zones/types'
import type { Camera } from '../interaction/camera/Camera'
import type { Lod } from './lod'
import type { LayerFlags, ViewMode } from './layers/modes'
import type { TemporalState } from '../engine/simulation/temporalEngine'
import type { WorldPoint } from '../geo/projection/mercator'
import type { RouteResult } from '../intelligence/routing/saferRouter'
import type { Selection } from '../interaction/selection/hitTest'
import type { DrawState } from '../interaction/drawing/ZoneDrawTool'

export interface WorldState {
  /** world time to render at (ms) */
  time: number
  /** real-time clock for animation easing (ms) */
  wallClock: number
  temporal: TemporalState
  camera: Camera
  lod: Lod
  mode: ViewMode
  layers: LayerFlags
  world: WorldModel
  intel: IntelligenceState
  zones: MonitoringZone[]
  selection: Selection | null
  highlights: { points: WorldPoint[]; entityIds: string[]; agentIds: number[]; rings?: WorldPoint[][]; pins?: Array<{ point: WorldPoint; label: string }> }
  /** people's crime reports in view (pink markers) */
  reports?: WorldPoint[]
  route: RouteResult | null
  routePick: WorldPoint[]
  drawing: DrawState | null
  hover: Selection | null
}

export interface CityRenderer {
  render(state: WorldState): void
  resize(width: number, height: number): void
  dispose(): void
}
