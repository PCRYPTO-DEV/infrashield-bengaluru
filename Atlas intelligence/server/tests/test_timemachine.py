"""PAST is what was read; FUTURE is a labelled prediction from the memory, never a simulation."""
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from app.cache import Cache
from app.main import create_app
from app.memory import History
from app.timemachine import forecast_at, history_at

BBOX = (77.1, 28.5, 77.3, 28.7)
SEG = lambda lvl: [{"id": "s1", "trafficLevel": lvl, "coordinates": [[77.2, 28.6], [77.21, 28.6]], "roadType": "Major road"}]  # noqa: E731


def test_history_at_returns_only_what_was_read():
    h = History(":memory:")
    now = datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc).timestamp()
    h.record_flow("12/1/1", SEG(0.4), now - 3600)
    h.record_flow("12/1/1", SEG(0.9), now - 600)
    h.record_incidents([{"id": "i1", "properties": {"kind": "accident", "severity": 0.8, "description": "x"}, "geometry": {"type": "Point", "coordinates": [77.2, 28.6]}}], now - 3600)
    r = history_at(h, BBOX, now - 3300)
    assert r["kind"] == "recorded" and r["flow"]["segments"][0]["level"] == 0.4 and len(r["incidents"]) == 1
    assert r["evidence"]["classification"] == "observed" and r["coverage"]["segments"] == 1
    # an instant between readings shows the nearest one and says how far off it is; beyond 3 hours, nothing
    r = history_at(h, BBOX, now - 2000)
    assert r["flow"]["count"] == 1 and r["flow"]["segments"][0]["level"] == 0.9 and r["flow"]["segments"][0]["offsetS"] == 1400 and r["flow"]["typicalOffsetS"] == 1400
    r = history_at(h, BBOX, now - 6 * 3600)
    assert r["flow"]["count"] == 0 and r["incidents"] == [] and r["evidence"]["confidence"] == 0.0


def test_forecast_is_the_usual_plus_a_fading_anomaly_with_confidence():
    h = History(":memory:")
    now = datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc).timestamp()
    target = now + 3600  # 10:00
    for weeks in (1, 2, 3):  # same weekday, 10:00, three earlier weeks: usually 0.8 free
        h.record_flow("12/1/1", SEG(0.8), target - weeks * 7 * 86400)
    r = forecast_at(h, BBOX, target, now=now)
    s = r["flow"]["segments"][0]
    assert r["kind"] == "predicted" and r["evidence"]["classification"] == "predicted"
    assert s["level"] == 0.8 and s["basis"] == "same weekday and hour" and 0.4 < s["confidence"] <= 0.8 and s["anomalyNow"] == 0.0
    # a jam right now (0.2 where 0.8 is usual at 09:00) still shows a little an hour later
    for weeks in (1, 2, 3):
        h.record_flow("12/1/1", SEG(0.8), now - weeks * 7 * 86400)
    h.record_flow("12/1/1", SEG(0.2), now - 60)
    r = forecast_at(h, BBOX, target, now=now)
    s = r["flow"]["segments"][0]
    assert s["anomalyNow"] < 0 and 0.6 < s["level"] < 0.8 and r["incidents"] == []
    # nothing remembered anywhere → nothing predicted
    assert forecast_at(h, (78.0, 29.0, 78.1, 29.1), target, now=now)["flow"]["count"] == 0
    # a road with a live reading but no history carries it forward, at low confidence, and says so
    h2 = History(":memory:")
    h2.record_flow("12/1/1", SEG(0.55), now - 60)
    s2 = forecast_at(h2, BBOX, target, now=now)["flow"]["segments"][0]
    assert s2["level"] == 0.55 and s2["samples"] == 0 and s2["confidence"] == 0.2 and "carried forward" in s2["basis"]


def test_time_machine_routes(tmp_path):
    app = create_app(cache=Cache(tmp_path / "c.db"), fixtures=None, history=History(tmp_path / "c.db"))
    with TestClient(app) as c:
        import time
        now = time.time()
        assert c.get("/api/history/at", params={"bbox": "77.1,28.5,77.3,28.7", "at": now - 600}).json()["kind"] == "recorded"
        assert c.get("/api/history/at", params={"bbox": "77.1,28.5,77.3,28.7", "at": now + 3600}).status_code == 400
        assert c.get("/api/forecast/at", params={"bbox": "77.1,28.5,77.3,28.7", "at": now + 3600}).json()["kind"] == "predicted"
        assert c.get("/api/forecast/at", params={"bbox": "70,20,80,30", "at": now + 3600}).status_code == 400
