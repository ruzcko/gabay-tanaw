"""Terrain horizon for each landing site, from LOLA elevation.

Usage: python science/horizon.py <ldem_75s_240m.img> <sites.json> <out_dir>
                                 [--fine DIR] [--polar60 IMG] [--windows DIR]
                                 [--height M] [--range KM]

For every site and every 0.25 degree of azimuth (0 = north, clockwise), cast a ray
along the Moon's surface out to --range km and keep the highest elevation angle
of the terrain, seen from --height m above the ground. Angles are measured from
the local horizontal: the plane perpendicular to the Moon's radius at the site
(sphere of 1737.4 km, no atmosphere, so no refraction).

With --fine, GeoTIFFs in DIR (NASA PGDA's 5 m site maps) replace the 240 m map
wherever they cover the ray, sampled every 5 m. Farther out the 240 m map is used.

North of 75 S: a site with an SLDEM2015 window <id>.npz in --windows (from
fetch_terrain.py) uses it; a site between 75 S and 60 S uses the LDEM_60S_240M map
given with --polar60. Sites with neither get a smooth-sphere horizon, flagged with
"terrain": "smooth".
"""
import argparse
import json
from pathlib import Path

import numpy as np

R = 1737400.0          # reference sphere radius, m
PIX = 240.0            # m per pixel of the polar maps
DS = 60.0              # ray sample spacing on the 240 m map, m
FINE_DS = 5.0          # ray sample spacing on 5 m maps, m
FINE_MAX = 23000.0     # 5 m maps are at most ~21 km across, so this covers them


def load_ldem(path):
    """Heights above the 1737.4 km sphere, m (int16 LSB x 0.5), N x N with the pole
    at the centre: N = 3812 for LDEM_75S_240M, 7760 for LDEM_60S_240M."""
    z = np.fromfile(path, dtype="<i2")
    n = int(round(np.sqrt(z.size)))
    if n not in (3812, 7760) or n*n != z.size:
        raise ValueError("Expected the labelled 75S or 60S 240 m polar product")
    return z.reshape(n, n).astype(np.float32) * 0.5


def load_window(path):
    """An SLDEM2015 window from fetch_terrain.py: heights, m, on a lat/lon grid."""
    with np.load(path) as f:
        win = {"z": f["z"], "lat0": float(f["lat0"]), "lon0": float(f["lon0"]),
                "step": float(f["step"])}
        if (win["z"].ndim != 2 or min(win["z"].shape) < 2 or not np.isfinite(win["z"]).all()
                or win["step"] != 1/128 or not np.isfinite([win["lat0"], win["lon0"]]).all()):
            raise ValueError("Invalid SLDEM2015 window")
        return win


def window_height(win, lat, lon):
    """Bilinear height from a window; rows run south from lat0, columns east from lon0."""
    row = (win["lat0"] - lat) / win["step"]
    col = ((lon - win["lon0"]) % 360) / win["step"]
    rows, cols = win["z"].shape
    if np.any((row < 0) | (row > rows - 1) | (col > cols - 1)):
        raise ValueError("ray leaves the SLDEM2015 window; use a shorter range")
    return bilinear(win["z"], row, col)


def to_xy(lat, lon):
    """South polar stereographic metres: x east at lon 90, y towards lon 0."""
    r = 2 * R * np.tan(np.pi / 4 + np.radians(lat) / 2)
    return r * np.sin(np.radians(lon)), r * np.cos(np.radians(lon))


def bilinear(z, row, col):
    r0 = np.clip(np.floor(row).astype(int), 0, z.shape[0] - 2)
    c0 = np.clip(np.floor(col).astype(int), 0, z.shape[1] - 2)
    fr, fc = row - r0, col - c0
    return ((z[r0, c0] * (1 - fc) + z[r0, c0 + 1] * fc) * (1 - fr)
            + (z[r0 + 1, c0] * (1 - fc) + z[r0 + 1, c0 + 1] * fc) * fr)


def fine_maps_near(folder, lat, lon):
    """5 m maps within FINE_MAX of the site, closest first: (heights, left, top, res)."""
    if not folder:
        return []
    import rasterio
    x, y = to_xy(lat, lon)
    found = []
    for path in sorted(Path(folder).glob("*.tif")):
        with rasterio.open(path) as src:
            b = src.bounds
            gap = np.hypot(max(b.left - x, 0, x - b.right), max(b.bottom - y, 0, y - b.top))
            if gap < FINE_MAX:
                dist = np.hypot((b.left + b.right) / 2 - x, (b.bottom + b.top) / 2 - y)
                found.append((dist, src.read(1), b.left, b.top, src.res[0]))
    return [m[1:] for m in sorted(found, key=lambda m: m[0])]


def height_at(dem, lat, lon, fine=()):
    """Height at (lat, lon) in degrees: from the 5 m maps where they cover it, else
    from dem (a polar map, or an SLDEM2015 window from load_window)."""
    if callable(getattr(dem, "sample", None)):
        return dem.sample(lat, lon)
    if isinstance(dem, dict):
        return window_height(dem, lat, lon)
    n = dem.shape[0]
    center = n / 2 - 0.5                        # pole, 0-based pixel centres
    x, y = to_xy(lat, lon)
    row, col = -y / PIX + center, x / PIX + center
    if np.any((row < 0) | (row > n - 1) | (col < 0) | (col > n - 1)):
        raise ValueError("ray leaves the polar map; use a shorter range")
    h = bilinear(dem, row, col)
    todo = np.ones(np.shape(h), bool)
    for z, left, top, res in fine:
        row, col = (top - y) / res - 0.5, (x - left) / res - 0.5
        inside = todo & (row >= 0) & (row <= z.shape[0] - 1) & (col >= 0) & (col <= z.shape[1] - 1)
        v = bilinear(z, row[inside], col[inside])
        ok = np.isfinite(v)
        idx = tuple(i[ok] for i in np.nonzero(inside))
        h[idx] = v[ok]
        todo[idx] = False
    return h


def horizon(dem, lat, lon, height=2.0, range_km=150.0, step=1.0, start_m=0.0, fine=()):
    """Max terrain elevation angle (degrees) for azimuths 0, step, ... < 360.
    start_m skips terrain closer than that (only used to test sensitivity)."""
    az = np.radians(np.arange(0, 360, step))[:, None]
    end = range_km * 1000 + DS / 2
    if fine:
        s = np.concatenate([np.arange(FINE_DS, FINE_MAX, FINE_DS), np.arange(FINE_MAX, end, DS)])
    else:
        s = np.arange(DS, end, DS)
    s = s[s >= start_m][None, :]
    d = s / R                                   # angular distance along the surface
    p1, l1 = np.radians(lat), np.radians(lon)
    # A ray reaching a pole can exceed the sine domain by floating-point roundoff.
    sin_p2 = np.sin(p1) * np.cos(d) + np.cos(p1) * np.sin(d) * np.cos(az)
    p2 = np.arcsin(np.clip(sin_p2, -1., 1.))
    l2 = l1 + np.arctan2(np.sin(az) * np.sin(d) * np.cos(p1),
                         np.cos(d) - np.sin(p1) * np.sin(p2))
    target = R + height_at(dem, np.degrees(p2), np.degrees(l2), fine)
    eye = R + height_at(dem, np.array([lat]), np.array([lon]), fine)[0] + height
    # Target in the observer's local frame: horizontal and vertical offsets.
    elev = np.degrees(np.arctan2(target * np.cos(d) - eye, target * np.sin(d)))
    return elev.max(axis=1)


def smooth_horizon(height=2.0, step=1.0):
    """Horizon dip of a smooth sphere seen from height above the ground."""
    dip = -np.degrees(np.arccos(R / (R + height)))
    return np.full(int(360 / step), dip)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ldem")
    ap.add_argument("sites")
    ap.add_argument("out")
    ap.add_argument("--fine", help="folder of 5 m site GeoTIFFs")
    ap.add_argument("--polar60", help="LDEM_60S_240M .img, for sites from 75 S to 60 S")
    ap.add_argument("--windows", help="folder of SLDEM2015 windows <id>.npz")
    ap.add_argument("--require-terrain", action="store_true", help="fail if any site lacks a terrain product")
    ap.add_argument("--height", type=float, default=2.0, help="observer height, m")
    ap.add_argument("--range", type=float, default=150.0, help="ray length, km")
    ap.add_argument("--step", type=float, choices=(0.25, 0.5, 1.0), default=0.25,
                    help="scientific azimuth grid; display profile remains at 1 degree")
    a = ap.parse_args()
    if not np.isfinite(a.height) or not 0 <= a.height <= 100000:
        ap.error("observer height must be finite and between 0 and 100000 m")
    if not np.isfinite(a.range) or a.range < FINE_MAX / 1000:
        ap.error("ray range must be finite and at least 23 km")
    dem = load_ldem(a.ldem)
    dem60 = load_ldem(a.polar60) if a.polar60 else None
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for site in json.loads(Path(a.sites).read_text(encoding="utf-8")):
        if site.get("referenceFrame") != "MOON_ME_DE421" or site.get("elevationDatum") != "sphere-1737400m":
            raise ValueError(f"{site['id']}: unsupported site frame/datum")
        if site["lat"] <= -75:
            fine = fine_maps_near(a.fine, site["lat"], site["lon"])
            elev = horizon(dem, site["lat"], site["lon"], a.height, a.range, step=a.step, fine=fine)
            ground = float(height_at(dem, np.array([site["lat"]]), np.array([site["lon"]]), fine)[0])
            terrain = "LOLA 5 m + 240 m" if fine else "LOLA 240 m"
        elif a.windows and (Path(a.windows) / f"{site['id']}.npz").exists():
            win = load_window(Path(a.windows) / f"{site['id']}.npz")
            elev = horizon(win, site["lat"], site["lon"], a.height, a.range, step=a.step)
            ground = float(height_at(win, np.array([site["lat"]]), np.array([site["lon"]]))[0])
            terrain = "SLDEM2015 237 m"
        elif dem60 is not None and site["lat"] <= -60:
            elev = horizon(dem60, site["lat"], site["lon"], a.height, a.range, step=a.step)
            ground = float(height_at(dem60, np.array([site["lat"]]), np.array([site["lon"]]))[0])
            terrain = "LOLA 240 m (60S map)"
        else:
            if a.require_terrain:
                raise ValueError(f"{site['id']}: missing terrain; refusing smooth fallback")
            elev, terrain = smooth_horizon(a.height, a.step), "smooth"
            ground = 0.0  # Explicit modeled sphere; catalog elevation is not substituted.
        if not np.isfinite(ground) or not np.isfinite(elev).all() or len(elev) != int(360/a.step):
            raise ValueError(f"{site['id']}: invalid computed terrain")
        result = {
            "id": site["id"],
            "lat": site["lat"], "lon": site["lon"],
            "referenceFrame": site["referenceFrame"],
            "datum": "sphere-1737400m",
            "surfaceElevation": ground,
            "observerHeight": a.height,
            "step": 1,
            "terrain": terrain,
            "elevations": [round(float(e), 2) for e in elev[::int(1/a.step)]],
            "calculation": {"step": a.step, "elevations": elev.tolist()},
        }
        (out / f"{site['id']}.json").write_text(json.dumps(result) + "\n")
        print(f"{site['id']:28s} {terrain:20s} max {elev.max():6.2f}  min {elev.min():6.2f}  mean {elev.mean():6.2f}")


if __name__ == "__main__":
    main()
