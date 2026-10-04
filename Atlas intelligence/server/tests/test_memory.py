import time
from datetime import datetime, timezone, timedelta

from fastapi.testclient import TestClient

from app.alerts import AlertEngine, AlertIn, RoadSlowRule, CountAboveRule, ZoneEventRule, message_for
from app.cache import Cache
from app.main import create_app
from app.memory import History

SEG = [{"id": "s1", "trafficLevel": 0.4, "coordinates": [[77.2, 28.6], [77.21, 28.6]], "roadType": "Major road"},
       {"id": "s2", "trafficLevel": 0.9, "coordinates": [[77.2, 28.61], [77.21, 28.61]], "roadType": "Secondary road"}]


def test_memory_builds_a_baseline_only_from_enough_readings():
    h = History(":memory:")
    now = datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc).timestamp()
    assert h.record_flow("12/1/1", SEG, now) == 2
    c = h.compare("12/1/1", now)
    assert c["segments"]["s1"]["now"] == 0.4 and c["segments"]["s1"]["usual"] is None and "not enough" in c["segments"]["s1"]["basis"]
    # same weekday and hour, three earlier weeks
    for weeks in (1, 2, 3):
        h.record_flow("12/1/1", [{"id": "s1", "trafficLevel": 0.8, "coordinates": [[77.2, 28.6]]}], now - weeks * 7 * 86400)
    u = h.usual("s1", now)
    assert u["usual"] == 0.8 and u["samples"] == 3 and u["basis"] == "same weekday and hour"
    c = h.compare("12/1/1", now)
    assert round(c["segments"]["s1"]["delta"], 2) == -0.4
    assert h.series("s1", hours=24 * 30, now=now)[-1][1] == 0.4
    s = h.summary(24, now)
    assert s["flowReadings"] == 2 and s["segments"] == 2


def test_observations_and_summary_endpoints():
    c = TestClient(create_app(Cache(":memory:")))
    assert c.post("/api/observations/camera", json={"cameraId": "cam-1", "people": 12, "vehicles": 3, "lng": 77.2, "lat": 28.6}).status_code == 200
    assert c.post("/api/observations/zone", json={"zone": "Gate 2", "kind": "count", "description": "40 people in Gate 2"}).status_code == 200
    assert c.post("/api/observations/zone", json={"zone": "Gate 2", "kind": "bad kind!", "description": ""}).status_code == 400
    s = c.get("/api/history/summary").json()
    assert s["cameraCounts"] == 1 and s["peakPeople"] == 12 and s["zoneEvents"] == 1 and s["zoneEventsRecent"][0]["zone"] == "Gate 2"
    assert c.get("/api/history/camera?camera=cam-1").json()["points"][0]["people"] == 12
    assert c.get("/api/history/compare?tile=12/1/1").json()["segments"] == {}
    assert c.get("/api/health").json()["memory"] == 0


def test_alerts_fire_in_plain_words_and_respect_cooldown():
    h = History(":memory:")
    sent = []
    eng = AlertEngine(":memory:", h, sender=lambda ch, to, body: (sent.append((ch, to, body)) or "SMxx"))
    slow = eng.create(AlertIn(name="Ring Road watch", channel="whatsapp", to="+919999999999", language="hi", rule=RoadSlowRule(kind="road_slow", tile="12/1/1", road="Ring Road", levelBelow=0.5, minutes=10)))
    count = eng.create(AlertIn(name="Gate crowd", channel="sms", to="+919999999999", rule=CountAboveRule(kind="count_above", camera="cam-1", what="people", above=50)))
    zone = eng.create(AlertIn(name="Zone watch", channel="app", rule=ZoneEventRule(kind="zone_event", zone="Gate 2", events=["count"])))
    t0 = time.time()
    h.record_flow("12/1/1", SEG, t0)             # below the limit, but not yet for 10 minutes
    assert sent == []
    h.record_flow("12/1/1", SEG, t0 + 10 * 60)   # 10 minutes later: fires
    assert len(sent) == 1 and sent[0][0] == "whatsapp" and "Ring Road" in sent[0][2] and "40%" in sent[0][2] and "धीमा" in sent[0][2]
    h.record_flow("12/1/1", SEG, t0 + 12 * 60)   # within the cooldown: silent
    assert len(sent) == 1
    h.record_camera("cam-1", 51, 2, None, None, t0)
    assert len(sent) == 2 and "51 people" in sent[1][2] and "above your limit of 50" in sent[1][2]
    h.record_camera("cam-1", 20, 2, None, None, t0 + 1)
    assert len(sent) == 2
    h.record_zone_event("Gate 2", "count", "60 agents in Gate 2", None, None, t0)
    log = eng.log()
    z = next(x for x in log if x["alertId"] == zone.id)
    assert z["delivered"] == "app" and "Gate 2" in z["message"] and len(log) == 3
    assert {a.id for a in eng.list()} == {slow.id, count.id, zone.id}
    assert eng.delete(zone.id) and len(eng.list()) == 2
    assert "seen by TomTom" in message_for(AlertIn(name="x", rule=RoadSlowRule(kind="road_slow", tile="12/1/1")), {"level": 0.3})


def test_alert_endpoints_validate_and_test_send():
    sent = []
    c = TestClient(create_app(Cache(":memory:"), alert_sender=lambda ch, to, body: (sent.append(body) or "SM1")))
    bad = c.post("/api/alerts", json={"name": "x", "channel": "sms", "to": "9999", "rule": {"kind": "count_above", "camera": "cam-1", "above": 5}})
    assert bad.status_code == 400
    ok = c.post("/api/alerts", json={"name": "Gate", "channel": "sms", "to": "+911234567890", "rule": {"kind": "count_above", "camera": "cam-1", "above": 5}})
    assert ok.status_code == 200
    aid = ok.json()["id"]
    assert c.get("/api/alerts").json()["alerts"][0]["name"] == "Gate"
    t = c.post(f"/api/alerts/{aid}/test").json()
    assert t["delivered"] == "sms" and "6 people and vehicles" in t["message"] and sent
    assert c.get("/api/alerts/log").json()["log"][0]["alertId"] == aid
    assert c.delete(f"/api/alerts/{aid}").status_code == 200 and c.delete(f"/api/alerts/{aid}").status_code == 404
