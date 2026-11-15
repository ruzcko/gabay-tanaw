"""Compare sunlight from our horizon masks with NASA PGDA's polar illumination maps.

Usage: python science/validate.py <ldem_75s_240m.img> <sites.json> [fine_dir]

fine_dir: NASA PGDA 5 m site maps, for the last two tables.

PGDA's AVGVISIB maps (Mazarico et al. 2011, https://pgda.gsfc.nasa.gov/products/69)
give the visible fraction of the Sun's disc, averaged hourly over 18.6 years, at
each map pixel. We rebuild the same number from our horizons (see sunlight.py).

PGDA pixels are read over HTTP (a few tiles per site) with rasterio.
Prints markdown tables.
"""
import json
import sys

import numpy as np
import rasterio
from rasterio.windows import Window, from_bounds

import horizon as hz
from sunlight import illumination, sun_directions

PGDA = "/vsicurl/https://pgda.gsfc.nasa.gov/data/MoonIllumination/"
MAP_240 = PGDA + "AVGVISIB_65S_240M_201608.TIF"
MAP_60 = PGDA + "AVGVISIB_85S_060M_201608.TIF"

# Mazarico et al. 2011 (240 m LOLA terrain, ground level), Table 3 as listed in
# Gläser et al. 2018, Table 1: (label, lat, lon, average illumination)
MAZARICO = [("Connecting Ridge", -89.45, 222.69, 0.890), ("Shackleton rim", -89.78, 204.27, 0.867)]

# Gläser et al. 2018 (20 m LOLA terrain, hourly 2017-2037), Tables 1 and 2:
# (label, lat, lon, observer height m, average illumination, Sun at least partly up)
GLASER = [
    ("Connecting Ridge C1", -89.4505, 222.84, 0, 0.760, 0.813),
    ("Connecting Ridge C2", -89.3157, 245.94, 0, 0.756, 0.806),
    ("Shackleton rim", -89.7849, 203.97, 0, 0.810, 0.855),
    ("Connecting Ridge C1", -89.4398, 222.83, 2, 0.880, 0.921),
    ("Connecting Ridge C2", -89.3130, 245.98, 2, 0.781, 0.820),
    ("Shackleton rim", -89.6866, 197.19, 2, 0.855, 0.894),
    ("Shackleton rim", -89.7815, 204.70, 2, 0.821, 0.898),
]


def pgda_patch(src, lat, lon, half=1):
    """PGDA 240 m pixels around a site, and the transform of that patch."""
    row, col = src.index(*hz.to_xy(lat, lon))
    win = Window(col - half, row - half, 2 * half + 1, 2 * half + 1)
    return src.read(1, window=win).astype(float) * src.scales[0], src.window_transform(win)


def pixel_latlon(transform, row, col):
    x, y = transform * (col + 0.5, row + 0.5)
    r = np.hypot(x, y)
    return np.degrees(2 * np.arctan(r / (2 * hz.R))) - 90, np.degrees(np.arctan2(x, y)) % 360


def main():
    dem = hz.load_ldem(sys.argv[1])
    sites = [s for s in json.load(open(sys.argv[2])) if s["lat"] <= -75]
    sun = sun_directions()
    src240, src60 = rasterio.open(MAP_240), rasterio.open(MAP_60)

    print("| Site | PGDA 240 m | Ours, same pixel | Diff | PGDA 60 m, mean (max) in that pixel | Ours at site, 2 m, 240 m only | Sun partly up, same |")
    print("| --- | --- | --- | --- | --- | --- | --- |")
    ours_all, pgda_all, centres = [], [], []
    for s in sites:
        patch, tr = pgda_patch(src240, s["lat"], s["lon"])
        ours = np.zeros_like(patch)
        for i in range(3):
            for j in range(3):
                la, lo = pixel_latlon(tr, i, j)
                ours[i, j] = illumination(hz.horizon(dem, la, lo, 0.0), la, lo, sun)[0]
        ours_all.append(ours)
        pgda_all.append(patch)
        centres.append(pixel_latlon(tr, 1, 1))
        p60 = "-"
        if s["lat"] <= -85:
            x0, y1 = tr * (1, 1)
            block = src60.read(1, window=from_bounds(x0, y1 - 240, x0 + 240, y1, src60.transform))
            block = block.astype(float) * src60.scales[0]
            p60 = f"{block.mean():.1%} ({block.max():.1%})"
        avg, up = illumination(hz.horizon(dem, s["lat"], s["lon"], 2.0), s["lat"], s["lon"], sun)
        print(f"| {s['name']} | {patch[1, 1]:.1%} | {ours[1, 1]:.1%} | {ours[1, 1] - patch[1, 1]:+.1%} "
              f"| {p60} | {avg:.1%} | {up:.1%} |")

    o, p = np.ravel(ours_all), np.ravel(pgda_all)
    d = o - p
    print(f"\nAll {d.size} pixels of the 3 x 3 patches: mean diff {d.mean():+.1%}, "
          f"mean |diff| {np.abs(d).mean():.1%}, max |diff| {np.abs(d).max():.1%}, "
          f"correlation {np.corrcoef(o, p)[0, 1]:.2f}")

    print("\nAgainst Mazarico et al. 2011 (240 m terrain, ground level), at their published points")
    print("\n| Point | Mazarico 2011 | PGDA map 2016, that pixel | Ours, that pixel |")
    print("| --- | --- | --- | --- |")
    for label, la, lo, m in MAZARICO:
        patch, tr = pgda_patch(src240, la, lo, 0)
        pla, plo = pixel_latlon(tr, 0, 0)
        ours = illumination(hz.horizon(dem, pla, plo, 0.0), pla, plo, sun)[0]
        print(f"| {label} ({la}, {lo}) | {m:.1%} | {patch[0, 0]:.1%} | {ours:.1%} |")

    print("\nNear-field sensitivity (site pixel, ground level): mean diff vs PGDA 240 m")
    for start in (60, 240, 480, 1000):
        dd = []
        for s, (la, lo) in zip(sites, centres):
            p = pgda_patch(src240, s["lat"], s["lon"], 0)[0][0, 0]
            dd.append(illumination(hz.horizon(dem, la, lo, 0.0, start_m=start), la, lo, sun)[0] - p)
        print(f"  ignore terrain closer than {start:4d} m: mean {np.mean(dd):+.1%}, mean |diff| {np.mean(np.abs(dd)):.1%}")

    print("\nRange sensitivity (site, 2 m): 150 km vs 300 km")
    for s in sites:
        r_km = np.hypot(*hz.to_xy(s["lat"], s["lon"])) / 1000
        if r_km + 300 < dem.shape[0] * hz.PIX / 2000:
            a = illumination(hz.horizon(dem, s["lat"], s["lon"], 2.0, 150), s["lat"], s["lon"], sun)[0]
            b = illumination(hz.horizon(dem, s["lat"], s["lon"], 2.0, 300), s["lat"], s["lon"], sun)[0]
            print(f"  {s['name']:28s} {a:.1%} vs {b:.1%}")

    if len(sys.argv) < 4:
        return
    fine_dir = sys.argv[3]

    print("\nAgainst Gläser et al. 2018 (20 m terrain), at their published points")
    print("\n| Point | Height | Gläser 20 m | Ours 240 m | Ours 5 m + 240 m | Sun partly up: Gläser / ours 5 m |")
    print("| --- | --- | --- | --- | --- | --- |")
    for label, la, lo, h, g_avg, g_up in GLASER:
        fine = hz.fine_maps_near(fine_dir, la, lo)
        coarse = illumination(hz.horizon(dem, la, lo, h), la, lo, sun)[0]
        avg, up = illumination(hz.horizon(dem, la, lo, h, fine=fine), la, lo, sun)
        print(f"| {label} ({la}, {lo}) | {h} m | {g_avg:.1%} | {coarse:.1%} | {avg:.1%} | {g_up:.1%} / {up:.1%} |")

    print("\nWhat the app uses: each site, 2 m above the ground")
    print("\n| Site | 240 m only | 5 m + 240 m | Sun partly up, 5 m + 240 m |")
    print("| --- | --- | --- | --- |")
    for s in sites:
        fine = hz.fine_maps_near(fine_dir, s["lat"], s["lon"])
        if not fine:
            continue
        coarse = illumination(hz.horizon(dem, s["lat"], s["lon"], 2.0), s["lat"], s["lon"], sun)[0]
        avg, up = illumination(hz.horizon(dem, s["lat"], s["lon"], 2.0, fine=fine), s["lat"], s["lon"], sun)
        print(f"| {s['name']} | {coarse:.1%} | {avg:.1%} | {up:.1%} |")

    print("\nDerived spots (best_spot.py): is the spot a single lucky point?")
    print("\n| Site | Ours at spot, 2 m | Ours 20 m around it: min to max (8 points) | PGDA 60 m pixel, ground level |")
    print("| --- | --- | --- | --- |")
    for s in sites:
        if "regionCentre" not in s:
            continue
        fine = hz.fine_maps_near(fine_dir, s["lat"], s["lon"])
        x, y = hz.to_xy(s["lat"], s["lon"])
        ring = []
        for a in np.radians(np.arange(0, 360, 45)):
            r = np.hypot(x + 20 * np.sin(a), y + 20 * np.cos(a))
            la = np.degrees(2 * np.arctan(r / (2 * hz.R))) - 90
            lo = np.degrees(np.arctan2(x + 20 * np.sin(a), y + 20 * np.cos(a))) % 360
            ring.append(illumination(hz.horizon(dem, la, lo, 2.0, fine=fine), la, lo, sun)[0])
        avg = illumination(hz.horizon(dem, s["lat"], s["lon"], 2.0, fine=fine), s["lat"], s["lon"], sun)[0]
        p60 = "-"
        if s["lat"] <= -85:
            p60 = f"{pgda_patch(src60, s['lat'], s['lon'], 0)[0][0, 0]:.1%}"
        print(f"| {s['name']} | {avg:.1%} | {min(ring):.1%} to {max(ring):.1%} | {p60} |")


if __name__ == "__main__":
    main()
