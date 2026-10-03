import { useState } from 'react'
import type { CityAtlas } from '../../app/CityAtlas'
import { tierOf, type Feature } from '../../app/tiers'
import { makeT } from '../i18n'

/** Wraps a Plus or Pro feature: shows it when the tier allows, otherwise the Plus or Pro card with its password field. */
export function TierGate({ app, feature, children }: { app: CityAtlas; feature: Feature; children: React.ReactNode }) {
  const T = makeT(app.language)
  const [pw, setPw] = useState('')
  const [wrong, setWrong] = useState<null | 'wrong' | 'tries' | 'offline'>(null)
  const [busy, setBusy] = useState(false)
  if (app.can(feature)) return <>{children}</>
  const need = tierOf(feature)
  return (
    <div className={`ca-gate ${need}`}>
      <div className="ca-gate-head"><span className="ca-gate-badge">{T(`tier.${need}` as 'tier.plus' | 'tier.pro')}</span><span className="ca-gate-tag">{T(need === 'pro' ? 'tier.pro.tag' : 'tier.plus.tag')}</span></div>
      <p className="note">{T(need === 'pro' ? 'tier.pro.locked' : 'tier.locked')}</p>
      <p className="note ca-gate-list">{T(need === 'pro' ? 'tier.pro.list' : 'tier.plus.list')}</p>
      <form className="ca-gate-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await app.unlock(pw, need); setBusy(false); if ('tier' in r) { setWrong(null); setPw('') } else setWrong(r.error) }}>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder={T(need === 'pro' ? 'tier.password.pro' : 'tier.password')} autoComplete="off" />
        <button type="submit" className="primary" disabled={busy || !pw}>{busy ? '…' : T('tier.unlock')}</button>
      </form>
      {wrong && <p className="note" style={{ color: 'var(--risk)' }}>{wrong === 'tries' ? T('tier.tries') : wrong === 'offline' ? T('tier.offline') : T(need === 'pro' ? 'tier.wrong.pro' : 'tier.wrong')}</p>}
    </div>
  )
}
