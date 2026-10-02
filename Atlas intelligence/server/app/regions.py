"""Regions the server knows. Mirrors web/src/app/regions.ts."""
REGIONS = {
    "ncr": {"id": "ncr", "name": "Delhi NCR", "origin": {"lng": 77.2167, "lat": 28.6315},
            "bbox": {"west": 76.80, "south": 28.25, "east": 77.65, "north": 28.90}, "source": "osm", "seed": "ncr-2026",
            "timezone": "Asia/Kolkata"},
    "bengaluru": {"id": "bengaluru", "name": "Bengaluru demo", "origin": {"lng": 77.6101, "lat": 12.9719},
                  "bbox": {"west": 77.45, "south": 12.85, "east": 77.75, "north": 13.10}, "source": "procedural", "seed": "bengaluru-2026",
                  "timezone": "Asia/Kolkata"},
}
