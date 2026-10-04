import { useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import { makeT } from '../i18n'

const KEY = 'atlas.welcomed'

function seen(): boolean { try { return localStorage.getItem(KEY) === '1' } catch { return false } }

/** First visit only: three lines on how the map works, then out of the way. */
export function WelcomeCard({ app, onAsk }: { app: CityAtlas; onAsk: () => void }) {
  const [open, setOpen] = useState(() => !seen())
  if (!open) return null
  const T = makeT(app.language)
  const close = () => { setOpen(false); try { localStorage.setItem(KEY, '1') } catch { /* private mode */ } }
  return (
    <div className="ca-welcome" role="dialog" aria-labelledby="ca-welcome-title">
      <div className="ca-welcome-card">
        <img src="./brand/symbol-64.png" alt="" width={44} height={44} />
        <h2 id="ca-welcome-title">{T('welcome.title')}</h2>
        <p>{T('welcome.body')}</p>
        <ol>
          <li>{T('welcome.1')}</li>
          <li><span className="ca-trafficbar" aria-hidden="true" /> {T('welcome.2')}</li>
          <li>{T('welcome.3')}</li>
        </ol>
        <div className="ca-welcome-actions">
          <button className="primary" onClick={close}>{T('welcome.go')}</button>
          <button className="ghost" onClick={() => { close(); onAsk() }}>{T('welcome.ask')}</button>
        </div>
      </div>
    </div>
  )
}
