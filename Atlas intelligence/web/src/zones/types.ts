import type { WorldPoint } from '../geo/projection/mercator'

export type ZoneShape =
  | { kind: 'polygon'; points: WorldPoint[] }
  | { kind: 'line'; points: WorldPoint[] }
  | { kind: 'radius'; centre: WorldPoint; radius: number }
  | { kind: 'corridor'; points: WorldPoint[]; width: number }

export type ZoneRuleType = 'entry' | 'exit' | 'dwell' | 'count' | 'direction' | 'speed' | 'density'

export interface ZoneRule {
  type: ZoneRuleType
  /** rule-specific threshold: seconds for dwell, count for count, m/s for speed, agents/ha for density */
  threshold?: number
  /** which kinds the rule applies to */
  kinds?: Array<'vehicle' | 'pedestrian'>
}

export interface MonitoringZone {
  id: string
  name: string
  shape: ZoneShape
  /** resolved polygon ring in local units (lines/corridors/radii are buffered) */
  ring: WorldPoint[]
  rules: ZoneRule[]
  restricted: boolean
  createdAt: number
}

export interface ZoneEvent {
  id: string
  zoneId: string
  type: ZoneRuleType
  agentId: number
  kind: 'vehicle' | 'pedestrian'
  timestamp: number
  value?: number
  description: string
}

export interface ZoneStats {
  zoneId: string
  time: number
  count: { vehicle: number; pedestrian: number }
  meanSpeed: number
  /** agents per hectare */
  density: number
  /** heading histogram, 8 bins starting east, clockwise */
  direction: number[]
  longestDwellS: number
}
