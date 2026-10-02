import type { WorldPoint } from '../../geo/projection/mercator'
import type { EvidenceClassification } from '../../entities/types'

/**
 * Clever insights for the people who run a city: short, numbered findings
 * worked out from what the map has actually measured right now. Every
 * insight names its source and its evidence class, carries a point on the
 * map when it has one, and keeps a stable id so the screen only pops a
 * bubble the first time it appears. Nothing here is estimated where a
 * reading is missing: no reading, no insight.
 */
export type InsightKind = 'usual' | 'slow' | 'cluster' | 'incident' | 'risk' | 'weather' | 'camera' | 'zone' | 'anomaly'

export interface Insight {
  id: string
  kind: InsightKind
  /** 0..1, drives order, colour and the bleep */
  severity: number
  /** i18n key for the one-line headline and its variables */
  key: string
  vars: Record<string, string | number>
  point: WorldPoint | null
  classification: EvidenceClassification
  source: string
  time: number
}

export interface InsightInput {
  time: number
  /** TomTom level (0..1 of free-flow) per edge, with the road's name and a point on it */
  flow: Array<{ edgeId: string; level: number; name: string; point: WorldPoint }>
  /** where the flow came from: live TomTom, the memory (past) or a prediction (future) */
  flowSource?: string
  flowClass?: EvidenceClassification
  /** now vs the usual level at this weekday and hour (from the city's memory) */
  usual: Array<{ edgeId: string; now: number; usual: number | null; delta: number | null; samples: number; name: string; point: WorldPoint }>
  incidents: Array<{ id: string; kind: string; severity: number; description: string; startTime: number; point: WorldPoint; classification: EvidenceClassification; source: string }>
  hotspots: Array<{ nodeId: string; x: number; y: number; risk: number; reasons: string[] }>
  anomalies: Array<{ id: string; type: string; severity: number; confidence: number; explanation: string; location: WorldPoint }>
  weather: { description?: string | null; temperatureC?: number | null; precipitationMm?: number | null; windKmh?: number | null; source?: string } | null
  camera: { people: number; vehicles: number; point: WorldPoint | null } | null
  zoneEvents: Array<{ id: string; zone: string; type: string; description: string; point: WorldPoint | null; timestamp: number }>
  unitPerMetre: number
  /** mean congestion in view, 0..1, from the flow analyser (derived) */
  congestion: number | null
}

const pct = (v: number) => Math.round(v * 100)

/** Group readings by road name, keeping the worst reading per road. */
function worstByRoad<T extends { name: string; level: number }>(rows: T[]): T[] {
  const best = new Map<string, T>()
  for (const r of rows) { if (!r.name) continue; const cur = best.get(r.name); if (!cur || r.level < cur.level) best.set(r.name, r) }
  return [...best.values()]
}

export function deriveInsights(input: InsightInput, max = 8): Insight[] {
  const out: Insight[] = []
  const t = input.time

  // 1. Worse than usual at this hour (memory + live): the finding an authority cannot get from a traffic map alone.
  const worse = new Map<string, { delta: number; now: number; usual: number; point: WorldPoint; samples: number }>()
  for (const u of input.usual) {
    if (u.usual === null || u.delta === null || u.samples < 3 || !u.name) continue
    if (u.delta > -0.15) continue
    const cur = worse.get(u.name)
    if (!cur || u.delta < cur.delta) worse.set(u.name, { delta: u.delta, now: u.now, usual: u.usual, point: u.point, samples: u.samples })
  }
  for (const [name, w] of worse) {
    out.push({ id: `usual:${name}`, kind: 'usual', severity: Math.min(1, 0.45 + -w.delta * 1.5), key: 'ins.usual', vars: { road: name, pct: pct(-w.delta), now: pct(w.now), usual: pct(w.usual), n: w.samples }, point: w.point, classification: 'derived', source: 'tomtom + memory', time: t })
  }

  // 2. Slowest corridors right now (live TomTom).
  for (const f of worstByRoad(input.flow.filter((f) => f.level < 0.35)).sort((a, b) => a.level - b.level).slice(0, 3)) {
    if (worse.has(f.name)) continue
    out.push({ id: `slow:${f.name}`, kind: 'slow', severity: Math.min(1, 0.35 + (0.35 - f.level) * 1.6), key: 'ins.slow', vars: { road: f.name, pct: pct(f.level) }, point: f.point, classification: input.flowClass ?? 'observed', source: input.flowSource ?? 'tomtom', time: t })
  }

  // 3. Incidents: clusters first, then the severe ones.
  const inc = input.incidents
  const r = 500 * input.unitPerMetre
  const clustered = new Set<string>()
  for (const a of inc) {
    if (clustered.has(a.id)) continue
    const near = inc.filter((b) => Math.hypot(a.point.x - b.point.x, a.point.y - b.point.y) <= r)
    if (near.length >= 2) {
      near.forEach((n) => clustered.add(n.id))
      const kinds = [...new Set(near.map((n) => n.kind.replace(/_/g, ' ')))].slice(0, 3).join(', ')
      out.push({ id: `cluster:${near.map((n) => n.id).sort().join('+')}`, kind: 'cluster', severity: Math.min(1, 0.55 + near.length * 0.1), key: 'ins.cluster', vars: { n: near.length, kinds }, point: a.point, classification: 'observed', source: a.source, time: t })
    }
  }
  for (const i of inc.filter((i) => !clustered.has(i.id) && i.severity >= 0.5).sort((a, b) => b.severity - a.severity).slice(0, 3)) {
    const mins = Math.max(0, Math.round((t - i.startTime) / 60000))
    out.push({ id: `incident:${i.id}`, kind: 'incident', severity: 0.4 + i.severity * 0.5, key: 'ins.incident', vars: { kind: i.kind.replace(/_/g, ' '), mins, what: i.description }, point: i.point, classification: i.classification, source: i.source, time: t })
  }

  // 4. Risk hotspots worked out from incidents, speeds and behaviour.
  for (const h of input.hotspots.filter((h) => h.risk >= 0.55).sort((a, b) => b.risk - a.risk).slice(0, 2)) {
    out.push({ id: `risk:${h.nodeId}`, kind: 'risk', severity: h.risk, key: 'ins.risk', vars: { pct: pct(h.risk), why: h.reasons.slice(0, 2).join('; ') }, point: { x: h.x, y: h.y }, classification: 'derived', source: 'risk model', time: t })
  }

  // 5. Weather that changes how the city moves.
  const w = input.weather
  if (w) {
    if ((w.precipitationMm ?? 0) > 0 && (input.congestion ?? 0) >= 0.4) out.push({ id: 'weather:rain-slow', kind: 'weather', severity: 0.6, key: 'ins.rainslow', vars: { mm: w.precipitationMm ?? 0, pct: pct(input.congestion ?? 0) }, point: null, classification: 'derived', source: `${w.source ?? 'open-meteo'} + tomtom`, time: t })
    if ((w.temperatureC ?? 0) >= 40) out.push({ id: 'weather:heat', kind: 'weather', severity: 0.55, key: 'ins.heat', vars: { c: Math.round(w.temperatureC ?? 0) }, point: null, classification: 'observed', source: w.source ?? 'open-meteo', time: t })
    if ((w.windKmh ?? 0) >= 45) out.push({ id: 'weather:wind', kind: 'weather', severity: 0.5, key: 'ins.wind', vars: { k: Math.round(w.windKmh ?? 0) }, point: null, classification: 'observed', source: w.source ?? 'open-meteo', time: t })
  }

  // 6. A camera counting a crowd.
  if (input.camera && input.camera.people >= 25) out.push({ id: 'camera:crowd', kind: 'camera', severity: Math.min(1, 0.4 + input.camera.people / 100), key: 'ins.crowd', vars: { n: input.camera.people, v: input.camera.vehicles }, point: input.camera.point, classification: 'observed', source: 'camera', time: t })

  // 7. Zone events in the last ten minutes.
  for (const z of input.zoneEvents.filter((z) => t - z.timestamp < 10 * 60000 && z.type !== 'exit').slice(-2)) {
    out.push({ id: `zone:${z.id}`, kind: 'zone', severity: 0.45, key: 'ins.zone', vars: { zone: z.zone, what: z.description }, point: z.point, classification: 'derived', source: 'zone rules', time: t })
  }

  // 8. Strong anomalies.
  for (const a of input.anomalies.filter((a) => a.confidence >= 0.6 && a.severity >= 0.5).slice(0, 2)) {
    out.push({ id: `anomaly:${a.id}`, kind: 'anomaly', severity: a.severity, key: 'ins.anomaly', vars: { type: a.type.replace(/_/g, ' '), what: a.explanation }, point: a.location, classification: 'derived', source: 'anomaly model', time: t })
  }

  return out.sort((a, b) => b.severity - a.severity).slice(0, max)
}
