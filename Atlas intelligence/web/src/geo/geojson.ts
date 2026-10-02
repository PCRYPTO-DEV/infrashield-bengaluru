/**
 * Minimal GeoJSON geometry types (RFC 7946). Defined locally to avoid a
 * dependency purely for types. Coordinates are [longitude, latitude].
 */
export type Position = [number, number] | [number, number, number]

export interface Point { type: 'Point'; coordinates: Position }
export interface MultiPoint { type: 'MultiPoint'; coordinates: Position[] }
export interface LineString { type: 'LineString'; coordinates: Position[] }
export interface MultiLineString { type: 'MultiLineString'; coordinates: Position[][] }
export interface Polygon { type: 'Polygon'; coordinates: Position[][] }
export interface MultiPolygon { type: 'MultiPolygon'; coordinates: Position[][][] }
export interface GeometryCollection { type: 'GeometryCollection'; geometries: Geometry[] }

export type Geometry =
  | Point
  | MultiPoint
  | LineString
  | MultiLineString
  | Polygon
  | MultiPolygon
  | GeometryCollection

export interface Feature<G extends Geometry = Geometry, P = Record<string, unknown>> {
  type: 'Feature'
  id?: string | number
  geometry: G
  properties: P | null
}

export interface FeatureCollection<G extends Geometry = Geometry, P = Record<string, unknown>> {
  type: 'FeatureCollection'
  features: Feature<G, P>[]
}

const GEOMETRY_TYPES = new Set([
  'Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection',
])

export function isGeometry(value: unknown): value is Geometry {
  if (!value || typeof value !== 'object') return false
  const g = value as { type?: unknown; coordinates?: unknown; geometries?: unknown }
  if (typeof g.type !== 'string' || !GEOMETRY_TYPES.has(g.type)) return false
  if (g.type === 'GeometryCollection') return Array.isArray(g.geometries) && g.geometries.every(isGeometry)
  return Array.isArray(g.coordinates)
}
