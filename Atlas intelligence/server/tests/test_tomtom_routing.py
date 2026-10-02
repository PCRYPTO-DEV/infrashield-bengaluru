"""Whole-country routing and search through TomTom, with the city's incidents judged along each route."""
import time
from pathlib import Path

from fastapi.testclient import TestClient

from app.cache import Cache
from app.main import create_app
from app.memory import History

FIXTURES = Path(__file__).parent / "fixtures"


def test_geocode_and_route_with_safer_choice(tmp_path):
    cache = Cache(tmp_path / "c.db"); history = History(tmp_path / "c.db")
    app = create_app(cache=cache, fixtures=FIXTURES, history=history)
    with TestClient(app) as c:
        g = c.get("/api/geocode", params={"q": "Cyber Hub", "lat": 28.63, "lng": 77.21}).json()["results"]
        assert g[0]["name"] == "Dlf Cyber Hub" and abs(g[0]["lat"] - 28.477) < 0.01 and g[0]["source"] == "tomtom-search"
        r = c.get("/api/route", params={"from": "28.6315,77.2167", "to": "28.4595,77.0266"}).json()
        assert len(r["routes"]) == 2 and r["routes"][0]["lengthM"] == 31962 and r["routes"][0]["points"][0] == [77.2167, 28.6315]
        assert r["recommended"]["fastest"] == 0 and r["evidence"]["classification"] == "derived"
        # with no incidents seen, the fastest route is also the safer one: nothing is claimed that the city has not seen
        assert r["recommended"]["safer"] == 0 and r["explanation"][0].startswith("The fastest route also")
        # an incident on the fastest route makes the other one the safer pick
        history.record_incidents([{"id": "x1", "properties": {"kind": "accident", "severity": 0.9, "description": "pile-up"}, "geometry": {"type": "Point", "coordinates": [77.12, 28.55]}}], ts=time.time() - 60)
        cache.set("tomtom:route:28.6315,77.2167:28.4595,77.0266:2", None, 0, 0)  # drop the cached answer
        r = c.get("/api/route", params={"from": "28.6315,77.2167", "to": "28.4595,77.0266"}).json()
        assert r["routes"][0]["incidentsNear"] == 1 and r["routes"][1]["incidentsNear"] == 0
        assert r["recommended"]["safer"] == 1 and "fewer reported incidents" in r["explanation"][0]
