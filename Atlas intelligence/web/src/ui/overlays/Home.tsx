import { useEffect, useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import { makeT } from '../i18n'

const KEY = 'atlas.home.seen'

/** First open: the city, a greeting, how much changed since yesterday, Ask Atlas, three prompts. No GIS. */
export function Home({ app, city, onChanged, onAsk }: { app: CityAtlas; city: string; onChanged: () => void; onAsk: () => void }) {
  const T = makeT(app.language)
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem(KEY) !== '1' } catch { return true } })
  useEffect(() => { if (open && app.region.source === 'osm') void app.loadChanges() }, [open, app])
  if (!open) return null
  const close = () => { setOpen(false); try { sessionStorage.setItem(KEY, '1') } catch { /* private mode */ } }
  const h = new Date().getHours()
  const greet = h < 12 ? 'home.morning' : h < 17 ? 'home.afternoon' : 'home.evening'
  const n = app.changes?.count
  return (
    <div className="ca-home" role="dialog">
      <div className="ca-home-card">
        <img src="./brand/symbol-64.png" alt="" width={40} height={40} />
        <h2>{T(greet)}</h2>
        <p className="ca-home-line">{app.changesLoading || n === undefined ? T('home.changes.loading') : n > 0 ? T('home.changes', { city, n }) : T('home.changes.none', { city })}</p>
        <button className="ca-home-ask" onClick={() => { close(); onAsk() }}><span>{T('ask.atlas')}</span><small>{T('home.example', { city })}</small></button>
        <div className="ca-home-prompts">
          <button onClick={() => { close(); onChanged() }}>{T('home.p1')}</button>
          <button onClick={close}>{T('home.p2')}</button>
          <button disabled title={T('home.p3.soon')}>{T('home.p3')}</button>
        </div>
      </div>
    </div>
  )
}
