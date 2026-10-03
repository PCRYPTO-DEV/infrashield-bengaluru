import { useEffect, useState } from 'react'
import { SERVER_BASE, type CityAtlas } from '../../app/CityAtlas'
import { makeT, type StringKey } from '../i18n'

type Row = { key: string; ok: boolean | null; detail: string; fix: string | null }
type Status = { ok: boolean; problems: number; rows: Row[]; checkedAt: number }

export async function fetchStatus(base: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<Status> {
  const r = await fetchImpl(`${base}/api/status`)
  if (!r.ok) throw new Error(`status: HTTP ${r.status}`)
  return (await r.json()) as Status
}

/** Is everything working on the server? One row per source, green / red / grey, with the fix for red. */
export function StatusPanel({ app }: { app: CityAtlas }) {
  const T = makeT(app.language)
  const [st, setSt] = useState<Status | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = () => { setErr(null); fetchStatus(SERVER_BASE).then(setSt, (e: Error) => setErr(e.message)) }
  useEffect(load, [])
  return (
    <div className="ca-panel ca-side ca-status">
      <h3>{T('st.title')}</h3>
      {err && <p className="note" style={{ color: 'var(--risk)' }}>{err}</p>}
      {!st && !err && <p className="note">{T('st.checking')}</p>}
      {st && <>
        <p className="note">{st.problems === 0 ? T('st.allok') : T('st.problems', { n: st.problems })}</p>
        <ul className="ca-status-rows">{st.rows.map((r) => (
          <li key={r.key} className={r.ok === true ? 'ok' : r.ok === false ? 'bad' : 'na'}>
            <span className="dot" aria-hidden="true" />
            <div><b>{T(`st.k.${r.key}` as StringKey)}</b><small>{r.detail}</small>{r.fix && <small className="fix">{T('st.fix')} {r.fix}</small>}</div>
          </li>))}
        </ul>
        <div className="ca-row"><button className="small" onClick={load}>{T('st.again')}</button><small className="note">{new Date(st.checkedAt).toLocaleTimeString()}</small></div>
      </>}
    </div>
  )
}
