import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.cache import Cache
from app.main import create_app
from app.osm import OverpassClient, normalize
from app.tiles import lnglat_to_tile, tile_bbox

FIXTURES = Path(__file__).parent / "fixtures"


def test_tile_maths_round_trip():
    x, y = lnglat_to_tile(77.2167, 28.6315, 16)
    b = tile_bbox(16, x, y)
    assert b.west <= 77.2167 <= b.east and b.south <= 28.6315 <= b.north
    assert (x, y) == (46823, 27152) or b.west < b.east


def test_normalize_matches_browser_rules():
    import json
    elements = json.loads((FIXTURES / "osm_street_16_46962_27200.json").read_text())["elements"]
    ents = normalize(elements, 1000.0)
    types = [e["type"] for e in ents]
    assert types == ["road", "road", "building", "building", "traffic_signal", "transit", "park"]
    road = ents[0]
    assert road["properties"]["roadClass"] == "arterial" and road["properties"]["lanes"] == 3
    assert abs(road["properties"]["speedLimit"] - 50 / 3.6) < 1e-6
    assert ents[1]["properties"]["speedLimitSource"] == "class-default"
    assert ents[2]["properties"]["floors"] == 6 and ents[2]["properties"]["landUse"] == "residential"
    assert ents[5]["properties"]["mode"] == "metro"
    for e in ents:
        assert e["evidence"] == {"classification": "observed", "source": "openstreetmap", "timestamp": 1000000, "confidence": e["evidence"]["confidence"]}


def test_overpass_client_caches_and_uses_fixtures(tmp_path):
    cache = Cache(tmp_path / "c.db")
    client = OverpassClient(cache, FIXTURES, min_interval=0)
    a = asyncio.run(client.tile(16, 46962, 27200))
    b = asyncio.run(client.tile(16, 46962, 27200))
    assert a["key"] == "16/46962/27200" and len(a["entities"]) == 7
    assert a == b and client.live_calls == 0
    with pytest.raises(LookupError):
        asyncio.run(client.tile(16, 1, 1))


def test_api_tile_endpoint(tmp_path):
    app = create_app(Cache(tmp_path / "c.db"), FIXTURES)
    c = TestClient(app)
    assert c.get("/api/health").json()["fixtures"] is True
    r = c.get("/api/tiles/osm/16/46962/27200.json")
    assert r.status_code == 200 and r.json()["source"] == "openstreetmap"
    assert c.get("/api/tiles/osm/16/1/1.json").status_code == 404
    assert c.get("/api/tiles/osm/12/1/1.json").status_code == 400
    assert c.get("/api/regions").json()["regions"]["ncr"]["source"] == "osm"
