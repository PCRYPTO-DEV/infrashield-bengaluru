// Scoring logic — mirrors backend/scoring.py exactly.
// SYNTHETIC scoring only. Not for operational use without field validation.
import type { Facility, RiskLevel } from '../types'

const WEIGHTS = {
  criticality: 0.20,
  power_dependency: 0.20,
  backup_readiness: 0.15,   // inverted
  flood_exposure: 0.15,
  water_dependency: 0.10,
  road_access: 0.10,
  heat_exposure: 0.05,
  data_confidence: 0.05,    // inverted
}

export function calculateContinuityRisk(f: Pick<Facility,
  'criticality_score' | 'power_dependency_score' | 'backup_readiness_score' |
  'flood_exposure_score' | 'water_dependency_score' | 'road_access_score' |
  'heat_exposure_score' | 'data_confidence_score'
>): number {
  const score =
    WEIGHTS.criticality * f.criticality_score +
    WEIGHTS.power_dependency * f.power_dependency_score +
    WEIGHTS.backup_readiness * (100 - f.backup_readiness_score) +
    WEIGHTS.flood_exposure * f.flood_exposure_score +
    WEIGHTS.water_dependency * f.water_dependency_score +
    WEIGHTS.road_access * f.road_access_score +
    WEIGHTS.heat_exposure * f.heat_exposure_score +
    WEIGHTS.data_confidence * (100 - f.data_confidence_score)
  return Math.round(Math.min(Math.max(score, 0), 100) * 10) / 10
}

export function classifyRiskLevel(score: number, dataConfidence: number): RiskLevel {
  if (dataConfidence < 50) return 'Insufficient Data'
  if (score <= 30) return 'Low'
  if (score <= 55) return 'Medium'
  if (score <= 75) return 'High'
  return 'Critical'
}

export function deriveRiskDrivers(f: Facility): string[] {
  const drivers: string[] = []
  if (f.power_dependency_score > 75) drivers.push('High power-dependency exposure')
  if (f.backup_readiness_score < 25) drivers.push('Backup readiness gap requires verification')
  if (f.flood_exposure_score > 70) drivers.push('Potential flood / drainage exposure')
  if (f.water_dependency_score > 70) drivers.push('Water continuity dependency risk')
  if (f.road_access_score > 70) drivers.push('Emergency access vulnerability')
  if (f.heat_exposure_score > 65) drivers.push('Elevated heat exposure risk')
  if (f.data_confidence_score < 50) drivers.push('Low data confidence — field verification required')
  if (f.criticality_score > 80) drivers.push('High facility criticality amplifies all risk factors')
  if (drivers.length === 0) drivers.push('No dominant risk driver identified — review sub-scores')
  return drivers
}

export function deriveRecommendedActions(f: Facility): string[] {
  const actions: string[] = []
  if (f.power_dependency_score > 60) actions.push('Verify feeder and substation dependency with BESCOM.')
  if (f.backup_readiness_score < 40) actions.push('Confirm DG / UPS runtime and fuel logistics capacity.')
  if (f.flood_exposure_score > 55) actions.push('Conduct flood and stormwater-drainage site inspection.')
  if (f.road_access_score > 55) actions.push('Validate emergency access route during peak traffic and rainfall.')
  if (f.water_dependency_score > 55) actions.push('Confirm water source, storage, tanker dependency and pumping backup.')
  if (f.heat_exposure_score > 55) actions.push('Create facility continuity plan for heatwave and monsoon events.')
  if (f.data_confidence_score < 60) actions.push('Add facility to district-level resilience verification list.')
  actions.push('Cross-check facility data with BBMP / operator records before operational use.')
  return actions
}

export const SCORE_BREAKDOWN_LABELS: { key: keyof Facility; label: string; inverted?: boolean }[] = [
  { key: 'criticality_score', label: 'Facility Criticality' },
  { key: 'power_dependency_score', label: 'Power Dependency' },
  { key: 'backup_readiness_score', label: 'Backup Readiness', inverted: true },
  { key: 'flood_exposure_score', label: 'Flood Exposure' },
  { key: 'water_dependency_score', label: 'Water Dependency' },
  { key: 'road_access_score', label: 'Road / Access Risk' },
  { key: 'heat_exposure_score', label: 'Heat Exposure' },
  { key: 'data_confidence_score', label: 'Data Confidence', inverted: true },
]
