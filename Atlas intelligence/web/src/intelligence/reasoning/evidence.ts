import type { EvidenceClassification } from '../../entities/types'
import type { WorldPoint } from '../../geo/projection/mercator'

/** A single structured fact gathered for a question. The LLM (if any) only ever sees these. */
export interface EvidenceItem {
  id: string
  classification: EvidenceClassification
  statement: string
  value?: number | string
  location?: WorldPoint
  entityIds?: string[]
  confidence?: number
  source?: string
}

export interface Answer {
  question: string
  intent: string
  summary: string
  evidence: EvidenceItem[]
  /** points and entity ids the UI should highlight */
  highlights: { points: WorldPoint[]; entityIds: string[]; agentIds: number[] }
  /** overall classification of the answer (the weakest class among its evidence) */
  classification: EvidenceClassification
  caveats: string[]
  /** which writer phrased `summary` (template or the AI writer's model id) */
  writer?: string
}

export function weakest(items: EvidenceItem[]): EvidenceClassification {
  const order: EvidenceClassification[] = ['observed', 'derived', 'simulated', 'predicted']
  let w = 0
  for (const i of items) w = Math.max(w, order.indexOf(i.classification))
  return order[w] ?? 'observed'
}

/**
 * Explanation providers turn structured evidence into prose. The default is
 * a template explainer. An LLM-backed provider receives *only* the evidence
 * list and must return prose; it cannot query the world.
 */
export interface ExplanationProvider {
  id: string
  explain(question: string, intent: string, evidence: EvidenceItem[]): Promise<string>
}
