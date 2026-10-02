import asyncio
import json
from pathlib import Path

import mapbox_vector_tile
import pytest
from fastapi.testclient import TestClient

from app.cache import Cache
from app.main import create_app
from app.tomtom import TomTomClient, BudgetExceeded, decode_flow_tile, normalize_incidents, tile_px_to_lnglat
from app.tiles import tile_bbox

FIXTURES = Path(__file__).parent / "fixtures"


def make_flow_pbf() -> bytes:
    # A tile with two flow lines, in tile pixel space (extent 4096, y down as served)
    layer = {"name": "Traffic flow", "features": [
        {"geometry": "LINESTRING(100 100, 2000 100)", "properties": {"traffic_level": 0.35, "traffic_road_coverage": "full", "road_type": "Major road"}},
        {"geometry": "LINESTRING(100 3000, 4000 3000)", "properties": {"traffic_level": 0.95, "traffic_road_coverage": "one_side"}},
    ]}
    return mapbox_vector_tile.encode([layer], default_options={"y_coord_down": True})


def test_decode_flow_tile_gives_lnglat_segments_with_levels():
    segs = decode_flow_tile(make_flow_pbf(), 12, 2926, 1697)
    assert len(segs) == 2
    assert segs[0]["trafficLevel"] == pytest.approx(0.35) and segs[1]["trafficLevel"] == pytest.approx(0.95)
    b = tile_bbox(12, 2926, 1697)
    for s in segs:
        for lng, lat in s["coordinates"]:
            assert b.west - 1e-6 <= lng <= b.east + 1e-6 and b.south - 1e-6 <= lat <= b.north + 1e-6
    assert tile_px_to_lnglat(0, 0, 12, 2926, 1697, 4096) == [round(b.west, 6), round(b.north, 6)]


def test_normalize_incidents():
    data = {"incidents": [{"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[77.21, 28.63], [77.22, 28.64]]},
                           "properties": {"id": "abc", "iconCategory": 9, "magnitudeOfDelay": 3, "events": [{"description": "Roadworks", "code": 701}], "startTime": "2026-10-02T01:00:00Z", "endTime": "2026-10-02T06:00:00Z", "delay": 240, "length": 800}}]}
    ents = normalize_incidents(data, 1000.0)
    assert len(ents) == 1
    e = ents[0]
    assert e["type"] == "incident" and e["evidence"]["classification"] == "observed" and e["evidence"]["source"] == "tomtom"
    assert e["properties"]["kind"] == "roadworks" and e["properties"]["delaySeconds"] == 240
    assert e["properties"]["startTime"] < e["properties"]["endTime"]


def test_budget_guard_and_fixtures(tmp_path):
    cache = Cache(tmp_path / "c.db")
    fx = tmp_path / "fx"; fx.mkdir()
    (fx / "tomtom_flow_12_2926_1697.pbf").write_bytes(make_flow_pbf())
    client = TomTomClient(cache, "k", fx, daily_budget=1)
    a = asyncio.run(client.flow_tile(12, 2926, 1697))
    assert len(a["segments"]) == 2 and a["source"] == "tomtom"
    assert asyncio.run(client.flow_tile(12, 2926, 1697)) == a  # cached
    live = TomTomClient(cache, "k", None, daily_budget=1)
    live._spend()
    with pytest.raises(BudgetExceeded):
        live._spend()
    assert live.calls_today() == 1


def test_api_endpoints_with_fixtures(tmp_path):
    fx = tmp_path / "fx"; fx.mkdir()
    (fx / "tomtom_flow_12_2926_1697.pbf").write_bytes(make_flow_pbf())
    (fx / "tomtom_incidents_77.1_28.5_77.3_28.7.json").write_text(json.dumps({"incidents": []}))
    (fx / "weather_default.json").write_text(json.dumps({"current": {"temperature_2m": 31.2, "precipitation": 0.0, "weather_code": 1, "wind_speed_10m": 8.1, "relative_humidity_2m": 60, "time": "2026-10-02T06:00"}}))
    app = create_app(Cache(tmp_path / "c.db"), fx)
    c = TestClient(app)
    assert c.get("/api/traffic/flow/12/2926/1697").status_code == 200
    assert c.get("/api/traffic/flow/12/1/1").status_code == 404
    assert c.get("/api/traffic/flow/20/1/1").status_code == 400
    assert c.get("/api/traffic/incidents?bbox=77.1,28.5,77.3,28.7").json()["entities"] == []
    assert c.get("/api/traffic/incidents?bbox=bad").status_code == 422
    w = c.get("/api/weather?lat=28.6315&lng=77.2167").json()
    assert w["temperatureC"] == 31.2 and w["description"] == "Mainly clear" and w["evidence"]["classification"] == "observed"
    s = c.get("/api/traffic/status").json()
    assert s["fixtures"] is True and s["callsToday"] == 0
