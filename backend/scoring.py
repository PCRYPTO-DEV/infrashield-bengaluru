# Scoring logic — mirrors frontend/src/utils/scoring.ts exactly.
# SYNTHETIC/DEMO scoring only. Not for operational use without field validation.

WEIGHTS = {
    "criticality": 0.20,
    "power_dependency": 0.20,
    "backup_readiness": 0.15,   # inverted: poor backup = high risk
    "flood_exposure": 0.15,
    "water_dependency": 0.10,
    "road_access": 0.10,
    "heat_exposure": 0.05,
    "data_confidence": 0.05,    # inverted: low confidence = higher risk
}


def calculate_continuity_risk(f: dict) -> float:
    score = (
        WEIGHTS["criticality"] * f["criticality_score"]
        + WEIGHTS["power_dependency"] * f["power_dependency_score"]
        + WEIGHTS["backup_readiness"] * (100 - f["backup_readiness_score"])
        + WEIGHTS["flood_exposure"] * f["flood_exposure_score"]
        + WEIGHTS["water_dependency"] * f["water_dependency_score"]
        + WEIGHTS["road_access"] * f["road_access_score"]
        + WEIGHTS["heat_exposure"] * f["heat_exposure_score"]
        + WEIGHTS["data_confidence"] * (100 - f["data_confidence_score"])
    )
    return round(min(max(score, 0), 100), 1)


def classify_risk_level(score: float, data_confidence: float) -> str:
    if data_confidence < 50:
        return "Insufficient Data"
    if score <= 30:
        return "Low"
    if score <= 55:
        return "Medium"
    if score <= 75:
        return "High"
    return "Critical"


def derive_risk_drivers(f: dict) -> list[str]:
    drivers = []
    if f["power_dependency_score"] > 75:
        drivers.append("High power-dependency exposure")
    if f["backup_readiness_score"] < 25:
        drivers.append("Backup readiness gap requires verification")
    if f["flood_exposure_score"] > 70:
        drivers.append("Potential flood / drainage exposure")
    if f["water_dependency_score"] > 70:
        drivers.append("Water continuity dependency risk")
    if f["road_access_score"] > 70:
        drivers.append("Emergency access vulnerability")
    if f["heat_exposure_score"] > 65:
        drivers.append("Elevated heat exposure risk")
    if f["data_confidence_score"] < 50:
        drivers.append("Low data confidence — field verification required")
    if f["criticality_score"] > 80:
        drivers.append("High facility criticality amplifies all risk factors")
    if not drivers:
        drivers.append("No dominant risk driver identified — review sub-scores")
    return drivers


def derive_recommended_actions(f: dict) -> list[str]:
    actions = []
    if f["power_dependency_score"] > 60:
        actions.append("Verify feeder and substation dependency with BESCOM.")
    if f["backup_readiness_score"] < 40:
        actions.append("Confirm DG / UPS runtime and fuel logistics capacity.")
    if f["flood_exposure_score"] > 55:
        actions.append("Conduct flood and stormwater-drainage site inspection.")
    if f["road_access_score"] > 55:
        actions.append("Validate emergency access route during peak traffic and rainfall.")
    if f["water_dependency_score"] > 55:
        actions.append("Confirm water source, storage, tanker dependency and pumping backup.")
    if f["heat_exposure_score"] > 55:
        actions.append("Create facility continuity plan for heatwave and monsoon events.")
    if f["data_confidence_score"] < 60:
        actions.append("Add facility to district-level resilience verification list.")
    actions.append("Cross-check facility data with BBMP / operator records before operational use.")
    return actions


def score_facility(f: dict) -> dict:
    crs = calculate_continuity_risk(f)
    return {
        **f,
        "continuity_risk_score": crs,
        "risk_level": classify_risk_level(crs, f["data_confidence_score"]),
        "main_risk_drivers": derive_risk_drivers(f),
        "recommended_actions": derive_recommended_actions(f),
    }
