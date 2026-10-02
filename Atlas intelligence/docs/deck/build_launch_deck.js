// City Atlas: the launch deck. Brand colours from the logo package; real product screenshots; nothing invented.
const pptxgen = require('pptxgenjs')
const fs = require('fs')
const path = require('path')
const { applyTheme } = require('/root/.claude/skills/synced/06ecdaca-38d7-4f57-8024-a936d88d4781_ebbc0742-7f6a-4eb8-9fd5-1a6eba4c9558/pptx/scripts/apply_theme.js')

const HERE = __dirname
const SHOTS = path.join(HERE, '..')          // product screenshots from the headless runs
const AD = path.join(HERE, '..', 'ad')       // branded photographs (when the host is reachable)
const LOGO = path.join(HERE, '..', 'logo')
const has = (p) => fs.existsSync(p)

const THEME = {
  name: 'City Atlas',
  headFontFace: 'Arial', bodyFontFace: 'Calibri',
  colors: { dk1: '071924', lt1: 'FFFFFF', dk2: '0B1F2C', lt2: 'EEF5F8', accent1: '0F6FFF', accent2: '00C2A8', accent3: '7ED957', accent4: '5B6B75', accent5: 'B7A6FF', accent6: 'FF5A5F', hlink: '0F6FFF', folHlink: '00C2A8' },
}
const pres = new pptxgen()
pres.layout = 'LAYOUT_WIDE' // 13.33 x 7.5
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace }
pres.title = 'City Atlas'; pres.author = 'City Atlas'; pres.subject = 'A living intelligence model of the city'
const C = pres.SchemeColor
const W = 13.33, H = 7.5

// ---- layouts
pres.defineSlideMaster({ title: 'DARK', background: { color: THEME.colors.dk1 }, objects: [
  { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 0.55, w: 11.9, h: 1.25, fontSize: 30, bold: true, color: C.background1, margin: 0, valign: 'top' } } },
  { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 1.9, w: 5.6, h: 4.6, fontSize: 16, color: C.background2, margin: 0, valign: 'top' } } },
  { image: { x: W - 1.95, y: H - 0.72, w: 1.5, h: 0.4167, path: path.join(LOGO, 'city-atlas-horizontal-transparent.png') } },
]})
pres.defineSlideMaster({ title: 'LIGHT', background: { color: THEME.colors.lt1 }, objects: [
  { placeholder: { options: { name: 'title', type: 'title', x: 0.7, y: 0.55, w: 11.9, h: 1.25, fontSize: 30, bold: true, color: C.text1, margin: 0, valign: 'top' } } },
  { placeholder: { options: { name: 'body', type: 'body', x: 0.7, y: 1.9, w: 5.6, h: 4.6, fontSize: 16, color: C.text2, margin: 0, valign: 'top' } } },
  { image: { x: W - 1.95, y: H - 0.72, w: 1.5, h: 0.4167, path: path.join(LOGO, 'city-atlas-horizontal-transparent.png') } },
]})
pres.defineSlideMaster({ title: 'PHOTO', background: { color: THEME.colors.dk1 }, objects: [] })

const dark = (section) => pres.addSlide({ masterName: 'DARK', sectionTitle: section })
const light = (section) => pres.addSlide({ masterName: 'LIGHT', sectionTitle: section })
const T = (s, text, opts = {}) => s.addText(text, { placeholder: 'title', ...opts })
const note = (s, text) => s.addNotes(text)
const shot = (s, file, x, y, w, h, name) => { const p = path.join(SHOTS, file); if (has(p)) s.addImage({ path: p, x, y, w, h, sizing: { type: 'cover', w, h }, rounding: false, objectName: name, shadow: { type: 'outer', blur: 14, offset: 4, angle: 90, color: '000000', opacity: 0.35 } }) }
const chip = (s, x, y, w, text, fill) => { s.addShape(pres.ShapeType.roundRect, { x, y, w, h: 0.34, fill: { color: fill }, line: { color: fill }, rectRadius: 0.17, objectName: `chip ${text}` }); s.addText(text, { x, y, w, h: 0.34, fontSize: 10, bold: true, color: C.background1, align: 'center', margin: 0, isTextBox: true, charSpacing: 2, objectName: `chip text ${text}` }) }

// ---- 1 cover (photo when available)
pres.addSection({ title: 'A living city' })
{
  const s = pres.addSlide({ masterName: 'PHOTO', sectionTitle: 'A living city' })
  const ad = path.join(AD, 'raw-1.jpg')
  if (has(ad)) { s.addImage({ path: ad, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H }, objectName: 'cover photograph' }); s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: 7.5, h: H, fill: { color: THEME.colors.dk1, transparency: 35 }, line: { color: THEME.colors.dk1, transparency: 100 }, objectName: 'shade' }) }
  s.addImage({ path: path.join(LOGO, 'city-atlas-horizontal-transparent.png'), x: 0.7, y: 0.6, w: 3.6, h: 1.0, objectName: 'logo' })
  s.addText([{ text: 'KNOW', options: { breakLine: true } }, { text: 'YOUR CITY.' }], { x: 0.7, y: 2.3, w: 8, h: 2.6, fontSize: 80, bold: true, color: C.background1, margin: 0, isTextBox: true, lineSpacingMultiple: 0.9, objectName: 'headline' })
  s.addText('A living map that says what is happening, and how sure it is.', { x: 0.7, y: 5.1, w: 7.2, h: 0.8, fontSize: 20, color: C.background2, margin: 0, isTextBox: true, objectName: 'subline' })
  s.addText('People · Places · Possibilities', { x: 0.7, y: 6.5, w: 6, h: 0.4, fontSize: 12, color: C.accent2, charSpacing: 4, margin: 0, isTextBox: true, objectName: 'tagline' })
  note(s, 'Open on the live map. The deck follows the product: what it does today, on real data, and how sure it is.')
}

// ---- 2 the problem
{
  const s = dark('A living city')
  T(s, 'Maps show you where. They do not tell you what is going on.')
  const qs = [['Why is this road jammed?', 'A red line says slow. It does not say why, or whether this is normal for 6 pm on a Tuesday.'], ['Which way home is calmer?', 'Apps pick the fastest route, not the one with fewer problems on it.'], ['What happens in an hour?', 'A map is a photo of now. Cities keep moving.']]
  qs.forEach(([q, a], i) => {
    const x = 0.7 + i * 4.05
    s.addShape(pres.ShapeType.roundRect, { x, y: 2.2, w: 3.75, h: 3.6, fill: { color: THEME.colors.dk2 }, line: { color: THEME.colors.dk2 }, rectRadius: 0.2, objectName: `card ${i}` })
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.35, y: 2.55, w: 0.6, h: 0.6, fill: { color: [THEME.colors.accent1, THEME.colors.accent2, THEME.colors.accent3][i] }, line: { color: [THEME.colors.accent1, THEME.colors.accent2, THEME.colors.accent3][i] }, objectName: `dot ${i}` })
    s.addText(String(i + 1), { x: x + 0.35, y: 2.55, w: 0.6, h: 0.6, fontSize: 16, bold: true, color: C.text1, align: 'center', valign: 'middle', margin: 0, isTextBox: true, objectName: `n ${i}` })
    s.addText(q, { x: x + 0.35, y: 3.4, w: 3.1, h: 0.9, fontSize: 22, bold: true, color: C.background1, margin: 0, isTextBox: true, objectName: `q ${i}` })
    s.addText(a, { x: x + 0.35, y: 4.35, w: 3.1, h: 1.3, fontSize: 14, color: C.background2, margin: 0, isTextBox: true, objectName: `a ${i}` })
  })
  note(s, 'Three everyday questions no map answers today.')
}

// ---- 3 the idea with the real product
{
  const s = light('A living city')
  T(s, 'City Atlas turns the map into a living city you can question.')
  shot(s, 'search-far.png', 6.6, 1.9, 6.1, 3.81, 'the live map')
  s.addText([
    { text: 'Real streets, buildings and green for all of India, streaming in as you move.', options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: 'Live traffic in the colours everyone already knows, with cars that move at the measured speed.', options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: 'Incidents, air, rain and the city’s own memory of what is usual at this hour.', options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: 'Ask Atlas in English or Hindi. Every answer lists the facts it came from.', options: { bullet: true } },
  ], { placeholder: 'body' })
  note(s, 'Screenshot: the live map after searching for a place across India.')
}

// ---- 4 the rule
pres.addSection({ title: 'The rule it never breaks' })
{
  const s = dark('The rule it never breaks')
  T(s, 'It always tells you how sure it is.')
  const rows = [['SEEN', 'Came from a real source: a map, a feed, a camera.', 'Solid ink.', THEME.colors.accent3, 'solid'], ['WORKED OUT', 'Calculated from what was seen, like “this road is at 30% of its usual speed”.', 'Soft colour.', THEME.colors.accent2, 'solid'], ['PREDICTED', 'What may come, from what the memory has seen before. Always carries a confidence.', 'Dashed ghost lines.', THEME.colors.accent5, 'dash'], ['NO DATA', 'Where a reading is missing it says so. Nothing is ever made up.', 'Left blank.', THEME.colors.accent4, 'none']]
  rows.forEach(([k, d, how, col, style], i) => {
    const y = 2.1 + i * 1.15
    s.addShape(pres.ShapeType.line, { x: 0.7, y: y + 0.42, w: 2.2, h: 0, line: { color: col, width: 4, dashType: style === 'dash' ? 'dash' : 'solid', transparency: style === 'none' ? 80 : 0 }, objectName: `line ${k}` })
    s.addText(k, { x: 3.2, y, w: 2.6, h: 0.85, fontSize: 20, bold: true, color: col, valign: 'middle', margin: 0, isTextBox: true, charSpacing: 2, objectName: `k ${k}` })
    s.addText(d, { x: 5.9, y, w: 4.9, h: 0.85, fontSize: 15, color: C.background2, valign: 'middle', margin: 0, isTextBox: true, objectName: `d ${k}` })
    s.addText(how, { x: 10.9, y, w: 1.9, h: 0.85, fontSize: 12, italic: true, color: C.accent4, valign: 'middle', margin: 0, isTextBox: true, objectName: `how ${k}` })
  })
  note(s, 'The evidence classes carried by every card, bubble and answer.')
}

// ---- 5 click anywhere
pres.addSection({ title: 'What it does' })
{
  const s = light('What it does')
  T(s, 'Click anywhere. Every place gets a score, and every score answers “why?”')
  shot(s, 'pro-sites.png', 6.6, 1.9, 6.1, 3.81, 'place card')
  s.addText([
    { text: 'One hexagon of the city, about 0.1 km²: traffic against its usual, incidents, air, rain, green space, healthcare, schools, transport, walkability, connectivity.', options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: 'WHY opens the evidence: the lines it was worked out from, its class, a confidence, the source, time and resolution.', options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: 'The same facts re-weighted for a family, a student, a young professional or a retiree.', options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: 'Flood and population stay “no data” until their adapters exist.', options: { bullet: true } },
  ], { placeholder: 'body' })
  note(s, 'Screenshot: the place intelligence card with a site-finder outline on the map.')
}

// ---- 6 past now future
{
  const s = dark('What it does')
  T(s, 'Past. Now. Future. Time is part of every place.')
  shot(s, 'tm-past.png', 0.7, 2.0, 5.9, 3.69, 'past')
  shot(s, 'tm-future.png', 6.75, 2.0, 5.9, 3.69, 'future')
  chip(s, 0.7, 5.85, 1.7, 'REMEMBERED', THEME.colors.accent4)
  s.addText('What the city actually read at that minute. Nothing interpolated; roads without a reading stay blank.', { x: 2.5, y: 5.8, w: 4.1, h: 0.9, fontSize: 12, color: C.background2, margin: 0, isTextBox: true, objectName: 'past text' })
  chip(s, 6.75, 5.85, 1.7, 'PREDICTED', THEME.colors.accent5)
  s.addText('What each road usually reads at that hour, with today’s unusual traffic fading out, dashed, with a confidence.', { x: 8.55, y: 5.8, w: 4.1, h: 0.9, fontSize: 12, color: C.background2, margin: 0, isTextBox: true, objectName: 'future text' })
  note(s, 'The time bar: three buttons and a slider from yesterday to six hours ahead.')
}

// ---- 7 ask + what changed
{
  const s = light('What it does')
  T(s, 'Ask the city. Get evidence, not guesses.')
  shot(s, 'pro-scenario.png', 0.7, 1.9, 6.1, 3.81, 'ask atlas')
  s.addText([
    { text: '“Why is traffic slow?” “Show unusual activity.” “Where should I open a café?”', options: { bold: true, breakLine: true, paraSpaceAfter: 10 } },
    { text: 'A question chooses the tools behind the answer: the place state, the memory, the change ranking, the router, the site finder.', options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: 'The writer phrases facts; it never adds one. It says when a line is a guess.', options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: 'What changed? ranks the meaningful changes since yesterday for the view on screen, each with its source.', options: { bullet: true } },
  ], { placeholder: 'body', x: 7.1, w: 5.5 })
  note(s, 'Screenshot: Ask Atlas answering a site question while the Scenario Lab is open.')
}

// ---- 8 routes
{
  const s = dark('What it does')
  T(s, 'Which way home is calmer? Anywhere in India, with live traffic.')
  shot(s, 'route-far.png', 6.6, 1.9, 6.1, 3.81, 'route options')
  s.addText([
    { text: 'Type any place or lane; routes come from the live routing engine with today’s traffic.', options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: 'Every option shows minutes, kilometres, the traffic delay and the incidents the city has seen within 300 m of it.', options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: 'The route with strictly fewer reported incidents is marked. It is never called “safe”.', options: { bullet: true, breakLine: true, paraSpaceAfter: 8 } },
    { text: 'Zones count who walks in and out from a phone camera: dots, not faces. Alerts arrive by WhatsApp or SMS.', options: { bullet: true } },
  ], { placeholder: 'body' })
  note(s, 'Screenshot: route options between two places found across India.')
}

// ---- 9 photo interlude
{
  const s = pres.addSlide({ masterName: 'PHOTO', sectionTitle: 'What it does' })
  const ad = path.join(AD, 'raw-2.jpg')
  if (has(ad)) { s.addImage({ path: ad, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H }, objectName: 'photograph' }); s.addShape(pres.ShapeType.rect, { x: W - 7, y: 0, w: 7, h: H, fill: { color: THEME.colors.dk1, transparency: 40 }, line: { color: THEME.colors.dk1, transparency: 100 }, objectName: 'shade' }) }
  s.addText([{ text: 'SEE', options: { breakLine: true } }, { text: 'WHAT IS.' }], { x: 6.6, y: 2.0, w: 6.2, h: 2.6, fontSize: 80, bold: true, color: C.background1, align: 'right', margin: 0, isTextBox: true, lineSpacingMultiple: 0.9, objectName: 'headline' })
  s.addText('Live traffic, incidents, air and rain. Nothing made up.', { x: 6.6, y: 4.7, w: 6.2, h: 0.6, fontSize: 18, color: C.background2, align: 'right', margin: 0, isTextBox: true, objectName: 'subline' })
  s.addImage({ path: path.join(LOGO, 'city-atlas-horizontal-transparent.png'), x: 0.7, y: H - 1.5, w: 2.9, h: 0.81, objectName: 'logo' })
}

// ---- 10 tiers
pres.addSection({ title: 'For everyone' })
{
  const s = light('For everyone')
  T(s, 'Free: what is here. Plus: what it means for you. Pro: what it means for a decision.')
  const tiers = [['CITY ATLAS', 'Know your surroundings.', ['Conditions around you', 'Click anywhere: the place card', 'Ask Atlas', 'Traffic, safety, air, rain', 'Three changes since yesterday', 'Routes with live traffic'], THEME.colors.accent3], ['CITY ATLAS PLUS', 'Understand how your city affects you.', ['Unlimited Ask Atlas', 'Live-here views', 'Before you rent or buy', 'Compare three areas', 'Watch areas and see them move', 'Alerts by WhatsApp or SMS'], THEME.colors.accent2], ['CITY ATLAS PRO', 'Turn location into intelligence for serious decisions.', ['Site finder for a purpose', 'Scenario Lab: road closes', 'Project workspace, GeoJSON/CSV', 'Client reports to PDF', 'Everything in Plus'], THEME.colors.accent1]]
  tiers.forEach(([name, tag, items, col], i) => {
    const x = 0.7 + i * 4.05
    s.addShape(pres.ShapeType.roundRect, { x, y: 2.0, w: 3.75, h: 4.6, fill: { color: THEME.colors.lt2 }, line: { color: THEME.colors.lt2 }, rectRadius: 0.2, shadow: { type: 'outer', blur: 10, offset: 3, angle: 90, color: '071924', opacity: 0.12 }, objectName: `tier ${i}` })
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.35, y: 2.35, w: 0.36, h: 0.36, fill: { color: col }, line: { color: col }, objectName: `tier dot ${i}` })
    s.addText(name, { x: x + 0.85, y: 2.3, w: 2.8, h: 0.46, fontSize: 15, bold: true, color: C.text1, valign: 'middle', margin: 0, isTextBox: true, charSpacing: 2, objectName: `tier name ${i}` })
    s.addText(tag, { x: x + 0.35, y: 2.9, w: 3.1, h: 0.7, fontSize: 13, italic: true, color: C.accent4, margin: 0, isTextBox: true, objectName: `tier tag ${i}` })
    s.addText(items.map((t, j) => ({ text: t, options: { bullet: true, breakLine: j < items.length - 1, paraSpaceAfter: 5 } })), { x: x + 0.35, y: 3.65, w: 3.1, h: 2.8, fontSize: 13, color: C.text2, margin: 0, isTextBox: true, valign: 'top', objectName: `tier items ${i}` })
  })
  s.addText('Never paywall basic knowledge. Paywall computational leverage.', { x: 0.7, y: 6.75, w: 9, h: 0.4, fontSize: 12, italic: true, color: C.accent4, margin: 0, isTextBox: true, objectName: 'motto' })
  note(s, 'Plus and Pro open with a password today; accounts and billing follow tested pricing.')
}

// ---- 11 pro
{
  const s = dark('For everyone')
  T(s, 'Pro: a workstation on the same city model.')
  const items = [['Site finder', 'Pick café, pharmacy, clinic, school, shop, office, warehouse or home. The hexagons on screen are ranked from the same real scores; a gap in supply counts for a pharmacy; every candidate says why and what has no data.'], ['Scenario Lab', '“Road closes” removes the drawn area from the network and the live router re-plans the trip. Metro, new development and signal timing are listed as not modelled, with the reason.'], ['Projects and reports', 'Shortlists, scenarios and watched areas saved to a workspace, exported as GeoJSON or CSV; a client report with every score’s class, confidence and source.']]
  items.forEach(([h, d], i) => {
    const y = 2.0 + i * 1.55
    s.addShape(pres.ShapeType.ellipse, { x: 0.7, y: y + 0.08, w: 0.5, h: 0.5, fill: { color: [THEME.colors.accent1, THEME.colors.accent5, THEME.colors.accent2][i] }, line: { color: [THEME.colors.accent1, THEME.colors.accent5, THEME.colors.accent2][i] }, objectName: `pro dot ${i}` })
    s.addText(h, { x: 1.4, y, w: 5, h: 0.5, fontSize: 20, bold: true, color: C.background1, valign: 'middle', margin: 0, isTextBox: true, objectName: `pro h ${i}` })
    s.addText(d, { x: 1.4, y: y + 0.55, w: 5.3, h: 1.0, fontSize: 12.5, color: C.background2, margin: 0, isTextBox: true, objectName: `pro d ${i}` })
  })
  shot(s, 'pro-saved.png', 7.2, 1.9, 5.5, 3.44, 'saved and projects')
  note(s, 'Screenshot: the project workspace with a watched area, a scenario and a shortlist.')
}

// ---- 12 under the hood
pres.addSection({ title: 'Under the hood' })
{
  const s = light('Under the hood')
  T(s, 'One city model. Everything flows through it.')
  const steps = [['SOURCES', 'OpenStreetMap\nTomTom\nOpen-Meteo\nCamera, uploads', THEME.colors.accent3], ['MEMORY', 'Every reading kept\nH3 cells\n28-day baselines\nDaily snapshots', THEME.colors.accent2], ['REASONING', 'Place state\nChanges\nRouting\nSite finder\nForecast', THEME.colors.accent1], ['WORDS', 'Ask Atlas\nEnglish / Hindi\nFacts in, prose out', THEME.colors.accent5], ['MAP', 'Ink tiers\nTraffic colours\nCallouts\nTime bar', THEME.colors.dk2]]
  steps.forEach(([h, d, col], i) => {
    const x = 0.7 + i * 2.5
    s.addShape(pres.ShapeType.roundRect, { x, y: 2.3, w: 2.2, h: 3.4, fill: { color: THEME.colors.lt2 }, line: { color: THEME.colors.lt2 }, rectRadius: 0.18, objectName: `step ${h}` })
    s.addShape(pres.ShapeType.ellipse, { x: x + 0.3, y: 2.6, w: 0.42, h: 0.42, fill: { color: col }, line: { color: col }, objectName: `step dot ${h}` })
    s.addText(h, { x: x + 0.85, y: 2.56, w: 1.3, h: 0.5, fontSize: 12, bold: true, color: C.text1, valign: 'middle', margin: 0, isTextBox: true, charSpacing: 2, objectName: `step h ${h}` })
    s.addText(d, { x: x + 0.3, y: 3.25, w: 1.7, h: 2.3, fontSize: 12.5, color: C.text2, margin: 0, isTextBox: true, valign: 'top', objectName: `step d ${h}` })
    if (i < steps.length - 1) s.addText('→', { x: x + 2.2, y: 3.7, w: 0.3, h: 0.5, fontSize: 18, color: C.accent4, align: 'center', margin: 0, isTextBox: true, objectName: `arrow ${i}` })
  })
  s.addText('FastAPI + SQLite on one Render service · React, Vite and TypeScript in the browser · the fogleman/ln line engine and the Shan Shui chunk pipeline for the ink.', { x: 0.7, y: 6.0, w: 11.9, h: 0.6, fontSize: 12, color: C.accent4, margin: 0, isTextBox: true, objectName: 'stack' })
  note(s, 'The server holds the model; the browser draws it.')
}

// ---- 13 numbers
{
  const s = dark('Under the hood')
  T(s, 'Built, tested, deployed. Today.')
  const stats = [['141', 'automated tests, web and server'], ['28', 'states and territories, one movable frame'], ['28 d', 'of memory per road, by weekday and hour'], ['0', 'simulated cars, people or incidents on the real map']]
  stats.forEach(([n, l], i) => {
    const x = 0.7 + i * 3.05
    s.addText(n, { x, y: 2.3, w: 2.8, h: 1.5, fontSize: 64, bold: true, color: [C.accent3, C.accent2, C.accent1, C.accent5][i], margin: 0, isTextBox: true, objectName: `stat ${i}` })
    s.addText(l, { x, y: 3.85, w: 2.7, h: 1.0, fontSize: 14, color: C.background2, margin: 0, isTextBox: true, objectName: `stat l ${i}` })
  })
  s.addText('Honesty rules the product keeps: nothing simulated for a real region; every number says how it knows; “no data” is never replaced by a guess; camera counts stay on the device.', { x: 0.7, y: 5.3, w: 11.9, h: 0.9, fontSize: 14, italic: true, color: C.background2, margin: 0, isTextBox: true, objectName: 'rules' })
  note(s, '107 web tests and 34 server tests at the time of this deck.')
}

// ---- 14 close
{
  const s = pres.addSlide({ masterName: 'PHOTO', sectionTitle: 'Under the hood' })
  const ad = path.join(AD, 'raw-3.jpg')
  if (has(ad)) { s.addImage({ path: ad, x: 0, y: 0, w: W, h: H, sizing: { type: 'cover', w: W, h: H }, objectName: 'photograph' }); s.addShape(pres.ShapeType.rect, { x: 0, y: 0, w: W, h: 4.2, fill: { color: THEME.colors.dk1, transparency: 35 }, line: { color: THEME.colors.dk1, transparency: 100 }, objectName: 'shade' }) }
  s.addText('ASK THE CITY.', { x: 0.7, y: 0.9, w: 11.9, h: 1.5, fontSize: 72, bold: true, color: C.background1, align: 'center', margin: 0, isTextBox: true, objectName: 'headline' })
  s.addText('infrashield-bengaluru.onrender.com', { x: 0.7, y: 2.4, w: 11.9, h: 0.6, fontSize: 20, color: C.accent2, align: 'center', margin: 0, isTextBox: true, objectName: 'url' })
  s.addImage({ path: path.join(LOGO, 'city-atlas-horizontal-transparent.png'), x: (W - 3.6) / 2, y: H - 1.9, w: 3.6, h: 1.0, objectName: 'logo' })
}

;(async () => {
  const out = path.join(HERE, 'City_Atlas_Launch.pptx')
  await pres.writeFile({ fileName: out })
  await applyTheme(out, THEME)
  console.log('wrote', out)
})()
