// Generates plain-English narrative summaries for facilities.
// Explains what the numbers actually mean in human terms.
import type { Facility } from '../types'

export function generateNarrative(f: Facility): string {
  const parts: string[] = []

  // Opening: risk level in plain language
  const openings: Record<string, string> = {
    Critical: `${f.name} is in a critical state. Immediate action is required.`,
    High: `${f.name} carries significant operational risk across multiple dimensions.`,
    Medium: `${f.name} shows moderate vulnerability — manageable but requires attention.`,
    Low: `${f.name} is operating within generally acceptable risk parameters.`,
    'Insufficient Data': `${f.name} lacks enough verified data for a confident risk assessment. Field verification is essential.`,
  }
  parts.push(openings[f.risk_level] ?? `${f.name} has been assessed for infrastructure continuity risk.`)

  // Power: the most common failure trigger
  if (f.power_dependency_score > 75 && f.backup_readiness_score < 50) {
    parts.push(
      `It draws heavily from the grid (power risk score ${f.power_dependency_score}/100) but has only ${f.backup_readiness_score}/100 backup readiness — a sustained BESCOM outage could halt critical functions within 2–4 hours. There is no verified fallback once generator fuel runs out.`
    )
  } else if (f.power_dependency_score > 75) {
    parts.push(
      `Power grid dependency is high (${f.power_dependency_score}/100). While backup readiness is moderate at ${f.backup_readiness_score}/100, extended outages beyond backup runtime remain a serious concern.`
    )
  } else if (f.backup_readiness_score < 40) {
    parts.push(
      `Backup power readiness is low (${f.backup_readiness_score}/100). Even a short grid interruption could disrupt operations if the backup system is inadequate or unverified.`
    )
  }

  // Flood: location-based threat
  if (f.flood_exposure_score > 70) {
    parts.push(
      `Flood exposure is severe (${f.flood_exposure_score}/100). During heavy monsoon events, approach roads are likely to be inundated before the building itself is at risk — meaning ambulances and emergency vehicles lose access well before flooding affects core operations.`
    )
  } else if (f.flood_exposure_score > 55) {
    parts.push(
      `Moderate flood exposure (${f.flood_exposure_score}/100) — heavy rainfall events can cause localised waterlogging around the facility, affecting access and potentially ground-floor infrastructure.`
    )
  }

  // Road access risk (higher score = higher risk)
  if (f.road_access_score > 70) {
    parts.push(
      `Road access is severely constrained (risk score ${f.road_access_score}/100). The surrounding network offers limited approach corridors — during congestion, heavy rain, or road incidents, emergency response times will be significantly and unpredictably extended.`
    )
  } else if (f.road_access_score > 55) {
    parts.push(
      `Road access risk is elevated (${f.road_access_score}/100). Single-point road approaches and peak-hour congestion create meaningful delays for time-critical emergency responses.`
    )
  }

  // Water dependency
  if (f.water_dependency_score > 80) {
    parts.push(
      `Water supply criticality is high (${f.water_dependency_score}/100). Any BWSSB supply interruption directly affects core operations. Borewell supplementation is assumed but has not been independently confirmed — this gap represents a significant unverified risk.`
    )
  } else if (f.water_dependency_score > 65) {
    parts.push(
      `Water dependency is above average (${f.water_dependency_score}/100). Supply interruptions during BWSSB maintenance or peak summer demand periods would require verified backup sourcing.`
    )
  }

  // Heat
  if (f.heat_exposure_score > 70) {
    parts.push(
      `Thermal stress is elevated (${f.heat_exposure_score}/100). During Bengaluru's April–June heat period, surge AC loads increase grid stress, raise equipment failure rates, and can make indoor environments unsafe without adequate cooling redundancy.`
    )
  }

  // Facility-type: operational context that makes scores meaningful
  const typeContext: Record<string, string> = {
    hospital: 'As a hospital, even a 10-minute service interruption has direct patient safety consequences — surgeries cannot pause, ICU equipment cannot stop. This facility class should carry the highest continuity-planning priority in any zone-level resilience review.',
    water_pumping_station: 'Pumping station failures cascade immediately and silently — when this facility goes offline, entire ward-level water supply is interrupted across hospitals, households, and other critical sites downstream. Recovery takes hours, not minutes.',
    power_substation: 'A substation failure here cascades to every facility in this zone that lacks independent backup power. It is the single upstream choke point. Loss of this node triggers simultaneous secondary failures across the zone.',
    emergency_command_centre: 'Loss of this command centre during a disaster would degrade city-wide response coordination. It is the nerve centre that routes ambulances, manages resource allocation, and coordinates between agencies — its failure multiplies the impact of every other failure happening simultaneously.',
    sewage_treatment_plant: 'STP failures during flood events create a compound crisis — backflows and sanitation breakdown become secondary public health emergencies that persist long after floodwaters recede.',
    fire_station: 'Emergency response time from this station directly determines life-safety outcomes across the surrounding zone. Road access is the primary operational constraint — a fire station with blocked roads cannot fulfil its mandate.',
    police_station: 'During emergencies, this station coordinates traffic management, crowd control, and evacuation. Its ability to operate and deploy depends on power continuity and clear road access.',
    airport: 'As an aviation hub, any infrastructure failure here affects not just air traffic but emergency medical evacuations and disaster-response airlift capacity for the entire region.',
  }
  if (typeContext[f.facility_type]) {
    parts.push(typeContext[f.facility_type])
  }

  // Data confidence caveat
  if (f.data_confidence_score < 60) {
    parts.push(`Data confidence is limited at ${f.data_confidence_score}/100 — this assessment relies on public records and reasonable assumptions rather than verified facility data. Some risk dimensions may be significantly understated. Field verification is strongly recommended before operational use.`)
  }

  return parts.join('\n\n')
}

/** One-line summary suitable for map tooltips */
export function generateBriefNarrative(f: Facility): string {
  const risks: string[] = []
  if (f.power_dependency_score > 75 && f.backup_readiness_score < 50) risks.push('power vulnerable')
  if (f.flood_exposure_score > 65) risks.push('flood exposed')
  if (f.road_access_score > 65) risks.push('road constrained')
  if (f.water_dependency_score > 75) risks.push('water critical')
  if (f.heat_exposure_score > 70) risks.push('heat stressed')
  if (risks.length === 0) return 'Within manageable parameters'
  return `Key risks: ${risks.join(' · ')}`
}
