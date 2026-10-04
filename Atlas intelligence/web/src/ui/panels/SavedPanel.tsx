import { useEffect, useState } from 'react'
import { SERVER_BASE, type CityAtlas } from '../../app/CityAtlas'
import { download, loadSaved, removeSaved, savedToCSV, savedToGeoJSON, type SavedItem } from '../../app/saved'
import { fetchPlace } from '../../data/adapters/placeAdapter'
import { makeT, type StringKey } from '../i18n'
import { TierGate } from './TierGate'

/**
 * Saved areas (Plus: a watchlist that shows how each area's score moved since it was saved)
 * and the project workspace (Pro: shortlists and scenarios, exported as GeoJSON or CSV).
 */
export function SavedPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const [items, setItems] = useState<SavedItem[]>(() => loadSaved())
  const [now, setNow] = useState<Record<string, number | null>>({})
  useEffect(() => { setItems(loadSaved()) }, [app.savedVersion])
  // the watchlist: today's score for each saved place, from the same place tool
  useEffect(() => {
    let alive = true
    const places = items.filter((i) => i.kind === 'place' && now[i.id] === undefined).slice(0, 6)
    for (const p of places) void fetchPlace(SERVER_BASE, p.lng, p.lat).then((st) => { if (alive) setNow((m) => ({ ...m, [p.id]: st.score })) }).catch(() => { if (alive) setNow((m) => ({ ...m, [p.id]: null })) })
    return () => { alive = false }
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps
  const places = items.filter((i) => i.kind === 'place')
  const work = items.filter((i) => i.kind !== 'place')
  const show = (it: SavedItem) => {
    app.flyToLngLat(it.lng, it.lat, it.kind === 'sites' ? 14.5 : 16)
    if (it.kind === 'place') void app.openPlaceAt(it.lng, it.lat)
    if (it.kind === 'sites') { const d = it.data as { candidates?: Array<{ boundary: number[][] }> }; app.setRings((d.candidates ?? []).map((c) => c.boundary)) }
  }
  const remove = (id: string) => setItems(removeSaved(id))
  const when = (t: number) => new Date(t).toLocaleDateString(app.language === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short' })
  return (
    <div className="ca-panel ca-side ca-saved">
      <h3>{T('saved.title')}</h3>
      <h4>{T('saved.areas')}</h4>
      <TierGate app={app} feature="watchlist">
        {places.length === 0 && <p className="note">{T('saved.areas.none')}</p>}
        <ul className="ca-saved-list">{places.map((it) => {
          const cur = now[it.id]; const then = it.score ?? null
          const delta = cur != null && then != null ? Math.round(cur - then) : null
          return <li key={it.id}><button className="ca-saved-item" onClick={() => show(it)}><b>{then ?? '–'}</b><span>{it.name}<small>{T('saved.when', { d: when(it.at) })}{cur === undefined ? ` · ${T('saved.checking')}` : delta === null ? '' : delta === 0 ? ` · ${T('saved.same')}` : ` · ${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} ${T('saved.since')}`}</small></span></button><button className="small" onClick={() => remove(it.id)}>×</button></li>
        })}</ul>
      </TierGate>
      <h4>{T('saved.projects')}</h4>
      <TierGate app={app} feature="pro.projects">
        {work.length === 0 && <p className="note">{T('saved.projects.none')}</p>}
        <ul className="ca-saved-list">{work.map((it) => <li key={it.id}><button className="ca-saved-item" onClick={() => show(it)}><b>{it.kind === 'sites' ? '⬡' : it.kind === 'scenario' ? '⇄' : '→'}</b><span>{it.name}<small>{T(`saved.kind.${it.kind}` as StringKey)} · {T('saved.when', { d: when(it.at) })}</small></span></button><button className="small" onClick={() => remove(it.id)}>×</button></li>)}</ul>
        {items.length > 0 && <div className="ca-row">
          <button className="small" onClick={() => download('city-atlas-project.geojson', savedToGeoJSON(items), 'application/geo+json')}>{T('saved.export.geojson')}</button>
          <button className="small" onClick={() => download('city-atlas-project.csv', savedToCSV(items), 'text/csv')}>{T('saved.export.csv')}</button>
        </div>}
        <p className="note">{T('saved.note')}</p>
      </TierGate>
    </div>
  )
}
