"""Ground elevation of each landing site, from LOLA.

Usage: python science/site_elevation.py <ldem_75s_240m.img> <sites.json>
                                        <fine_dir> <global_tiles_dir>
                                        [--polar60 IMG] [--windows DIR]

Writes surfaceElevationM (height above the 1,737,400 m sphere, 0.1 m) and
elevationProduct into every site in sites.json. The source is the first that
covers the site:
  1. a NASA PGDA 5 m site map (GeoTIFF in fine_dir), the one whose centre is closest;
  2. LDEM_75S_240M, for sites at or south of 75 S;
  3. an SLDEM2015 window <id>.npz in --windows (from fetch_terrain.py);
  4. LDEM_60S_240M (--polar60), for sites from 75 S to 60 S;
  5. the global LOLA 16 px/degree tiles (app/assets/observer/terrain/16).
All are sampled bilinearly, with pixels registered at their centres.
"""
import argparse
import gzip
import json
from pathlib import Path

import numpy as np

import horizon as hz

PPD = 16               # global tiles: pixels per degree
TILE = 10 * PPD        # pixels per tile side (10 degree tiles)


def fine_height(folder, lat, lon):
    """(height, map name) from the closest 5 m map that contains the site, else None."""
    import rasterio
    x, y = hz.to_xy(lat, lon)
    names = {}
    for path in sorted(Path(folder).glob("*.tif")):
        with rasterio.open(path) as src:
            names[(src.bounds.left, src.bounds.top)] = path.stem
    for z, left, top, res in hz.fine_maps_near(folder, lat, lon):
        row, col = (top - y) / res - 0.5, (x - left) / res - 0.5
        if 0 <= row <= z.shape[0] - 1 and 0 <= col <= z.shape[1] - 1:
            h = float(hz.bilinear(z, np.array(row), np.array(col)))
            if np.isfinite(h):
                return h, names[(left, top)]
    return None


def global_height(folder, lat, lon):
    """Height from the 16 px/degree tiles: x = (lon+180)*16 - 0.5, y = (90-lat)*16 - 0.5."""
    lon = (lon + 180) % 360 - 180
    x, y = (lon + 180) * PPD - 0.5, (90 - lat) * PPD - 0.5
    row, col = int(y // TILE), int(x // TILE)
    ty, tx = y - row * TILE, x - col * TILE
    if not (1 <= ty <= TILE - 2 and 1 <= tx <= TILE - 2):
        raise ValueError(f"site at {lat}, {lon} is within 1 px of a tile edge")
    raw = gzip.decompress((Path(folder) / f"{row}-{col}.bin.gz").read_bytes())
    z = np.frombuffer(raw, dtype="<u2").reshape(TILE, TILE).astype(np.float64) / 2 - 10000
    return float(hz.bilinear(z, np.array(ty), np.array(tx)))


def main():
    ap = argparse.ArgumentParser()
    for name in ("ldem", "sites", "fine_dir", "tiles_dir"):
        ap.add_argument(name)
    ap.add_argument("--polar60", help="LDEM_60S_240M .img, for sites from 75 S to 60 S")
    ap.add_argument("--windows", help="folder of SLDEM2015 windows <id>.npz")
    a = ap.parse_args()
    fine_dir, tiles_dir = a.fine_dir, a.tiles_dir
    dem = hz.load_ldem(a.ldem)
    dem60 = hz.load_ldem(a.polar60) if a.polar60 else None
    path = Path(a.sites)
    sites = json.loads(path.read_text())
    out = []
    print("| id | surfaceElevationM | elevationProduct |\n|---|---|---|")
    for site in sites:
        lat, lon = site["lat"], site["lon"]
        fine = fine_height(fine_dir, lat, lon)
        if fine:
            h, product = fine[0], f"PGDA LOLA 5 m site map {fine[1]}"
        elif lat <= -75:
            h = float(hz.height_at(dem, np.array(lat), np.array(lon)))
            product = "LOLA LDEM_75S_240M (240 m)"
        elif a.windows and (Path(a.windows) / f"{site['id']}.npz").exists():
            win = hz.load_window(Path(a.windows) / f"{site['id']}.npz")
            h = float(hz.height_at(win, np.array(lat), np.array(lon)))
            product = "SLDEM2015 (237 m)"
        elif dem60 is not None and lat <= -60:
            h = float(hz.height_at(dem60, np.array(lat), np.array(lon)))
            product = "LOLA LDEM_60S_240M (240 m)"
        else:
            h = global_height(tiles_dir, lat, lon)
            product = "LOLA LDEM_16 (16 px/degree, NASA CGI Moon Kit tiles)"
        new = {}
        for key, value in site.items():
            if key in ("surfaceElevationM", "elevationProduct"):
                continue
            new[key] = value
            if key == "elevationDatum":
                new["surfaceElevationM"] = round(h, 1)
                new["elevationProduct"] = product
        if "surfaceElevationM" not in new:
            raise KeyError(f"{site['id']} has no elevationDatum to place the elevation after")
        out.append(new)
        print(f"| {site['id']} | {new['surfaceElevationM']} | {product} |")
    path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
