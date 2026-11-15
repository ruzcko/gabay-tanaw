# Science

Python owns offline Horizons access, terrain horizons, visibility and forecast generation.
`app/computation/` owns browser contracts and checks. No backend is deployed. Run terrain
first, then fetch and build. See [Earth validation](EARTH_VALIDATION.md) for the accuracy audit.

## Travel

[Travel science and its UI contract](../app/computation/TRAVEL.md) screen regions for
landing and search six months of arrival dates. `landing_terrain.py` publishes 100 m
slope screens; `prepare_landing.py` prepares arbitrary sample points through the existing
Python horizon/Horizons/forecast path. Missing fine terrain stays unresolved. No UI is
connected by this addition.

## Terrain horizons

For each landing site in [`app/data/sites.json`](../app/data/sites.json), the real skyline:
how high the terrain rises above the horizontal in every compass direction, computed from
LOLA elevation maps. Python compares Sun/Earth elevations against the skyline and publishes the resulting states.

### Run

Steps 3 and 5 below are catalog research operations, not refresh steps: they change site
coordinates or catalog heights. The accepted catalog is pinned to `79bf18a`; do not rerun
site selection during a forecast refresh.

Needs Python 3 with numpy (and rasterio for the validation step, Pillow for the map layers). Run from the repo root.

```sh
pip install numpy rasterio pillow
```

1. Download the LOLA polar elevation maps (29 MB to 75°S, 120 MB to 60°S) into `science/cache/raw/`:

```sh
mkdir -p science/cache/raw && curl -o science/cache/raw/ldem_75s_240m.img https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_75s_240m.img
curl -o science/cache/raw/ldem_60s_240m.img https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_60s_240m.img
```

2. Download NASA PGDA's 5 m site elevation maps (seven files, 340 MB):

```sh
mkdir -p science/cache/raw/pgda_5mpp && for s in Site01 SL3 Site04 Site07 Site11 Site20 Site23; do curl -o science/cache/raw/pgda_5mpp/$s.tif https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/$s/${s}_final_adj_5mpp_surf.tif; done
```

3. For the sites published only as region centres, find the sunniest spot within 2 km
   whose slope over 100 m is under 10° (NASA's Artemis landing limit), and write it into
   `sites.json` (about 25 minutes). A site can set its own radius and published extent in
   `regionCentre` (`searchRadiusKm`, `extent`); five Artemis regions are searched within
   7.5 km. The published centre stays in `regionCentre`:

```sh
python science/best_spot.py science/cache/raw/ldem_75s_240m.img app/data/sites.json science/cache/raw/pgda_5mpp
```

4. Download SLDEM2015 elevation around each site between 60°S and 60°N. SLDEM2015 combines
   LOLA with Kaguya Terrain Camera images (128 px/degree, about 237 m); the script reads only
   a window of ±5.5° around each site with HTTP byte-range requests, about 143 MB of pixels for the current 15 windows:

```sh
python science/fetch_terrain.py app/data/sites.json science/cache/raw/sldem2015
```

5. Add each site's ground elevation:

```sh
python science/site_elevation.py science/cache/raw/ldem_75s_240m.img app/data/sites.json science/cache/raw/pgda_5mpp app/assets/observer/terrain/16 --polar60 science/cache/raw/ldem_60s_240m.img --windows science/cache/raw/sldem2015
```

6. Compute horizons locally; require terrain so missing inputs fail closed:

```sh
python science/horizon.py science/cache/raw/ldem_75s_240m.img app/data/sites.json out/review/horizons --fine science/cache/raw/pgda_5mpp --polar60 science/cache/raw/ldem_60s_240m.img --windows science/cache/raw/sldem2015 --require-terrain
```

Options: `--height` observer height in metres (default 2), `--range` ray length in km
(default 150), `--step` scientific azimuth grid (default 0.25 degrees; 0.5 or 1 also
supported). Without `--fine` it uses the 240 m map only.

7. Build the display terrain tiles for the sites south of 75°S (a few seconds; rerun after
   ground heights in `sites.json` change, since each tile's centre is set to them):

```sh
python science/make_terrain_tiles.py science/cache/raw/ldem_75s_240m.img app/data/sites.json science/cache/raw/pgda_5mpp app/data/terrain
```

8. Download NASA PGDA's polar illumination maps (south and north 240 m maps and the south
   60 m map, 156 MB) and build the map layers in `app/data/layers/` (about 40 seconds). The
   build also reads the app's site tiles (`app/data/terrain/`,
   `app/assets/observer/terrain/catalog/`) and global heights
   (`app/assets/observer/terrain/16/`), and stops before writing if a map is missing:

```sh
mkdir -p science/cache/raw/pgda_illum && for f in AVGVISIB_65S_240M_201608 AVGVISIB_65N_240M_201608 AVGVISIB_85S_060M_201608; do curl -o science/cache/raw/pgda_illum/$f.TIF https://pgda.gsfc.nasa.gov/data/MoonIllumination/$f.TIF; done
python science/make_layers.py science/cache/raw/ldem_75s_240m.img science/cache/raw/pgda_illum science/cache/raw/pgda_5mpp app
```

9. Check the results against published sunlight (reads a few NASA map tiles over HTTP, about
a minute). Prints the tables in [VALIDATION.md](VALIDATION.md):

```sh
python science/validate.py science/cache/raw/ldem_75s_240m.img app/data/sites.json science/cache/raw/pgda_5mpp
```

### Output

`app/data/horizons/<id>.json`:

```json
{ "id": "connecting-ridge", "observerHeight": 2.0, "step": 1,
  "terrain": "LOLA 5 m + 240 m", "elevations": [-2.09, -2.11, ...] }
```

- `elevations`: 360 numbers in degrees. Index 0 is north, then clockwise (90 = east).
- Elevation is measured from the local horizontal: the plane perpendicular to the Moon's
  radius at the site, on a sphere of 1737.4 km. A Sun or Earth position is above the skyline
  when its topocentric elevation, measured the same way, is higher than the value at its
  azimuth. Calculations interpolate the unrounded `calculation` grid; the whole-degree
  profile is retained for drawing. Metadata includes `lat`, `lon`, `referenceFrame`,
  `datum`, `surfaceElevation` and `observerHeight`. Ground is sampled from the same DEM
  stack as the rays; the single observer-height rule is in
  [SCIENCE.md](../app/computation/SCIENCE.md#site-and-local-axes).
- `terrain`: `"LOLA 5 m + 240 m"` where a 5 m map covers part of the rays,
  `"LOLA 240 m"` elsewhere inside 75°S, `"LOLA 240 m (60S map)"` from 75°S to 60°S,
  `"SLDEM2015 237 m"` between 60°S and 60°N, and `"smooth"` only for a site with no
  terrain file given. A smooth horizon is the dip of a bare sphere seen from 2 m
  (−0.09°), with no hills.

`app/data/terrain/<id>.bin` holds the ground around each site south of 75°S for the site
view: 257 × 257 Float32 heights in metres above the 1737.4 km sphere, 78.125 m apart on the
site's tangent plane (row 0 north, column 0 west), from the PGDA 5 m maps blended into
LDEM_75S_240M; `index.json` lists each file with its grid size and metadata.

`app/data/layers/` holds slope, sunlight and permanent shadow as value textures, with colours
left to the app. Globe textures are grey PNGs: slope for the whole Moon (`slope-global.png`,
2880 × 1440, equirectangular, lon −180° at the left, north at the top) and, finer, south of
75°S (`slope-south.png`, 2048 × 2048 on the LDEM_75S_240M grid, the same grid as the globe's
polar relief); sunlight and shadow from 65° to each pole (`sunlight-south.png`,
`sunlight-north.png`, `shadow-south.png`, `shadow-north.png`, 2048 × 2048, polar
stereographic, ±770,400 m). Between 65°S and 65°N there is no published sunlight map. Each of
the 30 sites has a 257 × 257 RGB PNG on its terrain tile grid (R slope, G sunlight, B shadow).
Values are slope bands, whole percent of sunlight at ground level from NASA's long-term
illumination maps, and a 0/1 shadow flag; 255 is no data. `index.json` gives each texture's
projection, extent and UV formula, the encodings, and each site tile's grid and slope
baseline. Globe slope is over one 3.8 km baseline everywhere (`slope-global`) or over 480 m
(`slope-south`), so it is much gentler than slope over 100 m, the baseline of the 10° landing
limit; site slope is over 100 m at the polar sites and over 469 m elsewhere, about twice the
source's 240 m cells.

`app/data/landings.json` gives each visited site's touchdown time in UTC (`landingUtc`) and
its source (`landingSource`). Blue Ghost 1 (US Eastern time) and SLIM (Japan time) were
converted to UTC; the other sources give UTC.

### Site fields

Each site in `sites.json` also carries:

- `referenceFrame`: `MOON_ME_DE421` for every site. `frameEvidence` says how it was
  accepted: a stated source frame, a controlled LRO catalogue/source chain, or the
  team-reviewed Gläser terrain consistency test. The latter is empirical support, not
  a measured frame transformation or a demonstrated positional error bound. The
  computation engine accepts only `MOON_ME_DE421`.
- `positionAccuracy`: `"approximate"` on planned landing targets, whose sources state no
  frame; absent elsewhere.
- `elevationDatum`: always `sphere-1737400m`.
- `surfaceElevationM`: ground height in metres, radially above the 1,737,400 m sphere, from
  the product named in `elevationProduct`: a PGDA 5 m map where one covers the site, else
  LDEM_75S_240M, else an SLDEM2015 window, else LDEM_60S_240M (75°S to 60°S), else LDEM_16.
- `frameEvidence`: one sentence on what the source says about its frame.
- `category`: `"base-candidate"`, `"visited"` or `"upcoming"`.
- `mission`, `agency`: the mission (or site list) and who runs it.
- `date`: for visited sites the landing month, for upcoming sites the planned launch as the
  mission states it, for base candidates the year NASA named the region; `"YYYY"`,
  `"YYYY-MM"` or `null`.
- `summary`: one sentence under 140 characters.
- `link`: the official page.

NASA named the nine 2024 regions for Artemis III. Since February 2026 Artemis III is a crewed
test flight in Earth orbit, and the first crewed landing is Artemis IV, planned for 2028
([NASA](https://www.nasa.gov/news-release/nasa-adds-mission-to-artemis-lunar-program-updates-architecture/)).

The elevation products' own frame and datum:

| Product | Frame | Heights relative to |
| --- | --- | --- |
| LDEM_75S_240M | Label: `COORDINATE_SYSTEM_NAME = "MEAN EARTH/POLAR AXIS OF DE421"` | 1737.4 km sphere |
| LDEM_60S_240M | Same label line as LDEM_75S_240M | 1737.4 km sphere |
| SLDEM2015 | Same label line | 1737.4 km sphere (heights in km) |
| LDEM_16 | Same frame (PDS label V3.1, 2019); the CGI Moon Kit says it reformats LOLA's 16 px/degree product | 1737.4 km sphere |
| PGDA 5 m maps | MOON_ME of DE421 (PGDA README, Barker et al. 2021) | "Elevation above the reference sphere" (Barker et al. 2021); radius not stated, but they match LDEM_75S_240M to within 0.3 m on average over each 240 m pixel |

### How it works

`horizon.py` reads the LOLA grid (south polar stereographic, 240 m per pixel, heights in
0.5 m steps above 1737.4 km) and, near the sites NASA has mapped in detail, the 5 m maps on
the same projection. From each site it walks along great circles every 0.25° of azimuth,
sampling the terrain every 5 m where a 5 m map covers it (first 23 km) and every 60 m on the
240 m map out to 150 km, with bilinear interpolation. It keeps the steepest angle to the
terrain, with the Moon's curvature included exactly.
`sunlight.py` turns a horizon into a long-term average of sunlight. `best_spot.py` uses it
to pick derived spots, and `validate.py` to compare against NASA's maps and published
studies.

## Forecast engine

Turns Sun and Earth positions from JPL Horizons plus each site's terrain horizon into the
forecasts in `app/data/forecast/`, and the Moon's hourly sub-solar and sub-Earth points in
`app/data/sun/` and `app/data/sun.json`. The window is one year, 1 Dec 2026 to 1 Dec 2027.
Method and data format: [FORECAST.md](FORECAST.md).

Python 3, standard library only. Run from the repo root. The raw Horizons responses are
cached in `science/cache/`, which stays local; these commands rebuild it.

The reviewed catalog has 30 sites, all accepted in `MOON_ME_DE421` with per-site
`frameEvidence`. Blue Ghost 2 is removed pending a published mission coordinate. IM-3
and Blue Ghost 3 retain `positionAccuracy: "approximate"`. Preserve those qualifications
in science provenance; frame acceptance does not certify the planned landing position.

Existing raw caches
may be reused only when their coordinates, observer height and source headers validate.

Default window: 2026-12-01 through 2027-12-01. For an accuracy check, supply a start/date
and number of days to the fetcher, optionally `--step-minutes 1`, in a separate cache.
Both cadences produce the same hourly/monthly output contract. All monthly source
headers and shared endpoints are checked before building. Missing horizons fail closed.
Review generated differences before copying outputs into `app/data`.

For a new site's window, `--batch` reduces Horizons request overhead without changing
the sampling or terrain model. Use a separate raw cache; monthly fetching remains the
default for existing refresh workflows:

```sh
python science/fetch_ephemeris.py science/cache/new-site/sites.json science/cache/new-site/batch-cache 2026-12-01 365 --horizons science/cache/new-site/horizons --batch
python science/build_forecast.py science/cache/new-site/sites.json science/cache/new-site/batch-cache science/cache/new-site/horizons science/cache/new-site/forecast
```

Batch windows contain at most 60,000 samples per body including endpoints (our resource
bound, not a claimed NASA API limit). A ten-minute year fits in one request per body;
one-minute requests split into shorter windows. Requests remain sequential. The builder
parses each raw response once, keeps all validation and seam checks, and writes the same
monthly forecast format. Original source headers/hashes describe the actual request
windows; the compute provider checks their coverage instead of counting monthly files.
Missing coverage is an error.

To repeat the six-duration benchmark with fresh local caches and existing terrain:

```sh
python science/benchmark_forecast.py science/cache/new-site/sites.json science/cache/new-site/horizons out/benchmark-new-run --batch
```

This requires the already-credited `jsonschema` validator, selects exactly one site,
and refuses an existing output directory. Defaults are 7, 14, 28, 90, 182 and 365 days;
`--days` accepts other positive whole-day windows. Timings cover data preparation,
not terrain generation, browser transfer or rendering. Raw caches stay local.

3. Fetch the hourly sub-solar and sub-Earth points on the Moon for the globe (the cached
   response is reused for the same window):

   ```sh
   python3 science/sun_points.py out/review/cache out/review/sun.json
   ```

4. Check one Sun position by hand against Horizons:

   ```sh
   python3 science/check_sun.py app/data/sites.json science/cache connecting-ridge "2026-12-15 12:00"
   ```

5. Forecast a 5 × 5 grid of points around each polar site, so the pin can move near a
   site (about 8 minutes). It reads the same local 10-minute cache from
   `fetch_ephemeris.py` as `build_forecast.py`:

   ```sh
   python science/make_grids.py science/cache/raw/ldem_75s_240m.img app/data/sites.json science/cache/raw/pgda_5mpp science/cache app/data/grid
   ```

6. Fetch Earth's hourly position around the Sun and the Moon's around Earth for the
   Sun-Earth-Moon diagram (two Horizons requests; the cached responses are reused for the
   same window):

   ```sh
   python3 science/make_orbit.py science/cache app/data/orbit.json
   ```

   Positions are geometric (no light-time correction) in the ecliptic and mean equinox of
   J2000, from JPL Horizons (DE441), with the same hours and month files as `app/data/sun/`.

### Grid around the polar sites

`app/data/grid/<id>.json` covers each site at or south of 75°S with points 500 m apart,
2 steps east/west (`i`) and north/south (`j`) of the site on its tangent plane; `(0, 0)` is
the site. Each point holds its `lat`, `lon`, ground height `groundM` (5 m map where one
covers it, else 240 m), `slopeDeg` over 100 m, and daily `sunHours` and `earthHours` for the
forecast year with their yearly share `sunPct` and `earthPct`. Each point has its own
terrain horizon on the same 0.25° grid as the forecasts. The Sun and Earth directions are
the forecast's 10-minute Horizons samples, turned from the cached observer position into
the point's own east/north/up axes. Moving 1 km tilts the local vertical by 0.033° (0.047° at the
1.41 km corners). Near the pole, local north also turns: at Connecting Ridge (89.44°S) the
azimuths shift by up to 3.6°. Reusing the site's azimuths unturned would change the year's
Earth-in-view share by up to 3.1 percentage points there and single days by up to 23 h.
What remains is parallax: the Sun and Earth are not re-aimed from the point itself, which
is at most 0.0002° for Earth (1.41 km over about 360,000 km) and less for the Sun. The
`(0, 0)` point reproduces each site's published ground height, horizon and daily hours
(within 0.03 h before rounding).
