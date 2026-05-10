"""
Polymath InfraShield Bengaluru — FastAPI Backend
Run: uvicorn main:app --reload --port 8000
"""
import csv
import io
import json
import sqlite3
import subprocess
import sys
import uuid
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from models import FacilityModel, PowerAsset, ReportSummary, UploadResult
from scoring import score_facility
from report_generator import generate_html_report
from pipeline_client import run_campus_pipeline, PIPELINE_AVAILABLE

DB_PATH = Path("infrashield.db")
ZONES_PATH = Path("data/bengaluru_risk_zones_seed.geojson")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Auto-seed the database on first startup if it doesn't exist."""
    if not DB_PATH.exists():
        print("📦 Database not found — seeding now...")
        subprocess.run(
            [sys.executable, "seed_data.py"],
            cwd=Path(__file__).parent,
            check=True,
        )
        print("✅ Database ready.")
    yield


app = FastAPI(
    title="Polymath InfraShield Bengaluru",
    description="Critical infrastructure continuity intelligence API — SYNTHETIC DEMO DATA",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174", "http://localhost:5175",
                   "http://localhost:3000", "http://127.0.0.1:5173", "http://localhost:8003"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    if not DB_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail="Database not found — restart the server to auto-seed.",
        )
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def row_to_facility(row) -> FacilityModel:
    d = dict(row)
    d["main_risk_drivers"] = json.loads(d["main_risk_drivers"])
    d["recommended_actions"] = json.loads(d["recommended_actions"])
    d["assumptions"] = json.loads(d.get("assumptions", "[]"))
    d["data_sources"] = json.loads(d.get("data_sources", "[]"))
    return FacilityModel(**d)


def build_report_data(facilities: list[FacilityModel]) -> dict:
    now = datetime.now().strftime("%Y-%m-%d %H:%M UTC")
    critical = [f for f in facilities if f.risk_level == "Critical"]
    high = [f for f in facilities if f.risk_level == "High"]
    medium = [f for f in facilities if f.risk_level == "Medium"]
    low = [f for f in facilities if f.risk_level == "Low"]
    insufficient = [f for f in facilities if f.risk_level == "Insufficient Data"]

    top10 = sorted(
        [f for f in facilities if f.risk_level != "Insufficient Data"],
        key=lambda x: x.continuity_risk_score,
        reverse=True,
    )[:10]

    zone_groups: dict[str, list] = defaultdict(list)
    for f in facilities:
        zone_groups[f.zone].append(f)

    zone_summary = {}
    for zone, items in zone_groups.items():
        scored = [i for i in items if i.risk_level != "Insufficient Data"]
        if not scored:
            continue
        best = max(scored, key=lambda x: x.continuity_risk_score)
        zone_summary[zone] = {
            "count": len(items),
            "avg_score": round(sum(i.continuity_risk_score for i in scored) / len(scored), 1),
            "top_facility": best.name,
            "top_score": best.continuity_risk_score,
        }

    return {
        "generated_at": now,
        "total_facilities": len(facilities),
        "critical_count": len(critical),
        "high_count": len(high),
        "medium_count": len(medium),
        "low_count": len(low),
        "insufficient_data_count": len(insufficient),
        "top_10_facilities": top10,
        "zone_risk_summary": zone_summary,
        "critical_themes": [
            "Power dependency without verified backup is the dominant risk factor across hospitals and water utilities.",
            "Flood exposure in Bellandur, Electronic City, Majestic, and KR Puram compounds infrastructure risk.",
            "Emergency access degradation during monsoon and peak traffic threatens response times.",
            "Water pumping stations face critical single-point-of-failure risk on power supply.",
            "Industrial zones show compounding water stress and power dependency with limited backup data.",
            "Data confidence gaps prevent reliable scoring for multiple key facilities.",
        ],
        "data_confidence_gaps": [
            "Backup generator runtime and fuel capacity not confirmed for 60%+ of facilities.",
            "BESCOM feeder dependency data not independently verified for substations.",
            "BWSSB pumping station operational backup data unavailable in public domain.",
            "Hospital DG capacity and UPS runtime not confirmed from operator records.",
            "Flood zone boundary accuracy requires BBMP / KSNDMC official data overlay.",
            "Road access delay data not available from BBMP / BMTC traffic operations.",
        ],
        "verification_checklist": [
            "Confirm DG capacity, fuel reserve, and runtime for all Critical-rated hospitals.",
            "Verify BESCOM feeder dependency for all power substations and their served facilities.",
            "Inspect BWSSB pumping station backup systems and power redundancy.",
            "Survey road access conditions at peak hours for Critical and High rated facilities.",
            "Obtain official flood zone maps from BBMP/KSNDMC and overlay with facility locations.",
            "Confirm water source, storage capacity, and tanker dependency for high-water-risk facilities.",
            "Validate emergency command centre backup readiness with district disaster management.",
        ],
        "actions_30_day": [
            "Compile a district-level facility registry with operator contact data.",
            "Initiate RTI requests for BESCOM feeder maps and BWSSB pumping data.",
            "Conduct tabletop continuity exercise with top 10 Critical/High facilities.",
            "Commission field surveys for the 5 highest-CRS facilities.",
            "Deploy field verification teams to confirm DG/UPS backup status.",
        ],
        "actions_90_day": [
            "Integrate official BESCOM feeder-level reliability data into scoring model.",
            "Replace synthetic flood zone boundaries with BBMP/KSNDMC-verified GIS data.",
            "Develop facility-specific Business Continuity Plans for Critical-rated assets.",
            "Establish real-time monitoring integration with at least 3 utility providers.",
            "Publish district resilience scorecard for BBMP / disaster management review.",
            "Expand platform to cover Bengaluru Rural and Peripheral Ring Road corridor.",
        ],
        "disclaimer": (
            "This report uses synthetic demonstration data. Scores are decision-support "
            "indicators only. Validate through field inspection and official records before operational use."
        ),
    }


@app.get("/live/conditions")
async def live_conditions(lat: float = Query(...), lng: float = Query(...), zone: str = Query("")):
    """
    Live road + weather conditions for a coordinate.
    Calls Open-Meteo weather, Open-Meteo Flood (GloFAS), and GDELT road disruption.
    No auth required. Used by frontend to decorate facility cards in real time.
    """
    try:
        import sys
        from pathlib import Path as _Path
        _pb = _Path(__file__).parent.parent.parent / "Polybrain"
        if str(_pb) not in sys.path:
            sys.path.insert(0, str(_pb))
        from integrations.road_condition import get_profile as rc_profile
        rc = await rc_profile(lat, lng, zone)
        return {
            "condition_label": rc.condition_label,
            "condition_score": rc.condition_score,
            "weather_desc": rc.current_weather_desc,
            "weather_code": rc.current_weather_code,
            "is_severe_weather": rc.is_severe_weather,
            "precipitation_1h_mm": rc.precipitation_1h_mm,
            "precipitation_24h_mm": rc.precipitation_24h_mm,
            "temperature_c": rc.temperature_c,
            "flood_signal": rc.flood_signal,
            "river_discharge_today_m3s": rc.river_discharge_today_m3s,
            "discharge_anomaly_pct": rc.discharge_anomaly_pct,
            "road_disruption_articles_30d": rc.road_disruption_articles_30d,
            "road_disruption_headlines": rc.road_disruption_headlines,
            "data_sources": rc.data_sources,
        }
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Live conditions unavailable: {exc}")


@app.get("/health")
def health():
    db_ok = DB_PATH.exists()
    return {
        "status": "ok",
        "database": "ready" if db_ok else "not_seeded",
        "note": "SYNTHETIC DEMO DATA — not for operational use without field validation",
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/facilities", response_model=list[FacilityModel])
def list_facilities(
    zone: Optional[str] = Query(None),
    facility_type: Optional[str] = Query(None),
    risk_level: Optional[str] = Query(None),
    min_score: Optional[float] = Query(None),
    max_score: Optional[float] = Query(None),
):
    conn = get_db()
    query = "SELECT * FROM facilities WHERE 1=1"
    params: list = []
    if zone:
        query += " AND zone = ?"
        params.append(zone)
    if facility_type:
        query += " AND facility_type = ?"
        params.append(facility_type)
    if risk_level:
        query += " AND risk_level = ?"
        params.append(risk_level)
    if min_score is not None:
        query += " AND continuity_risk_score >= ?"
        params.append(min_score)
    if max_score is not None:
        query += " AND continuity_risk_score <= ?"
        params.append(max_score)
    query += " ORDER BY continuity_risk_score DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [row_to_facility(r) for r in rows]


@app.get("/facilities/{facility_id}", response_model=FacilityModel)
def get_facility(facility_id: str):
    conn = get_db()
    row = conn.execute("SELECT * FROM facilities WHERE id = ?", [facility_id]).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Facility not found")
    return row_to_facility(row)


@app.post("/facilities/upload", response_model=UploadResult)
async def upload_facilities(file: UploadFile = File(...)):
    content = await file.read()
    text = content.decode("utf-8")
    reader = csv.DictReader(
        (row for row in text.splitlines() if not row.startswith("#"))
    )

    required_fields = [
        "name", "facility_type", "latitude", "longitude", "zone",
        "criticality_score", "power_dependency_score", "backup_readiness_score",
        "flood_exposure_score", "water_dependency_score", "road_access_score",
        "heat_exposure_score", "data_confidence_score",
    ]

    uploaded, failed, errors, new_facilities = 0, 0, [], []
    conn = get_db()

    for i, row in enumerate(reader):
        missing = [f for f in required_fields if f not in row or row[f] == ""]
        if missing:
            errors.append(f"Row {i+2}: missing fields {missing}")
            failed += 1
            continue
        try:
            facility = {
                "id": row.get("id") or f"UP{uuid.uuid4().hex[:8].upper()}",
                "name": row["name"],
                "facility_type": row["facility_type"],
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "zone": row["zone"],
                "owner_type": row.get("owner_type", "unknown"),
                "criticality_score": float(row["criticality_score"]),
                "power_dependency_score": float(row["power_dependency_score"]),
                "backup_readiness_score": float(row["backup_readiness_score"]),
                "flood_exposure_score": float(row["flood_exposure_score"]),
                "water_dependency_score": float(row["water_dependency_score"]),
                "road_access_score": float(row["road_access_score"]),
                "heat_exposure_score": float(row["heat_exposure_score"]),
                "data_confidence_score": float(row["data_confidence_score"]),
                "assumptions": [],
                "data_sources": ["User upload"],
            }
            scored = score_facility(facility)
            scored["main_risk_drivers"] = json.dumps(scored["main_risk_drivers"])
            scored["recommended_actions"] = json.dumps(scored["recommended_actions"])
            scored["assumptions"] = json.dumps([])
            scored["data_sources"] = json.dumps(["User upload"])
            scored["last_updated"] = datetime.now().isoformat()

            conn.execute(
                """INSERT OR REPLACE INTO facilities VALUES (
                   :id,:name,:facility_type,:latitude,:longitude,:zone,:owner_type,
                   :criticality_score,:power_dependency_score,:backup_readiness_score,
                   :flood_exposure_score,:water_dependency_score,:road_access_score,
                   :heat_exposure_score,:data_confidence_score,
                   :continuity_risk_score,:risk_level,
                   :main_risk_drivers,:recommended_actions,
                   :assumptions,:data_sources,:last_updated
                )""",
                scored,
            )
            scored["main_risk_drivers"] = json.loads(scored["main_risk_drivers"])
            scored["recommended_actions"] = json.loads(scored["recommended_actions"])
            scored["assumptions"] = []
            scored["data_sources"] = ["User upload"]
            new_facilities.append(FacilityModel(**scored))
            uploaded += 1
        except Exception as e:
            errors.append(f"Row {i+2}: {e}")
            failed += 1

    conn.commit()
    conn.close()
    return UploadResult(uploaded=uploaded, failed=failed, errors=errors, facilities=new_facilities)


@app.get("/risk/top", response_model=list[FacilityModel])
def top_risk(n: int = Query(10, ge=1, le=50)):
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM facilities ORDER BY continuity_risk_score DESC LIMIT ?", [n]
    ).fetchall()
    conn.close()
    return [row_to_facility(r) for r in rows]


@app.post("/risk/calculate")
def recalculate_scores():
    conn = get_db()
    rows = conn.execute("SELECT * FROM facilities").fetchall()
    updated = 0
    for row in rows:
        d = dict(row)
        scored = score_facility(d)
        conn.execute(
            """UPDATE facilities SET
               continuity_risk_score=:continuity_risk_score,
               risk_level=:risk_level,
               main_risk_drivers=:drivers,
               recommended_actions=:actions
               WHERE id=:id""",
            {
                "continuity_risk_score": scored["continuity_risk_score"],
                "risk_level": scored["risk_level"],
                "drivers": json.dumps(scored["main_risk_drivers"]),
                "actions": json.dumps(scored["recommended_actions"]),
                "id": d["id"],
            },
        )
        updated += 1
    conn.commit()
    conn.close()
    return {"recalculated": updated, "timestamp": datetime.now().isoformat()}


@app.get("/zones")
def get_zones():
    if not ZONES_PATH.exists():
        raise HTTPException(status_code=404, detail="Zones GeoJSON not found")
    return json.loads(ZONES_PATH.read_text(encoding="utf-8"))


@app.get("/power-assets", response_model=list[PowerAsset])
def get_power_assets():
    conn = get_db()
    rows = conn.execute("SELECT * FROM power_assets").fetchall()
    conn.close()
    return [PowerAsset(**dict(r)) for r in rows]


@app.get("/report/summary")
def report_summary():
    conn = get_db()
    rows = conn.execute("SELECT * FROM facilities ORDER BY continuity_risk_score DESC").fetchall()
    conn.close()
    facilities = [row_to_facility(r) for r in rows]
    return build_report_data(facilities)


@app.get("/report/facility/{facility_id}")
def facility_report(facility_id: str):
    conn = get_db()
    row = conn.execute("SELECT * FROM facilities WHERE id = ?", [facility_id]).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Facility not found")
    f = row_to_facility(row)
    crs = f.continuity_risk_score
    return {
        "facility": f,
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M UTC"),
        "executive_summary": (
            f"{f.name} ({f.zone}) is assessed at a Continuity Risk Score of {crs} "
            f"({f.risk_level}). The primary risk drivers are: {', '.join(f.main_risk_drivers[:2])}. "
            f"This facility serves a critical function and warrants prioritised resilience review."
        ),
        "risk_narrative": (
            f"The facility's power dependency score of {f.power_dependency_score} combined with "
            f"a backup readiness score of {f.backup_readiness_score} indicates a significant gap "
            f"in operational continuity during grid disruption. Flood exposure ({f.flood_exposure_score}) "
            f"and road access constraints ({f.road_access_score}) further compound this risk."
        ),
        "mitigation_plan": f.recommended_actions,
        "verification_items": [
            f"Confirm backup power runtime for {f.name} with facility operator.",
            "Request BESCOM feeder dependency confirmation.",
            "Conduct on-site stormwater drainage assessment.",
            "Survey emergency access route during monsoon simulation.",
        ],
        "disclaimer": (
            "This report uses synthetic demonstration data. Validate before operational use."
        ),
    }


@app.get("/export/facilities.csv")
def export_facilities_csv():
    conn = get_db()
    rows = conn.execute("SELECT * FROM facilities ORDER BY continuity_risk_score DESC").fetchall()
    conn.close()

    output = io.StringIO()
    output.write("# SYNTHETIC DEMO DATA — Polymath InfraShield Bengaluru\n")
    fieldnames = [
        "id", "name", "facility_type", "zone", "owner_type",
        "latitude", "longitude",
        "criticality_score", "power_dependency_score", "backup_readiness_score",
        "flood_exposure_score", "water_dependency_score", "road_access_score",
        "heat_exposure_score", "data_confidence_score",
        "continuity_risk_score", "risk_level",
    ]
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(dict(row))

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=infrashield_facilities.csv"},
    )


@app.get("/export/report.html", response_class=HTMLResponse)
def export_report_html():
    conn = get_db()
    rows = conn.execute("SELECT * FROM facilities ORDER BY continuity_risk_score DESC").fetchall()
    conn.close()
    facilities = [row_to_facility(r) for r in rows]
    data = build_report_data(facilities)
    html = generate_html_report(data)
    return HTMLResponse(
        content=html,
        headers={"Content-Disposition": "attachment; filename=infrashield_report.html"},
    )


# ── Polymath Pipeline Integration ─────────────────────────────────────────────

class PipelineRequest(BaseModel):
    name: str
    latitude: float
    longitude: float
    zone: str
    facility_type: str
    owner_type: str = "unknown"


@app.get("/pipeline/status")
def pipeline_status():
    return {
        "available": PIPELINE_AVAILABLE,
        "message": "Polymath campus pipeline ready" if PIPELINE_AVAILABLE
                   else "Polymath pipeline not found — check Polybrain path in pipeline_client.py",
    }


@app.websocket("/pipeline/ws")
async def pipeline_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for live pipeline progress streaming.

    Client sends one JSON message:
      { name, latitude, longitude, zone, facility_type, owner_type? }

    Server streams progress events as JSON, then the final facility record.
    Each event shape matches the campus_pipeline progress callback protocol.
    """
    await websocket.accept()
    try:
        payload = await websocket.receive_json()

        async def relay(event: dict):
            """Forward every pipeline event to the WebSocket client."""
            await websocket.send_json(event)

        facility_dict = await run_campus_pipeline(
            name=payload["name"],
            latitude=float(payload["latitude"]),
            longitude=float(payload["longitude"]),
            zone=payload["zone"],
            facility_type=payload["facility_type"],
            owner_type=payload.get("owner_type", "unknown"),
            on_progress=relay,
        )

        # Score via InfraShield model and persist
        scored = score_facility(facility_dict)
        fid = f"PL{uuid.uuid4().hex[:8].upper()}"
        scored["id"] = fid
        scored["last_updated"] = datetime.now().isoformat()

        conn = get_db()
        scored_db = {
            **scored,
            "main_risk_drivers": json.dumps(scored["main_risk_drivers"]),
            "recommended_actions": json.dumps(scored["recommended_actions"]),
            "assumptions": json.dumps(scored.get("assumptions", [])),
            "data_sources": json.dumps(scored.get("data_sources", [])),
        }
        conn.execute(
            """INSERT OR REPLACE INTO facilities VALUES (
               :id,:name,:facility_type,:latitude,:longitude,:zone,:owner_type,
               :criticality_score,:power_dependency_score,:backup_readiness_score,
               :flood_exposure_score,:water_dependency_score,:road_access_score,
               :heat_exposure_score,:data_confidence_score,
               :continuity_risk_score,:risk_level,
               :main_risk_drivers,:recommended_actions,
               :assumptions,:data_sources,:last_updated
            )""",
            scored_db,
        )
        conn.commit()
        conn.close()

        # Send the final scored facility to the client
        scored["main_risk_drivers"] = json.loads(scored_db["main_risk_drivers"])
        scored["recommended_actions"] = json.loads(scored_db["recommended_actions"])
        scored["assumptions"] = json.loads(scored_db["assumptions"])
        scored["data_sources"] = json.loads(scored_db["data_sources"])

        await websocket.send_json({
            "type": "facility_saved",
            "facility": scored,
        })

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        try:
            await websocket.send_json({"type": "pipeline_error", "message": str(exc)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ── Power Intelligence Layer ──────────────────────────────────────────────────
# In-memory cache for the last pipeline run (refreshed by background task every 10 min)
_power_cache: dict = {}
_power_cache_lock = asyncio.Lock()

# Bengaluru zone centroids fed to the pipeline
BENGALURU_ZONES_CENTROIDS = [
    {"name": "Whitefield / ITPL",          "latitude": 12.9698, "longitude": 77.7500},
    {"name": "Manyata / Nagavara",         "latitude": 13.0453, "longitude": 77.6182},
    {"name": "Electronic City",            "latitude": 12.8400, "longitude": 77.6760},
    {"name": "Majestic / Shivajinagar",    "latitude": 12.9767, "longitude": 77.5713},
    {"name": "Koramangala / BTM Layout",   "latitude": 12.9279, "longitude": 77.6271},
    {"name": "Jayanagar / Banashankari",   "latitude": 12.9250, "longitude": 77.5938},
    {"name": "Malleshwaram / Rajajinagar", "latitude": 13.0035, "longitude": 77.5600},
    {"name": "Hebbal / Yelahanka",         "latitude": 13.0358, "longitude": 77.5970},
    {"name": "KR Puram / Tin Factory",     "latitude": 13.0000, "longitude": 77.6900},
    {"name": "Bellandur / Sarjapur",       "latitude": 12.9250, "longitude": 77.6700},
    {"name": "Yeshwantpur / Peenya",       "latitude": 13.0230, "longitude": 77.5420},
]


def _polybrain_path():
    from pathlib import Path as _P
    pb = _P(__file__).parent.parent.parent / "Polybrain"
    if str(pb) not in sys.path:
        sys.path.insert(0, str(pb))


async def _refresh_power_cache():
    """Run the power intelligence pipeline and store results."""
    global _power_cache
    _polybrain_path()
    try:
        from integrations.power_intelligence_pipeline import run_pipeline as power_run

        conn = get_db()
        fac_rows = conn.execute("SELECT * FROM facilities").fetchall()
        asset_rows = conn.execute("SELECT * FROM power_assets").fetchall()
        conn.close()

        facilities = [dict(r) for r in fac_rows]
        power_assets = [dict(r) for r in asset_rows]

        result = await power_run(
            zones=BENGALURU_ZONES_CENTROIDS,
            facilities=facilities,
            power_assets=power_assets,
        )
        async with _power_cache_lock:
            _power_cache = {
                "zone_stress_geojson": result.zone_stress_geojson,
                "score_deltas": [
                    {
                        "facility_id": d.facility_id,
                        "facility_name": d.facility_name,
                        "zone": d.zone,
                        "original_power_score": d.original_power_score,
                        "new_power_score": d.new_power_score,
                        "delta": d.delta,
                        "new_continuity_risk_score": d.new_continuity_risk_score,
                        "feeder_id": d.feeder_id,
                        "feeder_name": d.feeder_name,
                        "feeder_stress": d.feeder_stress,
                        "zone_tier": d.zone_tier,
                    }
                    for d in result.score_deltas
                ],
                "action_plans": [
                    {
                        "facility_id": p.facility_id,
                        "facility_name": p.facility_name,
                        "zone": p.zone,
                        "priority": p.priority,
                        "action": p.action,
                        "rationale": p.rationale,
                        "confidence": p.confidence,
                        "timeframe": p.timeframe,
                        "generated_at": p.generated_at.isoformat(),
                    }
                    for p in result.action_plans
                ],
                "zones_processed": result.zones_processed,
                "facilities_affected": result.facilities_affected,
                "warnings": result.warnings,
                "refreshed_at": datetime.now().isoformat(),
            }
    except Exception as exc:
        async with _power_cache_lock:
            _power_cache["last_error"] = str(exc)
            _power_cache["refreshed_at"] = datetime.now().isoformat()


@app.get("/power/zone-stress")
async def power_zone_stress():
    """
    GeoJSON FeatureCollection of Bengaluru zone power stress scores.
    Each feature property includes stress_score (0-100), tier, thermal/outage/demand indices.
    Cached from the last pipeline run (refreshes every 10 min via background task,
    or call /power/refresh to force an immediate update).
    """
    async with _power_cache_lock:
        geojson = _power_cache.get("zone_stress_geojson")
    if not geojson:
        # Trigger a fresh run synchronously on first call
        await _refresh_power_cache()
        async with _power_cache_lock:
            geojson = _power_cache.get("zone_stress_geojson", {"type": "FeatureCollection", "features": []})
    return geojson


@app.get("/power/score-deltas")
async def power_score_deltas():
    """
    Per-facility power dependency score deltas driven by current zone stress.
    Applied by the frontend as a useMemo overlay on top of base facility scores
    (same pattern as scenario engine). Only includes facilities with delta > 0.5 pts.
    """
    async with _power_cache_lock:
        deltas = _power_cache.get("score_deltas")
    if deltas is None:
        await _refresh_power_cache()
        async with _power_cache_lock:
            deltas = _power_cache.get("score_deltas", [])
    return {
        "deltas": deltas,
        "facilities_affected": len(deltas),
        "refreshed_at": _power_cache.get("refreshed_at"),
    }


@app.get("/power/actions")
async def power_actions(zone: Optional[str] = Query(None)):
    """
    LLM-generated action plans sorted by priority.
    Cached 4h per zone in the pipeline (Gemini not called on every request).
    Pass ?zone= to filter by zone name. Triggers LLM cache refresh if stale.
    """
    async with _power_cache_lock:
        plans = _power_cache.get("action_plans")
    if plans is None:
        await _refresh_power_cache()
        async with _power_cache_lock:
            plans = _power_cache.get("action_plans", [])
    if zone:
        plans = [p for p in plans if p.get("zone") == zone]
    plans_sorted = sorted(plans, key=lambda p: p.get("priority", 99))
    return {
        "action_plans": plans_sorted,
        "count": len(plans_sorted),
        "refreshed_at": _power_cache.get("refreshed_at"),
    }


@app.post("/power/refresh")
async def power_refresh():
    """Force an immediate pipeline refresh (bypasses 10-min background schedule)."""
    await _refresh_power_cache()
    async with _power_cache_lock:
        return {
            "refreshed": True,
            "zones_processed": _power_cache.get("zones_processed", 0),
            "facilities_affected": _power_cache.get("facilities_affected", 0),
            "warnings": _power_cache.get("warnings", []),
            "refreshed_at": _power_cache.get("refreshed_at"),
        }


@app.post("/pipeline/run", response_model=FacilityModel)
async def pipeline_run_http(req: PipelineRequest):
    """
    REST fallback for pipeline (no live progress streaming).
    Prefer the WebSocket endpoint for interactive use.
    """
    if not PIPELINE_AVAILABLE:
        raise HTTPException(status_code=503, detail="Polymath pipeline not available")

    facility_dict = await run_campus_pipeline(
        name=req.name,
        latitude=req.latitude,
        longitude=req.longitude,
        zone=req.zone,
        facility_type=req.facility_type,
        owner_type=req.owner_type,
    )
    scored = score_facility(facility_dict)
    fid = f"PL{uuid.uuid4().hex[:8].upper()}"
    scored["id"] = fid
    scored["last_updated"] = datetime.now().isoformat()

    conn = get_db()
    scored_db = {
        **scored,
        "main_risk_drivers": json.dumps(scored["main_risk_drivers"]),
        "recommended_actions": json.dumps(scored["recommended_actions"]),
        "assumptions": json.dumps(scored.get("assumptions", [])),
        "data_sources": json.dumps(scored.get("data_sources", [])),
    }
    conn.execute(
        """INSERT OR REPLACE INTO facilities VALUES (
           :id,:name,:facility_type,:latitude,:longitude,:zone,:owner_type,
           :criticality_score,:power_dependency_score,:backup_readiness_score,
           :flood_exposure_score,:water_dependency_score,:road_access_score,
           :heat_exposure_score,:data_confidence_score,
           :continuity_risk_score,:risk_level,
           :main_risk_drivers,:recommended_actions,
           :assumptions,:data_sources,:last_updated
        )""",
        scored_db,
    )
    conn.commit()
    conn.close()
    return FacilityModel(**{
        **scored,
        "main_risk_drivers": scored["main_risk_drivers"],
        "recommended_actions": scored["recommended_actions"],
        "assumptions": scored.get("assumptions", []),
        "data_sources": scored.get("data_sources", []),
    })
