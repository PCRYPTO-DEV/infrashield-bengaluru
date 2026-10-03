# Atlas Infinity

A living map of a city. Where a map answers *where is something?*, Atlas
Infinity answers *what is happening here, why, what is unusual, what may
happen next, and how sure are we?* It says, for every object on screen, how it
knows: **seen**, **worked out**, **a guess**, or **made up**.

Region: **all of India**, state by state (first centre: Delhi), with real streets and buildings from
OpenStreetMap and live traffic from TomTom. Nothing on the map is made up:
where no data exists, the map stays empty and says so. (The procedural
city generator survives in the engine for tests only.)

Three open-source ideas are merged into one product:

- **{Shan, Shui}\*** (Lingdong Huang): a world that is planned, generated and
  drawn tile by tile as you move, from a seed, as ink on paper.
- **ln** (Michael Fogleman): a 3D engine whose output is lines, not pixels.
  Ported to TypeScript and fed with the city's buildings: the **Ink 3D** mode,
  **Atlas Vision** (the city drawn from a camera's own eye) and plottable SVG
  exports.
- The City Atlas brand (logo package) for the chrome; ink on paper for the map.
- An evidence-first intelligence layer: traffic flow, crowding, odd behaviour,
  risk, forecasts, zones, routes, business scoring, memory, City Pulse, and
  **Ask the City** with an AI writer that only rephrases measured facts, in
  simple English or Hindi, typed or spoken.

```
Atlas intelligence/
  web/        the app (TypeScript · React · Vite · workers)        npm test: 93 tests
  server/     FastAPI: OSM tiles, TomTom, weather, AI writer, hosting  pytest: 15 tests
  docs/       architecture, data sources, deployment, integration, Shan Shui study
  render.yaml one-click Render deployment · Dockerfile for anything else
```

## Deploy it

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/PCRYPTO-DEV/infrashield-bengaluru)

New → Blueprint → `PCRYPTO-DEV/infrashield-bengaluru` → branch `atlas-intelligence` → Apply, then paste `TOMTOM_API_KEY` and `ANTHROPIC_API_KEY`. Details in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Run it

```bash
# server (Python 3.11)
python -m venv .venv && . .venv/bin/activate
pip install -r server/requirements-dev.txt
cp server/.env.example server/.env          # add TOMTOM_API_KEY and ANTHROPIC_API_KEY
# web
npm --prefix web ci && npm --prefix web run build
# one process serves both
uvicorn app.main:app --app-dir server --port 8000
# open http://localhost:8000/?region=ncr
```

Without keys or network, run against recorded fixtures:

```bash
python server/scripts/make_dev_fixtures.py          # synthetic Overpass / TomTom / weather responses
ATLAS_FIXTURES=$PWD/server/dev-fixtures uvicorn app.main:app --app-dir server --port 8000
```

`npm --prefix web run dev` starts Vite on port 5174 with `/api` proxied to the
server.

## What you can do

| | |
|---|---|
| **Click anywhere** | the Atlas place intelligence card: score, trend, every dimension with WHY, evidence class, confidence and provenance; Live-here views; Before you rent or buy; Compare areas |
| **What changed?** | ranked, evidenced changes since yesterday for the view on screen |
| **Around you** | traffic, air, rain, safety and unusual activity in five words |
| **Free · Plus · Pro** | Free: what is here. Plus (password gate for now): what it means for you, with areas you watch. Pro (its own password): the site finder, the Scenario Lab, a project workspace with GeoJSON/CSV export and client reports |
| **Site finder** (Pro) | pick café, pharmacy, clinic, school, shop, office, warehouse or home; the hexagons on screen are ranked from the same real place scores, gaps in supply count, every candidate says why and what has no data |
| **Five stones** | five big round buttons on the left of the map, in traffic-light colours: **Look** (what is here?), **Go** (how do I get there?), **Safe?** (what people reported today), **Changing?** (gentrification in Pro, What changed? for everyone) and **Worth it?** (UINTEL+ score). Every answer is about the same place, and every panel ends with *What next?* stones that carry that place on. Simple enough for a ten-year-old (design: `docs/design/pebble-cartography.md`). |
| **Gentrification** (Pro) | is this area gentrifying? BSOCIAL's Community Behaviour and Gentrification indices on the places people mapped within 1 km, two years of map history (with the 5 km ring's mapping growth taken out), headlines and reported crime; archetype, advisory for civic bodies, a hex layer on the map; price and rent are shown as missing unless you type your own figure (see `docs/GENTRIFICATION.md`) |
| **UINTEL+ INVEST score** (Pro) | is this location a good idea? One 0–100 score and grade from yield (your price and rent), FSI gap (mapped buildings vs your permitted FAR), distress headlines, construction sites nearby and the place card's infrastructure; below half the weight there is no score; never buy/sell advice (see `docs/UINTEL.md`) |
| **Scenario Lab** (Pro) | "Road closes": the closed area is removed from the network and the live router re-plans the trip; metro, new development and signal changes are listed as not modelled, with the reason |
| **Saved & projects** | Plus: watch an area and see how its score moved since you saved it. Pro: shortlists and scenarios, exported as GeoJSON or CSV |
| **Client report** (Pro) | a printable report of a place card: every score with its class, confidence, why and source, plus what changed nearby |
| **Map · Traffic · Busy · Risk · Ahead · Ink 3D** | the six modes (under More) |
| **Ask Atlas** | a real conversation, typed or spoken, in English or Hindi: the thread stays on screen, follow-ups work, and every reply is phrased by the AI writer from the facts the map knows right now (`ANTHROPIC_API_KEY` on the server); each turn can show the facts it used |
| **English / हिंदी** | every label, answer and voice follows the toggle |
| **Day / Night** | white paper and ink by default; the City Atlas deep-night look one click away (also `?theme=night` and the embed option) |
| **Embed** | `embed.js` drops the whole map into the City Atlas app on Emergent, or any page, in two minutes ([docs](docs/INTEGRATION.md)) |
| **Just reported** | a pink Report button: say what happened, where and a few words; it pops up as a pink comic callout for everyone looking at that place, for one day, marked as a person's report the app does not verify (112 first in an emergency) |
| **Zones** | draw a shape; it counts who goes in and out, including camera dots |
| **Route** | From → To anywhere in India with live traffic; options with time, delay and the incidents seen near each; the one with strictly fewer incidents is marked |
| **Camera** | count people and vehicles as moving dots from a phone or laptop camera; Atlas Vision shows the street from the camera's eye as ink lines |
| **Upload** | GeoJSON / JSON / CSV up to 10 MB become a "seen" layer |
| **PAST · NOW · FUTURE** | the time machine: PAST shows the readings the city kept (nothing interpolated), NOW is live, FUTURE is predicted from what each road usually reads at that hour, labelled with a confidence; a day back, six hours ahead |
| **Save line drawing** | in Ink 3D, export the view as a plotter-ready SVG |
| **Alerts** | "tell me when a road gets very slow / a camera counts too many / something happens in a zone", by WhatsApp or SMS in English or Hindi |
| **Memory** | every live reading is kept; roads show "usual at this hour" and you can ask "is it worse than usual?" |

## Honesty rules

| class | meaning | drawn as |
|---|---|---|
| observed · *seen* | OpenStreetMap, TomTom, weather, camera tracks, uploads | solid ink |
| derived · *worked out* | calculated from observations | soft teal overlays |
| predicted · *a guess* | what may happen | dashed violet ghosts |
| simulated · *made up* | generated with no observation behind it | labelled; violet tint when ahead of now |

Where TomTom has no reading, the simulation's figures stay labelled
simulated. The timeline says *replay* only where a recording exists. The AI
writer never adds a fact. Camera frames never leave the device and no face
model is ever loaded.

## Docs

- [What the decks promise and where the product stands](docs/DECK_COVERAGE.md)
- [Launch deck (PowerPoint)](docs/City_Atlas_Launch.pptx), built by `docs/deck/build_launch_deck.js` from real product screenshots and the brand colours

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the whole system, the ln merge, the data flow
- [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md): OpenStreetMap, TomTom, Open-Meteo, cameras, the AI writer; quotas and caching
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): Render, Docker, environment variables, the network hosts the server needs
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md): embedding in the CityAtlas / Atlas Vision app
- [`docs/SHAN_SHUI_ARCHITECTURE.md`](docs/SHAN_SHUI_ARCHITECTURE.md): the study of Shan Shui and what was kept
- [`web/THIRD_PARTY_NOTICES.md`](web/THIRD_PARTY_NOTICES.md): licences (Shan Shui, ln, both MIT)
