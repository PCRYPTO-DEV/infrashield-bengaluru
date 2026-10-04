import type { UrbanEntity } from '../../entities/types'
import type { WorldBounds } from '../../geo/projection/mercator'
import type { RoadClass, LandUse, TrafficSignalProperties } from '../../entities/types'

/** Road graph in local world coordinates. Shared by simulation and routing. */
export interface GraphNode { id: string; x: number; y: number; signal: boolean }
export interface GraphEdge {
  id: string
  from: string
  to: string
  roadId: string
  roadClass: RoadClass
  lanes: number
  oneway: boolean
  /** free-flow speed in local units per second */
  speedLimit: number
  length: number
  /** 'ns' or 'ew' — which signal phase governs entry at the `to` node */
  axis: 'ns' | 'ew'
}
export interface RoadGraphData { nodes: GraphNode[]; edges: GraphEdge[]; signals: TrafficSignalProperties[] }

/** Flat, renderer-friendly geometry (local coordinates). */
export interface RenderRoad { id: string; roadClass: RoadClass; pts: number[]; width: number; name: string }
export interface RenderBuilding { id: string; ring: number[]; floors: number; landUse: LandUse }
export interface RenderPark { id: string; ring: number[]; kind?: string; name?: string }
export interface RenderSignal { id: string; x: number; y: number }
export interface RenderPoint { id: string; x: number; y: number; label: string }
export interface RenderBlock { ring: number[]; density: number; use: LandUse | 'park' | 'construction' | 'transit' }

export interface RenderChunk {
  roads: RenderRoad[]
  buildings: RenderBuilding[]
  parks: RenderPark[]
  signals: RenderSignal[]
  transit: RenderPoint[]
  /** named areas inside the chunk (sectors, colonies, neighbourhoods) for quiet labels */
  areas?: Array<{ id: string; x: number; y: number; label: string }>
  construction: RenderPark[]
  blocks: RenderBlock[]
  /** Mapped trees (OSM natural=tree); absent for procedural chunks. */
  trees?: RenderPoint[]
}

export interface ChunkMeta {
  /** 0..1 urban density from the city-scale noise field */
  density: number
  /** suggested vehicle population for the simulation */
  vehicleBudget: number
  pedestrianBudget: number
  districtName: string
}

export interface ChunkData {
  key: string
  bounds: WorldBounds
  /** canonical entities, geometry in lng/lat */
  entities: UrbanEntity[]
  graph: RoadGraphData
  render: RenderChunk
  meta: ChunkMeta
  /** pre-built SVG strings per LOD, in local coordinates; `ink` (the LN hidden-line 3D tier) is built on demand */
  svg: { city: string; neighbourhood: string; street: string; ink?: string }
  generatedAt: number
  seed: number
}

export interface ChunkRequest {
  key: string
  globalSeed: string
  datasetVersion: string
  /** Hour bucket of simulation time (for time-dependent content like incidents). */
  hourBucket: number
  frame: { originX: number; originY: number; groundScale: number; referenceLat: number }
}
