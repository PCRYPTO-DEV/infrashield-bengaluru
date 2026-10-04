// Screenshots for the City Atlas vision video: one PNG per scene, taken from a running City Atlas.
//   BASE=https://infrashield-bengaluru.onrender.com OUT=./shots [PRO_PASSWORD=...] node scripts/video/capture.mjs
// Each scene is tried on its own: if one fails, the rest still run, and the failure is listed.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = (process.env.BASE || 'http://localhost:8000').replace(/\/$/, '')
const OUT = process.env.OUT || './shots'
const PRO = process.env.PRO_PASSWORD || ''
const W = 1600, H = 900
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1.2 })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const wait = (ms) => page.waitForTimeout(ms)
const app = (fn, arg) => page.evaluate(fn, arg)
const shot = async (name) => { await wait(400); await page.screenshot({ path: `${OUT}/${name}.png` }) }
const more = async () => { if (!(await page.locator('.ca-more').count())) await page.getByRole('button', { name: /^more/i }).click(); await wait(250) }
const closeMore = async () => { if (await page.locator('.ca-more').count()) await page.locator('.ca-more-close').click(); await wait(150) }
const tool = async (label) => { await more(); await page.locator('.ca-more .ca-tool', { hasText: new RegExp(`^${label}$`, 'i') }).first().click(); await wait(1800) }
const clear = async () => { await page.keyboard.press('Escape'); await closeMore(); await wait(300) }

const done = [], failed = []
async function scene(name, fn) {
  try { await fn(); done.push(name); console.log('ok  ', name) } catch (e) { failed.push(`${name}: ${String(e.message).split('\n')[0]}`); console.log('FAIL', name, String(e.message).split('\n')[0]) }
  try { await clear() } catch { /* next scene starts clean anyway */ }
}

await page.goto(`${BASE}/?zoom=15`, { waitUntil: 'load' })
await wait(9000)
const explore = page.getByRole('button', { name: /explore the city/i })
if (await explore.count()) { await explore.click(); await wait(1500) }
if (PRO) {
  const r = await app(async (p) => window.__cityatlas.unlock(p, 'pro'), PRO)
  console.log('pro unlock:', JSON.stringify(r)); await wait(800)
}
const info = await app(() => { const a = window.__cityatlas; return { region: a.region.id, source: a.region.source, live: a.liveStatus?.live ?? null, fallbacks: a.realDataFallbacks, tier: a.tier } })
console.log('app:', JSON.stringify(info))

await scene('01-map', async () => { await shot('01-map') })
await scene('02-traffic', async () => { await app(() => window.__cityatlas.setMode('mobility')); await wait(2500); await shot('02-traffic'); await app(() => window.__cityatlas.setMode('reality')) })
await scene('03-place', async () => { await app(() => window.__cityatlas.stone('look')); await wait(3000); await shot('03-place') })
await scene('04-ask', async () => {
  await page.locator('.ca-ask input').fill('Why is traffic slow?'); await page.locator('.ca-ask button[type=submit]').click()
  await wait(6000); await shot('04-ask')
  await app(() => window.__cityatlas.clearChat())
})
await scene('05-past', async () => { await page.locator('.ca-timeline button', { hasText: /past/i }).click(); await wait(2500); await shot('05-past') })
await scene('06-future', async () => { await page.locator('.ca-timeline button', { hasText: /future/i }).click(); await wait(2500); await shot('06-future'); await page.locator('.ca-timeline button', { hasText: /^now$/i }).first().click() })
await scene('07-changed', async () => { await page.getByRole('button', { name: /what changed/i }).click(); await wait(2500); await shot('07-changed') })
await scene('08-route', async () => { await app(() => window.__cityatlas.stone('go')); await wait(4000); await shot('08-route') })
await scene('09-safe', async () => { await app(() => window.__cityatlas.stone('safe')); await wait(2500); await shot('09-safe') })
await scene('10-ink', async () => { await app(() => { const a = window.__cityatlas; a.setMode('ink3d'); a.camera.zoom = Math.max(a.camera.zoom, 16.5) }); await wait(9000); await shot('10-ink'); await app(() => window.__cityatlas.setMode('reality')) })
await scene('11-vision', async () => { await tool('camera'); await shot('11-vision') })
await scene('12-gentri', async () => { await app(() => window.__cityatlas.stone('change')); await wait(9000); await shot('12-gentri') })
await scene('13-invest', async () => { await app(() => window.__cityatlas.stone('worth')); await wait(7000); await shot('13-invest') })
await scene('14-sites', async () => { await tool('site finder'); await shot('14-sites') })
await scene('15-trackrecord', async () => { await tool('track record'); await wait(4000); await shot('15-trackrecord') })
await scene('16-status', async () => { await tool('status'); await wait(3000); await shot('16-status') })
await scene('17-hindi', async () => { await page.locator('.ca-lang button', { hasText: 'हि' }).first().click(); await wait(1500); await shot('17-hindi'); await page.locator('.ca-lang button', { hasText: 'EN' }).first().click() })
await scene('18-night', async () => { await page.getByRole('button', { name: /night/i }).first().click(); await wait(2500); await shot('18-night'); await page.getByRole('button', { name: /day/i }).first().click() })

writeFileSync(`${OUT}/capture.json`, JSON.stringify({ base: BASE, at: new Date().toISOString(), app: info, done, failed, pageErrors: errors.slice(0, 10) }, null, 2))
console.log(`done ${done.length}, failed ${failed.length}`, failed.join(' | '), 'page errors', errors.length)
await browser.close()
