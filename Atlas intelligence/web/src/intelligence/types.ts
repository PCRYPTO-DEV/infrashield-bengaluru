import type { RoadGraph } from '../engine/simulation/roadGraph'
import type { WorldModel } from '../engine/world/WorldModel'
import type { EvidenceMetadata } from '../entities/types'
import type { WorldPoint } from '../geo/projection/mercator'

export interface IntelligenceContext {
  time: number
  graph: RoadGraph
  world: WorldModel
  unitPerMetre: number
  /** Previous outputs, for temporal reasoning. */
  history: IntelligenceHistory
}

export interface IntelligenceModule<I, O> {
  id: string
  process(input: I, context: IntelligenceContext): Promise<O>
}

export type CongestionLevel = 'free' | 'slow' | 'congested' | 'jammed'

export interface EdgeFlow {
  edgeId: string
  count: number
  meanSpeed: number
  /** meanSpeed / speedLimit, 0..1+ */
  speedRatio: number
  /** 0 = free flow, 1 = standstill */
  congestion: number
  level: CongestionLevel
  /** where the speed came from */
  source: 'simulation' | 'tomtom' | string
  observed: boolean
}

export interface FlowReport {
  time: number
  edges: Map<string, EdgeFlow>
  meanSpeedRatio: number
  congestedShare: number
  vehicleCount: number
  /** edges carrying an observed level this pass */
  observedEdges: number
  evidence: EvidenceMetadata
}

export interface DensityCell { key: string; x: number; y: number; vehicles: number; pedestrians: number; density: number }
export interface DensityField {
  time: number
  cellSize: number
  cells: Map<string, DensityCell>
  max: number
  evidence: EvidenceMetadata
}

export interface ActivityHotspot { x: number; y: number; score: number; reason: string }
export interface ActivityReport {
  time: number
  cells: Map<string, { x: number; y: number; activity: number }>
  hotspots: ActivityHotspot[]
  overall: number
  evidence: EvidenceMetadata
}

export type AnomalyType =
  | 'wrong_way'
  | 'unusual_stop'
  | 'density_surge'
  | 'speed_drop'
  | 'restricted_zone_entry'
  | 'long_dwell'
  | 'flow_divergence'

export interface Anomaly {
  id: string
  type: AnomalyType
  severity: number
  confidence: number
  evidence: string[]
  explanation: string
  timestamp: number
  location: WorldPoint
  entityIds: string[]
  meta: EvidenceMetadata
}

export interface Prediction {
  agentId: number
  method: 'constant-velocity' | 'road-constrained'
  horizonS: number
  /** points at 1 s intervals */
  path: WorldPoint[]
  /** envelope radius per point */
  envelope: number[]
  confidence: number
  alternatives: Array<{ path: WorldPoint[]; probability: number }>
  evidence: EvidenceMetadata
}

export interface EdgeRisk {
  edgeId: string
  risk: number
  factors: { incident: number; congestion: number; pedestrian: number; construction: number }
}
export interface RiskReport { time: number; edges: Map<string, EdgeRisk>; hotspots: Array<{ nodeId: string; x: number; y: number; risk: number; reasons: string[] }>; evidence: EvidenceMetadata }

export interface CongestionForecast {
  time: number
  horizonsMin: number[]
  /** edgeId -> predicted congestion per horizon */
  edges: Map<string, number[]>
  confidence: number[]
  evidence: EvidenceMetadata
}

export interface IntelligenceHistory {
  flows: FlowReport[]
  densities: DensityField[]
  maxLength: number
}

export interface IntelligenceState {
  flow?: FlowReport
  density?: DensityField
  activity?: ActivityReport
  anomalies: Anomaly[]
  risk?: RiskReport
  forecast?: CongestionForecast
  predictions: Map<number, Prediction>
  lastRun: number
}
