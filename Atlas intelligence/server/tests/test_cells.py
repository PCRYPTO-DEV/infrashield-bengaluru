"""The H3 city model: scores only from real inputs, "no data" otherwise, provenance on every dimension; What changed? ranking."""
import asyncio
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.cache import Cache
from app.main import create_app
from app.memory import History
from app.tiles import tile_bbox
from tests.conftest import dated_fixtures

FIXTURES = Path(__file__).parent / "fixtures"
B = tile_bbox(16, 46962, 27200)
LNG, LAT = (B.west + B.east) / 2, (B.south + B.north) / 2


def make(tmp_path):
    cache = Cache(tmp_path / "c.db")
    history = History(tmp_path / "c.db")
    app = create_app(cache=cache, fixtures=dated_fixtures(tmp_path), history=history)
    return app, history


def test_place_scores_come_only_from_data_and_carry_provenance(tmp_path):
    app, history = make(tmp_path)
    with TestClient(app) as c:
        r = c.get("/api/place", params={"lng": LNG, "lat": LAT})
        assert r.status_code == 200
        st = r.json()
        keys = {d["key"]: d for d in st["dimensions"]}
        # no live traffic reading → no data, never a number
        assert keys["traffic"]["score"] is None and keys["traffic"]["note"] == "no data"
        # flood and population have no adapter → no data, with the honest note
        assert keys["flood"]["score"] is None and keys["population"]["score"] is None
        # structure from the fixture tile → derived scores with OpenStreetMap provenance
        for k in ("green", "walkability", "connectivity", "built"):
            assert keys[k]["class"] == "derived" and keys[k]["provenance"][0]["source"] == "openstreetmap", k
            assert keys[k]["why"]
        # air from the fixture → observed with its resolution
        assert keys["air"]["class"] == "observed" and keys["air"]["provenance"][0]["resolution"].startswith("about 11 km")
        assert keys["air"]["band"] == "good" or keys["air"]["score"] == 60  # AQI 58 → moderate band score 60
        assert st["score"] is not None and 0 <= st["score"] <= 100 and st["confidenceWord"] in ("low", "medium", "high")
        assert st["trend"] is None and "two days" in st["trendNote"]
        assert len(st["boundary"]) == 6 and st["cell"].startswith("89")
        assert all(d["class"] in ("observed", "derived", "inferred", "predicted") for d in st["dimensions"])


def test_traffic_dimension_uses_live_readings_and_the_usual(tmp_path):
    app, history = make(tmp_path)
    now = time.time()
    # 28 days of readings at this weekday+hour: usually fast; now slow
    for d in range(1, 8):
        history.record_flow("12/1/1", [{"id": "seg-a", "trafficLevel": 0.9, "coordinates": [[LNG, LAT]], "roadType": "primary"}], ts=now - d * 7 * 86400)
    history.record_flow("12/1/1", [{"id": "seg-a", "trafficLevel": 0.3, "coordinates": [[LNG, LAT]], "roadType": "primary"}, {"id": "seg-b", "trafficLevel": 0.35, "coordinates": [[LNG, LAT]], "roadType": "primary"}], ts=now - 60)
    with TestClient(app) as c:
        st = c.get("/api/place", params={"lng": LNG, "lat": LAT}).json()
        tr = next(d for d in st["dimensions"] if d["key"] == "traffic")
        assert tr["score"] is not None and 30 <= tr["score"] <= 35 and tr["class"] == "observed"
        assert any("slower than usual" in w for w in tr["why"]) and tr["provenance"][0]["source"] == "tomtom"
        # what changed: the slow-down against the usual is detected and ranked first
        ch = c.get("/api/changes", params={"bbox": f"{B.west},{B.south},{B.east},{B.north}"}).json()
        assert ch["count"] >= 1 and ch["items"][0]["kind"] == "traffic" and "slower than usual" in ch["items"][0]["text"]
        assert ch["items"][0]["rank"] > 0 and ch["notDetectable"]


def test_changes_rank_active_incidents_and_say_what_cannot_be_seen(tmp_path):
    app, history = make(tmp_path)
    now = time.time()
    history.record_incidents([{"id": "i1", "properties": {"kind": "accident", "severity": 0.9, "description": "two cars"}, "geometry": {"type": "Point", "coordinates": [LNG, LAT]}}], ts=now - 120)
    with TestClient(app) as c:
        ch = c.get("/api/changes", params={"bbox": f"{B.west},{B.south},{B.east},{B.north}", "since": 3600}).json()
        assert ch["items"] and ch["items"][0]["kind"] == "incident" and ch["items"][0]["classification"] == "observed"
        assert "snapshots" in " ".join(ch["notDetectable"])
        st = c.get("/api/place", params={"lng": LNG, "lat": LAT}).json()
        safety = next(d for d in st["dimensions"] if d["key"] == "safety")
        assert safety["score"] is not None and safety["score"] < 100 and "accident" in safety["why"][0]


def test_cells_in_bbox_uses_cached_tiles_only(tmp_path):
    app, history = make(tmp_path)
    with TestClient(app) as c:
        r = c.get("/api/cells", params={"bbox": f"{B.west},{B.south},{B.east},{B.north}"}).json()
        assert r["considered"] > 0 and all(0 <= x["score"] <= 100 and x["confidence"] is not None for x in r["cells"])
        # cached-only never fetches a tile: the tile cache is untouched by the call
        assert app.state.osm.live_calls == 0


def pro_headers(c):
    """Unlock Pro the way the app does and return the header the app sends."""
    r = c.post("/api/unlock", json={"password": "atbose-pro"})
    assert r.status_code == 200 and r.json()["tier"] == "pro"
    return {"X-Atlas-Token": r.json()["token"]}
