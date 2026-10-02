import type { WorldModel } from '../../engine/world/WorldModel'
import type { IntelligenceState } from '../types'
import type { WorldBounds, WorldPoint } from '../../geo/projection/mercator'
import { parseIntent, type Intent } from './intentParser'
import { type Answer, type EvidenceItem, type ExplanationProvider, weakest } from './evidence'
import { TemplateExplainer } from './templateExplainer'
import { UrbanMemory } from '../memory/urbanMemory'
import { scoreSites } from '../business/siteScorer'
import { cityPulse } from '../pulse/cityPulse'
import type { RoadProperties } from '../../entities/types'
import { tr } from '../../ui/i18n'
import type { Language } from './claudeExplainer'

export interface AskContext {
  world: WorldModel
  intel: IntelligenceState
  memory: UrbanMemory
  time: number
  /** area of interest in local units (viewport or selection) */
  focus: WorldBounds
  focusPoint: WorldPoint
  unitPerMetre: number
  explainer?: ExplanationProvider
  language?: Language
}

/**
 * Question → intent → spatial query → analytics → structured evidence →
 * explanation. The explainer only sees `evidence`; it cannot invent facts.
 */
export async function askTheCity(question: string, ctx: AskContext): Promise<Answer> {
  const intent = parseIntent(question)
  const evidence: EvidenceItem[] = []
  const highlights = { points: [] as WorldPoint[], entityIds: [] as string[], agentIds: [] as number[] }
  const caveats: string[] = []
  const upm = ctx.unitPerMetre
  const m = (v: number) => Math.round(v / upm)
  gather(intent, ctx, evidence, highlights, caveats, m)
  const explainer = ctx.explainer ?? TemplateExplainer
  const summary = await explainer.explain(question, intent.kind, evidence)
  const anySimulated = evidence.some((e) => e.classification === 'simulated') || ctx.world.agents.size > 0 && [...ctx.world.agents.values()][0].evidence.classification === 'simulated'
  if (anySimulated) caveats.push(tr(ctx.language ?? 'en', 'caveat.sim'))
  return { question, intent: intent.kind, summary, evidence, highlights, classification: weakest(evidence), caveats }
}

function gather(intent: Intent, ctx: AskContext, ev: EvidenceItem[], hl: Answer['highlights'], caveats: string[], m: (v: number) => number): void {
  const { world, intel, focus, focusPoint, time } = ctx
  const inFocus = (p: WorldPoint) => p.x >= focus.minX && p.x <= focus.maxX && p.y >= focus.minY && p.y <= focus.maxY
  const push = (e: EvidenceItem) => ev.push(e)
  switch (intent.kind) {
    case 'whats_happening': {
      let vehicles = 0, peds = 0, seenV = 0, seenP = 0
      for (const a of world.agents.values()) if (inFocus(a)) { if (a.kind === 'vehicle') vehicles++; else peds++ }
      for (const a of world.observedAgents.values()) if (inFocus(a)) { if (a.kind === 'vehicle') seenV++; else seenP++ }
      if (vehicles + peds > 0) push({ id: 'pop', classification: 'simulated', statement: `${vehicles} vehicles and ${peds} pedestrians are in the area right now (made up by the demo)`, source: 'atlas.simulation' })
      if (seenV + seenP > 0) push({ id: 'seen', classification: 'observed', statement: `A camera sees ${seenP} people and ${seenV} vehicles right now`, source: 'camera' })
      if (intel.flow) push({ id: 'flow', classification: 'derived', statement: `Mean speed is ${Math.round(intel.flow.meanSpeedRatio * 100)}% of free-flow; ${Math.round(intel.flow.congestedShare * 100)}% of segments are congested`, confidence: 0.8 })
      for (const inc of world.activeIncidents(time).filter((i) => inFocus(i.point)).slice(0, 4)) { push({ id: inc.entity.id, classification: inc.entity.evidence.classification, source: inc.entity.evidence.source, statement: `Active ${inc.props.kind}: ${inc.props.description} (severity ${inc.props.severity})`, location: inc.point, entityIds: [inc.entity.id] }); hl.points.push(inc.point); hl.entityIds.push(inc.entity.id) }
      for (const h of (intel.activity?.hotspots ?? []).filter(inFocus).slice(0, 3)) { push({ id: `hot:${h.x}`, classification: 'derived', statement: `Activity hotspot (index ${h.score.toFixed(2)}): ${h.reason}`, location: h, confidence: 0.7 }); hl.points.push(h) }
      for (const a of intel.anomalies.filter((x) => inFocus(x.location)).slice(0, 3)) { push({ id: a.id, classification: 'derived', statement: `${a.type.replace('_', ' ')}: ${a.explanation}`, location: a.location, confidence: a.confidence }); hl.points.push(a.location) }
      break
    }
    case 'why_slow': {
      const flows = [...(intel.flow?.edges.values() ?? [])].filter((f) => f.congestion > 0.4)
      const roads = new Map<string, { name: string; cong: number; count: number; ids: string[]; observed: boolean }>()
      for (const f of flows) {
        const e = world.graph.edge(f.edgeId); if (!e) continue
        const ep = world.graph.endpoints(e); if (!ep || !inFocus({ x: (ep.a.x + ep.b.x) / 2, y: (ep.a.y + ep.b.y) / 2 })) continue
        const road = world.entities.get(e.roadId)
        const name = (road?.entity.properties as RoadProperties | undefined)?.name ?? e.roadId
        // One entry per road name: a long road is many OSM ways, and the reader wants one line about it.
        const roadKey = name || e.roadId
        const r = roads.get(roadKey) ?? { name, cong: 0, count: 0, ids: [], observed: false }
        r.cong = Math.max(r.cong, f.congestion); r.count += f.count; r.ids.push(f.edgeId); r.observed = r.observed || f.observed; roads.set(roadKey, r)
      }
      const top = [...roads.entries()].sort((a, b) => b[1].cong - a[1].cong).slice(0, 4)
      if (top.length === 0) push({ id: 'none', classification: 'derived', statement: 'No segment in view is currently below 60% of free-flow speed', confidence: 0.8 })
      const incidents = world.graph.activeIncidentsByEdge(time)
      for (const [roadId, r] of top) {
        const inc = r.ids.map((id) => incidents.get(id)).find(Boolean)
        push({ id: roadId, classification: 'derived', statement: `${r.name}: congestion ${r.cong.toFixed(2)}${r.observed ? ' from live TomTom speeds' : ` with ${r.count} simulated vehicles`}${inc ? `; an active ${inc.kind} is on this road (${inc.description})` : ''}`, entityIds: [roadId], confidence: r.observed ? 0.85 : 0.75 })
        hl.entityIds.push(roadId)
      }
      const signalEntities = [...world.entities.values()].filter((e) => e.entity.type === 'traffic_signal' && inFocus(e.local[0]))
      if (signalEntities.length) { const observedSignals = signalEntities[0].entity.evidence.classification === 'observed'; push({ id: 'signals', classification: observedSignals ? 'observed' : 'simulated', source: signalEntities[0].entity.evidence.source, statement: observedSignals ? `${signalEntities.length} traffic lights in view (positions from OpenStreetMap) stop traffic in turns` : `${signalEntities.length} traffic lights in view stop traffic in turns (made up by the demo)` }) }
      break
    }
    case 'unusual': {
      const list = intel.anomalies.filter((a) => inFocus(a.location)).sort((a, b) => b.severity - a.severity).slice(0, 8)
      if (!list.length) push({ id: 'none', classification: 'derived', statement: 'No anomalies detected in the current view', confidence: 0.7 })
      for (const a of list) { push({ id: a.id, classification: 'derived', statement: `${a.type.replace('_', ' ')} (severity ${a.severity.toFixed(2)}): ${a.explanation} Evidence: ${a.evidence.join('; ')}`, location: a.location, confidence: a.confidence, entityIds: a.entityIds }); hl.points.push(a.location); for (const id of a.entityIds) if (id.startsWith('agent:')) hl.agentIds.push(Number(id.slice(6))) }
      break
    }
    case 'dangerous_intersections': {
      const hs = (intel.risk?.hotspots ?? []).filter(inFocus).slice(0, 6)
      if (!hs.length) push({ id: 'none', classification: 'derived', statement: 'No intersection in view currently carries an elevated risk indicator', confidence: 0.6 })
      for (const h of hs) { push({ id: h.nodeId, classification: 'derived', statement: `Intersection at (${m(h.x)}, ${m(h.y)}) m: risk indicator ${h.risk.toFixed(2)} — ${h.reasons.join(', ') || 'combined congestion and exposure'}`, location: h, confidence: 0.6 }); hl.points.push(h) }
      caveats.push('Risk indicators combine incidents, congestion, pedestrian exposure and construction. They are not accident statistics.')
      break
    }
    case 'history': {
      const from = time - intent.minutes * 60_000
      const events = ctx.memory.near(focusPoint, Math.max(focus.maxX - focus.minX, focus.maxY - focus.minY), from, time)
      if (!events.length) push({ id: 'none', classification: 'observed', statement: `No events were recorded in the last ${intent.minutes} minutes for this area. Atlas Infinity only replays what it recorded; it does not fabricate history.` })
      const byType = new Map<string, number>()
      for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
      for (const [type, n] of byType) push({ id: `t:${type}`, classification: 'derived', statement: `${n} × ${type.replace('_', ' ')} in the last ${intent.minutes} min` })
      for (const e of events.slice(0, 6)) { push({ id: e.id, classification: e.evidence.classification, statement: `${new Date(e.timestamp).toISOString().slice(11, 19)} — ${e.description}`, location: e.location }); hl.points.push(e.location) }
      break
    }
    case 'forecast': {
      const f = intel.forecast
      if (!f) { push({ id: 'none', classification: 'predicted', statement: 'Forecast not yet available (needs a few samples of history)' }); break }
      const hIdx = f.horizonsMin.findIndex((h) => h >= intent.minutes)
      const idx = hIdx === -1 ? f.horizonsMin.length - 1 : hIdx
      const rising: Array<{ road: string; now: number; later: number }> = []
      for (const [edgeId, vals] of f.edges) {
        const e = world.graph.edge(edgeId); const ep = e && world.graph.endpoints(e)
        if (!e || !ep || !inFocus({ x: (ep.a.x + ep.b.x) / 2, y: (ep.a.y + ep.b.y) / 2 })) continue
        const now = intel.flow?.edges.get(edgeId)?.congestion ?? 0
        if (vals[idx] - now > 0.15 || vals[idx] > 0.6) rising.push({ road: (world.entities.get(e.roadId)?.entity.properties as RoadProperties | undefined)?.name ?? e.roadId, now, later: vals[idx] })
      }
      rising.sort((a, b) => b.later - a.later)
      push({ id: 'conf', classification: 'predicted', statement: `Forecast horizon ${f.horizonsMin[idx]} min, model confidence ${Math.round(f.confidence[idx] * 100)}%`, confidence: f.confidence[idx] })
      if (!rising.length) push({ id: 'stable', classification: 'predicted', statement: 'No segment in view is projected to worsen materially', confidence: f.confidence[idx] })
      for (const r of rising.slice(0, 5)) push({ id: r.road, classification: 'predicted', statement: `${r.road}: congestion ${r.now.toFixed(2)} → ${r.later.toFixed(2)} projected`, confidence: f.confidence[idx] })
      for (const inc of world.activeIncidents(time).filter((i) => inFocus(i.point) && i.props.endTime > time)) push({ id: inc.entity.id, classification: inc.entity.evidence.classification, source: inc.entity.evidence.source, statement: `${inc.props.kind} expected to clear at ${new Date(inc.props.endTime).toISOString().slice(11, 16)} UTC`, location: inc.point })
      caveats.push('Forecasts extrapolate recent trends; confidence decays with horizon.')
      break
    }
    case 'site_selection': {
      const cands = scoreSites({ world, intel, time, unitPerMetre: ctx.unitPerMetre }, focus)
      for (const c of cands) { push({ id: `site:${m(c.point.x)},${m(c.point.y)}`, classification: 'derived', statement: `Candidate at (${m(c.point.x)}, ${m(c.point.y)}) m scores ${c.score.toFixed(2)}: ${c.factors.map((f) => `${f.label} ${f.value.toFixed(2)} — ${f.note}`).join('; ')}`, location: c.point, confidence: 0.5 }); hl.points.push(c.point) }
      caveats.push(`Scores for a ${intent.business} use footfall proxy, accessibility, competition, office/residential density, transit and time-of-day activity. Weights are configurable and the inputs are simulated in this demo.`)
      break
    }
    case 'route':
      push({ id: 'route', classification: 'derived', statement: 'Use the Route tool: click a start and an end point on the map. The cost combines travel time, incident risk, congestion, pedestrian exposure and environmental cost with configurable weights.' })
      break
    case 'pulse': {
      const p = cityPulse(world, intel, time)
      for (const c of p.categories) push({ id: c.id, classification: 'derived', statement: `${c.label}: ${c.index === null ? 'no data' : c.index.toFixed(2)} — ${c.measurements.map((x) => `${x.label} ${x.value}${x.unit ?? ''}`).join(', ')}${c.note ? ` (${c.note})` : ''}` })
      break
    }
    case 'help':
      push({ id: 'help', classification: 'observed', statement: 'Try: "What\'s happening here?", "Why is traffic slow?", "Show unusual activity", "Where are the dangerous intersections?", "Show activity during the last hour", "What may happen in the next 30 minutes?", "Where should I open a café?"' })
      break
  }
}
