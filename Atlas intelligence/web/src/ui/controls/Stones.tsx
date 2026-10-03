import type { CityAtlas, StoneKind } from '../../app/CityAtlas'
import { makeT, type StringKey } from '../i18n'

/** The five stones (see docs/design/pebble-cartography.md): one colour, one picture, one word each. */
export const STONES: Array<{ kind: StoneKind; color: string }> = [
  { kind: 'look', color: '#0F6FFF' },
  { kind: 'go', color: '#1E8E3E' },
  { kind: 'safe', color: '#D93025' },
  { kind: 'change', color: '#E8710A' },
  { kind: 'worth', color: '#F9AB00' },
]

/** The picture inside each stone, drawn in paper colour on a 100-unit circle. */
export function StoneGlyph({ kind }: { kind: StoneKind }) {
  const P = '#F7F4ED'
  switch (kind) {
    case 'look': return <g fill="none" stroke={P} strokeWidth="9"><circle cx="50" cy="50" r="30" /><circle cx="50" cy="50" r="15" /><circle cx="50" cy="50" r="5" fill={P} stroke="none" /></g>
    case 'go': return <g fill="none" stroke={P} strokeWidth="9" strokeLinejoin="round" strokeLinecap="round"><polyline points="24,72 42,72 42,47 63,47 63,30" /><circle cx="24" cy="72" r="6" fill={P} stroke="none" /><circle cx="63" cy="26" r="9" fill={P} stroke="none" /></g>
    case 'safe': return <g><polygon points="50,20 76,35 76,65 50,80 24,65 24,35" fill="none" stroke={P} strokeWidth="8" strokeLinejoin="round" /><circle cx="50" cy="50" r="8" fill="#FF2D95" /></g>
    case 'change': return <g fill={P}><polygon points="30,57 37,61 37,69 30,73 23,69 23,61" /><polygon points="50,40 61,46 61,59 50,65 39,59 39,46" /><polygon points="71,18 86,27 86,44 71,53 56,44 56,27" /></g>
    default: return <g fill={P}><rect x="27" y="56" width="12" height="18" rx="3" /><rect x="44" y="43" width="12" height="31" rx="3" /><rect x="61" y="28" width="12" height="46" rx="3" /></g>
  }
}

/**
 * The stones as buttons. `dock`: the always-there column on the map, joined by a thread.
 * `next`: a small "What next?" row at the end of a panel, leaving out the stone you are on.
 * Every stone answers about the same place (the open place card, else the middle of the map).
 */
export function Stones({ app, variant, active, exclude }: { app: CityAtlas; variant: 'dock' | 'next'; active?: StoneKind | null; exclude?: StoneKind }) {
  const T = makeT(app.language)
  const list = STONES.filter((s) => s.kind !== exclude)
  const f = variant === 'next' ? app.focus() : null
  return (
    <nav className={`ca-stones ca-stones-${variant}`} aria-label={T('stone.next')}>
      {variant === 'next' && <div className="ca-stones-head"><b>{T('stone.next')}</b>{f && <small>{T('stone.about', { p: f.name ?? T('stone.here') })}</small>}</div>}
      <div className="ca-stones-row">
        {list.map((s) => (
          <button key={s.kind} className={`ca-stone ${active === s.kind ? 'active' : ''}`} style={{ ['--stone' as string]: s.color }} title={T(`stone.${s.kind}.tip` as StringKey)} aria-label={T(`stone.${s.kind}.tip` as StringKey)} onClick={() => app.stone(s.kind)}>
            <svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50" fill={s.color} /><StoneGlyph kind={s.kind} /></svg>
            <span>{T(`stone.${s.kind}` as StringKey)}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}
