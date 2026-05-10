// Synthetic simulation scenarios — clearly labelled demo data.
// road_access_score is a RISK score (higher = worse access).
// backup_readiness_score is a GOODNESS score (lower = worse readiness).
import type { Facility } from '../types'
import { calculateContinuityRisk, classifyRiskLevel, deriveRiskDrivers } from '../utils/scoring'

export interface ScenarioFacilityOverride {
  facilityId: string
  delta: Partial<Pick<Facility,
    'flood_exposure_score' | 'power_dependency_score' | 'backup_readiness_score' |
    'road_access_score' | 'water_dependency_score' | 'heat_exposure_score'
  >>
  event_label: string
}

export interface Scenario {
  id: string
  name: string
  emoji: string
  tagline: string
  description: string
  severity: 'moderate' | 'severe' | 'critical'
  color: string
  overrides: ScenarioFacilityOverride[]
  corridor_statuses: Record<string, 'clear' | 'degraded' | 'blocked'>
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'S001',
    name: 'Bengaluru Flood',
    emoji: '🌊',
    tagline: 'September monsoon overflow — Bellandur lake breaches, ORR cut in 3 sections',
    description:
      'Historic flood scenario: Bellandur lake overflows into Marathahalli and Whitefield corridors. Electronic City STP submerged. Outer Ring Road cut in 3 sections. Ambulance ETA doubles across east Bengaluru. 6 facilities lose road access entirely.',
    severity: 'critical',
    color: '#3b82f6',
    overrides: [
      { facilityId: 'F010', delta: { flood_exposure_score: 95, road_access_score: 88, backup_readiness_score: 15 }, event_label: 'STP submerged — 0% operational. Access road under 1.2m water.' },
      { facilityId: 'F022', delta: { flood_exposure_score: 88, road_access_score: 82 }, event_label: 'Electronic City Phase 1 isolated. ORR exit ramp flooded. Workers evacuated.' },
      { facilityId: 'F036', delta: { flood_exposure_score: 92, road_access_score: 75 }, event_label: 'Bellandur 66kV substation at flood boundary — manual shutdown imminent.' },
      { facilityId: 'F026', delta: { flood_exposure_score: 85, road_access_score: 78 }, event_label: 'KR Puram industrial area — 0.8m water. 6 production units evacuated.' },
      { facilityId: 'F032', delta: { flood_exposure_score: 78, road_access_score: 80 }, event_label: 'KR Puram metro approach flooded. Station sealed to passengers.' },
      { facilityId: 'F002', delta: { flood_exposure_score: 58, road_access_score: 82 }, event_label: 'Marathahalli approach waterlogged. Ambulance diverted via Sarjapur Road only.' },
      { facilityId: 'F001', delta: { flood_exposure_score: 45, road_access_score: 72 }, event_label: 'Whitefield ITPL Road partially flooded. 40-min ambulance delay confirmed.' },
    ],
    corridor_statuses: {
      C001: 'degraded', C002: 'blocked', C003: 'clear', C004: 'clear',
      C005: 'clear', C006: 'clear', C007: 'clear', C008: 'clear',
      C009: 'degraded', C010: 'blocked',
    },
  },
  {
    id: 'S002',
    name: 'BESCOM Grid Cascade',
    emoji: '⚡',
    tagline: 'Peenya 220kV trips — 6-zone blackout spreads north and west',
    description:
      'Transformer fault at Peenya substation cascades to Hebbal, Yelahanka, and west zones. Hospitals without certified DG go dark within 4 minutes. Water pumping halts across 3 wards. KC General public hospital suspends OT — no certified backup power.',
    severity: 'severe',
    color: '#f59e0b',
    overrides: [
      { facilityId: 'F034', delta: { backup_readiness_score: 8, power_dependency_score: 99 }, event_label: 'SOURCE FAILURE. Peenya 220kV tripped. Manual restoration ETA: 4–8 hours.' },
      { facilityId: 'F009', delta: { backup_readiness_score: 18, power_dependency_score: 96 }, event_label: 'Hebbal pumping on emergency DG. 4h fuel reserve. Zone supply dropping.' },
      { facilityId: 'F011', delta: { backup_readiness_score: 10, power_dependency_score: 97 }, event_label: 'Peenya pumping dark. Supply to Peenya, Rajajinagar, Mathikere cut.' },
      { facilityId: 'F006', delta: { backup_readiness_score: 42, power_dependency_score: 94 }, event_label: 'Aster CMI on DG. ICU and OT maintained. Wards on emergency power.' },
      { facilityId: 'F007', delta: { backup_readiness_score: 38, power_dependency_score: 92 }, event_label: 'Baptist Hospital DG running. 6h fuel. Priority restore request sent to BESCOM.' },
      { facilityId: 'F004', delta: { backup_readiness_score: 15, power_dependency_score: 93 }, event_label: 'KC General (PUBLIC) — limited DG. OT suspended. ICU on UPS (45-min window).' },
      { facilityId: 'F018', delta: { backup_readiness_score: 30, power_dependency_score: 91 }, event_label: 'KSRP command center on UPS — 2h window. Backup generator delayed.' },
      { facilityId: 'F037', delta: { backup_readiness_score: 20, power_dependency_score: 96 }, event_label: 'Hebbal 110kV substation cascading from Peenya. Manual isolation active.' },
    ],
    corridor_statuses: {
      C001: 'clear', C002: 'clear', C003: 'degraded', C004: 'degraded',
      C005: 'clear', C006: 'clear', C007: 'clear', C008: 'clear',
      C009: 'degraded', C010: 'clear',
    },
  },
  {
    id: 'S003',
    name: 'Friday 6PM Emergency',
    emoji: '🚨',
    tagline: 'Peak-hour gridlock — ghost corridors are the only moving routes',
    description:
      'Mass casualty event during worst-case Friday evening traffic. All major arterials gridlocked. Only pre-cleared ghost corridors are operational. Ambulance ETA triples across east and north Bengaluru. This scenario shows exactly WHY ghost corridors exist.',
    severity: 'moderate',
    color: '#ef4444',
    overrides: [
      { facilityId: 'F001', delta: { road_access_score: 88 }, event_label: 'Whitefield ITPL signal failed. 2.5km queue. Ambulance took 48 min.' },
      { facilityId: 'F002', delta: { road_access_score: 84 }, event_label: 'Marathahalli junction gridlock. Ambulance diverted via Doddanekundi.' },
      { facilityId: 'F003', delta: { road_access_score: 65 }, event_label: 'Bowring via Queens Rd: 35 min delay. Inner lane partially clear.' },
      { facilityId: 'F006', delta: { road_access_score: 82 }, event_label: 'Hebbal flyover stop-and-go. Ambulance via Mekhri Circle: 28 min extra.' },
      { facilityId: 'F007', delta: { road_access_score: 78 }, event_label: 'Baptist via Hebbal junction: 25 min delay. Back gate now emergency entry.' },
      { facilityId: 'F029', delta: { road_access_score: 80 }, event_label: 'Airport expressway standstill. All lanes occupied. Emergency lane manually cleared.' },
      { facilityId: 'F032', delta: { road_access_score: 85 }, event_label: 'KR Puram bridge one-lane. Metro used for medical courier only.' },
    ],
    corridor_statuses: {
      C001: 'blocked', C002: 'blocked', C003: 'clear', C004: 'blocked',
      C005: 'degraded', C006: 'degraded', C007: 'degraded', C008: 'degraded',
      C009: 'blocked', C010: 'blocked',
    },
  },
  {
    id: 'S004',
    name: 'May Heat Emergency',
    emoji: '🌡️',
    tagline: '43°C for 5 days — AC loads surge, transformers overheat, water scarce',
    description:
      'Sustained extreme heat event. BESCOM load crosses 4,200MW — 18% above the all-time record. Industrial transformers in Peenya and Whitefield are thermal-limited. BWSSB reservoirs drop to 40% capacity. Public hospitals with aging HVAC report ward temperatures above 36°C.',
    severity: 'moderate',
    color: '#f97316',
    overrides: [
      { facilityId: 'F001', delta: { heat_exposure_score: 84, power_dependency_score: 93 }, event_label: 'AC load at 145% rated. Generator thermal stress. BESCOM priority feeder requested.' },
      { facilityId: 'F003', delta: { heat_exposure_score: 90, water_dependency_score: 90 }, event_label: 'Old building: ward temp 36°C. No insulation. Patient distress escalating.' },
      { facilityId: 'F004', delta: { heat_exposure_score: 86, water_dependency_score: 88 }, event_label: 'KC General (public): aging HVAC, 2 units down. Ward at 35°C.' },
      { facilityId: 'F009', delta: { heat_exposure_score: 87, water_dependency_score: 99 }, event_label: 'Pumping motor at thermal limit. Demand 185% of rated. 2 motors alternating.' },
      { facilityId: 'F034', delta: { heat_exposure_score: 90, power_dependency_score: 99 }, event_label: 'Peenya 220kV at 96% thermal rating. Demand control alerts issued.' },
      { facilityId: 'F024', delta: { heat_exposure_score: 92, power_dependency_score: 90 }, event_label: 'Peenya industrial — 2 transformers at thermal limit. 3 units shut preventively.' },
      { facilityId: 'F029', delta: { heat_exposure_score: 75, water_dependency_score: 82 }, event_label: 'Airport terminal cooling at capacity. Gate areas at 33°C. Heat advisory active.' },
    ],
    corridor_statuses: {
      C001: 'clear', C002: 'clear', C003: 'clear', C004: 'clear',
      C005: 'clear', C006: 'clear', C007: 'clear', C008: 'clear',
      C009: 'clear', C010: 'clear',
    },
  },
]

/** Apply a scenario's overrides to a base facility list, recomputing all derived scores. */
export function applyScenario(baseFacilities: Facility[], scenario: Scenario): Facility[] {
  const overrideMap = new Map(scenario.overrides.map(o => [o.facilityId, o]))
  return baseFacilities.map(f => {
    const override = overrideMap.get(f.id)
    if (!override) return f
    const modified = { ...f, ...override.delta }
    const crs = calculateContinuityRisk(modified)
    const riskLevel = classifyRiskLevel(crs, modified.data_confidence_score)
    return {
      ...modified,
      continuity_risk_score: crs,
      risk_level: riskLevel,
      main_risk_drivers: deriveRiskDrivers({ ...modified, continuity_risk_score: crs, risk_level: riskLevel } as Facility),
    }
  })
}

/** Get the scenario narrative for a specific facility under an active scenario */
export function getFacilityScenarioNote(facilityId: string, scenario: Scenario): string | null {
  const override = scenario.overrides.find(o => o.facilityId === facilityId)
  return override?.event_label ?? null
}
