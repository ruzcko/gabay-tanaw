"""Daily Sun and Earth hours on a small grid of points around each polar site.

Usage: python science/make_grids.py <ldem_75s_240m.img> <sites.json> <fine_dir> <cache_dir> <out_dir>

For every site at or south of 75 S: 5 x 5 points 500 m apart on the site's tangent
plane, i = -2..2 east, j = -2..2 north, (0, 0) = the site. Each point gets its own
ground height, slope over 100 m, terrain horizon and daily hours of Sun and Earth
over the forecast year. The horizon uses the same 0.25 degree grid as the forecasts.

Sun and Earth come from the site's cached Horizons samples in cache_dir (made by
fetch_ephemeris.py, read as build_forecast.py reads them), turned from the cache's
observer position into each point's own east/north/up axes. Parallax over the offset
is ignored.

Writes out_dir/index.json and out_dir/<id>.json.
"""
import gzip
import json
import re
import sys
from datetime import timedelta
from pathlib import Path

import numpy as np

import horizon as hz
from best_spot import slope
from build_forecast import chunks, hours_in, mask_at, read_table, up_intervals

N = 5                 # points per side
SPACING = 500.0       # m between points
STEP = 0.25           # horizon azimuth step, degrees
DAY = timedelta(days=1)


def axes(lat, lon):
    """East, north and up unit vectors (Moon-fixed) at lat, lon in degrees."""
    p, l = np.radians(lat), np.radians(lon)
    return (np.array([-np.sin(l), np.cos(l), 0.0]),
            np.array([-np.sin(p) * np.cos(l), -np.sin(p) * np.sin(l), np.cos(p)]),
            np.array([np.cos(p) * np.cos(l), np.cos(p) * np.sin(l), np.sin(p)]))


def grid_point(site, i, j):
    """Lat, lon of the point i * 500 m east and j * 500 m north on the site's tangent plane."""
    if i == j == 0:
        return site["lat"], site["lon"]
    east, north, up = axes(site["lat"], site["lon"])
    x, y = SPACING * i / hz.R, SPACING * j / hz.R
    u = x * east + y * north + np.sqrt(1 - x * x - y * y) * up
    return float(np.degrees(np.arcsin(u[2]))), float(np.degrees(np.arctan2(u[1], u[0])) % 360)


def sky(cache, site_id):
    """Sample times, the site's Sun and Earth (azimuth, elevation) arrays, and the
    observer's (lat, lon) as the cached responses state it."""
    times, sky, observers = None, {}, set()
    for body in ("sun", "earth"):
        paths = chunks(cache, site_id, body)
        t, az, el, _, _ = read_table(paths)
        if times is not None and t != times:
            raise ValueError(f"{site_id}: Sun and Earth tables have different times")
        times, sky[body] = t, (np.array(az), np.array(el))
        for path in paths:
            with gzip.open(path, "rt") as f:
                lon, lat = re.search(r"Center geodetic : *([-\d.E]+), *([-\d.E]+)", f.read()).groups()
            observers.add((float(lat), float(lon)))
    if len(observers) != 1:
        raise ValueError(f"{site_id}: cached responses disagree on the observer")
    return times, sky, observers.pop()


def turn(az, el, site_axes, point_axes):
    """Directions given as az/el in the site's axes, as az/el in the point's axes."""
    a, h = np.radians(az), np.radians(el)
    e, n, u = site_axes
    d = (np.outer(np.cos(h) * np.sin(a), e) + np.outer(np.cos(h) * np.cos(a), n)
         + np.outer(np.sin(h), u))
    e, n, u = point_axes
    return np.degrees(np.arctan2(d @ e, d @ n)) % 360, np.degrees(np.arcsin(np.clip(d @ u, -1, 1)))


def daily_hours(times, az, el, mask, days):
    """Hours per UTC day that the body's centre clears the horizon mask."""
    spans = up_intervals(times, [e - mask_at(mask, a) for a, e in zip(az.tolist(), el.tolist())])
    return [hours_in(spans, d0, d0 + DAY) for d0 in days]


def point(dem, fine_dir, site, i, j, times, days, sky, observer):
    lat, lon = grid_point(site, i, j)
    fine = hz.fine_maps_near(fine_dir, lat, lon)
    ground = float(hz.height_at(dem, np.array([lat]), np.array([lon]), fine)[0])
    mask = hz.horizon(dem, lat, lon, 2.0, 150.0, step=STEP, fine=fine).tolist()
    frames = axes(*observer), axes(lat, lon)
    out = {"i": i, "j": j, "lat": round(lat, 5), "lon": round(lon, 5), "groundM": round(ground, 1),
           "slopeDeg": round(float(slope(dem, fine, *hz.to_xy(lat, lon))), 1)}
    hours = {}
    for body in ("sun", "earth"):
        az, el = sky[body] if observer == (lat, lon) else turn(*sky[body], *frames)
        hours[body] = daily_hours(times, az, el, mask, days)
        out[f"{body}Pct"] = round(100 * sum(hours[body]) / (len(days) * 24), 1)
    for body in ("sun", "earth"):
        out[f"{body}Hours"] = [round(h, 1) for h in hours[body]]
    return out


def main(ldem, sites_path, fine_dir, cache_dir, out_dir):
    dem = hz.load_ldem(ldem)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    index = {"spacingM": int(SPACING), "n": N, "start": None, "days": None, "sites": {}}
    for site in json.loads(Path(sites_path).read_text(encoding="utf-8")):
        if site["lat"] > -75:
            continue
        times, sky_, observer = sky(Path(cache_dir), site["id"])
        days = [times[0] + k * DAY for k in range(int((times[-1] - times[0]) / DAY))]
        points = [point(dem, fine_dir, site, i, j, times, days, sky_, observer)
                  for j in range(N // 2, -(N // 2) - 1, -1) for i in range(-(N // 2), N // 2 + 1)]
        (out / f"{site['id']}.json").write_text(
            json.dumps({"id": site["id"], "points": points}, separators=(",", ":")) + "\n")
        index.update(start=times[0].strftime("%Y-%m-%d"), days=len(days))
        index["sites"][site["id"]] = f"{site['id']}.json"
        centre = points[len(points) // 2]
        print(f"{site['id']:28s} centre sun {centre['sunPct']}%, earth {centre['earthPct']}%", flush=True)
    (out / "index.json").write_text(json.dumps(index, indent=2) + "\n")


if __name__ == "__main__":
    main(*sys.argv[1:])
