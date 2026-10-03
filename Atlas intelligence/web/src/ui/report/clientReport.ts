import type { ChangeReport, PlaceState, EvidenceClass } from '../../data/adapters/placeAdapter'
import { makeT, type StringKey } from '../i18n'

type Language = 'en' | 'hi'
/** The class word, including the inferred class the card knows but the evidence vocabulary does not. */
function clsWord(T: ReturnType<typeof makeT>, c: EvidenceClass): string { return c === 'inferred' ? T('cls.inferred') : T.cls(c) }
function fresh(s: number | null, T: ReturnType<typeof makeT>): string { return s === null ? '–' : s < 120 ? T('time.mins', { n: Math.max(1, Math.round(s / 60)) }) : s < 7200 ? T('time.mins', { n: Math.round(s / 60) }) : T('time.hours', { n: Math.round(s / 360) / 10 }) }

function esc(s: unknown): string { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!) }

/**
 * City Atlas Pro: a client report for one place, printable to PDF from the browser. Every number
 * is the one on the card, with its class, confidence and provenance; nothing is added for the page.
 */
export function clientReportHtml(st: PlaceState, name: string, changes: ChangeReport | null, lang: Language, city: string): string {
  const T = makeT(lang)
  const dims = st.dimensions.map((d) => `<tr><td>${esc(T(`dim.${d.key}` as StringKey))}</td><td class="n">${d.score === null ? esc(T('place.nodata')) : Math.round(d.score)}</td><td>${esc(clsWord(T, d.class))}</td><td>${d.confidenceWord ? esc(T(`conf.${d.confidenceWord}` as StringKey)) : '–'}</td><td>${d.why.map(esc).join('<br>')}</td><td class="src">${d.provenance.map((p) => `${esc(p.source)} · ${esc(p.resolution)} · ${esc(fresh(p.freshnessS, T))}`).join('<br>')}</td></tr>`).join('')
  const ch = changes && changes.items.length ? `<h2>${esc(T('report.changes'))}</h2><ol>${changes.items.slice(0, 8).map((c) => `<li>${esc(c.text)} <span class="src">${esc(clsWord(T, c.classification))} · ${esc(c.source)}</span></li>`).join('')}</ol>` : ''
  const when = new Date(st.computedAt).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', { timeZone: 'Asia/Kolkata' })
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(T('report.title'))} · ${esc(name)}</title>
<style>
body{font-family:"DM Sans",Arial,sans-serif;color:#0b1f2c;margin:40px;max-width:900px}h1{font-size:26px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px;letter-spacing:.08em;text-transform:uppercase;color:#0a9c88}
.meta{color:#5b6b75;font-size:13px}.score{display:flex;gap:18px;align-items:center;margin:18px 0}.score b{font-size:48px;line-height:1}
table{border-collapse:collapse;width:100%;font-size:12px}td,th{border-top:1px solid #d8dcd6;padding:6px 8px;vertical-align:top;text-align:left}td.n{font-weight:700;text-align:right}td.src,.src{color:#5b6b75;font-size:11px}
.foot{margin-top:28px;border-top:1px solid #d8dcd6;padding-top:10px;color:#5b6b75;font-size:11px}@media print{body{margin:16mm}}
</style></head><body>
<h1>${esc(T('report.title'))}</h1>
<div class="meta">${esc(city)} · ${esc(name)} · ${esc(T('place.cell', { a: st.areaKm2 }))} · ${esc(when)}</div>
<div class="score"><b>${st.score === null ? '–' : Math.round(st.score)}</b><div>${esc(T('place.score'))} / 100<br><span class="meta">${esc(T('place.confidence'))}: ${st.confidenceWord ? esc(T(`conf.${st.confidenceWord}` as StringKey)) : '–'} · ${esc(T('place.trend'))}: ${st.trend === null ? esc(st.trendNote) : st.trend}</span></div></div>
<h2>${esc(T('report.dimensions'))}</h2>
<table><thead><tr><th>${esc(T('report.col.dim'))}</th><th>${esc(T('report.col.score'))}</th><th>${esc(T('report.col.class'))}</th><th>${esc(T('report.col.conf'))}</th><th>${esc(T('report.col.why'))}</th><th>${esc(T('report.col.src'))}</th></tr></thead><tbody>${dims}</tbody></table>
<p class="meta">${esc(T('place.structure', { b: st.structure.buildings, r: Object.values(st.structure.roadsKm).reduce((a, b) => a + b, 0).toFixed(1), g: Math.round(st.structure.greenShare * 100), p: st.structure.paths }))}</p>
${ch}
<div class="foot">${esc(T('report.foot'))}</div>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)})</script>
</body></html>`
}

/** Opens the report in a new tab and asks the browser to print it (save as PDF). */
export function openClientReport(html: string): boolean {
  const w = window.open('', '_blank')
  if (!w) return false
  w.document.open(); w.document.write(html); w.document.close()
  return true
}
