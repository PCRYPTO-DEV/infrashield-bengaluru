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
  // Moving things: made up only in the demo; seen when a camera reports them; otherwise there is no source and nothing is claimed.
  const movingCls: EvidenceMetadata['classification'] | null = world.agents.size > 0 ? 'simulated' : world.observedAgents.size > 0 ? 'observed' : null
  const cls: EvidenceMetadata['classification'] = movingCls ?? 'observed'
  const seenV = [...world.observedAgents.values()].filter((a) => a.kind === 'vehicle').length, seenP = world.observedAgents.size - seenV
  const vehiclesShown: number | string = movingCls === null ? 'no feed' : movingCls === 'observed' ? seenV : vehicles
  const pedestriansShown: number | string = movingCls === null ? 'no feed' : movingCls === 'observed' ? seenP : pedestrians
  const incidentCls: EvidenceMetadata['classification'] = incidents.length ? incidents[0].entity.evidence.classification : 'observed'
  const firstRoad = [...world.entities.values()].find((e) => e.entity.type === 'road')
  const mapCls: EvidenceMetadata['classification'] = firstRoad ? firstRoad.entity.evidence.classification : 'observed'
  const categories: PulseCategory[] = [
    { id: 'mobility', label: 'Mobility', index: flow ? Math.max(0, Math.min(1, flow.meanSpeedRatio)) : null, measurements: [
      { label: 'Vehicles in view', value: vehiclesShown, evidence: cls },
      { label: 'Mean speed / free-flow', value: flow ? flow.meanSpeedRatio.toFixed(2) : 'n/a', evidence: 'derived' },
      { label: 'Congested segments', value: flow ? `${Math.round(flow.congestedShare * 100)}%` : 'n/a', evidence: 'derived' },
    ] },
    { id: 'activity', label: 'Activity', index: activity ? activity.overall : null, measurements: [
      { label: 'Pedestrians in view', value: pedestriansShown, evidence: cls },
      { label: 'Active cells', value: density ? density.cells.size : 0, evidence: 'derived' },
      { label: 'Hotspots', value: activity ? activity.hotspots.length : 0, evidence: 'derived' },
    ] },
    { id: 'safety', label: 'Safety signals', index: Math.max(0, 1 - 0.12 * incidents.length - 0.05 * highSeverity), measurements: [
      { label: 'Active incidents', value: incidents.length, evidence: incidentCls },
      { label: 'Anomalies (all)', value: anomalies.length, evidence: 'derived' },
      { label: 'Anomalies (severity ≥ 0.6)', value: highSeverity, evidence: 'derived' },
      { label: 'Risk hotspots', value: intel.risk?.hotspots.length ?? 0, evidence: 'derived' },
    ] },
    world.weather
      ? { id: 'environment', label: 'Environment', index: environmentIndex(world.weather), measurements: [
          { label: 'Weather', value: world.weather.description ?? 'n/a', evidence: 'observed' },
          { label: 'Temperature', value: world.weather.temperatureC ?? 'n/a', unit: ' °C', evidence: 'observed' },
          { label: 'Rain (last hour)', value: world.weather.precipitationMm ?? 'n/a', unit: ' mm', evidence: 'observed' },
          { label: 'Wind', value: world.weather.windKmh ?? 'n/a', unit: ' km/h', evidence: 'observed' },
          { label: 'Air quality feed', value: 'not connected', evidence: 'observed' },
        ], note: `Source: ${world.weather.source}, observed ${world.weather.observedAt ?? ''}` }
      : { id: 'environment', label: 'Environment', index: null, note: 'No observed environmental data source connected. Nothing is shown rather than a fabricated value.', measurements: [
          { label: 'Weather feed', value: 'not connected', evidence: 'observed' },
          { label: 'Air quality feed', value: 'not connected', evidence: 'observed' },
        ] },
    { id: 'infrastructure', label: 'Infrastructure', index: Math.max(0, Math.min(1, 1 - construction / Math.max(1, roads) * 4)), measurements: [
      { label: 'Road segments loaded', value: roads, evidence: mapCls },
      { label: 'Signalised intersections', value: signals, evidence: mapCls },
      { label: 'Buildings', value: buildings, evidence: mapCls },
      { label: 'Transit stops', value: transit, evidence: mapCls },
      { label: 'Construction sites', value: construction, evidence: mapCls },
    ] },
  ]
  return { time, categories }
}

/** 1 = calm and dry; falls with rain, strong wind and severe weather codes. */
function environmentIndex(w: NonNullable<WorldModel['weather']>): number {
  let i = 1
  if (w.precipitationMm) i -= Math.min(0.5, w.precipitationMm / 10)
  if (w.windKmh) i -= Math.min(0.3, Math.max(0, (w.windKmh - 20) / 60))
  if (w.weatherCode !== null && w.weatherCode >= 95) i -= 0.3
  else if (w.weatherCode !== null && w.weatherCode >= 61) i -= 0.15
  return Math.max(0, Math.min(1, i))
}
