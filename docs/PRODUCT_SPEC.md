# Product Specification — Polymath InfraShield Bengaluru

## Product Identity

**Name:** Polymath InfraShield Bengaluru  
**Tagline:** Critical infrastructure continuity intelligence for Bengaluru  
**Brand:** ATBOSE / Polymath  
**Status:** MVP v1.0  

## Core Question

> "Which critical facilities in Bengaluru are most likely to suffer operational disruption during flood, power, water, heat, road-access or backup-system failure — and why?"

## What This Product Is NOT

- Not a smart-city dashboard
- Not a data-center-only tool
- Not a power-grid control system
- Not SCADA / CEMS / OT
- Not hospital patient-data software
- Not a real-time monitoring system (MVP)

## What This Product IS

A decision-support platform for:
- Critical infrastructure continuity planning
- Resilience and emergency preparedness
- Infrastructure insurance / risk assessment
- Facility-level mitigation planning
- Infrastructure due diligence

## User Personas

| Persona | Primary Use Case |
|---------|-----------------|
| BBMP / City Resilience Officer | City-wide vulnerability mapping and prioritisation |
| District Disaster Management Officer | Pre-monsoon risk identification and resource staging |
| Hospital Administrator | Facility-level backup and continuity gap review |
| Industrial/Tech Park Operator | Campus continuity risk and insurance preparation |
| Infrastructure Investor / Insurer | Due diligence risk scoring |
| Utility Planning Stakeholder | Dependency mapping and upgrade prioritisation |
| Emergency Response Planner | Response routing and facility status awareness |

## MVP Geography

Bengaluru Urban District.

Demo zones: Electronic City, Whitefield, Bellandur, Koramangala, Hebbal, Yelahanka, KR Puram, Peenya, Central Bengaluru, Sarjapur Road, Manyata/Nagavara, Marathahalli, Indiranagar, HSR Layout, Majestic.

## Core Product Outputs

1. Interactive facility map with risk markers
2. Facility risk cards with score breakdown
3. Continuity Risk Score (0–100) per facility
4. Risk level classification (Low / Medium / High / Critical / Insufficient Data)
5. Top 10 most vulnerable facilities table
6. Zone-level risk observations
7. Missing data checklist
8. AI-style executive mitigation report
9. CSV export
10. HTML report export

## Data Strategy (MVP)

MVP uses only:
- Public facility names and approximate coordinates
- Synthetic / estimated risk scores
- Open media references for flood zones
- No SCADA, no patient data, no private records

Next version will integrate:
- BESCOM feeder reliability data (RTI / open tender docs)
- BWSSB operational data
- BBMP official facility registry
- KSNDMC flood zone GIS data

## Technical Architecture

```
Browser (React + Leaflet)
    ↕ REST API
FastAPI (Python) on port 8000
    ↕ SQL
SQLite (dev) / PostgreSQL+PostGIS (prod)
    + GeoJSON flat files for zones
```

## Next Build Iteration

1. Real data integration (BESCOM, BWSSB, BBMP)
2. District / ward-level boundary overlay
3. Multi-hazard simultaneous scenario modelling
4. Facility operator data entry portal
5. Email-based verification checklist distribution
6. Mobile-responsive layout
7. Role-based access (viewer / analyst / admin)
8. Expansion to other Indian cities
