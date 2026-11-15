"""Find the sunniest landable spot near each published region centre.

Usage: python science/best_spot.py <ldem_75s_240m.img> <sites.json> <fine_dir> [--radius KM]

For every site in sites.json with a "regionCentre", search NASA's 5 m terrain
around that centre for the point with the most sunlight 2 m above the ground
(long-term average, see sunlight.py). Only points whose slope over 100 m is under
10 degrees count, NASA's landing limit for Artemis. The best point is written back
to sites.json as the site's lat/lon.

The search radius is regionCentre["searchRadiusKm"] if set, else --radius km
(default 2). If regionCentre has an "extent" ({"latMin", "latMax", "lonMin",
"lonMax"}: degrees, longitude east 0-360), every candidate must also lie inside
that latitude/longitude box.

Search: a grid with spacing 100 m x radius / 2 km scored with a coarse horizon
(every 4 degrees), then a 20 m grid within one spacing of the five best, then the
ten best re-scored at full resolution (1 degree).
"""
import argparse
import json
from pathlib import Path

import numpy as np

import horizon as hz
from sunlight import illumination, sun_directions

HEIGHT = 2.0          # observer height, m
MAX_SLOPE = 10.0      # degrees over 100 m
BASE = 50.0           # half of the 100 m slope baseline, m


def to_latlon(x, y):
    r = np.hypot(x, y)
    return np.degrees(2 * np.arctan(r / (2 * hz.R))) - 90, np.degrees(np.arctan2(x, y)) % 360


def slope(dem, fine, x, y):
    """Slope in degrees over 100 m, from heights 50 m either side in x and y."""
    h = lambda dx, dy: hz.height_at(dem, *to_latlon(np.array([x + dx]), np.array([y + dy])), fine)[0]
    gx = (h(BASE, 0) - h(-BASE, 0)) / (2 * BASE)
    gy = (h(0, BASE) - h(0, -BASE)) / (2 * BASE)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def sunlight(dem, fine, sun, x, y, step):
    lat, lon = to_latlon(x, y)
    return illumination(hz.horizon(dem, lat, lon, HEIGHT, step=step, fine=fine), lat, lon, sun)[0]


def score_grid(dem, fine, sun, points, step):
    """[(sunlight, x, y)] for points that pass the slope limit, best first."""
    scored = [(sunlight(dem, fine, sun, x, y, step), x, y)
              for x, y in points if slope(dem, fine, x, y) < MAX_SLOPE]
    return sorted(scored, reverse=True)


def disc(cx, cy, radius, spacing):
    o = np.arange(-radius, radius + spacing / 2, spacing)
    return [(cx + dx, cy + dy) for dx in o for dy in o if dx * dx + dy * dy <= radius * radius]


def inside(points, cx, cy, radius, extent):
    """Points within radius m of (cx, cy) and inside the lat/lon extent, if any."""
    points = [(x, y) for x, y in points if (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2]
    if not extent:
        return points
    lat, lon = to_latlon(np.array([x for x, _ in points]), np.array([y for _, y in points]))
    keep = ((lat >= extent["latMin"]) & (lat <= extent["latMax"])
            & (lon >= extent["lonMin"]) & (lon <= extent["lonMax"]))
    return [p for p, k in zip(points, keep) if k]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ldem")
    ap.add_argument("sites")
    ap.add_argument("fine")
    ap.add_argument("--radius", type=float, default=2.0, help="search radius, km")
    a = ap.parse_args()
    dem = hz.load_ldem(a.ldem)
    sun = sun_directions()
    sites = json.loads(Path(a.sites).read_text())
    print("| Site | Centre: sunlight, slope | Best spot: sunlight, slope | Distance |")
    print("| --- | --- | --- | --- |")
    for s in sites:
        if "regionCentre" not in s:
            continue
        c = s["regionCentre"]
        fine = hz.fine_maps_near(a.fine, c["lat"], c["lon"])
        cx, cy = hz.to_xy(c["lat"], c["lon"])
        radius = c.get("searchRadiusKm", a.radius) * 1000
        spacing = 100 * radius / 2000
        extent = c.get("extent")
        coarse = score_grid(dem, fine, sun, inside(disc(cx, cy, radius, spacing), cx, cy, radius, extent), 4)
        near = [p for _, x, y in coarse[:5] for p in disc(x, y, spacing, 20)]
        near = inside(near, cx, cy, radius, extent)
        fine_grid = score_grid(dem, fine, sun, near, 4)
        top = {(x, y) for _, x, y in (fine_grid[:10] + coarse[:5])}
        best_sun, bx, by = max((sunlight(dem, fine, sun, x, y, 1), x, y) for x, y in top)
        lat, lon = to_latlon(bx, by)
        s["lat"], s["lon"] = round(float(lat), 4), round(float(lon), 4)
        centre_sun = sunlight(dem, fine, sun, cx, cy, 1)
        print(f"| {s['name']} | {centre_sun:.1%}, {slope(dem, fine, cx, cy):.1f}° "
              f"| {best_sun:.1%}, {slope(dem, fine, bx, by):.1f}° | {np.hypot(bx - cx, by - cy):.0f} m |")
    Path(a.sites).write_text(json.dumps(sites, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
