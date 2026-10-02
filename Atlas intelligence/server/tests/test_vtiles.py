"""Vector tiles (OpenMapTiles schema) decode into the same elements as Overpass."""
import mapbox_vector_tile

from app.osm import normalize
from app.tiles import tile_bbox
from app.vtiles import decode_tile

Z, X, Y = 14, 11706, 6799  # Connaught Place


def make_tile() -> bytes:
    opts = {"extents": 4096, "y_coord_down": True}
    layers = [
        {"name": "transportation", "features": [
            {"geometry": "LINESTRING(100 2000, 2000 2000, 3900 2000)", "properties": {"class": "primary", "oneway": 1}, "id": 501},
            {"geometry": "LINESTRING(2000 100, 2000 2000, 2000 3900)", "properties": {"class": "minor"}, "id": 502},
            {"geometry": "LINESTRING(300 300, 600 600)", "properties": {"class": "path"}, "id": 503},
        ]},
        {"name": "transportation_name", "features": [{"geometry": "LINESTRING(100 2000, 2000 2000, 3900 2000)", "properties": {"name": "Janpath", "class": "primary"}}]},
        {"name": "building", "features": [{"geometry": "POLYGON((1000 1000, 1200 1000, 1200 1200, 1000 1200, 1000 1000))", "properties": {"render_height": 16}, "id": 901}]},
        {"name": "park", "features": [{"geometry": "POLYGON((2500 2500, 3000 2500, 3000 3000, 2500 3000, 2500 2500))", "properties": {"class": "park", "name": "Central Park"}}]},
        {"name": "landcover", "features": [{"geometry": "POLYGON((3200 3200, 3400 3200, 3400 3400, 3200 3400, 3200 3200))", "properties": {"class": "wood", "subclass": "forest"}}]},
        {"name": "poi", "features": [{"geometry": "POINT(2050 2050)", "properties": {"class": "railway", "subclass": "subway", "name": "Rajiv Chowk"}, "id": 77}]},
        {"name": "place", "features": [{"geometry": "POINT(1500 1500)", "properties": {"class": "suburb", "name": "Connaught Place"}}]},
    ]
    return mapbox_vector_tile.encode(layers, default_options=opts)


def test_street_tier_decodes_roads_buildings_green_and_stations():
    b = tile_bbox(Z, X, Y)
    els = decode_tile(make_tile(), b, "street")
    kinds = {(e["type"], e["tags"].get("highway") or e["tags"].get("building") or e["tags"].get("leisure") or e["tags"].get("natural") or e["tags"].get("railway")) for e in els}
    assert ("way", "primary") in kinds and ("way", "residential") in kinds and ("way", "yes") in kinds and ("way", "park") in kinds and ("way", "wood") in kinds and ("node", "station") in kinds
    assert not any(e["tags"].get("highway") is None and "building" not in e["tags"] and "leisure" not in e["tags"] and "natural" not in e["tags"] and "railway" not in e["tags"] for e in els)
    road = next(e for e in els if e["tags"].get("highway") == "primary")
    assert road["tags"]["name"] == "Janpath" and road["tags"]["oneway"] == "yes"
    # every coordinate lies inside the tile
    for e in els:
        for g in e.get("geometry", []) or [{"lat": e.get("lat"), "lon": e.get("lon")}]:
            assert b.south - 1e-6 <= g["lat"] <= b.north + 1e-6 and b.west - 1e-6 <= g["lon"] <= b.east + 1e-6
    out = normalize(els, 1000.0)
    types = {e["type"] for e in out}
    assert types == {"road", "building", "park", "transit", "path"}
    bld = next(e for e in out if e["type"] == "building")
    assert bld["properties"]["floors"] == 5 and bld["evidence"]["classification"] == "observed" and bld["evidence"]["source"] == "openstreetmap"
    park = next(e for e in out if e["properties"].get("name") == "Central Park")
    assert park["properties"]["kind"] == "park"


def test_district_tier_keeps_major_roads_and_places_only():
    els = decode_tile(make_tile(), tile_bbox(Z, X, Y), "district")
    assert {e["tags"].get("highway") for e in els if e["type"] == "way"} == {"primary"}
    assert [e["tags"]["name"] for e in els if e["type"] == "node"] == ["Connaught Place"]
