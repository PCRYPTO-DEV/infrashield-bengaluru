# Build Notes — Polymath InfraShield Bengaluru

## Build Date
2026-05-07

## Key Design Decisions

### SQLite as Default (No PostGIS Required)
The MVP uses SQLite + GeoJSON flat files rather than PostgreSQL+PostGIS. This means:
- Zero-config local setup for demos and development
- `python seed_data.py` → immediate working database
- Docker compose still provides PostgreSQL+PostGIS for production deployment

### Frontend-First Fallback
If the backend is unreachable, the frontend falls back to `sampleFacilities.ts` (hardcoded seed data). The app renders fully in the browser with all 41 demo facilities and scoring logic. This makes the app demo-safe with zero backend dependency.

### Identical Scoring Logic
`backend/scoring.py` and `frontend/src/utils/scoring.ts` implement exactly the same formula. If weights change, BOTH files must be updated. No shared schema is used — this is intentional for MVP simplicity.

### No Chart Libraries
Score breakdowns use plain HTML/CSS bar charts to avoid bundle size overhead. The circular score gauge uses a raw SVG `<circle>` with `strokeDashoffset`. No D3, Chart.js, or Recharts.

### Leaflet + react-leaflet
Chosen over MapLibre for simpler setup and broad OpenStreetMap tile compatibility without API keys. MapLibre is recommended for production with Mapbox/Stadia tiles.

### Jinja2 for Reports
The HTML report is generated server-side using Jinja2 with inline CSS — no PDF library dependency. Users can print-to-PDF from the browser.

## Known Limitations

- Coordinates are approximate (not survey-grade)
- All scores are synthetic / illustrative
- No real-time data feeds in MVP
- No authentication or access control
- No inter-facility dependency modelling
- SQLite has no geospatial query capability (PostGIS required for proximity queries)
- Report download requires backend to be running

## Potential Issues

### CORS
CORS is configured for `localhost:5173` and `localhost:3000`. Add production origin to `main.py` before deploying.

### Leaflet CSS
Must import `leaflet/dist/leaflet.css` in `main.tsx` BEFORE the app renders. Missing import causes broken map tiles.

### CSV Comment Lines
The seed CSV has a `#` comment header row. The reader skips lines starting with `#` — do not add `#` in data rows.

## Port Map

| Port | Service |
|------|---------|
| 5173 | Frontend (Vite dev) |
| 8000 | Backend (FastAPI uvicorn) |
| 5432 | PostgreSQL (Docker only) |
