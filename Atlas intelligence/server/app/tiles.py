"""Web Mercator XYZ tile maths, matching web/src/geo/tiles/tiles.ts."""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class BBox:
    west: float
    south: float
    east: float
    north: float

    def overpass(self) -> str:
        return f"{self.south:.6f},{self.west:.6f},{self.north:.6f},{self.east:.6f}"


def tile_bbox(z: int, x: int, y: int) -> BBox:
    n = 2**z
    west = x / n * 360.0 - 180.0
    east = (x + 1) / n * 360.0 - 180.0
    north = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    south = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 1) / n))))
    return BBox(west, south, east, north)


def lnglat_to_tile(lng: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lng + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2.0 * n)
    return x, y


def tiles_in_bbox(b: BBox, z: int) -> list[tuple[int, int]]:
    x0, y0 = lnglat_to_tile(b.west, b.north, z)
    x1, y1 = lnglat_to_tile(b.east, b.south, z)
    return [(x, y) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
