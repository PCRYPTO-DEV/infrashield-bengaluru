"""Live without lag: hot tiles within budget, events pushed to the stream, warm requests."""
import asyncio
import time

from fastapi.testclient import TestClient

from app.live import HotTiles, Broadcaster, sse
from app.cache import Cache
from app.main import create_app
from app.memory import History
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def test_hot_tiles_expire_and_interval_respects_the_budget():
    h = HotTiles()
    now = time.time()
    h.touch("12/1/1", now - 700); h.touch("12/1/2", now - 10)
    assert h.hot(now) == ["12/1/2"]
    assert HotTiles.interval(0, 2000) == 60
    assert HotTiles.interval(1, 2000) == 72            # one tile: 1,200 reads a day → every 72 s
    assert HotTiles.interval(3, 2000) == 216           # three tiles share the same 1,200 reads
    assert HotTiles.interval(20, 500) > 60             # 20 tiles cannot be read every minute on 300 calls
    assert abs(HotTiles.interval(20, 500) - 20 * 86400 / 300) < 1e-6


def test_events_reach_the_stream_as_sse():
    bc = Broadcaster()
    loop = asyncio.new_event_loop()
    bc.loop = loop
    q = bc.subscribe()
    bc.on_event("flow", {"tile": "12/2926/1707", "ts": 1.0, "segments": [1, 2, 3]})
    loop.run_until_complete(asyncio.sleep(0))
    msg = q.get_nowait()
    assert msg["kind"] == "flow" and msg["tile"] == "12/2926/1707" and msg["count"] == 3 and "segments" not in msg
    text = sse(msg)
    assert text.startswith("event: flow\ndata: {") and text.endswith("\n\n")
    loop.close()


def test_history_notifies_incidents_and_warm_is_skipped_on_fixtures(tmp_path):
    cache = Cache(tmp_path / "c.db"); history = History(tmp_path / "c.db")
    app = create_app(cache=cache, fixtures=FIXTURES, history=history)
    got = []
    history.subscribe(lambda kind, payload: got.append(kind))
    history.record_incidents([{"id": "i1", "properties": {"kind": "accident", "severity": 0.5, "description": "x"}, "geometry": {"type": "Point", "coordinates": [77.2, 28.6]}}])
    assert got == ["incidents"]
    with TestClient(app) as c:
        assert c.get("/api/warm", params={"lng": 77.2, "lat": 28.6}).json()["status"] == "skipped"
        st = c.get("/api/live/status").json()
        assert st["hotTiles"] == [] and st["subscribers"] == 0
        # a viewed flow tile becomes hot
        c.get("/api/traffic/flow/12/2926/1707")
        assert c.get("/api/live/status").json()["hotTiles"] == ["12/2926/1707"]


def test_spa_never_serves_outside_dist_and_api_unknowns_are_404(tmp_path):
    from app.config import WEB_DIST
    cache = Cache(tmp_path / "c.db"); history = History(tmp_path / "c.db")
    app = create_app(cache=cache, fixtures=FIXTURES, history=history)
    with TestClient(app) as c:
        if WEB_DIST.exists():
            for p in ("/..%2F..%2Fserver%2Fapp%2Fconfig.py", "/../../server/app/config.py", "/..%2F..%2F..%2F..%2Fetc%2Fpasswd"):
                r = c.get(p)
                assert r.status_code == 404 or (r.status_code == 200 and "<!doctype html>" in r.text.lower()), p
                assert "TOMTOM" not in r.text and "root:" not in r.text
        assert c.get("/api/no/such/thing").status_code == 404
        assert c.get("/api/cells", params={"bbox": "68,6,97,36"}).status_code == 400
