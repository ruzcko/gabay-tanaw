"""Display terrain tiles around the polar sites, for the app's site view.

Usage: python science/make_terrain_tiles.py <ldem_75s_240m.img> <sites.json> <fine_dir> <out_dir>

For every site at or south of 75 S: a 257 x 257 grid of heights, 78.125 m apart, on the
site's tangent plane (local orthographic, x east, z south), 20 km across. Each sample is the
average of 4 x 4 points from the PGDA 5 m maps in <fine_dir> where they cover it (closest
map centre first), else LDEM_75S_240M (bilinear). Within 1 km of a 5 m map's edge the two
are blended smoothly. The centre sample is set to the site's surfaceElevationM, read from
sites.json, so rerun this after ground heights change.

Output <out_dir>/<id>.bin: Float32 little-endian heights, m above the 1737.4 km sphere,
row-major, row 0 north, column 0 west. <out_dir>/index.json lists the files and metadata.
"""
import json
import sys
from pathlib import Path

import numpy as np
import rasterio

import horizon as hz

N = 257
SPACING = 78.125   # m between samples
SUB = 4            # 5 m sub-samples per sample along each axis
BLEND = 1000.0     # width of the 5 m to 240 m blend band, m


def frame(lat, lon):
    """The site's east, north and up unit vectors."""
    la, lo = np.radians(lat), np.radians(lon)
    up = np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
    east = np.array([-np.sin(lo), np.cos(lo), 0.0])
    return east, np.cross(up, east), up


def lat_lon(site, x, z):
    """Lat, lon in degrees of the sphere point under local (x east, z south), m."""
    e, n, u = frame(site["lat"], site["lon"])
    x, z = x[..., None] / hz.R, z[..., None] / hz.R
    p = x * e - z * n + np.sqrt(1 - x * x - z * z) * u
    return np.degrees(np.arcsin(p[..., 2])), np.degrees(np.arctan2(p[..., 1], p[..., 0]))


def sample_map(z, left, top, res, x, y):
    """Bilinear heights from a 5 m map at stereographic (x, y); NaN outside it."""
    row, col = (top - y) / res - 0.5, (x - left) / res - 0.5
    inside = (row >= 0) & (row <= z.shape[0] - 1) & (col >= 0) & (col <= z.shape[1] - 1)
    out = np.full(x.shape, np.nan)
    out[inside] = hz.bilinear(z, row[inside], col[inside])
    return out


def heights(dem, folder, site):
    """Blended heights, m, plus the parts: 240 m heights, combined 5 m heights (NaN where
    uncovered), 5 m weight, and the names of the maps used."""
    axis = (np.arange(N) - N // 2) * SPACING
    X, Z = np.meshgrid(axis, axis)
    lat, lon = lat_lon(site, X, Z)
    coarse = hz.height_at(dem, lat, lon).astype(np.float64)
    cx, cy = hz.to_xy(lat, lon)

    offsets = ((np.arange(SUB) + 0.5) / SUB - 0.5) * SPACING
    ox, oz = np.meshgrid(offsets, offsets)
    slat, slon = lat_lon(site, X[..., None] + ox.ravel(), Z[..., None] + oz.ravel())
    sx, sy = hz.to_xy(slat, slon)

    site_x, site_y = hz.to_xy(site["lat"], site["lon"])
    maps = []
    for path in sorted(Path(folder).glob("*.tif")):
        with rasterio.open(path) as src:
            b = src.bounds
            if ((sx > b.left) & (sx < b.right) & (sy > b.bottom) & (sy < b.top)).any():
                dist = np.hypot((b.left + b.right) / 2 - site_x, (b.bottom + b.top) / 2 - site_y)
                maps.append((dist, path.stem, src.read(1), b, src.res[0]))
    maps.sort(key=lambda m: m[0])

    fine = np.full((N, N), np.nan)
    inside = np.zeros((N, N))             # distance inside the 5 m footprints, m
    used = []
    for _, name, z, b, res in maps:
        sub = sample_map(z, b.left, b.top, res, sx, sy)
        ok = np.isfinite(sub)
        mean = np.where(ok.any(-1), np.where(ok, sub, 0).sum(-1) / np.maximum(ok.sum(-1), 1), np.nan)
        empty = ~np.isfinite(fine) & np.isfinite(mean)
        if not empty.any():
            continue
        fine[empty] = mean[empty]
        d = np.minimum.reduce([cx - b.left, b.right - cx, cy - b.bottom, b.top - cy])
        inside = np.maximum(inside, d)
        used.append(name)
    t = np.clip(inside / BLEND, 0, 1)
    w = np.where(np.isfinite(fine), t * t * (3 - 2 * t), 0.0)
    h = np.where(w > 0, w * np.nan_to_num(fine) + (1 - w) * coarse, coarse)
    return h, coarse, fine, w, used


def main():
    ldem, sites_path, folder, out = sys.argv[1:5]
    dem = hz.load_ldem(ldem)
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    index = {"sites": {}}
    for site in json.loads(Path(sites_path).read_text()):
        if site["lat"] > -75:
            continue
        h, _, _, _, used = heights(dem, folder, site)
        raw = h[N // 2, N // 2]
        h[N // 2, N // 2] = site["surfaceElevationM"]
        path = out / f"{site['id']}.bin"
        h.astype("<f4").tofile(path)
        if used:
            source = f"PGDA LOLA 5 m ({', '.join(used)}) blended into LOLA LDEM_75S_240M"
        else:
            source = "LOLA LDEM_75S_240M"
        lon = site["lon"]
        index["sites"][site["id"]] = {
            "file": path.name, "width": N, "height": N, "spacingM": SPACING,
            "metadata": {
                "projection": "local-orthographic-east-south",
                "latitudeDeg": site["lat"],
                "longitudeEastDeg": lon - 360 if lon > 180 else lon,
                "radiusM": int(hz.R),
                "referenceFrame": site["referenceFrame"],
                "elevationDatum": site["elevationDatum"],
                "noData": None,
                "source": source,
                "license": "NASA PDS / PGDA data, public domain; credit LRO LOLA (NASA GSFC)",
            },
        }
        print(f"{site['id']:28s} {', '.join(used) or '-':20s} centre {raw:7.1f} m"
              f" vs {site['surfaceElevationM']:7.1f} m ({raw - site['surfaceElevationM']:+5.1f})"
              f"  {path.stat().st_size} bytes")
    (out / "index.json").write_text(json.dumps(index, indent=1) + "\n")


if __name__ == "__main__":
    main()
