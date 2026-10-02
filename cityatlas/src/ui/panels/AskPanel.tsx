import { useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'

const SUGGESTIONS = ["What's happening here?", 'Why is traffic slow?', 'Show unusual activity', 'Where are the dangerous intersections?', 'Show activity during the last hour', 'What may happen in the next 30 minutes?', 'Where should I open a café?']

export function AskPanel({ app }: { app: CityAtlas }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const a = app.lastAnswer
  const submit = async (question: string) => { if (!question.trim()) return; setBusy(true); try { await app.ask(question) } finally { setBusy(false) } }
  return (
    <div className="ca-panel ca-ask">
      <h3>Ask the city</h3>
      <form onSubmit={(e) => { e.preventDefault(); void submit(q) }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="What's happening here?" />
        <button type="submit" disabled={busy}>Ask</button>
        {a && <button type="button" onClick={() => { app.lastAnswer = null; app.clearHighlights() }}>Clear</button>}
      </form>
      {!a && <div className="ca-chips">{SUGGESTIONS.map((s) => <button key={s} onClick={() => { setQ(s); void submit(s) }}>{s}</button>)}</div>}
      {a && (
        <div className="ca-answer">
          <span className={`ca-badge ${a.classification}`}>{a.classification}</span> <small style={{ color: 'var(--ink-soft)' }}>intent: {a.intent} · {a.evidence.length} evidence items</small>
          {'\n'}{a.summary}
          {a.caveats.map((c, i) => <div className="caveat" key={i}>{c}</div>)}
        </div>
      )}
    </div>
  )
}
