"""WHAT CHANGED? — meaningful differences between now and before, from readings the city kept.

Ranked by magnitude × confidence × relevance × geographic impact. Only what was measured twice can
change: traffic against its usual, incidents that started or cleared, air against 24 hours ago,
camera counts, zone events. Structural change (new roads, buildings) needs OpenStreetMap snapshots
over time, which do not exist yet; the response says so instead of guessing.
"""
from __future__ import annotations

import time
from typing import Any

from .cells import dist_m
from .tiles import BBox

ROAD_IMPACT = {"motorway": 1.0, "trunk": 1.0, "primary": 0.9, "secondary": 0.7, "tertiary": 0.5, "street": 0.3, "arterial": 0.9, "collector": 0.6, "local": 0.3}


def rank(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for it in items:
        it["rank"] = round(it["magnitude"] * it["confidence"] * it["relevance"] * it["impact"], 3)
    return sorted(items, key=lambda i: i["rank"], reverse=True)


class ChangeEngine:
    def __init__(self, history: Any, air: Any = None):
        self.history, self.air = history, air

    def detect(self, b: BBox, since_s: float = 86400, now: float | None = None, limit: int = 17) -> dict[str, Any]:
        now = time.time() if now is None else now
        items: list[dict[str, Any]] = []
        clat, clng = (b.south + b.north) / 2, (b.west + b.east) / 2
        # 1. traffic now vs usual for this weekday and hour
        flow = self.history.flow_in_bbox(b.west, b.south, b.east, b.north, within_s=900, now=now)
        by_road: dict[str, list[dict[str, Any]]] = {}
        for f in flow:
            u = self.history.usual(f["segment"], at=now)
            if u.get("usual") is None:
                continue
            f["delta"] = f["level"] - u["usual"]; f["usual"] = u["usual"]; f["samples"] = u.get("samples", 0)
            by_road.setdefault(f.get("roadType") or "street", []).append(f)
        for rt, segs in by_road.items():
            bad = [s for s in segs if s["delta"] <= -0.15]
            good = [s for s in segs if s["delta"] >= 0.15]
            for group, sign in ((bad, -1), (good, 1)):
                if not group:
                    continue
                d = sum(s["delta"] for s in group) / len(group)
                centre = max(group, key=lambda s: abs(s["delta"]))
                items.append({"id": f"traffic:{rt}:{sign}:{round(centre['lng'], 3)},{round(centre['lat'], 3)}", "kind": "traffic", "magnitude": min(1.0, abs(d) * 2.5), "confidence": min(0.9, 0.4 + 0.1 * min(4, min(s['samples'] for s in group)) + (0.1 if len(group) >= 2 else 0.0)),
                              "relevance": 1.0, "impact": ROAD_IMPACT.get(rt, 0.4), "lng": centre["lng"], "lat": centre["lat"], "classification": "derived", "source": "tomtom + memory",
                              "text": f"{len(group)} {rt} road segments are {abs(round(d * 100))} points {'slower' if sign < 0 else 'faster'} than usual for this weekday and hour.",
                              "evidence": [f"now {round(sum(s['level'] for s in group) / len(group) * 100)}% of free speed, usually {round(sum(s['usual'] for s in group) / len(group) * 100)}%", f"{min(s['samples'] for s in group)}+ past readings per segment"]})
        # 2. incidents that started or cleared in the window
        inc = self.history.incidents_in_bbox(b.west, b.south, b.east, b.north, since_s=since_s, now=now)
        for i in inc:
            active = now - (i["ts"] or 0) < 900
            started_recently = (i.get("firstSeen") or 0) >= now - since_s
            if not (active or started_recently):
                continue
            items.append({"id": f"incident:{i['id']}:{'active' if active else 'cleared'}", "kind": "incident", "magnitude": min(1.0, 0.4 + float(i.get("severity") or 0.5) * 0.6), "confidence": 0.85, "relevance": 1.0 if active else 0.6, "impact": 0.7,
                          "lng": i["lng"], "lat": i["lat"], "classification": "observed", "source": "tomtom-incidents",
                          "text": f"{(i.get('kind') or 'incident').replace('_', ' ').capitalize()} {'reported' if active else 'cleared'}: {i.get('description') or ''}".strip(),
                          "evidence": [f"first seen {round((now - (i.get('firstSeen') or now)) / 60)} min ago", "TomTom incident feed"]})
        # 3. air now vs 24 h ago (one reading per rounded spot)
        if self.history.count("air_readings") > 0:
            latest = self.history.air_before(clat, clng, 0, now)
            prev = self.history.air_before(clat, clng, 86400, now)
            if latest and prev and latest.get("euAqi") is not None and prev.get("euAqi") is not None:
                d = latest["euAqi"] - prev["euAqi"]
                if abs(d) >= 10:
                    items.append({"id": f"air:{round(clat, 2)},{round(clng, 2)}", "kind": "air", "magnitude": min(1.0, abs(d) / 50), "confidence": 0.65, "relevance": 0.9, "impact": 0.8, "lng": clng, "lat": clat, "classification": "observed", "source": "open-meteo-air",
                                  "text": f"Air quality {'worsened' if d > 0 else 'improved'}: European AQI {round(latest['euAqi'])} now, {round(prev['euAqi'])} a day ago.", "evidence": ["Open-Meteo air quality (CAMS model, about 11 km)"]})
        # 4. camera counts and zone events
        for c in self.history.camera_in_bbox(b.west, b.south, b.east, b.north, within_s=900, now=now):
            if c["people"] >= 25:
                items.append({"id": f"camera:{c['camera']}", "kind": "camera", "magnitude": min(1.0, c["people"] / 100), "confidence": 0.7, "relevance": 0.8, "impact": 0.4, "lng": c["lng"], "lat": c["lat"], "classification": "observed", "source": "camera",
                              "text": f"Camera {c['camera']} counts {c['people']} people and {c['vehicles']} vehicles right now.", "evidence": ["on-device counting; no faces"]})
        for z in self.history.recent_zone_events(hours=since_s / 3600, now=now, limit=20):
            if z.get("lng") is None or not (b.west <= z["lng"] <= b.east and b.south <= z["lat"] <= b.north):
                continue
            items.append({"id": f"zone:{z['zone']}:{int(z['ts'])}", "kind": "zone", "magnitude": 0.5, "confidence": 0.7, "relevance": 0.7, "impact": 0.3, "lng": z["lng"], "lat": z["lat"], "classification": "derived", "source": "zone rules",
                          "text": f"Zone {z['zone']}: {z.get('description') or z.get('kind')}", "evidence": [f"{round((now - z['ts']) / 60)} min ago"]})
        ranked = rank(items)
        return {"since": since_s, "count": len(ranked), "items": ranked[:limit], "computedAt": int(now * 1000),
                "notDetectable": ["new roads, buildings or land use (needs OpenStreetMap snapshots over time; the first snapshot is being kept now)", "population", "waterlogging reports (no feed connected)"]}
