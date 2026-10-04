import type { DataAdapter } from './DataAdapter'
import type { Feature, FeatureCollection } from '../../geo/geojson'
import type { UrbanEntity, UrbanEntityType, EvidenceClassification } from '../../entities/types'
import { validateGeoJSON } from '../schemas/validate'
import { boundsIntersect, type GeoBounds } from '../../geo/coordinates/lngLat'
import { fnv1a } from '../../engine/seed/hash'

const TYPE_HINTS: Array<[RegExp, UrbanEntityType]> = [
  [/^(building|house|tower|office|apartment)/i, 'building'],
  [/^(road|street|highway|motorway|primary|secondary|tertiary|residential)/i, 'road'],
  [/^(vehicle|car|bus|truck|bike|auto)/i, 'vehicle'],
  [/^(pedestrian|person|people)/i, 'pedestrian'],
  [/^(signal|traffic_?light|traffic_?signal)/i, 'traffic_signal'],
  [/^(incident|accident|collision|crash|event|report)/i, 'incident'],
  [/^(camera|cctv)/i, 'camera'],
  [/^(zone|area|district|ward|polygon)/i, 'zone'],
  [/^(transit|metro|station|bus_?stop|stop)/i, 'transit'],
  [/^(park|garden|green)/i, 'park'],
  [/^(construction|works)/i, 'construction'],
]

/** Guess an entity type from feature properties; falls back by geometry. */
export function inferEntityType(f: Feature): UrbanEntityType {
  const p = (f.properties ?? {}) as Record<string, unknown>
  const hint = String(p.type ?? p.kind ?? p.category ?? p.amenity ?? p.highway ?? p.building ?? '')
  for (const [re, t] of TYPE_HINTS) if (re.test(hint)) return t
  if (p.highway) return 'road'
  if (p.building) return 'building'
  switch (f.geometry.type) {
    case 'Polygon': case 'MultiPolygon': return 'zone'
    case 'LineString': case 'MultiLineString': return 'road'
    default: return 'incident'
  }
}

export interface GeoJSONAdapterOptions {
  source: string
  classification?: EvidenceClassification
  defaultType?: UrbanEntityType
}

export function featuresToEntities(fc: FeatureCollection, opts: GeoJSONAdapterOptions): UrbanEntity[] {
  const classification = opts.classification ?? 'observed'
  return fc.features.map((f, i) => {
    const p = (f.properties ?? {}) as Record<string, unknown>
    const idRaw = f.id ?? p.id ?? `${opts.source}:${i}:${fnv1a(JSON.stringify(f.geometry).slice(0, 200))}`
    const ts = p.timestamp ?? p.time ?? p.observed_at
    const timestamp = typeof ts === 'number' ? ts : typeof ts === 'string' && !Number.isNaN(Date.parse(ts)) ? Date.parse(ts) : undefined
    const conf = typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : undefined
    return {
      id: `${opts.source}:${String(idRaw)}`,
      type: opts.defaultType ?? inferEntityType(f),
      geometry: f.geometry,
      properties: p,
      timestamp,
      evidence: { classification, source: opts.source, timestamp, confidence: conf },
    }
  })
}

/** Adapter for an in-memory or fetched GeoJSON document. */
export class GeoJSONAdapter implements DataAdapter<FeatureCollection> {
  id: string
  constructor(private opts: GeoJSONAdapterOptions & { url?: string; document?: unknown }) { this.id = `geojson:${opts.source}` }
  async connect(): Promise<void> {}
  async fetch(bounds: GeoBounds): Promise<FeatureCollection> {
    let doc = this.opts.document
    if (!doc && this.opts.url) { const r = await fetch(this.opts.url); if (!r.ok) throw new Error(`GeoJSON fetch failed: ${r.status}`); doc = await r.json() }
    const v = validateGeoJSON(doc)
    if (!v.ok) throw new Error(`invalid GeoJSON: ${v.errors.join('; ')}`)
    return { type: 'FeatureCollection', features: v.value.features.filter((f) => boundsIntersect(bounds, featureBounds(f))) }
  }
  normalize(data: FeatureCollection): UrbanEntity[] { return featuresToEntities(data, this.opts) }
}

export function featureBounds(f: Feature): GeoBounds {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity
  const walk = (v: unknown) => {
    if (Array.isArray(v) && v.length && typeof v[0] === 'number') { const [x, y] = v as number[]; west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y) }
    else if (Array.isArray(v)) v.forEach(walk)
  }
  if (f.geometry.type === 'GeometryCollection') f.geometry.geometries.forEach((g) => walk((g as { coordinates?: unknown }).coordinates))
  else walk(f.geometry.coordinates)
  return { west, south, east, north }
}
