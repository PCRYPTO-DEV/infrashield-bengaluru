import type { Language } from '../intelligence/reasoning/claudeExplainer'
import type { EvidenceClassification } from '../entities/types'

/**
 * Every word the app shows, in simple English and simple Hindi.
 * Rule for both: short, everyday words; no jargon. The evidence classes
 * keep one plain phrase each so the reader always knows how sure we are.
 */
const S = {
  // evidence classes
  'cls.observed': ['seen', 'देखा गया'],
  'cls.derived': ['worked out', 'हिसाब से निकाला'],
  'cls.predicted': ['a guess', 'अनुमान'],
  'cls.simulated': ['made up', 'नकली (सिमुलेशन)'],
  // top bar
  'top.tagline': ['A living map of the city', 'शहर का जीता-जागता नक्शा'],
  'top.regenerate': ['new city', 'नया शहर'],
  'badge.osm': ['real streets · OpenStreetMap', 'असली सड़कें · OpenStreetMap'],
  'badge.simworld': ['made-up city', 'नकली शहर'],
  'badge.simtraffic': ['traffic is made up (demo)', 'ट्रैफ़िक बनावटी है (डेमो)'],
  'badge.notraffic': ['no live traffic feed yet', 'अभी लाइव ट्रैफ़िक नहीं'],
  'badge.demo': ['DEMO · made-up city, not data', 'डेमो · बनावटी शहर, डेटा नहीं'],
  'badge.realonly': ['real data only · nothing is made up', 'सिर्फ़ असली डेटा · कुछ भी बनावटी नहीं'],
  'badge.livetraffic': ['live traffic · TomTom', 'लाइव ट्रैफ़िक · TomTom'],
  'badge.derived': ['numbers are worked out', 'आँकड़े हिसाब से निकाले गए'],
  'badge.fallback': ['{n} tiles have no map data', '{n} टुकड़ों का नक्शा नहीं मिला'],
  // modes
  'mode.reality': ['Map', 'नक्शा'],
  'mode.reality.b': ['Streets, buildings and what moves on them', 'सड़कें, इमारतें और जो उन पर चलता है'],
  'mode.mobility': ['Traffic', 'ट्रैफ़िक'],
  'mode.mobility.b': ['How fast traffic moves and where it is slow', 'ट्रैफ़िक कितना तेज़ है और कहाँ धीमा है'],
  'mode.activity': ['Busy', 'भीड़'],
  'mode.activity.b': ['Where people gather', 'लोग कहाँ जमा होते हैं'],
  'mode.risk': ['Risk', 'ख़तरा'],
  'mode.risk.b': ['Odd things, accidents and risky spots', 'अजीब बातें, हादसे और ख़तरे की जगहें'],
  'mode.forecast': ['Ahead', 'आगे'],
  'mode.forecast.b': ['Where cars may go and where jams may come', 'गाड़ियाँ कहाँ जा सकती हैं और जाम कहाँ लग सकता है'],
  'mode.ink3d': ['Ink 3D', 'स्याही 3D'],
  'mode.ink3d.b': ['Buildings drawn in 3D as ink lines; zoom in to street level', 'इमारतें 3D में स्याही की लकीरों से; सड़क तक ज़ूम करें'],
  'ink.zoom': ['Zoom in to street level to see buildings in 3D', 'इमारतें 3D में देखने के लिए सड़क तक ज़ूम करें'],
  'ink.drawing': ['Drawing {n} tiles in ink…', '{n} टुकड़े स्याही से बन रहे हैं…'],
  'ink.ready': ['Ink lines · 3D drawing with hidden lines removed · fogleman/ln', 'स्याही की लकीरें · 3D चित्र · fogleman/ln'],
  'ink.save': ['Save line drawing', 'चित्र सहेजें'],
  // tools
  'tool.layers': ['layers', 'परतें'],
  'tool.zones': ['zones', 'इलाक़े'],
  'tool.route': ['route', 'रास्ता'],
  'tool.upload': ['upload', 'फ़ाइल'],
  'tool.pulse': ['pulse', 'हाल'],
  'tool.camera': ['camera', 'कैमरा'],
  'search.placeholder': ['Find a road, a place, #car', 'सड़क, जगह, #गाड़ी खोजें'],
  // layers
  'layers.title': ['What to show', 'क्या दिखाएँ'],
  'layer.roads': ['Roads', 'सड़कें'], 'layer.buildings': ['Buildings', 'इमारतें'], 'layer.labels': ['Street names', 'सड़कों के नाम'],
  'layer.vehicles': ['Vehicles', 'गाड़ियाँ'], 'layer.pedestrians': ['People walking', 'पैदल लोग'], 'layer.signals': ['Traffic lights', 'ट्रैफ़िक लाइटें'],
  'layer.incidents': ['Accidents and road works', 'हादसे और सड़क का काम'], 'layer.zones': ['Zones', 'इलाक़े'], 'layer.uploads': ['Uploaded files', 'अपलोड की फ़ाइलें'],
  'layer.flow': ['Traffic speed (worked out)', 'ट्रैफ़िक की रफ़्तार (हिसाब से)'], 'layer.density': ['How crowded (worked out)', 'भीड़ कितनी (हिसाब से)'], 'layer.activity': ['Busy spots (worked out)', 'भीड़ की जगहें (हिसाब से)'],
  'layer.anomalies': ['Odd things (worked out)', 'अजीब बातें (हिसाब से)'], 'layer.risk': ['Risk areas (worked out)', 'ख़तरे के इलाक़े (हिसाब से)'], 'layer.predictions': ['Where cars may go (guess)', 'गाड़ियाँ कहाँ जा सकती हैं (अनुमान)'], 'layer.forecast': ['Jams ahead (guess)', 'आगे जाम (अनुमान)'],
  // pulse
  'pulse.title': ['How the city is doing', 'शहर का हाल'],
  'pulse.wait': ['Working out the first numbers…', 'पहले आँकड़े निकल रहे हैं…'],
  'pulse.nodata': ['no data', 'कोई डेटा नहीं'],
  // zones
  'zones.title': ['Watch an area', 'एक इलाक़ा देखें'],
  'zones.help': ['Draw a shape on the map. The app counts who goes in and out. Shape: click points, press Enter or double-click to finish. Circle: click the middle, then the edge.', 'नक्शे पर एक आकार बनाएँ। ऐप गिनेगा कौन अंदर-बाहर गया। आकार: बिंदु क्लिक करें, Enter या डबल-क्लिक से पूरा करें। गोला: बीच में क्लिक करें, फिर किनारे पर।'],
  'zones.none': ['No areas yet.', 'अभी कोई इलाक़ा नहीं।'],
  'zones.restricted': ['no entry', 'प्रवेश मना'],
  'zone.polygon': ['shape', 'आकार'], 'zone.line': ['line', 'रेखा'], 'zone.radius': ['circle', 'गोला'], 'zone.corridor': ['road strip', 'सड़क की पट्टी'],
  'zones.count': ['Vehicles / people', 'गाड़ियाँ / लोग'], 'zones.speed': ['Average speed', 'औसत रफ़्तार'], 'zones.density': ['Crowding', 'भीड़'], 'zones.dwell': ['Longest stay', 'सबसे लंबा ठहराव'], 'zones.direction': ['Which way they go (E,SE,S,SW,W,NW,N,NE)', 'किस दिशा में (पू,द-पू,द,द-प,प,उ-प,उ,उ-पू)'],
  'zones.events': ['What happened', 'क्या हुआ'],
  // route
  'route.title': ['A route with less risk', 'कम ख़तरे वाला रास्ता'],
  'route.help': ['Click where you start and where you want to go. Move the sliders to say what matters more.', 'क्लिक करें कहाँ से चलना है और कहाँ जाना है। स्लाइडर से बताएँ क्या ज़्यादा ज़रूरी है।'],
  'route.pick': ['Pick start and end', 'शुरू और अंत चुनें'],
  'route.w.travelTime': ['time', 'समय'], 'route.w.incidentRisk': ['accidents', 'हादसे'], 'route.w.congestion': ['jams', 'जाम'], 'route.w.pedestrianRisk': ['people on foot', 'पैदल लोग'], 'route.w.environmental': ['air and weather', 'हवा और मौसम'],
  'route.distance': ['Distance', 'दूरी'], 'route.time': ['Time (about)', 'समय (लगभग)'], 'route.inc': ['Accidents on the way', 'रास्ते में हादसे'], 'route.cong': ['Jams on the way', 'रास्ते में जाम'], 'route.ped': ['People on foot on the way', 'रास्ते में पैदल लोग'],
  // upload
  'upload.title': ['Add your own data', 'अपना डेटा जोड़ें'],
  'upload.help': ['A GeoJSON, JSON or CSV file with lat/lng, up to 10 MB. We only read it; nothing in it runs. Its points show as', 'GeoJSON, JSON या CSV फ़ाइल (lat/lng के साथ), 10 MB तक। हम सिर्फ़ पढ़ते हैं; कुछ चलता नहीं। इसके बिंदु दिखेंगे'],
  'upload.added': ['Added {n} things as a "seen" layer.', '{n} चीज़ें "देखा गया" परत में जोड़ीं।'],
  'upload.rejected': ['Could not use the file: {m}', 'फ़ाइल काम नहीं आई: {m}'],
  'upload.toobig': ['the file is bigger than 10 MB', 'फ़ाइल 10 MB से बड़ी है'],
  // legend
  'legend.title': ['How sure are we?', 'हम कितने पक्के हैं?'],
  'legend.observed': ['seen · real data · solid line', 'देखा गया · असली डेटा · पक्की लकीर'],
  'legend.derived': ['worked out from data · soft colour', 'डेटा से निकाला · हल्का रंग'],
  'legend.predicted': ['a guess about the future · dashed', 'भविष्य का अनुमान · टूटी लकीर'],
  'legend.simulated': ['made up by the simulation · purple when ahead of now', 'सिमुलेशन का बनाया · आगे के समय में बैंगनी'],
  'legend.traffic': ['traffic · green, orange, red, dark red (like Google Maps); dashed when only a guess', 'ट्रैफ़िक · हरा, नारंगी, लाल, गहरा लाल (Google Maps जैसा); अनुमान हो तो टूटी लकीर'],
  'legend.risk': ['accident or risk · rings', 'हादसा या ख़तरा · गोल घेरे'],
  // timeline
  'time.live': ['LIVE', 'लाइव'],
  'time.replay': ['REPLAY · recorded · {n} min', 'रीप्ले · रिकॉर्ड किया · {n} मिनट'],
  'time.resim': ['REPLAYED AGAIN · nothing recorded · {n} min', 'दोबारा चलाया · कुछ रिकॉर्ड नहीं · {n} मिनट'],
  'time.sim': ['WHAT MAY COME · +{n} min', 'जो हो सकता है · +{n} मिनट'],
  'time.left': ['2 hours back · we recorded the last {n} min, earlier is replayed again', '2 घंटे पीछे · पिछले {n} मिनट रिकॉर्ड हैं, उससे पहले दोबारा चलाया'],
  'time.now': ['now', 'अभी'],
  'time.behind': ['catching up… {n} s behind', 'पीछे है… {n} सेकंड'],
  'time.right': ['2 hours ahead · a guess', '2 घंटे आगे · अनुमान'],
  'time.nofuture': ['the future is not simulated for real data', 'असली डेटा के लिए भविष्य नहीं बनाया जाता'],
  // inspector
  'insp.title': ['Details', 'जानकारी'],
  'insp.gone': ['This one left the loaded area.', 'यह लोड किए इलाक़े से बाहर चला गया।'],
  'insp.what': ['What', 'क्या'], 'insp.type': ['Kind', 'किस्म'], 'insp.state': ['Now', 'अभी'], 'insp.on': ['On', 'कहाँ'], 'insp.pos': ['Position', 'जगह'], 'insp.time': ['Time', 'समय'], 'insp.source': ['From', 'कहाँ से'], 'insp.conf': ['How sure', 'कितना पक्का'],
  'insp.stopped': ['stopped', 'रुका है'], 'insp.moving': ['moving', 'चल रहा है'], 'insp.heading': ['heading', 'दिशा'],
  'insp.vehicle': ['vehicle', 'गाड़ी'], 'insp.pedestrian': ['person walking', 'पैदल आदमी'],
  'insp.history': ['Speed over the last {n} moments', 'पिछले {n} पलों की रफ़्तार'],
  'insp.anomalies': ['Odd things', 'अजीब बातें'],
  'insp.related': ['Nearby events · {m} min, {d} m', 'आस-पास की घटनाएँ · {m} मिनट, {d} मीटर'],
  'insp.prediction': ['Our guess', 'हमारा अनुमान'],
  'insp.pred.text': ['may go this way for the next {s} s; we are {c}% sure; the path could be off by {m} m.', 'अगले {s} सेकंड शायद इधर जाए; हम {c}% पक्के हैं; रास्ता {m} मीटर इधर-उधर हो सकता है।'],
  'insp.pred.alt': ['{n} other possible turn(s).', '{n} और मुमकिन मोड़।'],
  'insp.cars': ['{n} simulated vehicles · jam level {c}', '{n} नकली गाड़ियाँ · जाम {c}'],
  'insp.livespeed': ['Live speed', 'लाइव रफ़्तार'], 'insp.offree': ['{n}% of free-flow speed', 'खुली सड़क की रफ़्तार का {n}%'], 'insp.ago': ['{n} min ago', '{n} मिनट पहले'],
  'insp.active': ['active', 'चालू'], 'insp.inactive': ['over', 'ख़त्म'],
  'insp.fc': ['jam level {a} now → {b} in {m} min; we are {c}% sure', 'जाम {a} अभी → {b} {m} मिनट में; हम {c}% पक्के हैं'],
  // hints
  'hint.route': ['click where you start, then where you go', 'पहले शुरू की जगह क्लिक करें, फिर मंज़िल'],
  'hint.draw': ['drawing a {k} · Enter or double-click to finish · Esc to cancel', '{k} बना रहे हैं · Enter या डबल-क्लिक से पूरा · Esc से रद्द'],
  'hint.cancel': ['cancel', 'रद्द'],
  // camera
  'cam.title': ['Camera counts', 'कैमरे से गिनती'],
  'cam.help': ['Counts people and vehicles as moving dots. The picture stays on this device and no face is ever looked for.', 'लोगों और गाड़ियों को चलते बिंदुओं की तरह गिनता है। तस्वीर इसी डिवाइस पर रहती है और चेहरा कभी नहीं खोजा जाता।'],
  'cam.s1': ['Open the camera', 'कैमरा खोलें'], 'cam.s2': ['Match four spots', 'चार जगहें मिलाएँ'], 'cam.s3': ['Place the camera', 'कैमरा रखें'], 'cam.s4': ['Count', 'गिनें'],
  'cam.demo': ['Try a demo without a camera', 'बिना कैमरे के डेमो देखें'],
  'cam.match.now': ['Now click the same spot on the map.', 'अब नक्शे पर वही जगह क्लिक करें।'],
  'cam.match': ['Click a spot in the picture, then the same spot on the map. {n} of 4 done.', 'तस्वीर में एक जगह क्लिक करें, फिर नक्शे पर वही जगह। 4 में से {n} हो गए।'],
  'cam.match.map': ['Now click the same spot on the map ({n} of 4)', 'अब नक्शे पर वही जगह क्लिक करें (4 में से {n})'],
  'cam.startover': ['start over', 'फिर से'],
  'cam.place': ['Place the camera on the map', 'नक्शे पर कैमरा रखें'],
  'cam.place.hint': ['Click where the camera stands on the map', 'नक्शे पर क्लिक करें जहाँ कैमरा खड़ा है'],
  'cam.height': ['height', 'ऊँचाई'],
  'cam.start': ['Start counting', 'गिनती शुरू करें'], 'cam.startdemo': ['Start the demo count', 'डेमो गिनती शुरू करें'], 'cam.reset': ['reset', 'रीसेट'],
  'cam.loading': ['Loading the detector in your browser…', 'आपके ब्राउज़र में डिटेक्टर लोड हो रहा है…'],
  'cam.counting': ['counting · {n} fps', 'गिन रहे हैं · {n} fps'], 'cam.stop': ['Stop', 'रोकें'],
  'cam.people': ['People now', 'लोग अभी'], 'cam.vehicles': ['Vehicles now', 'गाड़ियाँ अभी'], 'cam.frames': ['Frames read', 'फ़्रेम पढ़े'], 'cam.ms': ['Detection time', 'पहचान का समय'],
  'cam.vision': ['Atlas Vision: the city from the camera\'s eye, drawn as lines by the 3D engine, with the counted dots on top. {n} lines.', 'Atlas Vision: कैमरे की नज़र से शहर, 3D इंजन की लकीरों में, ऊपर गिने हुए बिंदु। {n} लकीरें।'],
  'cam.labels': ['Things we look for: {l}. Draw a zone on the map and it counts these dots too.', 'हम ये ढूँढते हैं: {l}। नक्शे पर इलाक़ा बनाएँ, वह इन बिंदुओं को भी गिनेगा।'],
  'cam.calibfirst': ['calibrate first: four matching points', 'पहले चार जगहें मिलाएँ'],
  // template answers
  'tpl.none': ['The map has nothing to show for this question in this view right now.', 'इस सवाल के लिए नक्शे के पास अभी इस जगह कुछ नहीं है।'],
  'tpl.whats_happening': ['Here is what we can see in this area:', 'इस इलाक़े में यह दिख रहा है:'],
  'tpl.why_slow': ['Traffic here is slower than normal. The reasons we can see:', 'यहाँ ट्रैफ़िक सामान्य से धीमा है। जो वजहें दिखती हैं:'],
  'tpl.unusual': ['These things look different from normal:', 'ये बातें सामान्य से अलग लगती हैं:'],
  'tpl.dangerous_intersections': ['The crossings with the most risk right now:', 'अभी सबसे ख़तरे वाले चौराहे:'],
  'tpl.history': ['What happened in this time window:', 'इस समय में क्या हुआ:'],
  'tpl.forecast': ['Our best guess for what comes next:', 'आगे क्या हो सकता है, हमारा अनुमान:'],
  'tpl.site_selection': ['The best spots, scored from the data we have:', 'हमारे डेटा के हिसाब से सबसे अच्छी जगहें:'],
  'tpl.route': ['About this route:', 'इस रास्ते के बारे में:'],
  'tpl.pulse': ['How the city is doing right now:', 'शहर का हाल अभी:'],
  'tpl.help': ['Try asking what is happening, why traffic is slow, what is unusual, or where to open a shop.', 'पूछ कर देखें: क्या हो रहा है, ट्रैफ़िक धीमा क्यों है, क्या अजीब है, या दुकान कहाँ खोलें।'],
  'tpl.sure': ['we are {c}% sure', 'हम {c}% पक्के हैं'],
  'tpl.hindi.note': ['The facts below are in English until the AI writer is switched on.', 'नीचे के तथ्य अंग्रेज़ी में हैं जब तक AI लेखक चालू नहीं होता।'],
  'caveat.sim': ['This city is a simulation: the things in it are made up, the numbers are worked out from them, and guesses about the future are marked as guesses. Nothing here is a claim about the real world.', 'यह शहर एक सिमुलेशन है: इसकी चीज़ें बनाई हुई हैं, आँकड़े उनसे निकाले गए हैं, और भविष्य की बातें अनुमान हैं। यहाँ कुछ भी असली दुनिया का दावा नहीं है।'],
} as const

export type StringKey = keyof typeof S

export function tr(lang: Language, key: StringKey, vars?: Record<string, string | number>): string {
  let s: string = S[key][lang === 'hi' ? 1 : 0]
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  return s
}

/** Plain word for an evidence class. */
export function cls(lang: Language, c: EvidenceClassification): string { return tr(lang, `cls.${c}` as StringKey) }

export function makeT(lang: Language) {
  return Object.assign((key: StringKey, vars?: Record<string, string | number>) => tr(lang, key, vars), { cls: (c: EvidenceClassification) => cls(lang, c), lang })
}
export type T = ReturnType<typeof makeT>
