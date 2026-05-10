import type { RiskLevel } from '../types'

export const RISK_COLORS: Record<RiskLevel, string> = {
  'Critical': '#ef4444',
  'High': '#f97316',
  'Medium': '#f59e0b',
  'Low': '#22c55e',
  'Insufficient Data': '#9ca3af',
}

export const RISK_BG_CLASSES: Record<RiskLevel, string> = {
  'Critical': 'bg-red-100 text-red-800 border-red-200',
  'High': 'bg-orange-100 text-orange-800 border-orange-200',
  'Medium': 'bg-yellow-100 text-yellow-800 border-yellow-200',
  'Low': 'bg-green-100 text-green-800 border-green-200',
  'Insufficient Data': 'bg-gray-100 text-gray-700 border-gray-200',
}

export const RISK_RING_CLASSES: Record<RiskLevel, string> = {
  'Critical': 'stroke-red-500',
  'High': 'stroke-orange-500',
  'Medium': 'stroke-yellow-500',
  'Low': 'stroke-green-500',
  'Insufficient Data': 'stroke-gray-400',
}

export const ZONE_RISK_FILL: Record<string, string> = {
  flood: 'rgba(59,130,246,0.22)',
  water_stress: 'rgba(234,179,8,0.18)',
  road_access: 'rgba(249,115,22,0.18)',
  heat: 'rgba(239,68,68,0.16)',
}

export const ZONE_RISK_BORDER: Record<string, string> = {
  flood: '#60a5fa',
  water_stress: '#fbbf24',
  road_access: '#fb923c',
  heat: '#f87171',
}

export function scoreToBarColor(score: number): string {
  if (score >= 76) return '#ef4444'
  if (score >= 56) return '#f97316'
  if (score >= 31) return '#f59e0b'
  return '#22c55e'
}

export function facilityTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    hospital: '🏥',
    clinic: '🏥',
    water_pumping_station: '💧',
    sewage_treatment_plant: '🔄',
    fire_station: '🚒',
    police_station: '🚔',
    emergency_command_centre: '📡',
    tech_park: '💼',
    industrial_estate: '🏭',
    public_building: '🏛️',
    metro_station: '🚇',
    bus_depot: '🚌',
    railway_station: '🚂',
    airport: '✈️',
    power_substation: '⚡',
  }
  return icons[type] ?? '📍'
}

export function formatFacilityType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
