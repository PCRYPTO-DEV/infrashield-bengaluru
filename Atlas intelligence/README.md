# Atlas Infinity

A living map of a city. Where a map answers *where is something?*, Atlas
Infinity answers *what is happening here, why, what is unusual, what may
happen next, and how sure are we?* It says, for every object on screen, how it
knows: **seen**, **worked out**, **a guess**, or **made up**.

First region: **Delhi NCR**, with real streets and buildings from
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
  web/        the app (TypeScript · React · Vite · workers)        npm test: 92 tests
  server/     FastAPI: OSM tiles, TomTom, weather, AI writer, hosting  pytest: 11 tests
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
| **Map · Traffic · Busy · Risk · Ahead · Ink 3D** | the six modes (top centre) |
| **Ask the city** | type or press the mic; answers list the facts they came from |
| **English / हिंदी** | every label, answer and voice follows the toggle |
| **Zones** | draw a shape; it counts who goes in and out, including camera dots |
| **Route** | a route with less risk, with the factors shown |
| **Camera** | count people and vehicles as moving dots from a phone or laptop camera; Atlas Vision shows the street from the camera's eye as ink lines |
| **Upload** | GeoJSON / JSON / CSV up to 10 MB become a "seen" layer |
| **Timeline** | live, recorded replay, or what may come next |
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

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the whole system, the ln merge, the data flow
- [`docs/DATA_SOURCES.md`](docs/DATA_SOURCES.md): OpenStreetMap, TomTom, Open-Meteo, cameras, the AI writer; quotas and caching
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md): Render, Docker, environment variables, the network hosts the server needs
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md): embedding in the CityAtlas / Atlas Vision app
- [`docs/SHAN_SHUI_ARCHITECTURE.md`](docs/SHAN_SHUI_ARCHITECTURE.md): the study of Shan Shui and what was kept
- [`web/THIRD_PARTY_NOTICES.md`](web/THIRD_PARTY_NOTICES.md): licences (Shan Shui, ln, both MIT)
