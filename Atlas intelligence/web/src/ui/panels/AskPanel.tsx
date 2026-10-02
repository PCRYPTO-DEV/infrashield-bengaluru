import { useEffect, useRef, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import { canListen, canSpeak, listenOnce, speak, stopSpeaking } from '../voice'
import { cls } from '../i18n'

const SUGGESTIONS: Record<'en' | 'hi', string[]> = {
  en: ["What's happening here?", 'Why is traffic slow?', 'Show unusual activity', 'Where are the dangerous intersections?', 'What may happen in the next 30 minutes?', 'Where should I open a café?', 'Is it raining?'],
  hi: ['यहाँ क्या हो रहा है?', 'ट्रैफ़िक धीमा क्यों है?', 'कुछ असामान्य दिखाओ', 'ख़तरनाक चौराहे कहाँ हैं?', 'अगले 30 मिनट में क्या हो सकता है?', 'मुझे चाय की दुकान कहाँ खोलनी चाहिए?', 'क्या बारिश हो रही है?'],
}

const T = {
  en: { title: 'Ask Atlas', placeholder: 'Ask anything about this city…', ask: 'Ask', clear: 'Clear', listen: 'Speak your question', listening: 'Listening…', read: 'Read aloud', stop: 'Stop reading', writer: 'written by', template: 'plain template', evidence: 'facts used', free: 'free question' },
  hi: { title: 'एटलस से पूछें', placeholder: 'इस शहर के बारे में कुछ भी पूछें…', ask: 'पूछें', clear: 'हटाएँ', listen: 'बोलकर पूछें', listening: 'सुन रहे हैं…', read: 'पढ़कर सुनाएँ', stop: 'रोकें', writer: 'लेखक', template: 'सादा टेम्पलेट', evidence: 'इस्तेमाल किए गए तथ्य', free: 'खुला सवाल' },
}

/**
 * One box for any question: typed or spoken. Fixed questions are answered
 * by the analysers; anything else goes to the AI writer as a free question
 * answered from a snapshot of what the map knows. The answer always lists
 * the facts it was built from.
 */
export function AskPanel({ app }: { app: CityAtlas }) {
  const lang = app.language
  const t = T[lang]
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [showFacts, setShowFacts] = useState(false)
  const cancelRef = useRef<() => void>(() => {})
  const a = app.lastAnswer
  useEffect(() => () => { cancelRef.current(); stopSpeaking() }, [])

  const submit = async (question: string) => { if (!question.trim()) return; setBusy(true); try { await app.ask(question) } finally { setBusy(false) } }
  const listen = async () => {
    if (listening) { cancelRef.current(); setListening(false); return }
    setListening(true)
    const { done, cancel } = listenOnce(lang, (partial) => setQ(partial))
    cancelRef.current = cancel
    const text = await done
    setListening(false)
    if (text) { setQ(text); await submit(text) }
  }
  const read = () => {
    if (!a) return
    if (speaking) { stopSpeaking(); setSpeaking(false); return }
    if (speak(a.summary, lang)) { setSpeaking(true); const id = setInterval(() => { if (!speechSynthesis.speaking) { setSpeaking(false); clearInterval(id) } }, 400) }
  }

  return (
    <div className="ca-panel ca-ask">
      <h3>{t.title} {a?.writer && a.writer !== 'template' && <span className="ca-badge derived" style={{ marginLeft: 6 }}>AI</span>}</h3>
      <form onSubmit={(e) => { e.preventDefault(); void submit(q) }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={listening ? t.listening : t.placeholder} lang={lang === 'hi' ? 'hi' : 'en'} />
        {canListen() && <button type="button" className={`ca-mic ${listening ? 'on' : ''}`} title={t.listen} aria-label={t.listen} onClick={() => void listen()}>{listening ? '●' : '🎤'}</button>}
        <button type="submit" disabled={busy}>{busy ? '…' : t.ask}</button>
        {a && <button type="button" onClick={() => { stopSpeaking(); app.lastAnswer = null; app.clearHighlights() }}>{t.clear}</button>}
      </form>
      {!a && <div className="ca-chips">{SUGGESTIONS[lang].map((s) => <button key={s} onClick={() => { setQ(s); void submit(s) }}>{s}</button>)}</div>}
      {a && (
        <div className="ca-answer" lang={lang === 'hi' ? 'hi' : 'en'}>
          <span className={`ca-badge ${a.classification}`}>{cls(lang, a.classification)}</span> <small style={{ color: 'var(--ink-soft)' }}>{a.intent === 'free' ? t.free : a.intent.replace(/_/g, ' ')} · {t.writer} {a.writer && a.writer !== 'template' ? a.writer : t.template}</small>
          {canSpeak() && <button type="button" className="small ca-read" onClick={read}>{speaking ? t.stop : t.read}</button>}
          {'\n'}{a.summary}
          {a.evidence.length > 0 && <div><button type="button" className="small" onClick={() => setShowFacts(!showFacts)}>{showFacts ? '▾' : '▸'} {a.evidence.length} {t.evidence}</button></div>}
          {showFacts && <ul className="ca-facts">{a.evidence.map((e) => <li key={e.id}><span className={`ca-badge ${e.classification}`}>{cls(lang, e.classification)}</span> {e.statement}</li>)}</ul>}
          {a.caveats.map((c, i) => <div className="caveat" key={i}>{c}</div>)}
        </div>
      )}
    </div>
  )
}
