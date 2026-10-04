import type { ExplanationProvider, EvidenceItem } from './evidence'
import { createTemplateExplainer } from './templateExplainer'

export type Language = 'en' | 'hi'

export interface WriterReply { text: string; writer: string; language: Language }
export interface ChatReply extends WriterReply { actions: string[] }
export interface ChatTurn { role: 'user' | 'assistant'; content: string }

/**
 * The AI writer behind the server's `/api/explain` and `/api/ask`. It is
 * only ever handed the evidence list (or a snapshot of facts); the server
 * prompt forbids new facts. When the server is missing, slow or declines,
 * the template writer answers instead and `lastWriter` says so, so the UI
 * can label which writer produced the prose.
 */
export class ClaudeExplainer implements ExplanationProvider {
  id = 'claude-writer'
  lastWriter = 'template'
  lastError: string | null = null
  private template: ExplanationProvider
  constructor(private baseUrl: string, private language: () => Language, private timeoutMs = 12000) { this.template = createTemplateExplainer(language) }

  private async post(path: string, body: unknown): Promise<WriterReply> {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), this.timeoutMs)
    try {
      const r = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal })
      if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try { detail = String((await r.json()).detail ?? detail) } catch { /* not json */ }
        throw new Error(detail)
      }
      return (await r.json()) as WriterReply
    } finally { clearTimeout(t) }
  }

  async explain(question: string, intent: string, evidence: EvidenceItem[]): Promise<string> {
    if (evidence.length === 0) return this.template.explain(question, intent, evidence)
    try {
      const reply = await this.post('/api/explain', { question, intent, language: this.language(), evidence: evidence.slice(0, 60).map(slim) })
      this.lastWriter = reply.writer; this.lastError = null
      return reply.text
    } catch (e) {
      this.lastWriter = 'template'; this.lastError = (e as Error).message
      return this.template.explain(question, intent, evidence)
    }
  }

  /** A conversation turn: the recent thread, the facts the app knows now, a little context. Null when the writer is unavailable. */
  async chat(messages: ChatTurn[], facts: EvidenceItem[], context: Record<string, string | number>): Promise<ChatReply | null> {
    try {
      const r = await fetch(`${this.baseUrl}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: messages.slice(-20), facts: facts.slice(0, 80).map(slim), language: this.language(), context }), signal: AbortSignal.timeout(this.timeoutMs + 8000) })
      if (!r.ok) { let d = `HTTP ${r.status}`; try { d = String((await r.json()).detail ?? d) } catch { /* not json */ } throw new Error(d) }
      const reply = (await r.json()) as ChatReply
      this.lastWriter = reply.writer; this.lastError = null
      return reply
    } catch (e) { this.lastWriter = 'template'; this.lastError = (e as Error).message; return null }
  }

  /** A free question answered from a snapshot of facts; null when the writer is unavailable. */
  async askFree(question: string, snapshot: EvidenceItem[]): Promise<string | null> {
    try {
      const reply = await this.post('/api/ask', { question, language: this.language(), snapshot: snapshot.slice(0, 60).map(slim) })
      this.lastWriter = reply.writer; this.lastError = null
      return reply.text
    } catch (e) { this.lastWriter = 'template'; this.lastError = (e as Error).message; return null }
  }
}

function slim(e: EvidenceItem) {
  return { id: e.id, classification: e.classification, statement: e.statement.slice(0, 400), value: typeof e.value === 'number' || typeof e.value === 'string' ? e.value : undefined, confidence: e.confidence, source: e.source }
}
