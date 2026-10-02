export type ViewMode = 'reality' | 'mobility' | 'activity' | 'risk' | 'forecast' | 'ink3d'

export interface LayerFlags {
  roads: boolean
  buildings: boolean
  vehicles: boolean
  pedestrians: boolean
  signals: boolean
  incidents: boolean
  zones: boolean
  predictions: boolean
  anomalies: boolean
  density: boolean
  flow: boolean
  risk: boolean
  forecast: boolean
  activity: boolean
  uploads: boolean
  labels: boolean
}

export const MODES: Array<{ id: ViewMode; label: string; blurb: string }> = [
  { id: 'reality', label: 'Reality', blurb: 'Observed and simulated city objects only' },
  { id: 'mobility', label: 'Mobility', blurb: 'Traffic flow, congestion and movement traces' },
  { id: 'activity', label: 'Activity', blurb: 'Urban activity density and pulses' },
  { id: 'risk', label: 'Risk', blurb: 'Anomalies, incidents and risk contours' },
  { id: 'forecast', label: 'Forecast', blurb: 'Predicted paths and congestion ahead' },
  { id: 'ink3d', label: 'Ink 3D', blurb: 'Buildings drawn in 3D as ink lines (fogleman/ln hidden-line engine); zoom in to street level' },
]

const BASE: LayerFlags = { roads: true, buildings: true, vehicles: true, pedestrians: true, signals: true, incidents: true, zones: true, predictions: false, anomalies: false, density: false, flow: false, risk: false, forecast: false, activity: false, uploads: true, labels: true }

export function modeDefaults(mode: ViewMode): LayerFlags {
  switch (mode) {
    case 'reality': return { ...BASE }
    case 'mobility': return { ...BASE, flow: true, pedestrians: false, predictions: true }
    case 'activity': return { ...BASE, density: true, activity: true, vehicles: false }
    case 'risk': return { ...BASE, anomalies: true, risk: true, pedestrians: false }
    case 'forecast': return { ...BASE, forecast: true, predictions: true, pedestrians: false }
    case 'ink3d': return { ...BASE, pedestrians: false, labels: false }
  }
}
