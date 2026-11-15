# How the forecast works

For each landing site, Tanaw needs to know, every day, how long the Sun shines on it and how
long Earth is in view for direct radio contact. Both depend on where the Sun and Earth sit in
the site's sky and on the terrain around it.

## Method

1. **Sky positions.** JPL Horizons gives the azimuth and elevation of the Sun (body 10) and
   Earth (body 399) as seen by an observer standing at the site on the Moon (centre
   `coord@301`, geodetic site coordinates on the 1737.4 km lunar sphere, Moon mean-Earth
   frame). Quantity 4, airless (the Moon has no atmosphere to bend light), every 10 minutes
   over one year: 1 Dec 2026 00:00 UTC to 1 Dec 2027 00:00 UTC. The same query also asks for
   quantity 13 (angular diameter: how wide the disc looks) and quantity 20 (range: distance
   in km). Ephemeris DE441. Requests go one calendar month at a time by default, or in
   bounded whole-window batches with `--batch`, always sequentially (see Cache).
2. **Horizon mask.** Each site's terrain horizon (`app/data/horizons/<id>.json`) gives the
   elevation of the skyline in the full-precision `calculation.elevations` grid (default 0.25 degrees), index 0 = north, clockwise.
   Between steps it is interpolated linearly. The 360 rounded `elevations` remain a display profile.
3. **Up or down.** At each sample, *clearance* = body elevation − skyline elevation at the
   body's azimuth. The body is up while clearance is above 0. Rise and set times come from
   linear interpolation of clearance between the actual sample times either side (10 minutes by default; optional 1 minute).
4. **Days.** Hours of sunlight and of Earth in view are the overlap of those up-spans with
   each UTC calendar day. Each day also records whether each body is up at its 00:00
   sample and the next rise or set after 00:00, looked up across the whole year. Events and
   daily hours use the full sampling grid; stored sky arrays keep exact hourly samples
   at either supported cadence.
5. **Sub-points.** A separate query (`sun_points.py`) asks Horizons for the Moon as target
   seen from Earth's centre (`500@399`): quantity 15 is the sub-solar point (where the Sun
   is straight overhead), quantity 14 the sub-Earth point (where Earth is straight
   overhead). Hourly, one request for the year. The globe uses them to light the Moon and
   place Earth.

Go/No-go is not in the data. The app compares each day's hours with the mission's needs
(example mission: 18 h of sunlight and 8 h of Earth in view per day).

## Units and time conventions

- Times are UTC, written as ISO 8601 with a `Z` (`2026-12-16T14:24:52Z`). Horizons tags
  samples in UT; "days" are UTC calendar days.
- Angles are degrees. Azimuth is measured clockwise from north (N 0, E 90, S 180, W 270).
  Elevation is above the plane perpendicular to the local vertical of the lunar sphere, the
  same plane the horizon masks use.
- Site longitude is degrees east.

## Output files

After publishing sub-points, `publish_geometry.py <pinned-kernel-directory> app/data`
adds a separately identified `geometric` object to each sun month and refreshes its
manifest hash. Existing fields and forecast values are preserved. Pinned geometric
states support static-hosted observer lighting and minute playback; they do not relabel
the apparent sub-points. See [the format and validation report](../app/computation/PUBLISHED_LIGHTING.md).
The optional `geometric.sky` object adds hourly J2000-to-Moon orientation quaternions
for the fixed star catalog, with explicit `xyzw` order and `slerp` interpolation.
Its samples share the monthly timestamps and kernel provenance. Existing data without
this object remains valid and has no static sky rotation; see [SKY.md](../app/computation/SKY.md).

Each site has a small header with the daily list for the whole year, plus one file per month
with the hourly sky. The globe's sub-points follow the same pattern. A month file holds the
hours from that month's first 00:00 up to, but not including, the next month's first 00:00;
the window's end instant (2027-12-01 00:00) is not stored.

```
app/data/forecast/<id>.json            header and days[] (~92 KB)
app/data/forecast/<id>/<YYYY-MM>.json  hourly sky for one month (~44 KB)
app/data/sun.json                      index for the sub-points (< 1 KB)
app/data/sun/<YYYY-MM>.json            hourly sub-points for one month (~24 KB)
app/data/orbit.json                    index for the Sun-Earth-Moon positions (< 1 KB)
app/data/orbit/<YYYY-MM>.json          hourly Earth and Moon positions for one month (~14 KB)
app/data/grid/index.json               index for the polar-site grids (< 1 KB)
app/data/grid/<id>.json                daily hours on a 5 × 5 grid around a polar site
```

The grid files come from `make_grids.py`; what each point holds is in
[README.md](README.md#grid-around-the-polar-sites).

### `app/data/forecast/<id>.json`

| Field | Meaning |
| --- | --- |
| `id`, `name`, `lat`, `lon` | The site, as in `sites.json` |
| `horizon` | `"lola"` for a LOLA terrain horizon, `"smooth"` for an explicitly requested bare-sphere model; all 30 current sites have terrain |
| `ephemeris` | Where the sky positions come from |
| `science` | Additive provenance: frame evidence, optional approximate-position flag, datum, modeled heights, cadence, horizon step/hash and raw source headers/hashes |
| `window.start`, `window.end` | First and last sample (end is exclusive for the day list) |
| `sunUpAtStart`, `earthUpAtStart` | Whether each body is up at `window.start` |
| `months` | The month files that exist, as `"YYYY-MM"` |
| `days[]` | One per UTC day (365): `date`, `sunHours`, `earthHours`, and lists of `sunrise`, `sunset`, `earthrise`, `earthset` times that fall in that day |
| `days[].sunUpAt0`, `earthUpAt0` | Whether each body clears the skyline at that day's 00:00 UTC sample |
| `days[].nextSunEvent`, `nextEarthEvent` | `{"kind": "rise" or "set", "at": time}`: the first rise or set strictly after that day's 00:00, anywhere in the year; `null` if there is none |

Rise and set lists can be empty: near the pole the Sun can stay up for days.

### `app/data/forecast/<id>/<YYYY-MM>.json`

Hourly arrays for drawing the horizon ring and the sky. Sample *i* is at `start` + *i* hours.

| Field | Meaning |
| --- | --- |
| `start`, `stepMinutes` | That month's first hour and the 60-minute step |
| `sunAz`, `sunEl`, `earthAz`, `earthEl` | Azimuth and elevation, degrees (0.01°) |
| `sunRangeKm`, `earthRangeKm` | Distance from the site, km (whole km) |
| `sunAngularDiameterDeg`, `earthAngularDiameterDeg` | Apparent width of the disc, degrees (0.0001°) |
| `sunVisible`, `earthVisible` | `1` when the body's centre clears the terrain skyline at that hour, else `0` (the same test as the daily hours) |

### `app/data/sun.json` and `app/data/sun/<YYYY-MM>.json`

One set for all sites. `sun.json` is the index: `frame` (the lunar frame the points are in,
see Frame), `source`, `window` (`start`, `end`), `stepMinutes` and `months`. Each month file
has:

| Field | Meaning |
| --- | --- |
| `start`, `stepMinutes` | That month's first hour and the 60-minute step |
| `subsolarLat`, `subsolarLon` | Sub-solar point, degrees |
| `subEarthLat`, `subEarthLon` | Sub-Earth point, degrees |

Latitudes are −90 to 90. Longitudes are degrees east, 0 to 360, the same convention as
`sites.json`. Values are rounded to 0.0001°.

### `app/data/orbit.json` and `app/data/orbit/<YYYY-MM>.json`

Positions for the Sun-Earth-Moon diagram, from `make_orbit.py`. `orbit.json` holds `start`
and `months`, which match `window.start` and `months` in `sun.json`. Each month file covers
the same hours as the matching `sun/` file:

| Field | Meaning |
| --- | --- |
| `start`, `stepMinutes` | That month's first hour and the 60-minute step |
| `earthHelioLonDeg` | Earth's longitude seen from the Sun's centre, degrees |
| `moonGeoLonDeg`, `moonGeoLatDeg` | The Moon's longitude and latitude seen from Earth's centre, degrees |

Geometric positions (no light-time correction) in the ecliptic and mean equinox of J2000,
from JPL Horizons (DE441). Longitudes are 0 to 360; values are rounded to 0.01°. The Sun's
longitude seen from Earth is `earthHelioLonDeg` + 180°.

## Cache

The raw Horizons responses are stored gzipped in `science/cache/`, which is local and not
committed (about 80 MB for 30 sites). The commands in [README.md](README.md) rebuild it:

- `science/cache/<id>/<sun|earth>-<YYYY-MM>.txt.gz`: one month of 10-minute samples per
  site and body. Each month ends at 00:00 on the next month's first day, so neighbouring
  months share one row. A month is reused only after validating API version, target, MEAN_ME frame, lunar radii,
  observer coordinates/altitude, units, model/EOP header, window and cadence. Invalid caches
  are refetched. The builder rejects gaps, changed columns and conflicting month endpoints. Requests run one at a time, with a 1 s pause between fetches.
- `science/cache/moon-subpoints.txt.gz`: the hourly sub-points for the year.
- `science/cache/orbit-earth.txt.gz`, `orbit-moon.txt.gz`: the hourly Earth and Moon vectors
  for the year, reused only when target, centre, DE441, frame, units and window validate.

With `fetch_ephemeris.py --batch`, choose a separate cache directory. Raw filenames are
`<id>/<sun|earth>-YYYY-MM-DD_YYYY-MM-DD.txt.gz`, with the final date inclusive in raw
samples. At most 60,000 samples per request keeps payloads bounded while retaining the
selected 1- or 10-minute cadence. Adjacent batches share one endpoint; the builder checks
every numeric column at the seam and retains that sample once. A batch cache rejects
monthly files or files for another requested window; use another directory to change
windows. Valid completed chunks can be reused after interruption. `--force` refetches.

Forecast paths, field names, units, hourly arrays and event definitions are unchanged.
Only `science.sources` reflects the actual raw request grouping: a ten-minute year has
two source records instead of 24. Each still has `file`, `sha256` and the untouched raw
`header`. Schemas accept both filename forms; Python and the browser compute provider
check complete Sun/Earth source-window coverage, cadence and identity. No source header
is rewritten to impersonate a monthly query. The observer's catalog and saved-hour
restrictions remain unchanged.

## Frame

Verified site coordinates and LOLA terrain use the
Moon's mean-Earth frame of DE421 (NAIF `MOON_ME_DE421`). A mean-Earth frame fixes lunar
longitude 0 at the mean direction to Earth.

Horizons reports Moon coordinates in its own mean-Earth frame (header label `MOON_ME`;
topocentric queries show `MEAN_ME (high precision)`). Per the
[Horizons manual](https://ssd.jpl.nasa.gov/horizons/manual.html) ("Lunar Mean-Earth Frame
of DE421"), this is the DE440 principal-axis frame turned by a fixed offset into the DE421
mean-Earth frame, valid AD 1550–2650. NAIF names it `MOON_ME_DE440_ME421`, with the fixed
angles from [Park et al. 2021](https://doi.org/10.3847/1538-3881/abd414) (AJ 161:105,
eq. 19); see the NAIF frames kernel
[moon_de440_250416.tf](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_de440_250416.tf).

Per that kernel, it differs from `MOON_ME_DE421` by at most 0.063 arcsec over 2000–2040,
about 0.5 m on the surface. A check against NAIF's published examples (2022) agreed to
0.002 arcsec. For comparison, the IAU_MOON frame differs from mean-Earth by up to about
18 arcsec (about 155 m). So no conversion is applied: the difference is about 1/57,000 of
the 1° horizon step and far below a pixel on the globe.

## Simplifications

- **Body centres.** The Sun and Earth count as up when their centres clear the skyline. The
  Sun's disc is about 0.53° wide and Earth's about 1.9° from the Moon, so a partly visible
  Sun or Earth is counted as fully up or fully down. This matters where the Sun grazes the
  skyline: at de Gerlache rim its centre clears the terrain by only 0.04° at the closest
  point between 1 Dec 2026 and 30 Jan 2027, so part of the disc is hidden for a while yet the day counts 24 h.
- **Sampling.** Clearance is interpolated in time and the skyline between azimuth rays.
  There is no universal timing bound: a narrow visibility window can fall entirely
  between samples. See [Earth validation](EARTH_VALIDATION.md) for measured cases.
- **Observer position.** Follow the single height convention in
  [SCIENCE.md](../app/computation/SCIENCE.md#site-and-local-axes). Terrain metadata supplies
  modeled ground and observer height; the old altitude-zero caches must be refetched.
- **Smooth sites.** When a bare-sphere model is explicitly requested, the modeled ground is zero,
  regardless of the catalog's real elevation. These are bare-sphere forecasts without
  local terrain; their forecast says `"horizon": "smooth"`.

## Worked check against Horizons

The following worked examples and monthly table describe the earlier forecast baseline.

`check_sun.py` takes a different route to the same Sun position: it asks Horizons for the
sub-solar point (where the Sun is straight overhead on the Moon, quantity 15, Moon
mean-Earth frame) and works out the Sun's direction from the site with spherical
trigonometry:

- elevation = 90° − arccos(sin φ sin φₛ + cos φ cos φₛ cos Δλ)
- azimuth = atan2(sin Δλ cos φₛ, cos φ sin φₛ − sin φ cos φₛ cos Δλ)

where φ is the site latitude, φₛ the sub-solar latitude and Δλ the difference in longitude.

Connecting Ridge (89.4398° S, 222.83° E) at 2026-12-15 12:00 UTC: the sub-solar point is at
103.4285° E, 1.3642° S.

| | Azimuth | Elevation |
| --- | --- | --- |
| By hand | 240.5881° | 1.0891° |
| Horizons, topocentric (cache) | 240.5879° | 1.0885° |
| Difference | 0.0002° | 0.0007° |

The two agree to under 0.001°, well inside the 0.27° half-width of the Sun's disc.

## Sub-solar point check

The sub-points and the per-site forecasts come from different Horizons queries, so they
should agree. Over the year the sub-solar latitude runs from −1.5524° to +1.5474°. That
matches the Moon's 1.54° axis tilt to the ecliptic.

At Connecting Ridge (89.4398° S, 222.83° E), the Sun's direction worked out from the
`app/data/sun/` sub-solar point with the formulas above, against the forecast's hourly values
(rounded to 0.01°):

| UTC | Sub-solar point | Azimuth by hand | Forecast | Elevation by hand | Forecast |
| --- | --- | --- | --- | --- | --- |
| 2026-12-01 00:00 | 280.0640° E, 1.4708° S | 57.2473° | 57.25° | 1.7739° | 1.77° |
| 2026-12-15 12:00 | 103.4285° E, 1.3642° S | 240.5881° | 240.59° | 1.0891° | 1.09° |
| 2027-01-11 16:00 | 133.1745° E, 0.8298° S | 270.3364° | 270.34° | 0.8331° | 0.83° |

Every difference is under 0.004°, inside the 0.005° rounding of the forecast.

## Check against the long-term sunlight average

[VALIDATION.md](VALIDATION.md) gives each site's sunlight averaged over the full 18.6-year
cycle, from the same horizons. The forecast year covers the Moon's full seasonal cycle
(346.6 days), so its average should sit close to the long-term one:

| Site | This year: Sun centre up | Long-term: Sun partly up | Long-term: visible disc |
| --- | --- | --- | --- |
| Connecting Ridge | 86.5% | 91.0% | 86.1% |
| Shackleton rim | 84.9% | 88.9% | 84.2% |

The forecast counts the Sun as up when its centre clears the skyline, which is stricter than
"partly up" and looser than "visible disc", so the year lands between the two.

Average hours per day, month by month (Sun / Earth):

| Month | Connecting Ridge | Shackleton rim |
| --- | --- | --- |
| Dec 2026 | 24.0 / 10.7 | 24.0 / 10.0 |
| Jan 2027 | 24.0 / 10.9 | 22.9 / 9.8 |
| Feb | 22.9 / 12.1 | 22.6 / 10.9 |
| Mar | 19.2 / 11.0 | 17.0 / 9.9 |
| Apr | 12.9 / 13.0 | 12.7 / 11.1 |
| May | 12.7 / 13.8 | 12.0 / 12.7 |
| Jun | 15.4 / 13.4 | 16.9 / 12.3 |
| Jul | 22.0 / 13.7 | 21.3 / 12.7 |
| Aug | 24.0 / 12.5 | 23.1 / 11.0 |
| Sep | 24.0 / 11.6 | 24.0 / 10.5 |
| Oct | 24.0 / 11.2 | 24.0 / 10.1 |
| Nov | 24.0 / 11.4 | 24.0 / 10.3 |

The April–May dip is the south pole's winter: the sub-solar point is north of the lunar
equator, so the Sun sits lower over the pole and drops behind the terrain for part of
each day.

## Rebuild provenance

The rebuilt indexes preserve filenames, daily fields and monthly hourly arrays. They
add `science`: visibility convention (`center`), frame evidence, datum, modeled ground
and observer heights, sample cadence, horizon grid step, and raw source headers plus
SHA-256 hashes of UTF-8 decoded response text. Full raw responses remain gzipped in
the local cache, including trailing warnings. Horizon JSON hashes normalize CRLF to LF
so they survive a Windows Git checkout. Missing horizons fail closed.

`calculation: {step, elevations}` keeps an unrounded scientific grid beside the legacy
display horizon. New horizon metadata includes `lat`, `lon`, `referenceFrame`, `datum`,
`surfaceElevation` (metres), and `observerHeight` (metres). `horizon.py` samples ground
from the same DEM stack as its rays. A legacy horizon without these fields needs regeneration.

Earth visibility means the center clears this skyline. It is not a link budget, a ground
station availability prediction, or a resolved-disc occultation model. The any/full-disc
variants in the validation report are sensitivity checks only.

## Current 30-site publication contract

The earlier unverified 31-site selection is superseded.
All 30 sites now have terrain; Blue Ghost 2 is absent. Existing forecast and sub-point
paths, names, units, array lengths and daily fields remain unchanged. The `science`
object and horizon metadata are additive. `forecast-manifest.json` records complete
coverage and hashes. JSON Schemas in `schemas/` describe the published monthly layout;
`validate_data.py` checks them plus identities, coverage and provenance links.
No ten-minute `observations/` export is required by the current app.
