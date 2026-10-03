import { useEffect, useRef, useState } from 'react'
import { SERVER_BASE, type CityAtlas } from '../../app/CityAtlas'
import { fetchTrackRecord, type GentriSummary, type TrackRecord } from '../../data/adapters/trackRecordAdapter'
import { makeT } from '../i18n'

const pct = (x: number) => Math.round(x * 100)

/**
 * Track record (free, public): how often Atlas's predictions came true. The gentrification projection is
 * re-run with its last 12 months hidden and compared with what was actually mapped, next to a
 * "nothing changes" guess; the traffic "usual for this hour" is compared with measured speeds.
 */
export function TrackRecordPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const [tr, setTr] = useState<TrackRecord | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let live = true
    const load = async () => {
      try {
        const r = await fetchTrackRecord(SERVER_BASE)
        if (!live) return
        setTr(r); setErr(null)
        if (r.gentrification.status === 'running') timer.current = setTimeout(() => void load(), 15_000)
      } catch (e) { if (live) setErr((e as Error).message) }
    }
    void load()
    return () => { live = false; if (timer.current) clearTimeout(timer.current) }
  }, [])

  const g = tr?.gentrification
  const sum: GentriSummary | null = g ? (g.status === 'ok' ? g.summary : g.status === 'running' ? g.partial : null) : null
  return (
    <div className="ca-panel ca-side ca-track">
      <h3>{T('trk.title')}</h3>
      <p className="note">{T('trk.intro')}</p>
      {err && <p className="note" style={{ color: 'var(--risk)' }}>{err}</p>}
      {!tr && !err && <p className="note">{T('trk.loading')}</p>}

      {tr && <>
        <h4>{T('trk.gen.h', { c: g && g.status === 'ok' ? g.label : tr.cities[tr.city] ?? tr.city })}</h4>
        {g?.status === 'running' && <p className="note">{T('trk.running', { d: g.done, n: g.of })}</p>}
        {sum ? <>
          <div className="ca-trk-big">
            <b>{sum.inBand12}<small>/{sum.localities}</small></b>
            <span>{T('trk.gen.band', { p: pct(sum.inBandShare12) })}</span>
          </div>
          <ul className="ca-trk-facts">
            <li>{T('trk.gen.error', { a: sum.medianErrorPct, b: sum.medianErrorNaivePct })} {sum.medianErrorPct < sum.medianErrorNaivePct ? <b className="good">{T('trk.beats')}</b> : <b className="bad">{T('trk.notbeats')}</b>}</li>
            {sum.directionOutOf > 0 && <li>{T('trk.gen.dir', { r: sum.directionRight, n: sum.directionOutOf })}</li>}
            <li>{T('trk.gen.thirds', { t: sum.topThirdActualChange, b: sum.bottomThirdActualChange })}</li>
            {sum.rankCorrelation !== null && <li>{T('trk.gen.rank', { r: sum.rankCorrelation })}</li>}
          </ul>
        </> : g?.status !== 'running' && <p className="note">{T('trk.none')}</p>}

        {g?.status === 'ok' && g.localities.length > 0 && <>
          <table className="ca-trk-table"><thead><tr><th>{T('trk.col.place')}</th><th>{T('trk.col.range')}</th><th>{T('trk.col.actual')}</th><th /></tr></thead>
            <tbody>{(showAll ? g.localities : g.localities.slice(0, 8)).map((l) => (
              <tr key={l.name} onClick={() => app.openGentrification(l.lng, l.lat, l.name)} className="clickable">
                <td>{l.name}</td><td>{l.predicted.lower12.toFixed(1)}–{l.predicted.upper12.toFixed(1)}</td><td>{l.actual.m12.toFixed(1)}</td>
                <td className={l.inBand12 ? 'good' : 'bad'}>{l.inBand12 ? '✓' : '✗'}</td></tr>))}
            </tbody></table>
          {g.localities.length > 8 && <button className="small" onClick={() => setShowAll(!showAll)}>{showAll ? T('trk.less') : T('trk.all', { n: g.localities.length })}</button>}
          {g.skipped.length > 0 && <p className="note">{T('trk.skipped', { n: g.skipped.length })}</p>}
          <p className="note">{g.method}</p>
        </>}

        <h4>{T('trk.traffic.h')}</h4>
        {tr.traffic.status === 'ok' ? <>
          <div className="ca-trk-big"><b>{pct(tr.traffic.within10)}%</b><span>{T('trk.traffic.within', { n: tr.traffic.checked, d: tr.traffic.days })}</span></div>
          <p className="note">{T('trk.traffic.within20', { p: pct(tr.traffic.within20) })} {tr.traffic.basis}.</p>
        </> : <p className="note">{T('trk.traffic.wait', { n: tr.traffic.readings, s: tr.traffic.memorySince ? new Date(tr.traffic.memorySince).toISOString().slice(0, 10) : '—' })}</p>}

        <h4>{T('trk.notyet.h')}</h4>
        <p className="note">{T('trk.notyet')}</p>
      </>}
    </div>
  )
}
