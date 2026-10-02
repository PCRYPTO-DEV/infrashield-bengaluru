import type { ExplanationProvider, EvidenceItem } from './evidence'
import { tr, type StringKey } from '../../ui/i18n'
import type { Language } from './claudeExplainer'

/**
 * Deterministic explanations in plain words: a one-line lead for the kind
 * of question, then the evidence statements as they are. No AI, no new
 * facts. This is what answers when the AI writer is off or unreachable.
 */
export function createTemplateExplainer(language: () => Language = () => 'en'): ExplanationProvider {
  return {
    id: 'template-explainer/2',
    async explain(_question, intent, evidence: EvidenceItem[]) {
      const lang = language()
      if (evidence.length === 0) return tr(lang, 'tpl.none')
      const leadKey = `tpl.${intent}` as StringKey
      const lead = (leadKey in LEADS) ? tr(lang, leadKey) : tr(lang, 'tpl.whats_happening')
      const lines = evidence.slice(0, 8).map((e) => `• ${e.statement}${e.confidence !== undefined ? ` (${tr(lang, 'tpl.sure', { c: Math.round(e.confidence * 100) })})` : ''}`)
      const note = lang === 'hi' ? `\n${tr(lang, 'tpl.hindi.note')}` : ''
      return `${lead}\n${lines.join('\n')}${note}`
    },
  }
}

const LEADS: Record<string, true> = { 'tpl.whats_happening': true, 'tpl.why_slow': true, 'tpl.unusual': true, 'tpl.dangerous_intersections': true, 'tpl.history': true, 'tpl.forecast': true, 'tpl.site_selection': true, 'tpl.route': true, 'tpl.pulse': true, 'tpl.help': true }

/** English default, for callers that do not carry a language. */
export const TemplateExplainer: ExplanationProvider = createTemplateExplainer()
