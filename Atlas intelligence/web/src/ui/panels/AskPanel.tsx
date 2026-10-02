import { useEffect, useRef, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import { canListen, canSpeak, listenOnce, speak, stopSpeaking } from '../voice'
import { cls } from '../i18n'

const SUGGESTIONS: Record<'en' | 'hi', string[]> = {
  en: ["What's happening here?", 'Why is traffic slow?', 'Show unusual activity', 'Where are the dangerous intersections?', 'What may happen in the next 30 minutes?', 'Where should I open a café?', 'Is it raining?'],
  hi: ['यहाँ क्या हो रहा है?', 'ट्रैफ़िक धीमा क्यों है?', 'कुछ असामान्य दिखाओ', 'ख़तरनाक चौराहे कहाँ हैं?', 'अगले 30 मिनट में क्या हो सकता है?', 'मुझे चाय की दुकान कहाँ खोलनी चाहिए?', 'क्या बारिश हो रही है?'],
}

const T = {
  en: { title: 'Ask Atlas', placeholder: 'Ask anything about this city…', follow: 'Ask a follow-up…', ask: 'Ask', clear: 'New chat', listen: 'Speak your question', listening: 'Listening…', read: 'Read aloud', stop: 'Stop reading', writer: 'written by', template: 'plain template', evidence: 'facts used', thinking: 'Atlas is looking at the map…' },
  hi: { title: 'एटलस से पूछें', placeholder: 'इस शहर के बारे में कुछ भी पूछें…', follow: 'आगे पूछें…', ask: 'पूछें', clear: 'नई बातचीत', listen: 'बोलकर पूछें', listening: 'सुन रहे हैं…', read: 'पढ़कर सुनाएँ', stop: 'रोकें', writer: 'लेखक', template: 'सादा टेम्पलेट', evidence: 'इस्तेमाल किए गए तथ्य', thinking: 'एटलस नक्शा देख रहा है…' },
}

/**
 * A conversation with Atlas. Typed or spoken; the thread stays on screen so follow-ups work
 * ("why?", "and tomorrow?"). Every Atlas turn can show the facts it was built from.
 */
export function AskPanel({ app }: { app: CityAtlas }) {
  const lang = app.language
  const t = T[lang]
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [factsFor, setFactsFor] = useState<number | null>(null)
  const cancelRef = useRef<() => void>(() => {})
  const endRef = useRef<HTMLDivElement>(null)
  const thread = app.chat
  useEffect(() => () => { cancelRef.current(); stopSpeaking() }, [])
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [thread.length, busy])

  const submit = async (question: string) => { if (!question.trim() || busy) return; setQ(''); setBusy(true); try { await app.ask(question) } finally { setBusy(false) } }
  const listen = async () => {
    if (listening) { cancelRef.current(); setListening(false); return }
    setListening(true)
    const { done, cancel } = listenOnce(lang, (partial) => setQ(partial))
    cancelRef.current = cancel
    const text = await done
    setListening(false)
    if (text) { setQ(text); await submit(text) }
  }
  const read = (text: string) => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return }
    if (speak(text, lang)) { setSpeaking(true); const id = setInterval(() => { if (!speechSynthesis.speaking) { setSpeaking(false); clearInterval(id) } }, 400) }
  }
  const last = app.lastAnswer

  return (
    <div className="ca-panel ca-ask">
      <h3>{t.title} {last?.writer && last.writer !== 'template' && <span className="ca-badge derived" style={{ marginLeft: 6 }}>AI</span>}</h3>
      {thread.length > 0 && (
        <div className="ca-thread" lang={lang === 'hi' ? 'hi' : 'en'}>
          {thread.map((turn, i) => turn.role === 'user' ? <div key={i} className="ca-turn user">{turn.content}</div> : (
            <div key={i} className="ca-turn atlas">
              {turn.content}
              {turn.answer && <div className="ca-turn-meta">
                <span className={`ca-badge ${turn.answer.classification}`}>{cls(lang, turn.answer.classification)}</span>
                <span>{t.writer} {turn.answer.writer && turn.answer.writer !== 'template' ? turn.answer.writer : t.template}</span>
                {turn.answer.evidence.length > 0 && <button type="button" onClick={() => setFactsFor(factsFor === i ? null : i)}>{factsFor === i ? '▾' : '▸'} {turn.answer.evidence.length} {t.evidence}</button>}
                {canSpeak() && <button type="button" onClick={() => read(turn.content)}>{speaking ? t.stop : t.read}</button>}
              </div>}
              {factsFor === i && turn.answer && <ul className="ca-facts">{turn.answer.evidence.map((e) => <li key={e.id}><span className={`ca-badge ${e.classification}`}>{cls(lang, e.classification)}</span> {e.statement}</li>)}</ul>}
              {turn.answer?.caveats.map((c, j) => <div className="caveat" key={j}>{c}</div>)}
            </div>
          ))}
          {busy && <div className="ca-turn atlas thinking">{t.thinking}</div>}
          <div ref={endRef} />
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void submit(q) }} style={{ marginTop: thread.length ? 10 : 0 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={listening ? t.listening : thread.length ? t.follow : t.placeholder} lang={lang === 'hi' ? 'hi' : 'en'} />
        {canListen() && <button type="button" className={`ca-mic ${listening ? 'on' : ''}`} title={t.listen} aria-label={t.listen} onClick={() => void listen()}>{listening ? '●' : '🎤'}</button>}
        <button type="submit" disabled={busy}>{busy ? '…' : t.ask}</button>
        {thread.length > 0 && <button type="button" onClick={() => { stopSpeaking(); app.clearChat() }}>{t.clear}</button>}
      </form>
      {thread.length === 0 && <div className="ca-chips">{SUGGESTIONS[lang].map((s) => <button key={s} onClick={() => void submit(s)}>{s}</button>)}</div>}
    </div>
  )
}
