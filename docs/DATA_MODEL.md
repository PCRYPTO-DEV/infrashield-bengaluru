# Data Model — Polymath InfraShield Bengaluru

## Facility Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (F001, F002 ... or UUID for uploads) |
| `name` | string | Facility name |
| `facility_type` | string | Asset class (see below) |
| `latitude` | float | WGS84 latitude |
| `longitude` | float | WGS84 longitude |
| `zone` | string | Bengaluru zone / area name |
| `owner_type` | 'public' / 'private' / 'unknown' | Ownership category |
| `criticality_score` | 0–100 | How critical this facility is to city operations |
| `power_dependency_score` | 0–100 | Reliance on grid power supply |
| `backup_readiness_score` | 0–100 | DG/UPS/backup adequacy (higher = better prepared) |
| `flood_exposure_score` | 0–100 | Proximity to / likelihood of flood impact |
| `water_dependency_score` | 0–100 | Dependence on external water supply |
| `road_access_score` | 0–100 | Road access difficulty / congestion risk |
| `heat_exposure_score` | 0–100 | Urban heat exposure level |
| `data_confidence_score` | 0–100 | Confidence in the input data (higher = more confident) |
| `continuity_risk_score` | 0–100 | **Computed** — see scoring model |
| `risk_level` | Low/Medium/High/Critical/Insufficient Data | **Computed** |
| `main_risk_drivers` | string[] | **Auto-generated** dominant risk factors |
| `recommended_actions` | string[] | **Auto-generated** mitigation steps |
| `assumptions` | string[] | Key assumptions behind the scores |
| `data_sources` | string[] | Reference sources for the data |
| `last_updated` | ISO datetime | When the record was last scored |

## Supported Facility Types

| Type | Description |
|------|-------------|
| `hospital` | Full-service hospitals |
| `clinic` | Health centres and clinics |
| `water_pumping_station` | BWSSB pumping and service stations |
| `sewage_treatment_plant` | STP facilities |
| `fire_station` | KFES fire stations |
| `police_station` | Police stations and outposts |
| `emergency_command_centre` | District / state emergency operations |
| `tech_park` | Technology parks and campuses |
| `industrial_estate` | KIADB / private industrial clusters |
| `public_building` | Civic halls, relief centres |
| `metro_station` | BMRCL metro stations |
| `bus_depot` | KSRTC bus depots |
| `railway_station` | Indian Railways stations |
| `airport` | Civil airports |
| `power_substation` | BESCOM substations |

## Power Asset Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID |
| `name` | string | Substation / feeder name |
| `asset_type` | string | substation / feeder_station |
| `latitude` | float | WGS84 |
| `longitude` | float | WGS84 |
| `zone` | string | Bengaluru zone |
| `capacity_mva` | float? | Rated capacity in MVA |
| `feeder_count` | int? | Number of distribution feeders |
| `reliability_score` | float? | Estimated reliability 0–100 |

## Risk Zone GeoJSON Properties

| Field | Type | Description |
|-------|------|-------------|
| `zone_id` | string | Unique zone ID |
| `name` | string | Zone display name |
| `risk_type` | flood/water_stress/road_access/heat | Zone hazard type |
| `severity` | Low/Medium/High/Critical | Severity classification |
| `description` | string | Human-readable description |
