import type { ExplanationProvider, EvidenceItem } from './evidence'

/** Deterministic explanations: readable prose assembled from evidence statements only. */
export const TemplateExplainer: ExplanationProvider = {
  id: 'template-explainer/1',
  async explain(_question, intent, evidence: EvidenceItem[]) {
    if (evidence.length === 0) return 'No evidence is available for this question in the current view and time window.'
    const lead: Record<string, string> = {
      whats_happening: 'Here is what the available signals show for this area.',
      why_slow: 'Traffic here is slower than free flow. The contributing signals are:',
      unusual: 'These patterns diverge from expected behaviour:',
      dangerous_intersections: 'Intersections with the highest derived risk indicators right now:',
      history: 'Recorded events in this window:',
      forecast: 'Looking ahead, the models suggest:',
      site_selection: 'Ranked candidate locations by the configured scoring modules:',
      route: 'Route evaluation:',
      pulse: 'City pulse right now:',
    }
    const lines = evidence.slice(0, 8).map((e) => `• ${e.statement}${e.confidence !== undefined ? ` (confidence ${Math.round(e.confidence * 100)}%)` : ''}`)
    return `${lead[intent] ?? ''}\n${lines.join('\n')}`
  },
}
