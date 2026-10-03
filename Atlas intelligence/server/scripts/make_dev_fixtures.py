"""Generate SYNTHETIC Overpass-style fixtures for offline development.

These are not real OpenStreetMap data. They exist so the OSM code path can
be exercised in a sandbox with no network. Real tiles replace them the
moment the server can reach Overpass. Usage:

    python scripts/make_dev_fixtures.py [out_dir] [lng] [lat] [radius_tiles]
"""
from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.tiles import lnglat_to_tile, tile_bbox  # noqa: E402

NAMES = ["Kasturba Gandhi Marg", "Barakhamba Road", "Janpath", "Sansad Marg", "Tolstoy Marg", "Ashoka Road", "Baba Kharak Singh Marg", "Panchkuian Road", "Minto Road", "Bhagwan Das Road"]


def make_tile(z: int, x: int, y: int, seed: int) -> dict:
    rng = random.Random(seed)
    b = tile_bbox(z, x, y)
    w, h = b.east - b.west, b.north - b.south
    elements = []
    nid = seed * 100000
    # edge roads shared with neighbours: west edge (vertical) and north edge (horizontal), full tile span
    cols = [0.0] + sorted(rng.uniform(0.2, 0.8) for _ in range(2)) + [1.0]
    rows = [0.0] + sorted(rng.uniform(0.2, 0.8) for _ in range(2)) + [1.0]
    # Deterministic per column/row so neighbours line up: derive from x/y hashes
    cols = [0.0] + sorted(random.Random(x * 7919 + 1).uniform(0.2, 0.8) for _ in range(2)) + [1.0]
    rows = [0.0] + sorted(random.Random(y * 104729 + 3).uniform(0.2, 0.8) for _ in range(2)) + [1.0]
    for i, c in enumerate(cols[:-1]):
        lng = b.west + c * w
        geom = [{"lat": b.north - r * h, "lon": lng} for r in rows]
        tags = {"highway": "primary" if i == 0 else "residential", "name": f"{NAMES[(x + i) % len(NAMES)]}"}
        if i == 0:
            tags.update({"maxspeed": "50", "lanes": "3"})
        elements.append({"type": "way", "id": nid, "tags": tags, "geometry": geom}); nid += 1
    for j, r in enumerate(rows[:-1]):
        lat = b.north - r * h
        geom = [{"lat": lat, "lon": b.west + c * w} for c in cols]
        tags = {"highway": "secondary" if j == 0 else "residential", "name": f"{NAMES[(y + j + 3) % len(NAMES)]}"}
        elements.append({"type": "way", "id": nid, "tags": tags, "geometry": geom}); nid += 1
    # buildings inside blocks
    for i in range(len(cols) - 1):
        for j in range(len(rows) - 1):
            x0, x1 = b.west + cols[i] * w, b.west + cols[i + 1] * w
            y0, y1 = b.north - rows[j + 1] * h, b.north - rows[j] * h
            n = rng.randint(2, 5)
            for k in range(n):
                bw, bh = (x1 - x0) * rng.uniform(0.12, 0.25), (y1 - y0) * rng.uniform(0.12, 0.25)
                bx, by = rng.uniform(x0 + 0.08 * (x1 - x0), x1 - bw - 0.08 * (x1 - x0)), rng.uniform(y0 + 0.08 * (y1 - y0), y1 - bh - 0.08 * (y1 - y0))
                ring = [{"lat": by, "lon": bx}, {"lat": by, "lon": bx + bw}, {"lat": by + bh, "lon": bx + bw}, {"lat": by + bh, "lon": bx}, {"lat": by, "lon": bx}]
                tags = {"building": rng.choice(["apartments", "commercial", "office", "yes"]), "building:levels": str(rng.randint(2, 14))}
                elements.append({"type": "way", "id": nid, "tags": tags, "geometry": ring}); nid += 1
            if rng.random() < 0.15:
                ring = [{"lat": y0 + 0.3 * (y1 - y0), "lon": x0 + 0.3 * (x1 - x0)}, {"lat": y0 + 0.3 * (y1 - y0), "lon": x0 + 0.7 * (x1 - x0)}, {"lat": y0 + 0.7 * (y1 - y0), "lon": x0 + 0.7 * (x1 - x0)}, {"lat": y0 + 0.7 * (y1 - y0), "lon": x0 + 0.3 * (x1 - x0)}, {"lat": y0 + 0.3 * (y1 - y0), "lon": x0 + 0.3 * (x1 - x0)}]
                elements.append({"type": "way", "id": nid, "tags": {"leisure": "park", "name": "Neighbourhood park"}, "geometry": ring}); nid += 1
                for _ in range(rng.randint(3, 7)):
                    elements.append({"type": "node", "id": nid, "lat": rng.uniform(y0 + 0.32 * (y1 - y0), y0 + 0.68 * (y1 - y0)), "lon": rng.uniform(x0 + 0.32 * (x1 - x0), x0 + 0.68 * (x1 - x0)), "tags": {"natural": "tree"}}); nid += 1
    # signals at some interior intersections
    for c in cols[1:-1]:
        for r in rows[1:-1]:
            if rng.random() < 0.6:
                elements.append({"type": "node", "id": nid, "lat": b.north - r * h, "lon": b.west + c * w, "tags": {"highway": "traffic_signals"}}); nid += 1
    if rng.random() < 0.3:
        elements.append({"type": "node", "id": nid, "lat": b.south + 0.5 * h, "lon": b.west + 0.5 * w, "tags": {"public_transport": "station", "station": "subway", "name": "Metro (synthetic)"}}); nid += 1
    return {"elements": elements, "synthetic": True, "note": "SYNTHETIC development fixture, not OpenStreetMap data"}


def make_district(z: int, x: int, y: int) -> dict:
    b = tile_bbox(z, x, y)
    elements = []
    for i in range(1, 4):
        lng = b.west + i / 4 * (b.east - b.west)
        elements.append({"type": "way", "id": 900000 + x * 10 + i, "tags": {"highway": "primary", "name": f"Ring Road {i}"}, "geometry": [{"lat": b.south, "lon": lng}, {"lat": b.north, "lon": lng}]})
        lat = b.south + i / 4 * (b.north - b.south)
        elements.append({"type": "way", "id": 950000 + y * 10 + i, "tags": {"highway": "secondary", "name": f"Outer Road {i}"}, "geometry": [{"lat": lat, "lon": b.west}, {"lat": lat, "lon": b.east}]})
    elements.append({"type": "node", "id": 990000 + x, "lat": (b.south + b.north) / 2, "lon": (b.west + b.east) / 2, "tags": {"place": "suburb", "name": f"District {x % 7}-{y % 5} (synthetic)"}})
    return {"elements": elements, "synthetic": True}


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "dev-fixtures"
    lng = float(sys.argv[2]) if len(sys.argv) > 2 else 77.2167
    lat = float(sys.argv[3]) if len(sys.argv) > 3 else 28.6315
    radius = int(sys.argv[4]) if len(sys.argv) > 4 else 3
    out.mkdir(parents=True, exist_ok=True)
    cx, cy = lnglat_to_tile(lng, lat, 16)
    n = 0
    for x in range(cx - radius, cx + radius + 1):
        for y in range(cy - radius, cy + radius + 1):
            (out / f"osm_street_16_{x}_{y}.json").write_text(json.dumps(make_tile(16, x, y, x * 1000003 + y)))
            n += 1
    dx, dy = lnglat_to_tile(lng, lat, 13)
    for x in range(dx - 2, dx + 3):
        for y in range(dy - 2, dy + 3):
            (out / f"osm_district_13_{x}_{y}.json").write_text(json.dumps(make_district(13, x, y)))
            n += 1
    # TomTom flow tiles (z12) with levels along the synthetic arterials, a default incident set and weather
    import mapbox_vector_tile
    fx, fy = lnglat_to_tile(lng, lat, 12)
    for x in range(fx - 1, fx + 2):
        for y in range(fy - 1, fy + 2):
            b = tile_bbox(12, x, y)
            feats = []
            rng = random.Random(x * 31 + y)
            # vertical arterials every z16 column edge (same positions as make_tile: column 0 of each z16 tile)
            for i in range(16):
                px = int(i / 16 * 4096)
                level = round(rng.uniform(0.25, 1.0), 2)
                feats.append({"geometry": f"LINESTRING({px} 0, {px} 4096)", "properties": {"traffic_level": level, "traffic_road_coverage": "full", "road_type": "Major road"}})
                py = int(i / 16 * 4096)
                feats.append({"geometry": f"LINESTRING(0 {py}, 4096 {py})", "properties": {"traffic_level": round(rng.uniform(0.25, 1.0), 2), "traffic_road_coverage": "full", "road_type": "Secondary road"}})
            pbf = mapbox_vector_tile.encode([{"name": "Traffic flow", "features": feats}], default_options={"y_coord_down": True})
            (out / f"tomtom_flow_12_{x}_{y}.pbf").write_bytes(pbf)
            n += 1
    inc = {"incidents": [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [lng + 0.004, lat + 0.002]},
                           "properties": {"id": "synthetic-1", "iconCategory": 9, "magnitudeOfDelay": 2, "events": [{"description": "Road works (synthetic fixture)", "code": 701}], "startTime": "2026-10-02T00:00:00Z", "endTime": "2026-10-03T00:00:00Z", "delay": 300, "length": 400}}]}
    (out / "tomtom_incidents_default.json").write_text(json.dumps(inc))
    (out / "weather_default.json").write_text(json.dumps({"current": {"temperature_2m": 31.4, "relative_humidity_2m": 58, "precipitation": 0.0, "weather_code": 2, "wind_speed_10m": 9.5, "time": "2026-10-02T09:00"}, "synthetic": True}))
    n += 2
    # air quality (synthetic): one reading reused for every spot
    (out / "air.json").write_text(json.dumps({"current": {"time": "2026-10-02T06:00", "european_aqi": 58, "us_aqi": 112, "pm2_5": 41.2, "pm10": 88.0, "nitrogen_dioxide": 31.0, "ozone": 60.0}}))
    n += 1 + make_gentrification(out, lng, lat)
    print(f"wrote {n} synthetic fixtures to {out}")


def make_gentrification(out: Path, lng: float, lat: float) -> int:
    """Synthetic Overpass census, two years of counts and an area news feed for the gentrification panel (offline only)."""
    import math
    from datetime import datetime, timedelta, timezone
    from email.utils import format_datetime
    rng = random.Random(49)
    els = []
    kinds = [({"amenity": "cafe"}, 14), ({"amenity": "restaurant"}, 22), ({"leisure": "fitness_centre"}, 4), ({"amenity": "school"}, 5), ({"amenity": "clinic"}, 4),
             ({"leisure": "park"}, 5), ({"amenity": "bank"}, 7), ({"shop": "convenience"}, 60), ({"shop": "clothes"}, 25), ({"amenity": "coworking_space"}, 2),
             ({"shop": "organic"}, 2), ({"amenity": "spa"}, 2), ({"amenity": "cafe", "name": "Artisan Roasters"}, 2)]
    for tags, k in kinds:
        for i in range(k):
            a, r = rng.random() * 2 * math.pi, rng.uniform(40, 2400)
            els.append({"type": "node", "id": len(els) + 1, "lat": lat + r * math.sin(a) / 110570, "lon": lng + r * math.cos(a) / (111320 * math.cos(math.radians(lat))), "tags": {"name": f"synthetic {i}", **tags}})
    (out / "overpass_census_default.json").write_text(json.dumps({"elements": els, "synthetic": True}))
    for m, (t, p, f, ring) in {36: (100, 2, 21, 8500), 30: (110, 2, 23, 8800), 24: (120, 3, 25, 9000), 18: (130, 4, 27, 9300), 12: (142, 5, 30, 9600), 6: (151, 6, 33, 9800), 0: (160, 8, 36, 10000)}.items():
        (out / f"overpass_history_{m}.json").write_text(json.dumps({"elements": [{"type": "count", "tags": {"total": str(v)}} for v in (t, p, f, ring)], "synthetic": True}))
    now = datetime.now(timezone.utc)
    items = "".join(f"<item><title>Connaught Place {t} (synthetic) - Fixture</title><link>https://example.org/{i}</link><pubDate>{format_datetime(now - timedelta(days=d))}</pubDate><source url='https://example.org'>Fixture</source></item>"
                    for i, (t, d) in enumerate([("new cafe row", 3), ("metro exit reopens", 11), ("traders meet", 19)]))
    (out / "news_area_default.xml").write_text(f"<?xml version='1.0'?><rss><channel>{items}</channel></rss>")
    # UINTEL+: construction count and distress headlines (synthetic)
    (out / "overpass_construction_default.json").write_text(json.dumps({"elements": [{"type": "count", "tags": {"total": "6"}}], "synthetic": True}))
    d_items = "".join(f"<item><title>Connaught Place {t} (synthetic) - Fixture</title><link>https://example.org/d{i}</link><pubDate>{format_datetime(now - timedelta(days=d))}</pubDate><source url='https://example.org'>Fixture</source></item>"
                      for i, (t, d) in enumerate([("shop unit e-auction under SARFAESI", 12), ("builder insolvency plea at NCLT", 60)]))
    (out / "news_distress_default.xml").write_text(f"<?xml version='1.0'?><rss><channel>{d_items}</channel></rss>")
    return 10


if __name__ == "__main__":
    main()
