import { isGeometry, type Feature, type FeatureCollection, type Geometry } from '../../geo/geojson'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_FEATURES = 200_000
const MAX_DEPTH = 6


export type ValidationOutcome<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] }

function depthOf(v: unknown, d = 0): number {
  if (d > MAX_DEPTH) return d
  if (Array.isArray(v)) return v.reduce<number>((m, x) => Math.max(m, depthOf(x, d + 1)), d)
  return d
}

function validCoord(c: unknown): c is [number, number] {
  return Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number' && Number.isFinite(c[0]) && Number.isFinite(c[1]) && c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90
}

function validateGeometry(g: Geometry, errors: string[], path: string): void {
  if (g.type === 'GeometryCollection') { g.geometries.forEach((x, i) => validateGeometry(x, errors, `${path}.geometries[${i}]`)); return }
  if (depthOf(g.coordinates) > MAX_DEPTH) { errors.push(`${path}: coordinate nesting too deep`); return }
  const flat: unknown[] = []
  const walk = (v: unknown) => { if (Array.isArray(v) && v.length && Array.isArray(v[0])) v.forEach(walk); else flat.push(v) }
  walk(g.coordinates)
  if (flat.length === 0) errors.push(`${path}: empty geometry`)
  for (const c of flat) if (!validCoord(c)) { errors.push(`${path}: invalid coordinate ${JSON.stringify(c).slice(0, 40)} (expected [lng, lat] in range)`); break }
  if (g.type === 'Polygon') for (const ring of g.coordinates) if (ring.length < 4) errors.push(`${path}: polygon ring needs ≥ 4 positions`)
  if (g.type === 'LineString' && g.coordinates.length < 2) errors.push(`${path}: line needs ≥ 2 positions`)
}

/** Strict GeoJSON validation. Never evaluates anything; pure structural checks. */
export function validateGeoJSON(input: unknown): ValidationOutcome<FeatureCollection> {
  const errors: string[] = [], warnings: string[] = []
  if (!input || typeof input !== 'object') return { ok: false, errors: ['not an object'] }
  const o = input as { type?: unknown; features?: unknown; geometry?: unknown; properties?: unknown }
  let features: unknown[]
  if (o.type === 'FeatureCollection') { if (!Array.isArray(o.features)) return { ok: false, errors: ['FeatureCollection.features must be an array'] }; features = o.features }
  else if (o.type === 'Feature') features = [o]
  else if (isGeometry(o)) features = [{ type: 'Feature', geometry: o, properties: {} }]
  else return { ok: false, errors: [`unsupported GeoJSON type ${String(o.type)}`] }
  if (features.length > MAX_FEATURES) return { ok: false, errors: [`too many features (${features.length} > ${MAX_FEATURES})`] }
  const out: Feature[] = []
  features.forEach((f, i) => {
    if (errors.length > 20) return
    const ff = f as { type?: unknown; geometry?: unknown; properties?: unknown; id?: unknown }
    if (!ff || ff.type !== 'Feature') { errors.push(`features[${i}]: not a Feature`); return }
    if (ff.geometry === null) { warnings.push(`features[${i}]: null geometry skipped`); return }
    if (!isGeometry(ff.geometry)) { errors.push(`features[${i}]: invalid geometry`); return }
    validateGeometry(ff.geometry, errors, `features[${i}]`)
    const props = ff.properties && typeof ff.properties === 'object' && !Array.isArray(ff.properties) ? (ff.properties as Record<string, unknown>) : {}
    if (ff.properties !== undefined && ff.properties !== null && (typeof ff.properties !== 'object' || Array.isArray(ff.properties))) warnings.push(`features[${i}]: properties not an object, ignored`)
    out.push({ type: 'Feature', id: typeof ff.id === 'string' || typeof ff.id === 'number' ? ff.id : undefined, geometry: ff.geometry, properties: props })
  })
  if (errors.length) return { ok: false, errors }
  return { ok: true, value: { type: 'FeatureCollection', features: out }, warnings }
}

/** RFC 4180-ish CSV parser (quotes, escaped quotes, CRLF). Returns rows of strings. */
export function parseCSV(text: string, maxRows = MAX_FEATURES): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false }
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
      if (rows.length >= maxRows) break
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((x) => x.trim() !== '')) rows.push(row) }
  return rows
}

const LAT_KEYS = ['lat', 'latitude', 'y']
const LNG_KEYS = ['lng', 'lon', 'long', 'longitude', 'x']

export interface TabularPoints { features: Feature[]; latKey: string; lngKey: string; skipped: number }

/** Turn CSV rows (header first) into point features. */
export function csvToFeatures(rows: string[][]): ValidationOutcome<TabularPoints> {
  if (rows.length < 2) return { ok: false, errors: ['CSV needs a header row and at least one data row'] }
  const header = rows[0].map((h) => h.trim())
  const lower = header.map((h) => h.toLowerCase())
  const latIdx = lower.findIndex((h) => LAT_KEYS.includes(h)), lngIdx = lower.findIndex((h) => LNG_KEYS.includes(h))
  if (latIdx < 0 || lngIdx < 0) return { ok: false, errors: [`no latitude/longitude columns found (looked for ${LAT_KEYS.join('/')} and ${LNG_KEYS.join('/')})`] }
  const features: Feature[] = []
  let skipped = 0
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    const lat = parseFloat(row[latIdx]), lng = parseFloat(row[lngIdx])
    if (!validCoord([lng, lat])) { skipped++; continue }
    const properties: Record<string, unknown> = {}
    header.forEach((h, i) => { if (i !== latIdx && i !== lngIdx) properties[h] = coerce(row[i] ?? '') })
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties })
  }
  if (!features.length) return { ok: false, errors: ['no rows with valid coordinates'] }
  return { ok: true, value: { features, latKey: header[latIdx], lngKey: header[lngIdx], skipped }, warnings: skipped ? [`${skipped} rows skipped for invalid coordinates`] : [] }
}

/** JSON array of objects with lat/lng-like keys → point features. */
export function jsonRecordsToFeatures(input: unknown): ValidationOutcome<TabularPoints> {
  if (!Array.isArray(input)) return { ok: false, errors: ['expected a JSON array of records'] }
  if (input.length > MAX_FEATURES) return { ok: false, errors: ['too many records'] }
  const first = input.find((x) => x && typeof x === 'object') as Record<string, unknown> | undefined
  if (!first) return { ok: false, errors: ['no object records'] }
  const keys = Object.keys(first)
  const latKey = keys.find((k) => LAT_KEYS.includes(k.toLowerCase())), lngKey = keys.find((k) => LNG_KEYS.includes(k.toLowerCase()))
  if (!latKey || !lngKey) return { ok: false, errors: ['records have no latitude/longitude keys'] }
  const features: Feature[] = []
  let skipped = 0
  for (const rec of input as Array<Record<string, unknown>>) {
    const lat = Number(rec?.[latKey]), lng = Number(rec?.[lngKey])
    if (!validCoord([lng, lat])) { skipped++; continue }
    const properties: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rec)) if (k !== latKey && k !== lngKey && isPlain(v)) properties[k] = v
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties })
  }
  if (!features.length) return { ok: false, errors: ['no records with valid coordinates'] }
  return { ok: true, value: { features, latKey, lngKey, skipped }, warnings: skipped ? [`${skipped} records skipped`] : [] }
}

function isPlain(v: unknown): boolean { return v === null || ['string', 'number', 'boolean'].includes(typeof v) }
function coerce(s: string): string | number | boolean | null {
  const t = s.trim()
  if (t === '') return null
  if (t === 'true') return true
  if (t === 'false') return false
  const n = Number(t)
  return t !== '' && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(t) ? n : t
}
