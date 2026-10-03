"""UINTEL+ INVEST score: deck weights over real signals only; no score below half the weight; never buy/sell."""
import json

from fastapi.testclient import TestClient

from app.invest import WEIGHTS, combine, grade, supply_signal, verdict, yield_signal, fsi_signal, distress_signal
from tests.test_cells import pro_headers, LAT, LNG, make


def test_weights_and_grades_follow_the_deck():
    assert WEIGHTS == {"yield": 0.30, "fsiGap": 0.20, "distress": 0.20, "supply": 0.15, "infrastructure": 0.15}
    assert [grade(v) for v in (85, 84.9, 70, 55, 40, 39.9, None)] == ["A+", "A", "A", "B", "C", "D", None]


def test_yield_needs_both_figures_and_is_labelled_as_theirs():
    assert yield_signal("home", None, 30000)["score"] is None
    y = yield_signal("home", 1_00_00_000, 30_000)  # ₹1 crore, ₹30k a month → 3.6%
    assert y["value"] == 3.6 and y["class"] == "your figure" and 0 < y["score"] < 100
    assert yield_signal("office", 1_00_00_000, 30_000)["score"] == 0.0  # 3.6% is low for an office


def test_fsi_gap_only_with_a_permitted_far():
    info = {"buildings": 10, "floorAreaM2": 98174.8, "landM2": 196349.5, "floorsKnownShare": 0.5}
    assert fsi_signal(0.5, info, None)["score"] is None and fsi_signal(0.5, info, None)["builtFar"] == 0.5
    s = fsi_signal(0.5, info, 2.0)
    assert s["value"] == 75.0 and s["score"] == 100.0 and s["class"] == "derived"
    assert fsi_signal(2.5, info, 2.0)["score"] == 0.0


def test_supply_and_distress_directions():
    assert supply_signal({"sites": 0})["score"] == 100.0 and supply_signal({"sites": 25})["score"] == 0.0
    assert supply_signal(None)["score"] is None
    assert distress_signal(None)["score"] is None
    assert distress_signal({"name": "X", "hits": 0, "items": []})["score"] == 0.0


def test_no_score_below_half_the_weight():
    sig = {k: {"score": None, "confidence": None, "value": None} for k in WEIGHTS}
    sig["infrastructure"] = {"score": 80.0, "confidence": 0.6, "value": None}
    sig["supply"] = {"score": 60.0, "confidence": 0.45, "value": 10}
    c = combine(sig)
    assert c["score"] is None and c["coverage"] == 0.3 and c["partial"] is not None
    sig["distress"] = {"score": 50.0, "confidence": 0.5, "value": 3}
    c = combine(sig)
    assert c["coverage"] == 0.5 and c["score"] == round((0.15 * 80 + 0.15 * 60 + 0.2 * 50) / 0.5, 1) and c["grade"]
    words = " ".join(verdict({**sig, "yield": {"score": None, "value": None}, "fsiGap": {"score": None, "value": None}}, c["score"])).lower()
    assert "buy" not in words and "sell" not in words.replace("sellers", "")


def test_endpoint_uses_real_signals_and_names_what_is_missing(tmp_path):
    app, _ = make(tmp_path)
    with TestClient(app) as c:
        c.headers.update(pro_headers(c))
        r = c.get("/api/invest", params={"lng": LNG, "lat": LAT, "name": "Sector 49", "purpose": "investment"})
        assert r.status_code == 200
        d = r.json()
        by = {s["key"]: s for s in d["signals"]}
        assert by["yield"]["score"] is None and by["fsiGap"]["score"] is None
        assert by["supply"]["value"] == 7 and by["supply"]["class"] == "derived"
        assert by["distress"]["value"] == 2  # the 400-day-old story and the park story do not count
        assert by["infrastructure"]["score"] is not None
        assert "250 m" in by["fsiGap"]["why"][0] or by["fsiGap"]["builtFar"] is not None
        assert set(d["missing"]) >= {"yield", "fsiGap"} and "not investment advice" in d["note"]
        d2 = c.get("/api/invest", params={"lng": LNG, "lat": LAT, "name": "Sector 49", "price": 10000000, "rent": 35000, "permitted_far": 2.5}).json()
        assert d2["coverage"] >= 0.8 and d2["score"] is not None and d2["grade"] in ("A+", "A", "B", "C", "D")
        assert any(p["source"] == "your figures" for p in d2["evidence"]["provenance"])
        assert c.get("/api/invest", params={"lng": LNG, "lat": LAT, "purpose": "casino"}).status_code == 400
        text = json.dumps(d2).lower()
        assert "strong buy" not in text and "avoid" not in text


def test_built_far_from_footprints_and_floors():
    import asyncio
    import math

    from app.invest import BUILT_RADIUS_M, Invest

    lng, lat = 77.2, 28.6
    dx = 20 / (111_320 * math.cos(math.radians(lat))); dy = 20 / 110_570  # a 40 m x 40 m footprint

    def box(cx, cy, floors, src):
        ring = [[cx - dx, cy - dy], [cx + dx, cy - dy], [cx + dx, cy + dy], [cx - dx, cy + dy], [cx - dx, cy - dy]]
        return {"type": "building", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {"floors": floors, "floorsSource": src}}

    class Cells:
        weather = None

        async def entities_in(self, bbox, cached_only=False):
            far_away = box(lng + 0.01, lat, 10, "osm:building:levels")  # about 1 km away: outside the 250 m circle
            return [box(lng, lat, 4, "osm:building:levels"), box(lng + 0.001, lat, 1, "assumed"), far_away]

    class Osm:
        cache = None

    inv = Invest(Osm(), Cells(), None)
    far, info = asyncio.run(inv.built_far(lng, lat))
    assert info["buildings"] == 2 and info["floorsKnownShare"] == 0.5
    expected = (1600 * 4 + 1600 * 1) / (math.pi * BUILT_RADIUS_M ** 2)
    assert abs(far - expected) < 0.005
