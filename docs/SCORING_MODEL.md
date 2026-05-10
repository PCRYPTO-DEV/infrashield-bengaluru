# Scoring Model — Polymath InfraShield Bengaluru

## Overview

The Continuity Risk Score (CRS) is a weighted composite score ranging from 0 to 100.
Higher score = higher operational disruption risk.

## Formula

```
CRS =   0.20 × criticality_score
      + 0.20 × power_dependency_score
      + 0.15 × (100 - backup_readiness_score)   ← inverted
      + 0.15 × flood_exposure_score
      + 0.10 × water_dependency_score
      + 0.10 × road_access_score
      + 0.05 × heat_exposure_score
      + 0.05 × (100 - data_confidence_score)     ← inverted
```

All input scores are 0–100.
Final CRS is clamped to [0, 100].

## Factor Weights

| Factor | Weight | Direction | Rationale |
|--------|--------|-----------|-----------|
| Facility Criticality | 20% | Higher = worse | More critical = higher disruption impact |
| Power Dependency | 20% | Higher = worse | High grid reliance → grid failures cause outage |
| Backup Readiness | 15% | **Inverted** | Poor backup = high risk |
| Flood Exposure | 15% | Higher = worse | Flood proximity compounds operational disruption |
| Water Dependency | 10% | Higher = worse | Tanker/borewell dependency = supply risk |
| Road / Access | 10% | Higher = worse | Poor access = delayed emergency response |
| Heat Exposure | 5% | Higher = worse | Urban heat impacts facility operations |
| Data Confidence | 5% | **Inverted** | Low confidence = higher uncertainty penalty |

## Risk Level Thresholds

| CRS Range | Risk Level |
|-----------|------------|
| 0–30 | Low |
| 31–55 | Medium |
| 56–75 | High |
| 76–100 | Critical |
| Any (confidence < 50) | Insufficient Data |

## Risk Driver Detection

Risk drivers are auto-generated when individual scores exceed thresholds:

| Condition | Driver |
|-----------|--------|
| power_dependency_score > 75 | High power-dependency exposure |
| backup_readiness_score < 25 | Backup readiness gap requires verification |
| flood_exposure_score > 70 | Potential flood / drainage exposure |
| water_dependency_score > 70 | Water continuity dependency risk |
| road_access_score > 70 | Emergency access vulnerability |
| heat_exposure_score > 65 | Elevated heat exposure risk |
| data_confidence_score < 50 | Low data confidence — field verification required |
| criticality_score > 80 | High facility criticality amplifies all risk factors |

## Implementation

The scoring logic is implemented identically in:
- `backend/scoring.py` (Python)
- `frontend/src/utils/scoring.ts` (TypeScript)

Both must remain synchronised when weights are updated.

## Limitations

- All input scores in this MVP are **synthetic / estimated**.
- Model does not account for inter-facility dependencies.
- Model does not account for simultaneous multi-hazard events.
- Weights are default assumptions, not empirically calibrated.
- Field validation is mandatory before any operational use.
