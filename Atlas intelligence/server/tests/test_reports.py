"""People's crime reports: kept for a day, shown as what they are, rate-limited, never invented."""
from fastapi.testclient import TestClient

from app.cache import Cache
from app.main import create_app
from app.memory import History


def test_reports_round_trip_and_limits(tmp_path):
    history = History(tmp_path / "c.db")
    app = create_app(cache=Cache(tmp_path / "c.db"), fixtures=None, history=history)
    seen = []
    history.subscribe(lambda kind, payload: seen.append((kind, payload)))
    with TestClient(app) as c:
        r = c.post("/api/reports", json={"kind": "snatching", "description": "phone snatched near the metro gate", "lng": 77.2167, "lat": 28.6315})
        assert r.status_code == 200 and r.json()["evidence"]["source"].startswith("a person") and r.json()["ageMin"] == 0
        assert ("report", {**seen[-1][1]}) == seen[-1] and seen[-1][1]["kind"] == "snatching"
        lst = c.get("/api/reports", params={"bbox": "77.2,28.6,77.3,28.7"}).json()
        assert lst["count"] == 1 and lst["items"][0]["description"] == "phone snatched near the metro gate" and "112" in lst["note"]
        assert c.get("/api/reports", params={"bbox": "77.0,28.0,77.1,28.1"}).json()["count"] == 0
        assert c.post("/api/reports", json={"kind": "murder", "lng": 77.2, "lat": 28.6}).status_code == 400
        for _ in range(9):
            assert c.post("/api/reports", json={"kind": "other", "lng": 77.2, "lat": 28.6}).status_code == 200
        assert c.post("/api/reports", json={"kind": "other", "lng": 77.2, "lat": 28.6}).status_code == 429
        # a report from yesterday is no longer shown
        history.record_report("theft", "old", 77.25, 28.65, "x", ts=__import__("time").time() - 90000)
        assert c.get("/api/reports", params={"bbox": "77.2,28.6,77.3,28.7"}).json()["count"] == 10
