"""
Seed the SQLite database from CSV data.
Run: python seed_data.py
Recreates the infrashield.db file with all 41 demo facilities.
"""
import csv
import json
import sqlite3
import uuid
from pathlib import Path
from datetime import datetime
from scoring import score_facility

DB_PATH = Path("infrashield.db")
CSV_PATH = Path("data/bengaluru_facilities_seed.csv")


SCHEMA = """
CREATE TABLE IF NOT EXISTS facilities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    facility_type TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    zone TEXT NOT NULL,
    owner_type TEXT NOT NULL DEFAULT 'unknown',
    criticality_score REAL NOT NULL,
    power_dependency_score REAL NOT NULL,
    backup_readiness_score REAL NOT NULL,
    flood_exposure_score REAL NOT NULL,
    water_dependency_score REAL NOT NULL,
    road_access_score REAL NOT NULL,
    heat_exposure_score REAL NOT NULL,
    data_confidence_score REAL NOT NULL,
    continuity_risk_score REAL NOT NULL,
    risk_level TEXT NOT NULL,
    main_risk_drivers TEXT NOT NULL DEFAULT '[]',
    recommended_actions TEXT NOT NULL DEFAULT '[]',
    assumptions TEXT NOT NULL DEFAULT '[]',
    data_sources TEXT NOT NULL DEFAULT '[]',
    last_updated TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS power_assets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    asset_type TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    zone TEXT NOT NULL,
    capacity_mva REAL,
    feeder_count INTEGER,
    reliability_score REAL
);
"""

INSERT_FACILITY = """
INSERT OR REPLACE INTO facilities VALUES (
    :id, :name, :facility_type, :latitude, :longitude, :zone, :owner_type,
    :criticality_score, :power_dependency_score, :backup_readiness_score,
    :flood_exposure_score, :water_dependency_score, :road_access_score,
    :heat_exposure_score, :data_confidence_score,
    :continuity_risk_score, :risk_level,
    :main_risk_drivers, :recommended_actions,
    :assumptions, :data_sources, :last_updated
)
"""

INSERT_POWER = """
INSERT OR REPLACE INTO power_assets VALUES (
    :id, :name, :asset_type, :latitude, :longitude, :zone,
    :capacity_mva, :feeder_count, :reliability_score
)
"""


def load_facilities() -> list[dict]:
    rows = []
    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            break
        # reopen properly skipping comment lines

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(
            (row for row in f if not row.startswith("#"))
        )
        for row in reader:
            facility = {
                "id": row["id"],
                "name": row["name"],
                "facility_type": row["facility_type"],
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "zone": row["zone"],
                "owner_type": row["owner_type"],
                "criticality_score": float(row["criticality_score"]),
                "power_dependency_score": float(row["power_dependency_score"]),
                "backup_readiness_score": float(row["backup_readiness_score"]),
                "flood_exposure_score": float(row["flood_exposure_score"]),
                "water_dependency_score": float(row["water_dependency_score"]),
                "road_access_score": float(row["road_access_score"]),
                "heat_exposure_score": float(row["heat_exposure_score"]),
                "data_confidence_score": float(row["data_confidence_score"]),
                "assumptions": row.get("assumptions", ""),
                "data_sources": row.get("data_sources", ""),
            }
            scored = score_facility(facility)
            scored["assumptions"] = json.dumps(
                [a.strip() for a in facility["assumptions"].split(";") if a.strip()]
            )
            scored["data_sources"] = json.dumps(
                [d.strip() for d in facility["data_sources"].split(";") if d.strip()]
            )
            scored["main_risk_drivers"] = json.dumps(scored["main_risk_drivers"])
            scored["recommended_actions"] = json.dumps(scored["recommended_actions"])
            scored["last_updated"] = datetime.now().isoformat()
            rows.append(scored)
    return rows


def load_power_assets() -> list[dict]:
    path = Path("data/bengaluru_power_assets_seed.csv")
    rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(
            (row for row in f if not row.startswith("#"))
        )
        for row in reader:
            rows.append({
                "id": row["id"],
                "name": row["name"],
                "asset_type": row["asset_type"],
                "latitude": float(row["latitude"]),
                "longitude": float(row["longitude"]),
                "zone": row["zone"],
                "capacity_mva": float(row["capacity_mva"]) if row["capacity_mva"] else None,
                "feeder_count": int(row["feeder_count"]) if row["feeder_count"] else None,
                "reliability_score": float(row["reliability_score"]) if row["reliability_score"] else None,
            })
    return rows


def seed():
    print(f"Initialising database at {DB_PATH.resolve()} ...")
    if DB_PATH.exists():
        DB_PATH.unlink()

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)

    facilities = load_facilities()
    conn.executemany(INSERT_FACILITY, facilities)
    print(f"  Inserted {len(facilities)} facilities.")

    power_assets = load_power_assets()
    conn.executemany(INSERT_POWER, power_assets)
    print(f"  Inserted {len(power_assets)} power assets.")

    conn.commit()
    conn.close()
    print("Seed complete.")


if __name__ == "__main__":
    seed()
