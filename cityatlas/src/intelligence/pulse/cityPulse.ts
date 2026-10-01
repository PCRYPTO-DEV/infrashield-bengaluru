import type { IntelligenceState } from '../types'
import type { WorldModel } from '../../engine/world/WorldModel'
import type { EvidenceMetadata } from '../../entities/types'

export interface PulseMeasurement { label: string; value: number | string; unit?: string; evidence: EvidenceMetadata['classification'] }
export interface PulseCategory { id: 'mobility' | 'activity' | 'safety' | 'environment' | 'infrastructure'; label: string; /** 0..1 or null when not computable */ index: number | null; measurements: PulseMeasurement[]; note?: string }
export interface CityPulseReport { time: number; categories: PulseCategory[] }

/**
 * City Pulse: high-level indicators that always expose the measurements
 * they are built from. A category with no observed or derived inputs says
 * so rather than inventing a number.
 */
export function cityPulse(world: WorldModel, intel: IntelligenceState, time: number): CityPulseReport {
  const flow = intel.flow, density = intel.density, activity = intel.activity
  let vehicles = 0, pedestrians = 0
  for (const a of world.agents.values()) if (a.kind === 'vehicle') vehicles++; else pedestrians++
  const incidents = world.activeIncidents(time)
  let roads = 0, signals = 0, construction = 0, buildings = 0, transit = 0
  for (const ie of world.entities.values()) {
    if (ie.entity.type === 'road') roads++
    else if (ie.entity.type === 'traffic_signal') signals++
    else if (ie.entity.type === 'construction') construction++
    else if (ie.entity.type === 'building') buildings++
    else if (ie.entity.type === 'transit') transit++
  }
  const anomalies = intel.anomalies
  const highSeverity = anomalies.filter((a) => a.severity >= 0.6).length
  const cls: EvidenceMetadata['classification'] = 'simulated'
  const categories: PulseCategory[] = [
    { id: 'mobility', label: 'Mobility', index: flow ? Math.max(0, Math.min(1, flow.meanSpeedRatio)) : null, measurements: [
      { label: 'Vehicles in view', value: vehicles, evidence: cls },
      { label: 'Mean speed / free-flow', value: flow ? flow.meanSpeedRatio.toFixed(2) : 'n/a', evidence: 'derived' },
      { label: 'Congested segments', value: flow ? `${Math.round(flow.congestedShare * 100)}%` : 'n/a', evidence: 'derived' },
    ] },
    { id: 'activity', label: 'Activity', index: activity ? activity.overall : null, measurements: [
      { label: 'Pedestrians in view', value: pedestrians, evidence: cls },
      { label: 'Active cells', value: density ? density.cells.size : 0, evidence: 'derived' },
      { label: 'Hotspots', value: activity ? activity.hotspots.length : 0, evidence: 'derived' },
    ] },
    { id: 'safety', label: 'Safety signals', index: Math.max(0, 1 - 0.12 * incidents.length - 0.05 * highSeverity), measurements: [
      { label: 'Active incidents', value: incidents.length, evidence: cls },
      { label: 'Anomalies (all)', value: anomalies.length, evidence: 'derived' },
      { label: 'Anomalies (severity ≥ 0.6)', value: highSeverity, evidence: 'derived' },
      { label: 'Risk hotspots', value: intel.risk?.hotspots.length ?? 0, evidence: 'derived' },
    ] },
    { id: 'environment', label: 'Environment', index: null, note: 'No observed environmental data source connected. Nothing is shown rather than a fabricated value.', measurements: [
      { label: 'Weather feed', value: 'not connected', evidence: 'observed' },
      { label: 'Air quality feed', value: 'not connected', evidence: 'observed' },
    ] },
    { id: 'infrastructure', label: 'Infrastructure', index: Math.max(0, Math.min(1, 1 - construction / Math.max(1, roads) * 4)), measurements: [
      { label: 'Road segments loaded', value: roads, evidence: cls },
      { label: 'Signalised intersections', value: signals, evidence: cls },
      { label: 'Buildings', value: buildings, evidence: cls },
      { label: 'Transit stops', value: transit, evidence: cls },
      { label: 'Construction sites', value: construction, evidence: cls },
    ] },
  ]
  return { time, categories }
}
