import { describe, it, expect } from 'vitest'
import { validateGeoJSON, parseCSV, csvToFeatures, jsonRecordsToFeatures, MAX_UPLOAD_BYTES } from '../data/schemas/validate'
import { featuresToEntities, inferEntityType } from '../data/adapters/geoJsonAdapter'
import { normalizeOsm, overpassQuery } from '../data/adapters/openStreetMapAdapter'
import { parseUploadedText } from '../data/adapters/uploadedDatasetAdapter'
import { MockRealtimeFeed } from '../data/realtime/feed'

describe('data validation', () => {
  it('accepts valid GeoJSON and rejects malformed input', () => {
    const ok = validateGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [77.6, 12.9] }, properties: { name: 'x' } }] })
    expect(ok.ok).toBe(true)
    expect(validateGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [200, 12.9] }, properties: {} }] }).ok).toBe(false)
    expect(validateGeoJSON({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] }, properties: {} }] }).ok).toBe(false)
    expect(validateGeoJSON('nope').ok).toBe(false)
    expect(validateGeoJSON({ type: 'Banana' }).ok).toBe(false)
    expect(validateGeoJSON({ type: 'FeatureCollection', features: 'x' }).ok).toBe(false)
  })
  it('bare geometry and single Feature are wrapped', () => {
    const r = validateGeoJSON({ type: 'LineString', coordinates: [[77, 12], [77.1, 12.1]] })
    expect(r.ok && r.value.features.length).toBe(1)
  })
  it('parses CSV with quotes and CRLF and maps lat/lng columns', () => {
    const rows = parseCSV('name,lat,lon,note\r\n"Shop, A",12.97,77.61,"said ""hi"""\r\nbad,abc,77.6,x\r\n')
    expect(rows.length).toBe(3)
    const f = csvToFeatures(rows)
    expect(f.ok).toBe(true)
    if (f.ok) { expect(f.value.features.length).toBe(1); expect(f.value.features[0].properties?.name).toBe('Shop, A'); expect(f.value.features[0].properties?.note).toBe('said "hi"'); expect(f.value.skipped).toBe(1) }
    expect(csvToFeatures(parseCSV('a,b\n1,2')).ok).toBe(false)
  })
  it('parses JSON record arrays', () => {
    const r = jsonRecordsToFeatures([{ latitude: 12.9, longitude: 77.6, kind: 'camera' }, { latitude: 'x', longitude: 1 }])
    expect(r.ok && r.value.features.length).toBe(1)
    expect(jsonRecordsToFeatures({}).ok).toBe(false)
  })
  it('upload size limit is enforced and format is detected', () => {
    expect(() => parseUploadedText('big.json', '{}', MAX_UPLOAD_BYTES + 1)).toThrow(/limit/)
    expect(parseUploadedText('a.csv', 'lat,lng\n12.9,77.6').format).toBe('csv')
    expect(parseUploadedText('a.json', '[{"lat":12.9,"lng":77.6}]').format).toBe('json-records')
    expect(parseUploadedText('a.geojson', JSON.stringify({ type: 'Point', coordinates: [77.6, 12.9] })).format).toBe('geojson')
    expect(() => parseUploadedText('a.json', '{"__proto__": 1')).toThrow(/invalid JSON/)
  })
})

describe('entity normalization', () => {
  it('GeoJSON features become observed UrbanEntities with inferred types', () => {
    const ents = featuresToEntities({ type: 'FeatureCollection', features: [
      { type: 'Feature', id: 7, geometry: { type: 'Point', coordinates: [77.6, 12.9] }, properties: { type: 'camera', confidence: 0.7, timestamp: '2026-01-01T00:00:00Z' } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[77.6, 12.9], [77.61, 12.91]] }, properties: { highway: 'primary' } },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[77.6, 12.9], [77.61, 12.9], [77.61, 12.91], [77.6, 12.9]]] }, properties: { building: 'yes' } },
    ] }, { source: 'test' })
    expect(ents.map((e) => e.type)).toEqual(['camera', 'road', 'building'])
    expect(ents[0].id).toBe('test:7')
    expect(ents[0].evidence).toMatchObject({ classification: 'observed', source: 'test', confidence: 0.7 })
    expect(ents[0].timestamp).toBe(Date.parse('2026-01-01T00:00:00Z'))
    expect(inferEntityType({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { kind: 'incident' } })).toBe('incident')
  })
  it('OSM elements normalise to roads, buildings, signals and transit', () => {
    const ents = normalizeOsm({ elements: [
      { type: 'way', id: 1, tags: { highway: 'primary', name: 'MG Road', maxspeed: '50', lanes: '3', oneway: 'yes' }, geometry: [{ lat: 12.97, lon: 77.6 }, { lat: 12.98, lon: 77.61 }] },
      { type: 'way', id: 2, tags: { building: 'apartments', 'building:levels': '8' }, geometry: [{ lat: 12.97, lon: 77.6 }, { lat: 12.97, lon: 77.601 }, { lat: 12.971, lon: 77.601 }] },
      { type: 'node', id: 3, lat: 12.97, lon: 77.6, tags: { highway: 'traffic_signals' } },
      { type: 'node', id: 4, lat: 12.97, lon: 77.6, tags: { public_transport: 'station', station: 'subway', name: 'Indiranagar' } },
      { type: 'way', id: 5, tags: { highway: 'residential' }, geometry: [{ lat: 12.97, lon: 77.6 }, { lat: 12.98, lon: 77.61 }] },
    ] }, 1000)
    expect(ents.map((e) => e.type)).toEqual(['road', 'building', 'traffic_signal', 'transit', 'road'])
    expect(ents[0].properties).toMatchObject({ roadClass: 'arterial', lanes: 3, oneway: true, speedLimitSource: 'osm:maxspeed' })
    expect(ents[0].properties.speedLimit).toBeCloseTo(50 / 3.6, 5)
    expect(ents[1].properties).toMatchObject({ landUse: 'residential', floors: 8 })
    expect((ents[1].geometry as { coordinates: number[][][] }).coordinates[0].length).toBe(4)
    expect(ents[3].properties).toMatchObject({ mode: 'metro', name: 'Indiranagar' })
    expect(ents[4].properties.speedLimitSource).toBe('class-default')
    for (const e of ents) expect(e.evidence).toMatchObject({ classification: 'observed', source: 'openstreetmap', timestamp: 1000 })
    expect(overpassQuery({ west: 77.6, south: 12.9, east: 77.7, north: 13 })).toContain('12.9,77.6,13,77.7')
  })
  it('mock realtime feed emits observed incidents deterministically', () => {
    const a = new MockRealtimeFeed('mock', 5, { lng: 77.6, lat: 12.97 }, 1000, () => 42)
    const b = new MockRealtimeFeed('mock', 5, { lng: 77.6, lat: 12.97 }, 1000, () => 42)
    const ea = a.tick()[0], eb = b.tick()[0]
    expect(ea.geometry).toEqual(eb.geometry)
    expect(ea.evidence.classification).toBe('observed')
    expect(ea.type).toBe('incident')
  })
})
