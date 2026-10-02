import { useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import { REPORT_KINDS, type ReportKind } from '../../data/adapters/reportsAdapter'
import { makeT, type StringKey } from '../i18n'

/**
 * Report what just happened: pick what, say a few words, tap where. The report becomes a pink
 * callout for everyone looking at that place, for a day. It is a person's word, not a verified
 * record, and the panel says so. Emergencies go to 112, not to a map.
 */
export function ReportPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const [kind, setKind] = useState<ReportKind>('snatching')
  const [text, setText] = useState('')
  const [where, setWhere] = useState<{ lng: number; lat: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const pick = () => app.pickMapPoint(T('rep.pick.hint'), (_p, ll) => setWhere(ll))
  const useCentre = () => setWhere(app.lngLatOf(app.camera.centre))
  const send = async () => {
    const ll = where ?? app.lngLatOf(app.camera.centre)
    setBusy(true); setErr(null)
    try { await app.reportCrime(kind, text.trim(), ll); setDone(T('rep.done')); setText(''); setWhere(null) }
    catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const nearby = app.reports
  return (
    <div className="ca-panel ca-side ca-report">
      <h3>{T('rep.title')}</h3>
      <p className="note ca-rep-112">{T('rep.112')}</p>
      <p className="note">{T('rep.help')}</p>
      <div className="ca-chips">{REPORT_KINDS.map((k) => <button key={k} className={`ca-chip ${kind === k ? 'active pink' : ''}`} onClick={() => setKind(k)}>{T(`rep.k.${k}` as StringKey)}</button>)}</div>
      <textarea className="ca-rep-text" value={text} maxLength={200} rows={2} placeholder={T('rep.text.ph')} onChange={(e) => setText(e.target.value)} />
      <div className="ca-row">
        <button className="small" onClick={pick}>{T('rep.pick')}</button>
        <button className="small" onClick={useCentre}>{T('rep.centre')}</button>
        <span className="note">{where ? `${where.lat.toFixed(4)}, ${where.lng.toFixed(4)}` : T('rep.where.none')}</span>
      </div>
      <button className="primary ca-rep-send" disabled={busy} onClick={() => void send()}>{busy ? '…' : T('rep.send')}</button>
      {done && <p className="note" style={{ color: 'var(--pink)' }}>{done}</p>}
      {err && <p className="note" style={{ color: 'var(--risk)' }}>{err}</p>}
      <h4>{T('rep.today', { n: nearby.length })}</h4>
      {nearby.length === 0 && <p className="note">{T('rep.today.none')}</p>}
      <ul className="ca-rep-list">{nearby.slice(0, 12).map((r) => <li key={r.id}><button onClick={() => app.flyToLngLat(r.lng, r.lat, 16.5)}><b>{T(`rep.k.${r.kind}` as StringKey)}</b> · {r.ageMin < 60 ? T('rep.min', { n: r.ageMin }) : T('rep.hr', { n: Math.round(r.ageMin / 60) })}{r.description ? <small>{r.description}</small> : null}</button></li>)}</ul>
      <p className="note"><span className="ca-badge observed">{T.cls('observed')}</span> {T('rep.source')}</p>
    </div>
  )
}
