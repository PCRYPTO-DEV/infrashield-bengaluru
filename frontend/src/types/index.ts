export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical' | 'Insufficient Data'
export type OwnerType = 'public' | 'private' | 'unknown'

export interface Facility {
  id: string
  name: string
  facility_type: string
  latitude: number
  longitude: number
  zone: string
  owner_type: OwnerType
  criticality_score: number
  power_dependency_score: number
  backup_readiness_score: number
  flood_exposure_score: number
  water_dependency_score: number
  road_access_score: number
  heat_exposure_score: number
  data_confidence_score: number
  continuity_risk_score: number
  risk_level: RiskLevel
  main_risk_drivers: string[]
  recommended_actions: string[]
  assumptions: string[]
  data_sources: string[]
  last_updated: string
}

export interface PowerAsset {
  id: string
  name: string
  asset_type: string
  latitude: number
  longitude: number
  zone: string
  capacity_mva?: number
  feeder_count?: number
  reliability_score?: number
}

export interface RiskZoneProperties {
  zone_id: string
  name: string
  risk_type: 'flood' | 'water_stress' | 'road_access' | 'heat'
  severity: 'Low' | 'Medium' | 'High' | 'Critical'
  description: string
}

export interface FilterState {
  facilityTypes: string[]
  riskLevels: RiskLevel[]
  zone: string
  minConfidence: number
}

export interface LayerState {
  facilities: boolean
  powerAssets: boolean
  floodZones: boolean
  waterStress: boolean
  roadAccess: boolean
  heatZones: boolean
  satelliteThermal: boolean   // NASA GIBS VIIRS thermal anomalies
  satelliteFlood: boolean     // NASA GIBS MODIS flood detection
  nightLights: boolean        // NASA GIBS VIIRS night-time lights (power outage proxy)
  ghostCorridors: boolean     // Animated ambulance ghost corridors between hospitals
  powerStress: boolean        // Live zone power stress choropleth (power intelligence layer)
}

// ── Power Intelligence Layer types ────────────────────────────────────────────

export interface PowerScoreDelta {
  facility_id: string
  facility_name: string
  zone: string
  original_power_score: number
  new_power_score: number
  delta: number
  new_continuity_risk_score: number
  feeder_id: string | null
  feeder_name: string | null
  feeder_stress: number
  zone_tier: 'LOW' | 'ELEVATED' | 'HIGH' | 'CRITICAL'
}

export interface PowerActionPlan {
  facility_id: string
  facility_name: string
  zone: string
  priority: number
  action: string
  rationale: string
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  timeframe: 'immediate' | 'this_week' | 'this_month'
  generated_at: string
}

export interface ReportSummary {
  generated_at: string
  total_facilities: number
  critical_count: number
  high_count: number
  medium_count: number
  low_count: number
  insufficient_data_count: number
  top_10_facilities: Facility[]
  zone_risk_summary: Record<string, { count: number; avg_score: number; top_facility: string; top_score: number }>
  critical_themes: string[]
  data_confidence_gaps: string[]
  verification_checklist: string[]
  actions_30_day: string[]
  actions_90_day: string[]
  disclaimer: string
}

export const ALL_FACILITY_TYPES = [
  'hospital',
  'clinic',
  'water_pumping_station',
  'sewage_treatment_plant',
  'fire_station',
  'police_station',
  'emergency_command_centre',
  'tech_park',
  'industrial_estate',
  'public_building',
  'metro_station',
  'bus_depot',
  'railway_station',
  'airport',
  'power_substation',
] as const

export const ALL_RISK_LEVELS: RiskLevel[] = ['Critical', 'High', 'Medium', 'Low', 'Insufficient Data']

export const ZONES = [
  'All Zones',
  'Whitefield',
  'Electronic City',
  'Bellandur',
  'Koramangala',
  'Hebbal',
  'Yelahanka',
  'KR Puram',
  'Peenya',
  'Indiranagar',
  'Majestic',
  'Sarjapur Road',
  'Manyata / Nagavara',
  'Marathahalli',
  'HSR Layout',
  'Central Bengaluru',
]
