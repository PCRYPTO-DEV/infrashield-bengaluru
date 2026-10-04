import type { CityAtlas } from '../../app/CityAtlas'
import { makeT } from '../i18n'

const H = 3600_000
const PAST_MS = 24 * H
const FUTURE_MS = 6 * H
const DEMO_WINDOW_MS = 2 * H

function fmt(ts: number): string { return new Date(ts).toISOString().slice(11, 16) + ' UTC' }
function fmtDate(ts: number): string { return new Date(ts).toISOString().slice(0, 10) }
function fmtDay(ts: number, lang: string): string { return new Date(ts).toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) }

/**
 * The time machine: PAST ← NOW → FUTURE. Three buttons that say where you are, one slider that
 * reaches a day back and six hours ahead, and a clock that says what the map is showing and how
 * sure it is. For real regions the past is the city's memory and the future a labelled prediction;
 * for the engine demo it is a recording and a simulation.
 */
export function Timeline({ app }: { app: CityAtlas }) {
  const t = app.temporal.current
  const T = makeT(app.language)
  const live = app.temporal.liveTimestamp()
  const simulate = app.region.simulation
  const real = !!app.timeMachine
  const min = live - (real ? PAST_MS : DEMO_WINDOW_MS), max = real ? live + FUTURE_MS : simulate ? live + DEMO_WINDOW_MS : live
  const value = Math.max(min, Math.min(max, t.timestamp))
  const offsetMin = Math.round((t.timestamp - live) / 60000)
  const past = t.mode !== 'live' && t.timestamp < live
  const future = t.mode !== 'live' && t.timestamp >= live
  const tm = app.timeMachine?.state
  const lag = app.stats.simLagS
  const when = past ? 'past' : future ? 'future' : 'live'
  const hoursAbs = (ms: number) => { const h = Math.abs(ms) / H; return h >= 1 ? T('time.hours', { n: Math.round(h * 10) / 10 }) : T('time.mins', { n: Math.round(Math.abs(ms) / 60000) }) }

  let label: string
  let detail: string
  if (t.mode === 'live') { label = `${T('time.live')} · ${app.liveStatus.label}`; detail = T('time.live.detail') }
  else if (real) {
    const sure = tm && tm.count > 0 ? ` · ${T('time.sure', { n: Math.round((tm.confidence || 0) * 100) })}` : ''
    label = past ? `${T('time.remembered')} · ${hoursAbs(t.timestamp - live)} ${T('time.ago')}` : `${T('time.predicted')} · +${hoursAbs(t.timestamp - live)}${sure}`
    detail = tm?.busy ? T('time.asking') : tm?.error ? tm.error : tm && tm.count > 0 ? (past ? (tm.offsetS !== null && Math.abs(tm.offsetS) > 900 ? T('time.roads.read.off', { n: tm.count, m: Math.round(Math.abs(tm.offsetS) / 60) }) : T('time.roads.read', { n: tm.count })) : T('time.roads.pred', { n: tm.count, m: tm.roadsRemembered })) : past ? T('time.nothing.past', { d: tm?.memorySince ? fmtDay(tm.memorySince, app.language) : '—' }) : T('time.nothing.future')
  } else {
    label = t.mode === 'historical' ? T('time.replay', { n: offsetMin }) : t.resimulated ? T('time.resim', { n: offsetMin }) : T('time.sim', { n: offsetMin })
    detail = lag > 5 ? T('time.behind', { n: lag }) : simulate ? T('time.demo.detail') : T('time.nofuture')
  }
  const jump = (ms: number) => { if (ms === 0) app.temporal.goLive(); else app.temporal.seek(live + ms) }
  const ticks: Array<[number, string]> = real
    ? [[-PAST_MS, T('time.yesterday')], [-12 * H, T('time.hago', { n: 12 })], [-H, T('time.hago', { n: 1 })], [0, T('time.now')], [H, '+1 h'], [3 * H, '+3 h'], [FUTURE_MS, '+6 h']]
    : [[-DEMO_WINDOW_MS, T('time.past')], [0, T('time.now')], [simulate ? DEMO_WINDOW_MS : 0, simulate ? T('time.future') : '']]

  return (
    <div className={`ca-timeline when-${when}`}>
      <div className="ca-when" role="group" aria-label={T('time.title')}>
        <button className={past ? 'active' : ''} onClick={() => jump(past ? Math.max(-PAST_MS, t.timestamp - live - H) : -H)} title={T('time.past.tip')}>◀ {T('time.past')}</button>
        <button className={t.mode === 'live' ? 'active now' : 'now'} onClick={() => jump(0)} title={T('time.now.tip')}>{T('time.now.btn')}</button>
        <button className={future ? 'active' : ''} onClick={() => jump(future ? Math.min(FUTURE_MS, t.timestamp - live + H) : H)} title={T('time.future.tip')}>{T('time.future')} ▶</button>
        {!real && <button onClick={() => app.temporal.togglePause()} title="space">{t.paused ? '▶' : '❚❚'}</button>}
        {simulate && [1, 5, 20].map((s) => <button key={s} className={t.mode !== 'live' && t.speed === s ? 'active' : ''} onClick={() => app.temporal.setSpeed(s)}>{s}×</button>)}
      </div>
      <div className="scrub">
        <input type="range" min={min} max={max} step={60000} value={value} aria-label={T('time.title')} onChange={(e) => { const v = Number(e.target.value); if (Math.abs(v - live) < 90_000) app.temporal.goLive(); else app.temporal.seek(v) }} />
        <div className="ticks">{ticks.map(([ms, text], i) => <button key={i} className={ms === 0 ? 'now' : ''} onClick={() => jump(ms)}>{text}</button>)}</div>
      </div>
      <div className="clock">
        <span className={`ca-badge ${past ? 'observed' : future ? 'predicted' : 'live'}`}>{label}</span>
        <small>{fmtDate(t.timestamp)} {fmt(t.timestamp)} · {detail}</small>
      </div>
    </div>
  )
}
