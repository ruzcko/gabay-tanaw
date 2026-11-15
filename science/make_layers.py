"""Map layers for the whole Moon: slope, sunlight and permanent shadow, as value textures.

Usage: python science/make_layers.py <ldem_75s_240m.img> <pgda_illum_dir> <pgda_5mpp_dir> <app_dir>

Inputs:
- <ldem_75s_240m.img>: LOLA LDEM_75S_240M (south polar stereographic, 240 m).
- <pgda_illum_dir>: NASA PGDA's AVGVISIB_65S_240M_201608.TIF, AVGVISIB_65N_240M_201608.TIF
  and AVGVISIB_85S_060M_201608.TIF (Mazarico et al. 2011): per cell, the average visible
  fraction of the Sun's disc at ground level over 18.6 years, int16 x 4e-5, -32768 = no data.
  A cell of 0 is never sunlit. The build stops before writing anything if one is missing.
- <pgda_5mpp_dir>: PGDA 5 m south polar height maps (Barker et al. 2021).
- <app_dir>: the app folder. Reads data/sites.json, data/terrain/ (polar site tiles),
  assets/observer/terrain/16/ (LOLA global heights, 16 px/degree, 10 degree tiles) and
  assets/observer/terrain/catalog/ (the other site tiles). Writes data/layers/.

Globe textures (8-bit grey PNG):
- slope-global.png, 2880 x 1440: equirectangular, 8 px/degree (row 0 north, column 0 at
  lon -180). Slope at each sample of the 16 px/degree grid from heights 1.9 km north,
  south, east and west of it along the surface (bilinear), so over one 3.79 km baseline
  in both directions at every latitude. Each pixel is the mean in degrees of 2 x 2 samples.
- slope-south.png, 2048 x 2048: the LDEM_75S_240M grid (south polar stereographic, lon 0
  towards the top, +-457,440 m), slope by central differences at 240 m (480 m baseline),
  corrected for the map's scale factor, box-averaged in degrees.
- sunlight-<pole>.png and shadow-<pole>.png, 2048 x 2048: the 240 m AVGVISIB map's own
  extent (+-770,400 m, the 65 degree cap) reduced by an area-weighted mean. Sunlight in whole
  percent 0-100; shadow 1 where at least half of the valid 240 m cells are 0, else 0.
Slope bands: 0 under 5 degrees, 1 5-10, 2 10-20, 3 20 and over.

Site tiles (sites/<id>.png, 257 x 257 RGB), pixel for pixel on each site's terrain grid
(78.125 m apart, row 0 north, column 0 west, centred on the site):
- Sites with a tile in data/terrain (south of 75 S): R slope band over 100 m, from heights
  50 m east, west, north and south of each point, all four from one PGDA 5 m map when one
  covers them all, else from LDEM_75S_240M.
- Sites with a tile in the observer catalog: R slope band from the tile's own heights by
  central differences over 3 samples each way (468.75 m baseline, about twice the source's
  ~240 m cells); the outer 3 rows and columns have no data.
- G: sunlight in percent from the AVGVISIB cell containing the point: the 60 m map when it
  covers the whole tile, else the 240 m map of the site's pole. Sites between 65 S and 65 N
  have no published map: G and B are no data.
- B: 1 where that cell is 0 (permanently shadowed), else 0.

255 means no data in every texture and channel. index.json describes the layout.
"""
import gzip
import json
import sys
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import horizon as hz  # noqa: E402
from make_terrain_tiles import N as TILE_N, SPACING, lat_lon  # noqa: E402

R = hz.R
OUT = 2048                        # polar texture size, px
HALF = 3812 * hz.PIX / 2          # LDEM_75S_240M half extent, 457,440 m
CAP_HALF = 770400.0               # AVGVISIB 240 m half extent (the 65 degree cap), m
CAP_N = 6420                      # AVGVISIB 240 m size, px
SCALE = 4e-5                      # AVGVISIB value to fraction
NODATA_IN = -32768
NODATA = 255
BANDS = (5.0, 10.0, 20.0)         # slope band edges, degrees
BASE = 50.0                       # half of the 100 m polar site slope baseline, m
CAT_K = 3                         # catalog site slope: samples each way
PPD = 16                          # global grid, px per degree
GW, GH = 360 * PPD, 180 * PPD
GLOBE_W, GLOBE_H = GW // 2, GH // 2   # slope-global.png size, px
STEP = np.pi * R / (180 * PPD)    # north-south sample spacing of the global grid, 1895.3 m
MAPS_240 = {"south": "AVGVISIB_65S_240M_201608.TIF", "north": "AVGVISIB_65N_240M_201608.TIF"}
MAP_60 = "AVGVISIB_85S_060M_201608.TIF"
PROJ = {"south": "+proj=stere +lat_0=-90 +lon_0=0 +R=1737400 +units=m",
        "north": "+proj=stere +lat_0=90 +lon_0=0 +R=1737400 +units=m"}
TERRAIN = "../terrain/index.json"
COVERAGE = ("Complete from 65° to each pole; the corners of each square reach about 55° where the "
            "map has values. Between 65° S and 65° N there is no published map.")
CATALOG = "../../assets/observer/terrain/catalog/index.json"


def band(slope):
    return np.searchsorted(BANDS, slope, side="right").astype(np.uint8)


def box(a, out=OUT):
    """Area-weighted mean of a square n x n grid onto an out x out grid: each source cell
    counts by the share of its width and height inside the output pixel."""
    s = a.shape[0] / out
    edges = np.arange(out + 1) * s
    cells = np.arange(a.shape[0])
    m = np.clip(np.minimum(cells + 1, edges[1:, None]) - np.maximum(cells, edges[:-1, None]), 0, None)
    m /= m.sum(1, keepdims=True)
    return m @ a.astype(np.float64) @ m.T


def polar_xy(lat, lon, pole):
    """Polar stereographic metres (sphere R, scale 1 at the pole). South: lon 0 at +y.
    North: lon 180 at +y. Both: lon 90 E at +x."""
    la, lo = np.radians(lat), np.radians(lon)
    if pole == "south":
        r = 2 * R * np.tan(np.pi / 4 + la / 2)
        return r * np.sin(lo), r * np.cos(lo)
    r = 2 * R * np.tan(np.pi / 4 - la / 2)
    return r * np.sin(lo), -r * np.cos(lo)


# --- Globe slope ---------------------------------------------------------------------

def load_global(folder):
    """The 16 px/degree heights, m, as one GH x GW grid: row 0 north, column 0 at lon -180,
    pixel centres at lat 90 - (row + 0.5)/16, lon -180 + (col + 0.5)/16."""
    folder = Path(folder)
    man = json.loads((folder.parent / "manifest.json").read_text())
    if (man["tileDegrees"] != 10 or PPD not in man["levels"]
            or man["encoding"] != "gzip uint16 little-endian; metres = value / 2 - 10000"):
        raise ValueError("observer terrain tiles changed layout")
    side = 10 * PPD
    g = np.empty((GH, GW), np.float32)
    for i in range(18):
        for j in range(36):
            raw = gzip.decompress((folder / f"{i}-{j}.bin.gz").read_bytes())
            g[i * side:(i + 1) * side, j * side:(j + 1) * side] = (
                np.frombuffer(raw, "<u2").reshape(side, side) / 2 - 10000)
    return g


def global_height(g, lat, lon):
    """Bilinear height at (lat, lon), wrapping in longitude."""
    row = np.clip((90 - lat) * PPD - 0.5, 0, GH - 1)
    col = ((lon + 180) * PPD - 0.5) % GW
    r0 = np.minimum(np.floor(row).astype(int), GH - 2)
    c0 = np.floor(col).astype(int) % GW
    c1 = (c0 + 1) % GW
    fr, fc = row - r0, col - np.floor(col)
    return ((g[r0, c0] * (1 - fc) + g[r0, c1] * fc) * (1 - fr)
            + (g[r0 + 1, c0] * (1 - fc) + g[r0 + 1, c1] * fc) * fr)


def along(lat, lon, north, east):
    """The point reached from (lat, lon) after `north` and `east` metres along the surface
    (one great-circle step in that direction)."""
    la, lo = np.radians(lat), np.radians(lon)
    up = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])
    e = np.stack([-np.sin(lo), np.cos(lo), np.zeros_like(lo)])
    n = np.stack([-np.sin(la) * np.cos(lo), -np.sin(la) * np.sin(lo), np.cos(la)])
    d = np.hypot(north, east)
    a = d / R
    p = np.cos(a) * up + np.sin(a) * (n * north + e * east) / d
    return np.degrees(np.arcsin(np.clip(p[2], -1, 1))), np.degrees(np.arctan2(p[1], p[0]))


def global_slope(g):
    """Slope bands on the slope-global grid (see the module docstring)."""
    lat = 90 - (np.arange(GH) + 0.5) / PPD
    lon = -180 + (np.arange(GW) + 0.5) / PPD
    deg = np.empty((GH, GW))
    for r in range(0, GH, 160):                                   # in strips, to bound memory
        la, lo = np.meshgrid(lat[r:r + 160], lon, indexing="ij")
        h = [global_height(g, *along(la, lo, dn, de))
             for dn, de in ((0, STEP), (0, -STEP), (STEP, 0), (-STEP, 0))]   # E, W, N, S
        deg[r:r + 160] = np.degrees(np.arctan(np.hypot((h[0] - h[1]) / (2 * STEP), (h[2] - h[3]) / (2 * STEP))))
    return band(deg.reshape(GLOBE_H, 2, GLOBE_W, 2).mean(axis=(1, 3)))


def south_slope(dem):
    n = dem.shape[0]
    centre = n / 2 - 0.5
    gy, gx = np.gradient(dem.astype(np.float64), hz.PIX)
    i = np.arange(n) - centre
    r2 = (i[None, :] ** 2 + i[:, None] ** 2) * hz.PIX ** 2
    k = 1 + r2 / (4 * R ** 2)                       # map length per ground length
    deg = np.degrees(np.arctan(np.hypot(gx, gy) * k))
    return band(box(deg))


# --- Sunlight and shadow ---------------------------------------------------------------

def read_cap(illum_dir, pole):
    """The 240 m AVGVISIB map of one pole: (values, left, top, res), checked against its grid."""
    with rasterio.open(Path(illum_dir) / MAPS_240[pole]) as src:
        p = src.crs.to_dict()
        lat0 = -90 if pole == "south" else 90
        b = src.bounds
        if (p.get("proj") != "stere" or p.get("lat_0") != lat0 or p.get("lon_0", 0) != 0
                or p.get("R") != R or src.res != (hz.PIX, hz.PIX) or src.shape != (CAP_N, CAP_N)
                or (b.left, b.bottom, b.right, b.top) != (-CAP_HALF, -CAP_HALF, CAP_HALF, CAP_HALF)):
            raise ValueError(f"{MAPS_240[pole]}: not the expected {pole} polar stereographic "
                             f"240 m grid of +-{CAP_HALF:.0f} m")
        return src.read(1), b.left, b.top, src.res[0]


def cap_textures(a):
    """Sunlight percent and shadow flag of a 240 m map, reduced to OUT x OUT."""
    valid = a != NODATA_IN
    w = box(valid)
    mean = box(np.where(valid, a, 0) * SCALE) / np.maximum(w, 1e-9)
    dark = box(valid & (a == 0)) / np.maximum(w, 1e-9)
    none = w < 1e-6
    sun = np.where(none, NODATA, np.rint(mean * 100)).astype(np.uint8)
    shadow = np.where(none, NODATA, dark >= 0.5).astype(np.uint8)
    return sun, shadow


# --- Site tiles ------------------------------------------------------------------------

def tile_points(site, dx=0.0, dz=0.0):
    axis = (np.arange(TILE_N) - TILE_N // 2) * SPACING
    X, Z = np.meshgrid(axis, axis)
    return lat_lon(site, X + dx, Z + dz)


def polar_tile_slope(dem, fine, site):
    """Slope band over 100 m, each point's four samples from one source; and the source
    resolutions used, m."""
    pts = [tile_points(site, dx, dz) for dx, dz in ((BASE, 0), (-BASE, 0), (0, -BASE), (0, BASE))]
    coarse = [hz.height_at(dem, la, lo) for la, lo in pts]       # E, W, N, S
    use, best = np.zeros((TILE_N, TILE_N), bool), [c.copy() for c in coarse]
    for z, left, top, res in fine:                               # closest map first
        vals = []
        for la, lo in pts:
            x, y = hz.to_xy(la, lo)
            row, col = (top - y) / res - 0.5, (x - left) / res - 0.5
            inside = (row >= 0) & (row <= z.shape[0] - 1) & (col >= 0) & (col <= z.shape[1] - 1)
            v = np.full(row.shape, np.nan)
            v[inside] = hz.bilinear(z, row[inside], col[inside])
            vals.append(v)
        ok = ~use & np.all([np.isfinite(v) for v in vals], axis=0)
        for b, v in zip(best, vals):
            b[ok] = v[ok]
        use |= ok
    e, w, n, s = best
    deg = np.degrees(np.arctan(np.hypot((e - w) / (2 * BASE), (s - n) / (2 * BASE))))
    res = ([5] if use.any() else []) + ([int(hz.PIX)] if not use.all() else [])
    return band(deg), res


def catalog_tile_slope(h):
    """Slope band from a catalog tile's heights over CAT_K samples each way; edges no data."""
    k, out = CAT_K, np.full(h.shape, NODATA, np.uint8)
    gx = (h[k:-k, 2 * k:] - h[k:-k, :-2 * k]) / (2 * k * SPACING)    # columns run east
    gz = (h[2 * k:, k:-k] - h[:-2 * k, k:-k]) / (2 * k * SPACING)    # rows run south
    out[k:-k, k:-k] = band(np.degrees(np.arctan(np.hypot(gx, gz))))
    return out


def tile_sun(maps, site):
    """Sunlight percent and shadow flag from the containing cell of one map; its label."""
    for label, pole, a, left, top, res in maps:                  # 60 m first
        x, y = polar_xy(*tile_points(site), pole)
        row = np.floor((top - y) / res).astype(int)
        col = np.floor((x - left) / res).astype(int)
        if (row.min() < 0 or col.min() < 0 or row.max() >= a.shape[0] or col.max() >= a.shape[1]):
            continue
        v = a[row, col]
        if label == "60 m" and (v == NODATA_IN).any():
            continue
        none = v == NODATA_IN
        sun = np.where(none, NODATA, np.rint(v * SCALE * 100)).astype(np.uint8)
        shadow = np.where(none, NODATA, v == 0).astype(np.uint8)
        return sun, shadow, label
    raise ValueError(f"{site['id']}: no illumination map covers the tile")


def site_tiles(app, dem, fine_dir, maps, out):
    """Write every site's tile; return its index entries."""
    sites = json.loads((app / "data/sites.json").read_text())
    terrain = json.loads((app / "data/terrain/index.json").read_text())["sites"]
    catalog_dir = app / "assets/observer/terrain/catalog"
    catalog = json.loads((catalog_dir / "index.json").read_text())["sites"]
    if set(terrain) & set(catalog):
        raise ValueError(f"sites in both terrain sets: {sorted(set(terrain) & set(catalog))}")
    entries = {}
    for site in sites:
        sid = site["id"]
        tile = terrain.get(sid) or catalog.get(sid)
        if tile is None:
            raise ValueError(f"{sid}: no terrain tile in data/terrain or the observer catalog")
        m = tile["metadata"]
        if ((tile["width"], tile["height"], tile["spacingM"]) != (TILE_N, TILE_N, SPACING)
                or m["projection"] != "local-orthographic-east-south"
                or m["latitudeDeg"] != site["lat"]
                or abs((m["longitudeEastDeg"] - site["lon"] + 180) % 360 - 180) > 1e-9):
            raise ValueError(f"{sid}: terrain tile grid changed")
        site = {"id": sid, "lat": site["lat"], "lon": site["lon"] % 360}
        if sid in terrain:
            fine = hz.fine_maps_near(fine_dir, site["lat"], site["lon"])
            slope, res = polar_tile_slope(dem, fine, site)
            entry = {"grid": TERRAIN, "slopeBaselineM": 2 * BASE, "slopeSourceResolutionM": res}
        else:
            h = np.fromfile(catalog_dir / tile["file"], "<f4").reshape(TILE_N, TILE_N).astype(np.float64)
            slope = catalog_tile_slope(h)
            entry = {"grid": CATALOG, "slopeBaselineM": 2 * CAT_K * SPACING,
                     "slopeSourceResolutionM": [round(m["sourceResolutionM"], 1)]}
        pole = "south" if site["lat"] <= -65 else "north" if site["lat"] >= 65 else None
        if pole:
            sun, shadow, label = tile_sun([mp for mp in maps if mp[1] == pole], site)
        else:
            sun = shadow = np.full((TILE_N, TILE_N), NODATA, np.uint8)
            label = None
        save(out / "sites" / f"{sid}.png", np.stack([slope, sun, shadow], -1), "RGB")
        entries[sid] = {"file": f"sites/{sid}.png", **entry, "sunlightMap": label}
        print(f"{sid:28s} slope {entry['slopeBaselineM']:6.1f} m, sunlight {label or 'none':5s} "
              f"centre: band {slope[128, 128]}, {sun[128, 128]}%, shadow {shadow[128, 128]}")
    return entries


# --- Output ----------------------------------------------------------------------------

def save(path, a, mode):
    Image.fromarray(a, mode).save(path, optimize=True)


def textures():
    """Every globe texture: name -> description (see index.json)."""
    pole_half = round(HALF / R, 5)
    cap_half = round(CAP_HALF / R, 5)
    south_uv = ("r = 2 tan(45° + lat/2) in Moon radii; u = 0.5 + r sin(lon) / (2 halfExtentRadii), "
                "v = 0.5 + r cos(lon) / (2 halfExtentRadii); lon 0 towards row 0, lon 90° E to the right")
    north_uv = ("r = 2 tan(45° − lat/2) in Moon radii; u = 0.5 + r sin(lon) / (2 halfExtentRadii), "
                "v = 0.5 − r cos(lon) / (2 halfExtentRadii); lon 180° towards row 0, lon 90° E to the right")
    t = {
        "slope-global": {
            "layer": "slope", "width": GLOBE_W, "height": GLOBE_H,
            "projection": {"name": "equirectangular", "lonRangeDeg": [-180, 180], "latRangeDeg": [-90, 90]},
            "uv": "u = lon / 360° + 0.5 (lon east, −180° to 180°), v = lat / 180° + 0.5, as globe.js "
                  "lonLatUv; pixel centres at lon = −180° + (column + 0.5) / 8, lat = 90° − (row + 0.5) / 8",
            "pixelDeg": 360 / GLOBE_W,
            "slopeBaselineM": round(2 * STEP, 1),
            "slopeMethod": f"heights {STEP:.1f} m north, south, east and west of each 16 px/degree "
                           f"sample along the surface (bilinear), so one {2 * STEP:.1f} m baseline both "
                           "ways at every latitude; then the mean of 2 × 2 samples per pixel",
            "source": "LOLA global heights, 16 px/degree (NASA SVS CGI Moon Kit), as the observer's tiles",
        },
        "slope-south": {
            "layer": "slope", "width": OUT, "height": OUT,
            "projection": {"name": "south polar stereographic", "proj": PROJ["south"],
                           "halfExtentM": int(HALF), "halfExtentRadii": pole_half},
            "uv": south_uv, "pixelM": 2 * HALF / OUT,
            "slopeBaselineM": 2 * hz.PIX,
            "slopeMethod": "central differences on the 240 m grid, corrected for the map's scale, "
                           "then the area-weighted mean per pixel",
            "source": "LOLA LDEM_75S_240M",
        },
    }
    for pole in ("south", "north"):
        for layer in ("sunlight", "shadow"):
            t[f"{layer}-{pole}"] = {
                "layer": layer, "width": OUT, "height": OUT,
                "projection": {"name": f"{pole} polar stereographic", "proj": PROJ[pole],
                               "halfExtentM": int(CAP_HALF), "halfExtentRadii": cap_half},
                "uv": south_uv if pole == "south" else north_uv, "pixelM": 2 * CAP_HALF / OUT,
                "source": f"NASA PGDA {MAPS_240[pole][:-4]}",
            }
    for name, d in t.items():
        t[name] = {"file": f"{name}.png", **d}
    return t


def cap_globe(layer):
    half = round(CAP_HALF / R, 5)
    return {"south": f"{layer}-south.png", "north": f"{layer}-north.png",
            "southHalf": half, "northHalf": half, "southEdge": 25, "northEdge": 25}


def index(site_entries):
    bands = [{"value": 0, "minDeg": 0, "maxDeg": 5, "label": "Under 5°"},
             {"value": 1, "minDeg": 5, "maxDeg": 10, "label": "5–10°"},
             {"value": 2, "minDeg": 10, "maxDeg": 20, "label": "10–20°"},
             {"value": 3, "minDeg": 20, "maxDeg": 90, "label": "20° and over"}]
    pgda = "NASA PGDA lunar polar illumination (Mazarico et al. 2011)"
    return {
        "uvConvention": "u = 0 at column 0 (left), v = 1 at row 0 (top), as Three.js loads images "
                        "(flipY); lat and lon in degrees, lon east",
        "textures": textures(),
        "layers": {
            "slope": {
                "globe": {"global": "slope-global.png", "south": "slope-south.png",
                          "southHalf": round(HALF / R, 5), "southEdge": 15},
                "siteChannel": "R",
                "encoding": "slope band index",
                "bands": bands,
                "landingLimitDeg": 10,
                "landingLimitLabel": "NASA Artemis landing limit: under 10° over 100 m",
                "scaleNote": "Globe slope is over kilometres (3.8 km in slope-global, 480 m in "
                             "slope-south), so it is much gentler than slope over 100 m",
                "noData": NODATA,
                "noDataLabel": "No data",
                "source": "LOLA global 16 px/degree heights and LDEM_75S_240M; site tiles: PGDA 5 m "
                          "maps (Barker et al. 2021), LDEM_75S_240M, SLDEM2015 and LDEM_60S_240M",
            },
            "sunlight": {
                "globe": cap_globe("sunlight"), "siteChannel": "G",
                "encoding": "percent of time the Sun is visible, long-term average at ground level "
                            "(average visible fraction of the Sun's disc)",
                "values": {"min": 0, "max": 100, "unit": "%"},
                "coverageDeg": {"south": -65, "north": 65},
                "coverageNote": COVERAGE,
                "noData": NODATA,
                "noDataLabel": "No published map here",
                "source": f"{pgda}, 240 m maps to 65° S and 65° N; site tiles use the 60 m map where "
                          "it covers the whole tile",
            },
            "shadow": {
                "globe": cap_globe("shadow"), "siteChannel": "B",
                "encoding": "permanent shadow flag (globe: at least half of the 240 m cells never sunlit)",
                "values": [{"value": 0, "label": "Sunlit at some time"},
                           {"value": 1, "label": "Permanently shadowed"}],
                "coverageDeg": {"south": -65, "north": 65},
                "coverageNote": COVERAGE,
                "noData": NODATA,
                "noDataLabel": "No published map here",
                "source": pgda,
            },
        },
        "sites": {
            "grid": {"width": TILE_N, "height": TILE_N, "spacingM": SPACING,
                     "projection": "local-orthographic-east-south",
                     "rows": "row 0 north", "columns": "column 0 west"},
            "tiles": site_entries,
        },
    }


def build(ldem, illum_dir, fine_dir, app, poles=("south", "north")):
    """Write data/layers/ (the cap textures for `poles` only; main() always builds both)."""
    app = Path(app)
    out = app / "data/layers"
    (out / "sites").mkdir(parents=True, exist_ok=True)
    for p in list(out.glob("*.png")) + list((out / "sites").glob("*.png")):
        p.unlink()

    save(out / "slope-global.png", global_slope(load_global(app / "assets/observer/terrain/16")), "L")
    dem = hz.load_ldem(ldem)
    save(out / "slope-south.png", south_slope(dem), "L")

    maps = []
    with rasterio.open(Path(illum_dir) / MAP_60) as src:
        maps.append(("60 m", "south", src.read(1), src.bounds.left, src.bounds.top, src.res[0]))
    for pole in poles:
        a, left, top, res = read_cap(illum_dir, pole)
        sun, shadow = cap_textures(a)
        save(out / f"sunlight-{pole}.png", sun, "L")
        save(out / f"shadow-{pole}.png", shadow, "L")
        maps.append(("240 m", pole, a, left, top, res))

    entries = site_tiles(app, dem, fine_dir, maps, out)
    (out / "index.json").write_text(json.dumps(index(entries), indent=1, ensure_ascii=False) + "\n",
                                    encoding="utf-8")
    total = 0
    for p in sorted(out.rglob("*.*")):
        total += p.stat().st_size
        print(f"{p.relative_to(out)}: {p.stat().st_size} bytes")
    print(f"total: {total} bytes")


def main():
    if len(sys.argv) != 5:
        sys.exit(__doc__)
    ldem, illum_dir, fine_dir, app = sys.argv[1:5]
    missing = [n for n in (*MAPS_240.values(), MAP_60) if not (Path(illum_dir) / n).exists()]
    if missing:
        sys.exit(f"Missing illumination maps in {illum_dir}: {', '.join(missing)}. "
                 "Download them first (science/README.md); nothing was written.")
    build(ldem, illum_dir, fine_dir, app)


if __name__ == "__main__":
    main()
