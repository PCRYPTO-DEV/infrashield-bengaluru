"""Instant OpenStreetMap: pre-made vector tiles (OpenMapTiles schema, served by OpenFreeMap)
decoded into the same Overpass-style elements the normaliser already understands.

One z14 tile holds 16 street tiles and arrives from a CDN in well under a second, anywhere in
the world; the live Overpass query path stays as the fallback. Everything here is OpenStreetMap
data; only the delivery differs. What vector tiles do not carry (traffic signals, individual
trees) is simply absent, never invented.
"""
from __future__ import annotations

import logging
import math
import time
from typing import Any

import httpx

from .config import settings
from .tiles import BBox, tile_bbox

log = logging.getLogger("atlas.vtiles")
MAX_ZOOM = 14

# OpenMapTiles transportation classes -> the OSM highway tag the normaliser classifies
ROAD_CLASS = {"motorway": "motorway", "trunk": "trunk", "primary": "primary", "secondary": "secondary", "tertiary": "tertiary",
              "minor": "residential", "service": "service", "motorway_construction": None, "path": "footway", "track": None, "rail": None, "transit": None}
# OpenMapTiles poi classes that matter for a place card; the normaliser keeps them as `poi` entities
POI_KINDS = {"hospital": "hospital", "doctors": "clinic", "dentist": "clinic", "pharmacy": "pharmacy", "school": "school", "college": "college", "university": "university",
             "kindergarten": "school", "police": "police", "fire_station": "fire_station", "grocery": "grocery", "shop": "shop", "clothing_store": "shop",
             "supermarket": "grocery", "bank": "bank", "atm": "bank", "bus": "bus_stop", "park": "park", "playground": "playground", "sports_centre": "sports",
             "stadium": "sports", "cinema": "leisure", "theatre": "leisure", "restaurant": "food", "cafe": "food", "fast_food": "food", "fuel": "fuel", "charging_station": "ev_charging",
             "post_office": "civic", "townhall": "civic", "library": "civic", "place_of_worship": "worship"}
GREEN = {  # (layer, class/subclass) -> tags
    "park": {"leisure": "park"}, "national_park": {"leisure": "nature_reserve"}, "nature_reserve": {"leisure": "nature_reserve"},
    "wood": {"natural": "wood"}, "forest": {"natural": "wood"}, "grass": {"landuse": "grass"}, "grassland": {"natural": "grassland"},
    "scrub": {"natural": "scrub"}, "orchard": {"landuse": "orchard"}, "garden": {"leisure": "garden"}, "golf_course": {"landuse": "grass"},
    "recreation_ground": {"landuse": "recreation_ground"}, "cemetery": {"landuse": "cemetery"}, "pitch": {"leisure": "pitch"},
    "playground": {"leisure": "playground"}, "meadow": {"landuse": "meadow"}, "village_green": {"landuse": "village_green"}, "heath": {"natural": "heath"},
}


class VectorTileSource:
    def __init__(self, url: str | None = None):
        self.base = (url or settings.osm_tiles_url).strip()
        self._template: str | None = self.base if "{z}" in self.base else None
        self._template_at = 0.0
        self.calls = 0
        self.last_error: str | None = None

    async def template(self, client: httpx.AsyncClient) -> str:
        """The {z}/{x}/{y} URL: given directly, or read from the TileJSON at the base URL (re-read daily)."""
        if self._template and (self._template == self.base or time.monotonic() - self._template_at < 86400):
            return self._template
        r = await client.get(self.base, headers={"Accept": "application/json"})
        r.raise_for_status()
        tiles = r.json().get("tiles") or []
        if not tiles:
            raise RuntimeError("TileJSON has no tiles URL")
        self._template, self._template_at = tiles[0], time.monotonic()
        return self._template

    async def elements(self, tier: str, z: int, x: int, y: int) -> list[dict[str, Any]]:
        """Overpass-style elements for the tile z/x/y (z <= 14), selected like the Overpass queries for this tier."""
        if z > MAX_ZOOM:
            raise ValueError("vector tiles stop at zoom 14")
        from .osm import http_client  # late import: osm imports this module
        async with http_client(httpx.Timeout(20.0, connect=8.0)) as client:
            url = (await self.template(client)).replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y))
            t0 = time.monotonic()
            r = await client.get(url)
            self.calls += 1
            if r.status_code == 204 or (r.status_code == 404 and not r.content):
                return []
            r.raise_for_status()
            log.info("vtile %s/%s/%s: %d bytes in %.2fs", z, x, y, len(r.content), time.monotonic() - t0)
            return decode_tile(r.content, tile_bbox(z, x, y), tier)


def decode_tile(pbf: bytes, b: BBox, tier: str) -> list[dict[str, Any]]:
    import mapbox_vector_tile
    layers = mapbox_vector_tile.decode(pbf, default_options={"y_coord_down": True})
    out: list[dict[str, Any]] = []

    def to_ll(extent: int, pt: list[float]) -> dict[str, float]:
        fx, fy = pt[0] / extent, pt[1] / extent
        lon = b.west + fx * (b.east - b.west)
        # Mercator between the tile's north and south edges
        my0 = math.log(math.tan(math.pi / 4 + math.radians(b.north) / 2))
        my1 = math.log(math.tan(math.pi / 4 + math.radians(b.south) / 2))
        lat = math.degrees(2 * math.atan(math.exp(my0 + fy * (my1 - my0))) - math.pi / 2)
        return {"lat": lat, "lon": lon}

    def lines(geom: dict[str, Any]) -> list[list[list[float]]]:
        t = geom.get("type")
        if t == "LineString":
            return [geom["coordinates"]]
        if t == "MultiLineString":
            return geom["coordinates"]
        return []

    def rings(geom: dict[str, Any]) -> list[list[list[float]]]:
        t = geom.get("type")
        if t == "Polygon":
            return [geom["coordinates"][0]] if geom["coordinates"] else []
        if t == "MultiPolygon":
            return [p[0] for p in geom["coordinates"] if p]
        return []

    def point(geom: dict[str, Any]) -> list[float] | None:
        t = geom.get("type")
        if t == "Point":
            return geom["coordinates"]
        if t == "MultiPoint" and geom["coordinates"]:
            return geom["coordinates"][0]
        return None

    def way(layer: str, idx: int, feat: dict[str, Any], coords: list[list[float]], extent: int, tags: dict[str, Any]) -> dict[str, Any]:
        fid = feat.get("id") or 0
        return {"type": "way", "id": f"{layer}{fid}-{idx}" if not fid else int(fid), "tags": tags, "geometry": [to_ll(extent, c) for c in coords]}

    # --- names for roads: transportation_name vertices -> name, matched to transportation geometry by shared vertices
    names: dict[tuple[int, int], str] = {}
    tn = layers.get("transportation_name")
    if tn:
        for feat in tn["features"]:
            name = feat["properties"].get("name") or feat["properties"].get("name:latin") or feat["properties"].get("ref")
            if not name:
                continue
            for ln in lines(feat["geometry"]):
                for c in ln:
                    names[(round(c[0]), round(c[1]))] = name
    tr = layers.get("transportation")
    major = {"motorway", "trunk", "primary", "secondary"}
    if tr:
        ext = tr["extent"]
        for i, feat in enumerate(tr["features"]):
            props = feat["properties"]
            cls = props.get("class")
            hw = ROAD_CLASS.get(cls)
            if not hw or (tier == "district" and cls not in major):
                continue
            if props.get("brunnel") == "tunnel" and tier == "street":
                pass
            for j, ln in enumerate(lines(feat["geometry"])):
                if len(ln) < 2:
                    continue
                found: dict[str, int] = {}
                for c in ln:
                    n = names.get((round(c[0]), round(c[1])))
                    if n:
                        found[n] = found.get(n, 0) + 1
                tags: dict[str, Any] = {"highway": hw}
                if found:
                    tags["name"] = max(found, key=found.get)
                if props.get("oneway") == 1:
                    tags["oneway"] = "yes"
                if props.get("ramp") == 1 and hw in ("motorway", "trunk", "primary", "secondary"):
                    tags["highway"] = hw + "_link"
                out.append(way("transportation", i * 10 + j, feat, ln, ext, tags))
    if tier == "district":
        pl = layers.get("place")
        if pl:
            for feat in pl["features"]:
                p = point(feat["geometry"])
                cls = feat["properties"].get("class")
                name = feat["properties"].get("name") or feat["properties"].get("name:latin")
                if p and name and cls in ("city", "town", "suburb", "neighbourhood", "quarter", "village"):
                    ll = to_ll(pl["extent"], p)
                    out.append({"type": "node", "id": f"place-{feat.get('id') or name}", "lat": ll["lat"], "lon": ll["lon"], "tags": {"place": "neighbourhood" if cls == "quarter" else cls, "name": name}})
        return out
    # --- buildings
    bl = layers.get("building")
    if bl:
        ext = bl["extent"]
        for i, feat in enumerate(bl["features"]):
            props = feat["properties"]
            h = props.get("render_height")
            tags: dict[str, Any] = {"building": "yes"}
            if isinstance(h, (int, float)) and h > 0:
                tags["height"] = str(h)
            for j, ring in enumerate(rings(feat["geometry"])):
                if len(ring) >= 4:
                    out.append(way("building", i * 10 + j, feat, ring, ext, tags))
    # --- greenery: park, landcover, landuse
    for layer_name in ("park", "landcover", "landuse"):
        ly = layers.get(layer_name)
        if not ly:
            continue
        ext = ly["extent"]
        for i, feat in enumerate(ly["features"]):
            props = feat["properties"]
            key = props.get("subclass") if layer_name == "landcover" and props.get("subclass") in GREEN else props.get("class")
            tags = GREEN.get(key or "")
            if not tags:
                continue
            tags = dict(tags)
            if props.get("name"):
                tags["name"] = props["name"]
            for j, ring in enumerate(rings(feat["geometry"])):
                if len(ring) >= 4:
                    out.append(way(layer_name, i * 10 + j, feat, ring, ext, tags))
    # --- stations and the other points of interest
    poi = layers.get("poi")
    if poi:
        for feat in poi["features"]:
            props = feat["properties"]
            cls, sub = props.get("class"), props.get("subclass")
            kind = POI_KINDS.get(sub or "") or POI_KINDS.get(cls or "")
            if kind and not (cls == "railway" or (cls == "bus" and sub == "bus_station")):
                p = point(feat["geometry"])
                if p:
                    ll = to_ll(poi["extent"], p)
                    out.append({"type": "node", "id": f"poi-{feat.get('id') or len(out)}", "lat": ll["lat"], "lon": ll["lon"], "tags": {"atlas:poi": kind, "name": props.get("name") or kind.replace("_", " ")}})
                continue
            if cls == "railway" and sub in ("station", "halt", "subway", "tram_stop") or (cls == "bus" and sub == "bus_station"):
                p = point(feat["geometry"])
                if not p:
                    continue
                ll = to_ll(poi["extent"], p)
                tags = {"name": props.get("name") or "Station", "public_transport": "station"}
                if sub == "subway":
                    tags["station"] = "subway"
                if cls == "railway":
                    tags["railway"] = "station"
                out.append({"type": "node", "id": f"poi-{feat.get('id') or len(out)}", "lat": ll["lat"], "lon": ll["lon"], "tags": tags})
    return out
