/**
 * Atlas Infinity visual language tokens.
 *
 * Paper + ink, inherited in spirit from Shan Shui: a warm paper ground,
 * thin ink geometry, no saturated fills. Evidence classification owns the
 * only strong hues so the eye reads *certainty*, not category.
 */
export const PALETTE = {
  paper: '#f3eee3',
  paperDeep: '#e9e2d3',
  ink: '#2b2a26',
  inkSoft: 'rgba(43,42,38,0.55)',
  inkFaint: 'rgba(43,42,38,0.22)',
  inkHair: 'rgba(43,42,38,0.12)',
  roadCasing: 'rgba(43,42,38,0.35)',
  roadFill: '#f8f4ea',
  building: '#e6dfcf',
  buildingTall: '#d9d0bb',
  buildingStroke: 'rgba(43,42,38,0.45)',
  park: '#dfe4cf',
  parkStipple: 'rgba(70,90,50,0.35)',
  water: '#d8e2e4',
  construction: 'rgba(196,140,70,0.28)',
  constructionHatch: 'rgba(150,100,40,0.5)',
  transit: '#3a4a6b',

  /** Evidence classes */
  observed: '#2b2a26',
  derived: '#2f7f86',
  derivedSoft: 'rgba(47,127,134,0.18)',
  predicted: '#6f66a3',
  predictedSoft: 'rgba(111,102,163,0.22)',
  simulated: '#8a5a86',
  simulatedSoft: 'rgba(138,90,134,0.14)',

  /** Signals */
  risk: '#b5493a',
  riskSoft: 'rgba(181,73,58,0.16)',
  activity: '#c98a2e',
  activitySoft: 'rgba(201,138,46,0.22)',
  vehicle: '#2b2a26',
  pedestrian: '#4f6b57',
  signalGreen: '#5a9a62',
  signalRed: '#b5493a',
  selection: '#1d6fa5',
} as const

export type EvidenceColourKey = 'observed' | 'derived' | 'predicted' | 'simulated'
export function evidenceColour(c: EvidenceColourKey): string {
  return PALETTE[c]
}
