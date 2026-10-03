import { useEffect } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import { FREE_CHANGES } from '../../app/tiers'
import { makeT } from '../i18n'
import { TierGate } from './TierGate'
import { Stones } from '../controls/Stones'

/** WHAT CHANGED? — ranked, evidenced differences between now and before, for the view on screen. */
export function WhatChanged({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  useEffect(() => { void app.loadChanges() }, [app])
  const r = app.changes
  const full = app.can('changes.full')
  const items = r ? (full ? r.items : r.items.slice(0, FREE_CHANGES)) : []
  return (
    <div className="ca-panel ca-side ca-changed">
      <h3>{T('changed.title')} <button className="small" onClick={() => void app.loadChanges()}>↻</button></h3>
      {app.changesLoading && <p className="note">{T('changed.loading')}</p>}
      {r && <p className="ca-changed-count">{r.count ? T('changed.count', { n: r.count }) : T('changed.none')} <span className="note">{T('changed.since', { h: Math.round(r.since / 3600) })}</span></p>}
      <ul className="ca-inslist">
        {items.map((c) => (
          <li key={c.id} className={c.rank >= 0.5 ? 'sev-high' : c.rank >= 0.25 ? 'sev-mid' : ''}>
            <div className="ca-ins-head"><span className="ca-ins-dot" /><span className="ca-ins-txt">{c.text}</span></div>
            <div className="ca-ins-meta"><span className={`ca-badge ${c.classification}`}>{T.cls(c.classification as 'observed')}</span> {c.source} · {c.evidence.join(' · ')}{c.lng !== null && c.lat !== null && <button className="small" onClick={() => { app.flyToLngLat(c.lng!, c.lat!); void app.openPlaceAt(c.lng!, c.lat!) }}>{T('changed.show')}</button>}</div>
          </li>
        ))}
      </ul>
      {r && !full && r.items.length > FREE_CHANGES && <TierGate app={app} feature="changes.full"><span /></TierGate>}
      {r && r.notDetectable.length > 0 && <p className="note"><b>{T('changed.cannot')}:</b> {r.notDetectable.join('; ')}.</p>}
      <Stones app={app} variant="next" exclude="change" />
    </div>
  )
}
