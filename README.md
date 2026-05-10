# Polymath InfraShield Bengaluru

**Critical infrastructure continuity intelligence for Bengaluru.**

> Which critical facilities in Bengaluru are most likely to suffer operational disruption — and why?

---

## What It Is

InfraShield Bengaluru is a decision-support platform for critical infrastructure continuity planning. It maps hospitals, water utilities, power substations, tech parks, emergency services, and transport hubs across Bengaluru and calculates a **Continuity Risk Score (CRS)** for each based on:

- Power dependency and backup readiness gap  
- Flood and drainage exposure  
- Water dependency  
- Road and emergency access risk  
- Heat exposure  
- Data confidence

**This is NOT a smart-city dashboard, SCADA system, or hospital patient-data tool.** It is a planning and risk-intelligence product for resilience officers, emergency planners, insurers, and facility operators.

---

## Problem Statement

Bengaluru faces compounding critical infrastructure risks: urban flooding (Bellandur, Majestic), power supply interruptions (feeder-level BESCOM reliability), water scarcity (borewell/tanker dependency), chronic road congestion, and increasing heat events. There is no unified platform to assess which specific facilities are most exposed to operational disruption and why.

## Solution

A web application that scores every critical facility on eight risk dimensions, generates explainable risk cards with driver analysis and recommended actions, and produces executive reports suitable for BBMP, district disaster management, and infrastructure investors.

---

## Architecture

```
┌─────────────────────────────────┐
│  React + TypeScript + Vite      │  Port 5173
│  Leaflet map, Tailwind CSS      │
│  Sample data fallback built-in  │
└──────────────┬──────────────────┘
               │ REST API (/api proxy)
┌──────────────▼──────────────────┐
│  FastAPI (Python)               │  Port 8000
│  SQLite (dev) / PostgreSQL+PostGIS (prod)
│  Jinja2 report generator        │
└─────────────────────────────────┘
```

---

## Setup — Local (No Docker)

### Backend

```bash
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# Mac/Linux:
source venv/bin/activate

pip install -r requirements.txt
python seed_data.py        # seeds SQLite with 41 demo facilities
uvicorn main:app --reload --port 8000
```

API runs at http://localhost:8000  
Interactive docs at http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App runs at http://localhost:5173

> **Demo mode:** If the backend is not running, the frontend automatically uses built-in sample data. All 41 facilities and scoring will work offline.

---

## Setup — Docker

```bash
docker-compose up --build
```

Services start on:
- Frontend: http://localhost:5173
- Backend: http://localhost:8000
- PostgreSQL: localhost:5432

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | API health check |
| GET | `/facilities` | List all facilities (supports `?zone=&facility_type=&risk_level=` filters) |
| GET | `/facilities/{id}` | Get facility detail |
| POST | `/facilities/upload` | Upload CSV of new facilities |
| GET | `/risk/top` | Top N highest-risk facilities (default 10) |
| POST | `/risk/calculate` | Recalculate all scores |
| GET | `/zones` | GeoJSON risk zones |
| GET | `/power-assets` | Power asset list |
| GET | `/report/summary` | Executive report JSON |
| GET | `/report/facility/{id}` | Facility-specific report JSON |
| GET | `/export/facilities.csv` | Download scored facilities CSV |
| GET | `/export/report.html` | Download executive HTML report |

---

## Scoring Model

```
CRS =   0.20 × criticality_score
      + 0.20 × power_dependency_score
      + 0.15 × (100 - backup_readiness_score)
      + 0.15 × flood_exposure_score
      + 0.10 × water_dependency_score
      + 0.10 × road_access_score
      + 0.05 × heat_exposure_score
      + 0.05 × (100 - data_confidence_score)
```

Risk levels: 0–30 Low | 31–55 Medium | 56–75 High | 76–100 Critical  
Facilities with data confidence < 50 → "Insufficient Data" regardless of score.

See `docs/SCORING_MODEL.md` for full documentation.

---

## Seed Data

41 synthetic demo facilities across 14 Bengaluru zones. Run `python seed_data.py` to load.  
Data is clearly marked synthetic. See `backend/data/README_DATA_SOURCES.md`.

---

## Limitations

- All scores are synthetic / illustrative estimates
- Coordinates are approximate (not survey-grade)
- No real-time data feeds
- No authentication or access control
- Scoring model weights are assumptions, not empirically calibrated

---

## Disclaimer

> This MVP uses public, open, and synthetic demonstration data. Scores are decision-support indicators only and must be validated through field inspection, operator data, and official agency records (BESCOM, BWSSB, BBMP, Karnataka Health Department) before operational use.

---

## Next Steps

1. Real data integration: BESCOM feeder data, BWSSB, BBMP facility registry, KSNDMC flood GIS
2. District / ward boundary overlays
3. Multi-hazard scenario modelling
4. Facility operator data entry portal
5. Role-based access control
6. Mobile-responsive layout
7. Expansion to other Indian cities

---

*Built by ATBOSE / Polymath · 2026*
