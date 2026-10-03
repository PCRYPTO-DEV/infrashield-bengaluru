"""Gentrification (Pro): BSOCIAL's formulas on real mapped places, nothing invented for price, rent or people."""
import json
import math
from pathlib import Path

from fastapi.testclient import TestClient

from app.gentrification import (ARCHETYPES, advisory, archetypes, cbi, classify, components, counts_within, developer_grade, gi, gi_class, history_query, months_ago_iso, project, te, trend)
from tests.test_cells import LAT, LNG, make

FIX = Path(__file__).parent / "fixtures"


def census_points():
    els = json.loads((FIX / "overpass_census_default.json").read_text())["elements"]
    return [[e.get("lat", (e.get("center") or {}).get("lat")), e.get("lon", (e.get("center") or {}).get("lon")), classify(e["tags"])] for e in els]


def test_categories_follow_bsocial():
    assert classify({"amenity": "cafe"}) == 1 << 0
    assert classify({"leisure": "fitness_centre"}) & (1 << 2)
    # coworking by brand name, and it is premium
    b = classify({"office": "company", "name": "WeWork Tower"})
    assert b & (1 << 8) and b & (1 << 9)
    # an Italian restaurant counts as a restaurant and as premium
    b = classify({"amenity": "restaurant", "cuisine": "italian"})
    assert b & (1 << 1) and b & (1 << 9)
    # a plain shop is a shop, not premium
    assert classify({"shop": "convenience", "name": "Kirana"}) == 1 << 7


def test_counts_only_inside_the_radius():
    c = counts_within(census_points(), LNG, LAT)
    assert c["total"] == 54 and c["cafes"] == 8 and c["restaurants"] == 10 and c["schools"] == 3 and c["coworking"] == 2
    assert c["premium"] == 5  # organic, spa, coworking space, WeWork, Italian restaurant


def test_component_formulas_match_bsocial_when_inputs_exist():
    c = counts_within(census_points(), LNG, LAT)
    comp = components(c, None, None)
    total = c["total"]; dens = total / max(1.0, math.pi); prem = c["premium"] / total; food = (c["cafes"] + c["restaurants"]) / total; civic = (c["schools"] + c["hospitals"]) / total
    fam = te(c["schools"], 0, 8) * .35 + te(c["hospitals"], 0, 5) * .2 + te(c["parks"], 0, 6) * .2 + (1 - food) * .15 + te(civic, 0, .3) * .1
    inv = te(c["coworking"], 0, 5) * .3 + te(dens, 0, 500) * .2 + (1 - fam) * .25 + prem * .25
    life = te(c["cafes"] + c["restaurants"], 0, 30) * .35 + te(c["gyms"], 0, 5) * .2 + prem * .25 + te(dens, 0, 300) * .2
    stab = te(c["banks"], 0, 8) * .2 + te(c["schools"], 0, 6) * .25 + te(c["hospitals"], 0, 4) * .15 + (1 - inv) * .25 + (1 - prem) * .15
    gen = prem * .35 + te(c["coworking"], 0, 4) * .2 + te(c["cafes"], 0, 15) * .2 + te(dens, 0, 400) * .15 + food * .1
    for k, v in (("family", fam), ("investor", inv), ("lifestyle", life), ("stability", stab), ("gentrification", gen)):
        assert abs(comp[k]["value"] - round(v, 3)) < 1e-9, k
    # without headlines there is no digital buzz: not guessed
    assert comp["buzz"]["value"] is None and comp["engagement"]["value"] is not None
    # reported crime lowers stability; none reported leaves BSOCIAL's value untouched
    assert components(c, None, 30)["stability"]["value"] < comp["stability"]["value"]


def test_gi_leaves_out_price_and_rent_unless_typed():
    c = counts_within(census_points(), LNG, LAT)
    comp = components(c, 6, None)
    g = gi(c, comp)
    by = {p["key"]: p for p in g["components"]}
    assert by["priceMomentum"]["value"] is None and by["rentalTurnover"]["value"] is None
    assert g["coverage"] == 0.5 and g["value"] is not None and g["class"] == gi_class(g["value"])
    g2 = gi(c, comp, price_trend_pct=15)
    assert g2["coverage"] == 0.85 and {p["key"]: p for p in g2["components"]}["priceMomentum"]["class"] == "your figure"
    assert [gi_class(v) for v in (39, 40, 59, 60, 79, 80)] == ["stable", "transitional", "transitional", "emerging", "emerging", "high"]


def test_cbi_weights_and_archetype_softmax():
    comp = {k: {"value": v, "why": ""} for k, v in zip(("family", "investor", "lifestyle", "engagement", "stability", "gentrification", "buzz"), ARCHETYPES[0][2])}
    assert cbi(comp)["value"] == round(sum(w * v for w, v in zip((.15, .12, .15, .13, .15, .15, .15), ARCHETYPES[0][2])) * 100)
    a = archetypes(comp)
    assert a[0]["id"] == "family-stability" and abs(sum(x["probability"] for x in a) - 1) < 0.03
    comp["buzz"]["value"] = None; comp["engagement"]["value"] = None; comp["stability"]["value"] = None
    assert archetypes(comp) is None  # fewer than five measured dimensions: no archetype


def test_trend_and_projection_need_real_points():
    assert trend([1, 2, 3])["direction"] == "flat"
    assert trend([10, 11, 14, 18, 23])["direction"] == "accelerating"
    assert project([0, 6, 12], [1, 2, 3]) is None
    p = project([-24, -18, -12, -6, 0], [2, 2.5, 3, 3.6, 4.2])
    assert p["points"][0]["months"] == 6 and p["points"][1]["lower"] <= p["points"][1]["predicted"] <= p["points"][1]["upper"] and p["slopePerYear"] > 0


def test_advisory_rules_and_grade():
    a = advisory(45, 72, 0.5, [{"cell": "x", "gi": 65}, {"cell": "y", "gi": 70}], 0)
    keys = {i["key"] for i in a["items"]}
    assert {"infra_pressure", "displacement", "spillover"} <= keys and a["level"] == "critical"
    assert advisory(70, 30, 0.5, [], 0)["level"] == "low"
    assert advisory(30, 30, 0.5, [], 12)["level"] == "elevated"  # crime rule
    assert developer_grade(60, 50, None)["grade"] is None
    assert developer_grade(60, 50, 10)["grade"] in ("A+", "A", "B+", "B", "C")


def test_history_query_and_dates():
    q = history_query(28.6, 77.2, "2024-10-01T00:00:00Z")
    assert '[date:"2024-10-01T00:00:00Z"]' in q and q.count("out count") == 4
    assert months_ago_iso(24, 1759449600) == "2023-10-01T00:00:00Z"  # 2025-10-03 → two years back, first of month


def test_endpoint_reports_real_parts_and_says_what_is_missing(tmp_path):
    app, history = make(tmp_path)
    history.record_report("theft", "phone snatched", LNG + 0.001, LAT, "t1")
    with TestClient(app) as c:
        r = c.get("/api/gentrification", params={"lng": LNG, "lat": LAT, "name": "Sector 49"})
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "ok" and d["counts"]["total"] == 54
        assert d["news"]["mentions"] == 3  # the 45-day-old story is outside 30 days
        assert d["incidents90d"] == 1
        assert d["gi"]["coverage"] == 0.5 and d["gi"]["value"] is not None
        assert {"priceMomentum", "rentalTurnover", "liquidity", "households", "income"} <= set(d["missing"])
        text = json.dumps(d)
        for invented in ("medianIncome", "avgAge", "totalHouseholds", "avgDaysOnMarket"):
            assert invented not in text
        m = d["momentum"]
        assert m["status"] == "ok" and [r["monthsAgo"] for r in m["series"]] == [24, 18, 12, 6, 0]
        assert m["areaGrowth"] == 50.0 and m["ringGrowth"] == 10.0 and m["trend"]["direction"] in ("accelerating", "steady-up") and m["projection"]
        assert d["archetypes"] and d["advisory"]["level"] in ("low", "moderate", "elevated", "high", "critical")
        assert d["evidence"]["provenance"][0]["source"].startswith("OpenStreetMap")
        # a typed price trend is used and labelled as the person's own figure
        d2 = c.get("/api/gentrification", params={"lng": LNG, "lat": LAT, "name": "Sector 49", "price_trend": 12}).json()
        assert d2["gi"]["coverage"] == 0.85 and d2["developerGrade"]["grade"] is not None
        # the map layer works from the cached census
        g = c.get("/api/gentrification/grid", params={"bbox": f"{LNG - 0.01},{LAT - 0.01},{LNG + 0.01},{LAT + 0.01}"}).json()
        assert g["cells"] and all(len(x["boundary"]) == 6 for x in g["cells"])
        assert c.get("/api/gentrification/grid", params={"bbox": "70,20,80,30"}).status_code == 400
        assert c.get("/api/gentrification", params={"lng": 0, "lat": 0}).status_code == 422  # India only


def test_a_failed_source_is_remembered_not_hammered(tmp_path):
    import asyncio

    from app.cache import Cache
    from app.gentrification import Gentrification

    class Down:
        def __init__(self):
            self.cache = Cache(tmp_path / "g.db"); self.calls = 0

        async def raw(self, *a, **k):
            self.calls += 1
            raise TimeoutError("overpass slow")

    osm = Down()
    g = Gentrification(osm, history=None, cells=None, fixtures=None)
    first = asyncio.run(g.census("873dac9a8ffffff"))
    again = asyncio.run(g.census("873dac9a8ffffff"))
    assert first["failed"] and again["failed"] and osm.calls == 1
    h1 = asyncio.run(g.history_series("883dac9a85fffff", 1759449600))
    h2 = asyncio.run(g.history_series("883dac9a85fffff", 1759449600))
    assert h1["failed"] and h2["failed"] and osm.calls == 2
