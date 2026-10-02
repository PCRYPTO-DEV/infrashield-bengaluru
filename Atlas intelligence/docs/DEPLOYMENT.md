# Deployment

One process serves everything: the FastAPI server answers `/api/*` and
serves the built web app from `web/dist` with a single-page fallback.

## Environment variables

| name | required | meaning |
|---|---|---|
| `TOMTOM_API_KEY` | for live traffic | TomTom developer key. Never commit it; rotate a key that was ever pasted into a chat. |
| `ANTHROPIC_API_KEY` | for the AI writer | Anthropic API key. Without it the template writer answers. |
| `ATLAS_REGION` | no | `ncr` (default) or `bengaluru` |
| `ATLAS_DATA_DIR` | no | where the SQLite cache lives (default `server/data`) |
| `TOMTOM_DAILY_BUDGET` | no | calls per UTC day before the server stops asking TomTom (default 2000) |
| `ATLAS_FIXTURES` | no | folder of recorded responses; runs offline |
| `OVERPASS_URL` | no | another Overpass endpoint |

## Render (recommended)

1. Push the repository to GitHub.
2. In Render, **New → Blueprint**, pick the repository; `render.yaml` at the
   root defines the service (Python runtime, Node 20 for the web build, a
   2 GB disk for the cache, health check on `/api/health`).
3. Set `TOMTOM_API_KEY` and `ANTHROPIC_API_KEY` in the service's
   environment.
4. Open the service URL: `https://<name>.onrender.com/?region=ncr`.

The web build uses relative asset paths, so the same build works under any
path. Cameras need HTTPS, which Render provides.

## Docker

```bash
docker build -t atlas-infinity .
docker run -p 8000:8000 -e TOMTOM_API_KEY=... -e ANTHROPIC_API_KEY=... -v atlas-data:/var/data atlas-infinity
```

## Outbound hosts the server must reach

- `overpass-api.de` (or your `OVERPASS_URL`)
- `api.tomtom.com`
- `api.open-meteo.com`
- `api.anthropic.com`
- optionally `download.geofabrik.de` for a bulk extract

The browser additionally loads the camera detector from
`cdn.jsdelivr.net` when the camera panel is opened.

## Verifying a live deployment

- `GET /api/health` → `{"ok": true, "tomtom": true, "writer": true}` when both keys are set.
- `GET /api/traffic/status` shows today's TomTom call count.
- In the app: the timeline badge reads `LIVE · TomTom + Open-Meteo + OpenStreetMap`; clicking a main road shows "Live speed … seen · tomtom"; City pulse → Environment shows the weather; the Ask panel shows "written by claude-opus-5-5".

## Static demo build

`VITE_DEFAULT_REGION=bengaluru npm --prefix web run build` produces a build
that starts on the procedural city, for hosts with no server (the simulated
demo artifact). Real data, the AI writer and the camera detector need the
server or the network; everything else works offline.
