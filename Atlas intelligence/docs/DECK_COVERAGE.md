# What the two decks promise, and where the product stands

Two decks describe the product: *Atlas Infinity Pitch* (the engine: a living city you can question) and *City Atlas Vision* (the intelligence model: place, time and consequence for people, Plus and Pro). This page maps every claim to the product as built, with the rule that never bends: **nothing is simulated or invented for a real region; where data is missing the product says "no data"**, and every number says how it knows (seen · worked out · predicted) with a confidence and a source.

Legend: ✅ working on real data · 🟡 working with a stated limit · ⛔ not built, with the honest reason shown in the product.

## Atlas Infinity Pitch

| Slide | Promise | Status | Where |
|---|---|---|---|
| 2 | Why is this road jammed? | ✅ | Click a road or ask "Why is traffic slow?": live TomTom speed vs the usual at this hour from the city's memory, incidents on the road |
| 2 | Which way home is calmer? | ✅ | Route tool, anywhere in India: options with live time, delay and the incidents seen within 300 m; the one with strictly fewer incidents is marked, never called "safe" |
| 2 | What happens in 30 minutes? | ✅ | Time bar → FUTURE: what each road usually reads at that hour with today's anomaly fading, labelled PREDICTED with a confidence |
| 3–4 | Every car moves, grows as you move, a brain watches | 🟡 | Real regions: streets stream in as you pan; cars are **measured-speed markers** (no simulated vehicles, the legend says so); the insight engine watches and pops callouts. The made-up seed city exists only as the engine demo (`?region=demo`), never on the real map |
| 5 | Seen / worked out / guessed / made up, drawn differently | ✅ | Solid, soft, dashed; every card, bubble and answer carries the class and source |
| 6 | Getting home calmer, shows its working | ✅ | Route options list time, traffic delay and incidents; the explanation names its source and says lower reported risk is not a guarantee |
| 7 | "Where should I open a café?" scored with the numbers behind it | ✅ | Ask Atlas answers with the top three cells and their reasons; the Pro site finder ranks the view for eight purposes with outlines on the map |
| 8 | Draw a circle, count who walks in and out, warn at a limit | ✅ | Zones tool + camera (on-device counting, no faces) + alerts by WhatsApp/SMS |
| 9 | Ask the city, evidence not guesses | ✅ | Ask Atlas: facts first, writer phrases them (Claude when `ANTHROPIC_API_KEY` is set), says when a line is a guess |
| 10 | Real streets, live traffic and weather, camera counts, AI writer | ✅ | OpenStreetMap vector tiles, TomTom flow + incidents, Open-Meteo weather + air, MediaPipe camera, Claude writer |
| 11 | Drop two pins, ask one question | ✅ | "Or pick two points on the map" routes country-wide; Ask Atlas is the centre of the screen |

## City Atlas Vision

| Slide | Promise | Status | Where |
|---|---|---|---|
| 2–3 | Ask a decision question → reason → evidence and alternatives | ✅ | Ask Atlas routes place, change, site and route questions to deterministic tools; answers list evidence and caveats |
| 4 | A question chooses the spatial tools | ✅ | intent → place / changes / sites / route / pulse tools; free questions go to the writer with the snapshot only |
| 5 | Click anywhere → a decision brief: access, exposure, development, evidence, weighted for priorities | ✅ | Place card: Atlas score, dimensions with WHY, provenance, confidence; Live-here views re-weight the same facts; "Before you rent or buy" questions |
| 6 | H3 cells, time-stamped memory, provenance, knowledge graph | 🟡 | H3 res 9 cells, memory tables with 28-day baselines, provenance rows. Relations are NEAR/SERVES computed per cell (nearest services, roads, transit); a persisted graph of places–assets–events is Phase 4 |
| 7 | PAST · NOW · FUTURE | ✅ | Time bar: PAST = the readings the city kept (nothing interpolated), NOW = live with feed freshness and disruptions, FUTURE = PREDICTED from what is usual with a confidence; "not remembered" and "too few readings" are said plainly |
| 8 | What changed? ranked, compared with a baseline, persistence, who it affects | 🟡 | Ranked by magnitude × confidence × relevance × impact from traffic, incidents, air, camera and zones. New construction and closures from map snapshots: not detectable until a second OpenStreetMap snapshot exists; the panel says so |
| 9 | Traffic digital twin: compare policies before a trial | 🟡 | Scenario Lab "Road closes": the closed area is removed from the network and the live router re-plans a trip, labelled what-if. Signals, lanes, metro and demand changes are listed as not modelled, with the reason (no calibrated demand data yet) |
| 10 | Free: around-you, basic Ask, route context, limited What changed. Plus: comparisons, briefs, watchlists, commute alerts, history | ✅ | Around-you strip, 3 changes free; Plus (password `atbose`): unlimited Ask, Live-here views, Compare 3, full What changed, alerts by message, safer routes, **Watch this area** with the score's move since saving |
| 11 | Expansion, property, logistics, infrastructure questions | 🟡 | Expansion: site finder with gap-in-supply logic. Property: place trend from daily snapshots and the rent-or-buy questions. Logistics: routes with incidents and closures. Infrastructure pressure vs capacity: no utilities data, says "no data" |
| 12 | Pro workspace: projects, site screening, catchment, portfolio, scenarios, deliverables | 🟡 | Pro (password `atbose-pro`): site finder, Scenario Lab, project workspace (saved shortlists, scenarios, areas) with GeoJSON/CSV export, client report. Catchment/cannibalisation and portfolio analysis need population and footfall adapters: not built |
| 13 | Scenario Lab: baseline, metro opens, road closes, new development, sensitivity | 🟡 | Road closes ✅ (real router). Metro, new development, sensitivity ⛔ with reasons shown in the panel |
| 14 | Consulting report: evidence-connected, PDF/PowerPoint, Excel/GeoJSON | 🟡 | Client report (print to PDF) with every score's class, confidence, why and source, plus what changed nearby; GeoJSON and CSV export of the project. PowerPoint export: not built |
| 15 | Free / Plus / Pro | ✅ | `web/src/app/tiers.ts`; passwords now, accounts and billing later |
| 16 | One shared city model, separate experiences | ✅ | One server (cells, memory, time machine, sites, routing); the same tools answer people, Plus and Pro |
| 17 | Defensibility from city memory | ✅ | Every live reading is kept (stable road ids), baselines by weekday and hour, daily cell snapshots |
| 18 | Trust: evidence, confidence, privacy, human judgement | ✅ | Provenance rows, classes, "no data"; camera counts on device, no faces; the report records assumptions and due-diligence questions |
| 19 | Roadmap 01–04 | — | 01 done; 02 done (memory, What changed, Plus); 03 partly (Pro workspace, Scenario Lab v1, reports; calibrated twin pending data); 04 open |

## Easy to use: how a person reaches each of these

- **Six things on screen**: brand, Around-you strip, search + state picker + What changed? + More, Ask Atlas, the time bar, the map. Everything else is contextual under More and rolls up.
- **Time**: three buttons, PAST · NOW · FUTURE, and a slider from yesterday to six hours ahead; the clock says what the map shows and how sure it is.
- **Pro**: More → *open Pro* opens the site finder with its password card; once open, the More menu lists *site finder*, *scenario lab* and *saved & projects*; the place card gains *Client report* and *Watch this area*.
- **Ask**: typing "Where should I open a café?" answers in words and opens the site finder for the full list.
