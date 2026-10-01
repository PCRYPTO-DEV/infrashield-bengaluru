import type { Geometry } from '../geo/geojson'

/**
 * Evidence classification is the backbone of CITYATLAS. Nothing is rendered
 * without one, and renderers style by classification, never by source.
 *
 *  observed  — directly supported by observed data (OSM, sensor, camera, feed)
 *  derived   — calculated from observations (density, congestion estimate)
 *  predicted — what the system believes may happen (paths, forecasts)
 *  simulated — generated content with no observational backing
 */
export type EvidenceClassification = 'observed' | 'derived' | 'predicted' | 'simulated'

export interface EvidenceMetadata {
  classification: EvidenceClassification
  source?: string
  timestamp?: number
  confidence?: number
  model?: string
  /** Version of the dataset / generator that produced this object. */
  datasetVersion?: string
}

export type UrbanEntityType =
  | 'building'
  | 'road'
  | 'intersection'
  | 'vehicle'
  | 'pedestrian'
  | 'traffic_signal'
  | 'incident'
  | 'camera'
  | 'zone'
  | 'transit'
  | 'infrastructure'
  | 'park'
  | 'construction'

export interface UrbanEntity<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string
  type: UrbanEntityType
  geometry: Geometry
  properties: P
  timestamp?: number
  evidence: EvidenceMetadata
}

export type RoadClass = 'arterial' | 'collector' | 'local' | 'service'

export interface RoadProperties extends Record<string, unknown> {
  name: string
  roadClass: RoadClass
  lanes: number
  oneway: boolean
  /** Nominal free-flow speed, m/s. Used as a baseline for anomaly detection. */
  speedLimit: number
  /** Graph edge ids this road contributes (one road may be several edges). */
  edgeIds: string[]
}

export type LandUse = 'residential' | 'commercial' | 'office' | 'industrial' | 'civic' | 'mixed'

export interface BuildingProperties extends Record<string, unknown> {
  landUse: LandUse
  floors: number
  heightM: number
  footprintM2: number
  name?: string
}

export interface IntersectionProperties extends Record<string, unknown> {
  nodeId: string
  degree: number
  signalised: boolean
}

export interface TrafficSignalProperties extends Record<string, unknown> {
  nodeId: string
  cycleSeconds: number
  /** Offset in seconds into the cycle at t=0, so phases are deterministic. */
  offsetSeconds: number
  greenNorthSouthSeconds: number
}

export type IncidentKind = 'collision' | 'breakdown' | 'roadworks' | 'flooding' | 'crowd' | 'closure'

export interface IncidentProperties extends Record<string, unknown> {
  kind: IncidentKind
  severity: number
  startTime: number
  endTime: number
  edgeId: string
  description: string
}

export interface ParkProperties extends Record<string, unknown> {
  name: string
  areaM2: number
}

export interface ConstructionProperties extends Record<string, unknown> {
  name: string
  startTime: number
  endTime: number
  laneReduction: number
}

export interface TransitProperties extends Record<string, unknown> {
  name: string
  mode: 'metro' | 'bus' | 'rail'
}

export interface ZoneProperties extends Record<string, unknown> {
  name: string
  restricted: boolean
}

export type MovingKind = 'vehicle' | 'pedestrian'

/**
 * Agents are the moving population. Positions are in world units
 * (Web Mercator metres), not lng/lat, because they are updated at 60 Hz.
 */
export interface MovingEntityState {
  id: number
  kind: MovingKind
  x: number
  y: number
  /** metres per second */
  speed: number
  /** radians, 0 = +x (east), increasing clockwise in screen space (y down) */
  heading: number
  acceleration: number
  edgeId: string
  /** 0..1 along the current edge */
  t: number
  stoppedSince: number
  evidence: EvidenceMetadata
}
