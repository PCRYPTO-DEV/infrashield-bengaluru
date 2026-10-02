"""Pro site finder: ranks real cells for a purpose, inverts gap dimensions, never ranks a cell without data."""
from fastapi.testclient import TestClient

from app.sites import PURPOSES, score_cell
from tests.test_cells import B, make


def test_score_cell_inverts_gaps_and_skips_no_data():
    st = {"dimensions": [{"key": "access_pharmacy", "score": 20.0, "confidence": 0.6, "class": "derived", "why": ["Nearest pharmacy 2.1 km"]},
                         {"key": "built", "score": 80.0, "confidence": 0.7, "class": "derived", "why": ["Dense"]},
                         {"key": "access_transport", "score": None, "confidence": None, "class": "derived", "why": []}]}
    r = score_cell(st, PURPOSES["pharmacy"])
    # a far pharmacy is a gap worth filling: inverted to 80
    assert r["why"][0]["key"] == "access_pharmacy" and r["why"][0]["inverted"] and r["why"][0]["score"] == 80.0
    assert r["score"] == 80.0 and "access_transport" in r["gaps"] and 0 < r["coverage"] < 1
    assert score_cell({"dimensions": []}, PURPOSES["cafe"])["score"] is None


def test_sites_endpoint_ranks_cells_from_cached_tiles(tmp_path):
    app, _ = make(tmp_path)
    with TestClient(app) as c:
        bbox = f"{B.west},{B.south},{B.east},{B.north}"
        c.get("/api/place", params={"lng": (B.west + B.east) / 2, "lat": (B.south + B.north) / 2})  # caches the fixture tiles
        r = c.get("/api/sites", params={"bbox": bbox, "purpose": "cafe"}).json()
        assert r["cellsScored"] >= 1 and r["candidates"][0]["score"] is not None and r["candidates"][0]["why"] and r["evidence"]["classification"] == "derived"
        assert c.get("/api/sites", params={"bbox": bbox, "purpose": "casino"}).status_code == 400
        assert c.get("/api/sites", params={"bbox": "70,20,80,30", "purpose": "cafe"}).status_code == 400
