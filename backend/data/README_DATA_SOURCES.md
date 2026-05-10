# Data Sources — SYNTHETIC DEMO DATA

> **All data in this directory is synthetic and illustrative.**
> It was generated for demonstration purposes only and must NOT be used for operational decisions.
> Field inspection, operator records, and official agency data are required before any operational use.

## Facility Data (`bengaluru_facilities_seed.csv`)

- **Source type:** Synthetic/illustrative, generated from publicly known facility names and approximate locations.
- **Scores:** All scores (criticality, power dependency, etc.) are illustrative estimates only.
- **Coordinates:** Approximate public reference coordinates only. Not survey-grade.
- **Not sourced from:** BESCOM internal data, BWSSB operational records, hospital patient systems, BBMP private records, SCADA/CEMS.

## Risk Zone Data (`bengaluru_risk_zones_seed.geojson`)

- **Source type:** Synthetic zone boundaries based on publicly known flood-risk areas.
- **Reference publications:** News media, BBMP flood reports (public), satellite imagery interpretation.
- **Accuracy:** Low — illustrative only. Do not use for emergency planning without official BBMP/KSNDMC data.

## Power Asset Data (`bengaluru_power_assets_seed.csv`)

- **Source type:** Synthetic, based on publicly referenced BESCOM substation names/locations.
- **Capacity figures:** Illustrative only. Actual capacity data requires BESCOM official records.
- **Reliability scores:** Synthetic estimates only.

## Official Sources for Real Data

| Agency | Data Type | Access |
|--------|-----------|--------|
| BESCOM | Feeder maps, substation data | Public tender docs, RTI |
| BWSSB | Pumping stations, service reservoirs | Annual reports, RTI |
| BBMP | Facility registry, ward boundaries | Open data portal |
| KSNDMC | Flood risk maps, weather data | Public portal |
| BMRCL | Metro station locations | BMRCL website |
| Karnataka Health Dept | Hospital registry | State portal |
| KFES | Fire station locations | State portal |

## Disclaimer

This product uses synthetic demonstration data. All scores are decision-support indicators only.
Validate through field inspection, operator data, and official agency records before operational use.
