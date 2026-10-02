"""Regions the server knows. Mirrors web/src/app/regions.ts."""
REGIONS = {
    "india": {"id": "india", "name": "India", "origin": {"lng": 77.2167, "lat": 28.6315},
            "bbox": {"west": 68.1, "south": 6.5, "east": 97.4, "north": 35.7}, "source": "osm", "seed": "india-2026",
            "timezone": "Asia/Kolkata"},
}
REGIONS["ncr"] = REGIONS["india"]  # older links
