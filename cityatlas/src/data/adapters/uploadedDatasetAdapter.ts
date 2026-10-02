import type { DataAdapter } from './DataAdapter'
import type { UrbanEntity, EvidenceClassification } from '../../entities/types'
import type { GeoBounds } from '../../geo/coordinates/lngLat'
import type { FeatureCollection } from '../../geo/geojson'
import { MAX_UPLOAD_BYTES, validateGeoJSON, parseCSV, csvToFeatures, jsonRecordsToFeatures } from '../schemas/validate'
import { featuresToEntities } from './geoJsonAdapter'

export interface UploadResult { collection: FeatureCollection; warnings: string[]; format: 'geojson' | 'json-records' | 'csv' }

/**
 * Parses a user-supplied file into features. Content is only ever parsed
 * (JSON.parse / CSV tokenizer); nothing is evaluated or executed.
 */
export function parseUploadedText(name: string, text: string, sizeBytes = text.length): UploadResult {
  if (sizeBytes > MAX_UPLOAD_BYTES) throw new Error(`file exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit`)
  const lower = name.toLowerCase()
  const warnings: string[] = []
  if (lower.endsWith('.csv') || (!lower.endsWith('.json') && !lower.endsWith('.geojson') && !text.trimStart().startsWith('{') && !text.trimStart().startsWith('['))) {
    const r = csvToFeatures(parseCSV(text))
    if (!r.ok) throw new Error(r.errors.join('; '))
    return { collection: { type: 'FeatureCollection', features: r.value.features }, warnings: [...warnings, ...r.warnings], format: 'csv' }
  }
  let doc: unknown
  try { doc = JSON.parse(text) } catch (e) { throw new Error(`invalid JSON: ${(e as Error).message}`) }
  const g = validateGeoJSON(doc)
  if (g.ok) return { collection: g.value, warnings: [...warnings, ...g.warnings], format: 'geojson' }
  const j = jsonRecordsToFeatures(doc)
  if (j.ok) return { collection: { type: 'FeatureCollection', features: j.value.features }, warnings: [...warnings, ...j.warnings], format: 'json-records' }
  throw new Error(`not valid GeoJSON (${g.errors[0]}) nor a record array (${j.errors[0]})`)
}

export class UploadedDatasetAdapter implements DataAdapter<FeatureCollection> {
  id: string
  constructor(private name: string, private text: string, private classification: EvidenceClassification = 'observed') { this.id = `upload:${name}` }
  async connect(): Promise<void> {}
  async fetch(_bounds: GeoBounds): Promise<FeatureCollection> { return parseUploadedText(this.name, this.text).collection }
  normalize(data: FeatureCollection): UrbanEntity[] { return featuresToEntities(data, { source: this.id, classification: this.classification }) }
}
