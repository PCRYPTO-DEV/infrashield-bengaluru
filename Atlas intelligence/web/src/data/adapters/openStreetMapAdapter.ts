import type { DataAdapter } from './DataAdapter'
import type { UrbanEntity, RoadClass } from '../../entities/types'
import type { GeoBounds } from '../../geo/coordinates/lngLat'
import type { Position } from '../../geo/geojson'

/** Subset of the Overpass JSON output we consume. */
export interface OsmElement {
  type: 'node' | 'way' | 'relation'
  id: number
  lat?: number
  lon?: number
  nodes?: number[]
  tags?: Record<string, string>
  geometry?: Array<{ lat: number; lon: number }>
}
export interface OverpassResponse { elements: OsmElement[] }

const HIGHWAY_CLASS: Record<string, RoadClass> = {
  motorway: 'arterial', trunk: 'arterial', primary: 'arterial', secondary: 'collector', tertiary: 'collector',
  residential: 'local', unclassified: 'local', living_street: 'local', service: 'service',
}
const MAXSPEED_DEFAULT: Record<RoadClass, number> = { arterial: 13.9, collector: 11.1, local: 8.3, service: 5.5 }

export function overpassQuery(b: GeoBounds): string {
  const bbox = `${b.south},${b.west},${b.north},${b.east}`
  return `[out:json][timeout:25];(way["highway"](${bbox});way["building"](${bbox});node["highway"="traffic_signals"](${bbox});node["public_transport"="station"](${bbox});way["leisure"="park"](${bbox}););out geom;`
}

/**
 * OpenStreetMap via Overpass. Observations are *observed* with the OSM
 * source; the adapter never guesses attributes it cannot read from tags
 * (unknown maxspeed falls back to a class default and says so).
 */
export class OpenStreetMapAdapter implements DataAdapter<OverpassResponse> {
  id = 'osm-overpass'
  constructor(private endpoint = 'https://overpass-api.de/api/interpreter') {}
  async connect(): Promise<void> {}
  async fetch(bounds: GeoBounds): Promise<OverpassResponse> {
    const r = await fetch(this.endpoint, { method: 'POST', body: `data=${encodeURIComponent(overpassQuery(bounds))}`, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    if (!r.ok) throw new Error(`Overpass ${r.status}`)
    return (await r.json()) as OverpassResponse
  }
  normalize(data: OverpassResponse): UrbanEntity[] { return normalizeOsm(data) }
}

export function normalizeOsm(data: OverpassResponse, fetchedAt = Date.now()): UrbanEntity[] {
  const out: UrbanEntity[] = []
  const ev = (confidence = 0.9) => ({ classification: 'observed' as const, source: 'openstreetmap', timestamp: fetchedAt, confidence })
  for (const el of data.elements) {
    const tags = el.tags ?? {}
    if (el.type === 'node' && el.lat !== undefined && el.lon !== undefined) {
      const geometry = { type: 'Point' as const, coordinates: [el.lon, el.lat] as Position }
      if (tags.highway === 'traffic_signals') out.push({ id: `osm:n${el.id}`, type: 'traffic_signal', geometry, properties: { nodeId: `osm:n${el.id}`, cycleSeconds: 0, offsetSeconds: 0, greenNorthSouthSeconds: 0, osm: tags }, evidence: ev() })
      else if (tags.public_transport === 'station' || tags.railway === 'station') out.push({ id: `osm:n${el.id}`, type: 'transit', geometry, properties: { name: tags.name ?? 'Station', mode: tags.station === 'subway' || tags.subway === 'yes' ? 'metro' : tags.railway ? 'rail' : 'bus', osm: tags }, evidence: ev() })
      continue
    }
    if (el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      const coords = el.geometry.map((g) => [g.lon, g.lat] as Position)
      if (tags.highway) {
        const roadClass = HIGHWAY_CLASS[tags.highway] ?? 'local'
        const ms = parseMaxspeed(tags.maxspeed)
        out.push({ id: `osm:w${el.id}`, type: 'road', geometry: { type: 'LineString', coordinates: coords }, properties: { name: tags.name ?? tags.highway, roadClass, lanes: parseInt(tags.lanes ?? '', 10) || (roadClass === 'arterial' ? 2 : 1), oneway: tags.oneway === 'yes', speedLimit: ms ?? MAXSPEED_DEFAULT[roadClass], speedLimitSource: ms ? 'osm:maxspeed' : 'class-default', edgeIds: [], osm: tags }, evidence: ev(ms ? 0.9 : 0.75) })
      } else if (tags.building) {
        const ring = closeRing(coords)
        const levels = parseInt(tags['building:levels'] ?? '', 10)
        out.push({ id: `osm:w${el.id}`, type: 'building', geometry: { type: 'Polygon', coordinates: [ring] }, properties: { landUse: landUseFromBuilding(tags), floors: Number.isFinite(levels) ? levels : 1, heightM: parseFloat(tags.height ?? '') || (Number.isFinite(levels) ? levels * 3.2 : 3.2), footprintM2: 0, name: tags.name, floorsSource: Number.isFinite(levels) ? 'osm:building:levels' : 'assumed', osm: tags }, evidence: ev(Number.isFinite(levels) ? 0.9 : 0.7) })
      } else if (tags.leisure === 'park') {
        out.push({ id: `osm:w${el.id}`, type: 'park', geometry: { type: 'Polygon', coordinates: [closeRing(coords)] }, properties: { name: tags.name ?? 'Park', areaM2: 0, osm: tags }, evidence: ev() })
      }
    }
  }
  return out
}

function closeRing(c: Position[]): Position[] { const f = c[0], l = c[c.length - 1]; return f[0] === l[0] && f[1] === l[1] ? c : [...c, f] }
function parseMaxspeed(v?: string): number | undefined {
  if (!v) return undefined
  const m = /^(\d+(?:\.\d+)?)\s*(mph)?/.exec(v)
  if (!m) return undefined
  const n = parseFloat(m[1])
  return m[2] ? n * 0.44704 : n / 3.6
}
function landUseFromBuilding(tags: Record<string, string>): 'residential' | 'commercial' | 'office' | 'industrial' | 'civic' | 'mixed' {
  const b = tags.building
  if (b === 'office' || tags.office) return 'office'
  if (b === 'commercial' || b === 'retail' || tags.shop) return 'commercial'
  if (b === 'industrial' || b === 'warehouse') return 'industrial'
  if (b === 'school' || b === 'hospital' || b === 'public' || b === 'civic' || tags.amenity) return 'civic'
  if (b === 'apartments' || b === 'house' || b === 'residential' || b === 'yes') return 'residential'
  return 'mixed'
}
