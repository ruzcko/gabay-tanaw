# Tanaw browser quick estimate

This optional engine computes Sun/Earth forecasts for a selected lunar point and UTC
date window in a Web Worker, using static assets only. Every index/month is marked
`quality: "estimate"` and `model: "Tanaw-DE440-ME421-v1"`. The published Python forecasts
remain authoritative. **Coarse terrain can change an entire day's visibility.** Do not
use this estimate for operational illumination or communications decisions.

## Model and data

- Complete, unchanged double-precision type-2 JPL DE440 coefficients, partitioned into
  yearly packs by `science/prepare_quick_coefficients.py`. No fitted or repeated monthly
  ephemerides. Model assets total 10,945,054 compressed bytes plus their manifest;
  the 2026/2027 pair is 164,501 bytes. Only requested years are fetched.
- Numerical DE440 lunar libration from `moon_pa_de440_200625.bpc`, with the fixed
  `MOON_ME_DE440_ME421` transform in `moon_de440_250416.tf`, following the same frame
  interpretation documented in [FORECAST.md](../../science/FORECAST.md#frame).
  The simplified visual IAU rotation is not used.
- Scene snapshots reuse this orientation for the fixed ICRS-J1991.25 star catalog at
  the selected UTC, with no added asset requests. Proper motion, parallax and aberration
  of catalog stars are not modeled. See [SKY.md](SKY.md).
- Sphere 1737.4 km; terrain ground plus 2 m radial eye height. Converged reception
  light time, relativistic observer aberration, Sun/Earth finite-source monopole
  deflection, apparent airless body centres. Smaller-body deflections, detailed
  relativistic light time, eclipses and resolved-disc occultations are not modeled.
- UTC→TAI→TT→TDB uses the USNO `tai-utc.dat` offset/rate segments before 1972,
  then the known leap seconds and periodic constants in `naif0012.tls`.
  Future leap seconds are unknown. Duration arithmetic retains the existing forecast's
  UTC-label convention, including its leap-second-duration limitation.
- Latitude strictly between −90° and +90°, east longitude normalized to [0,360).
  Supported years come from [the coefficient manifest](../assets/computation/quick/manifest.json),
  shared by the engine, worker and estimate date picker. Windows have UTC-midnight
  bounds and span 1–366 days. The manifest end is exclusive for selected dates; a
  window may end exactly there, using the last pack's original padded records only
  for that integration endpoint. Every polynomial evaluation still checks its actual
  coverage. Other years show `Estimate not available for this year.` inline.
  Exact poles and missing/corrupt assets fail explicitly without a neighbouring-year,
  smooth-horizon or all-dark fallback.

The skyline uses the shipped `assets/observer/terrain/16` grid and `polar20` south of
87.5° S, bilinear heights, spherical curvature, 1,440 azimuth rays at 0.25° and 150 km
range. Radial samples are 20 m for windows reaching the polar grid, otherwise 60 m.
No display blend, mesh LOD or exaggeration enters the scientific terrain adapter.
Polar tiles are downloaded only when their samples could raise the horizon; conservative
height bounds exclude samples that cannot change its value. Horizon interpolation is
cyclic linear; centre clearance must be >0.
Crossings are linearly interpolated on the full ten-minute grid, including month seams.

Polar horizon downloads use `polar20-delta-v1/`: a lossless transport copy of the
same signed half-metre samples. Row differences modulo 65536 are split into low/high
byte planes and gzip compressed. The worker restores the original little-endian
bytes and checks each decoded tile's SHA-256 before caching it. The source grid,
bilinear interpolation, 1,440 rays, radial steps and 150 km range are unchanged.
Within-tile samples reuse one tile lookup while preserving the arithmetic order;
tile boundaries, longitude wrap and pole clamping retain the original sampler.

Rebuild with `python app/tools/pack_horizon_terrain.py` from the repository root.
It reconstructs and checks the complete unpadded NASA source before writing the
transport copy. All 225 tiles total 34,943,486 compressed bytes, versus 64,195,557
for the original tiles retained for display. At (-89.44°, 222.83°), cold scientific
terrain downloads decrease from 58,625,972 to 32,533,451 bytes (excluding manifests).
Nearby selections reuse decoded tiles. Cancellation can still restart a worker;
this change does not introduce persistent horizon storage or approximate reuse.

The worker now loads `polar20-bounds-v1.bin` (28,800 bytes) before tracing polar rays.
It contains exact signed half-metre maxima for every 64×64 source-pixel block; the
generator checks the reconstructed NASA source and the worker pins the bounds hash.
Each bilinear sample is bounded by the maximum of all four neighbouring blocks plus
one metre of floating-point slack. For positive range below 150 km, apparent slope
increases with terrain height. A bound strictly below the ray's current maximum
therefore cannot affect its result. Otherwise, the original lossless 512×512 tiles
are required. Rays pause at missing samples, fetch their combined tile set with up to
eight requests at once, and resume in the original order. No height, ray spacing,
range, interpolation or result precision is reduced; ground height is always sampled
exactly. Invalid bounds or required tiles fail explicitly.

At (-89.44°, 222.83°), this reduces cold scientific terrain from 32,533,451 to
5,658,486 bytes, including the bounds and global tiles but excluding manifests:
an 82.6% reduction over eager lossless downloads, or 90.3% below the original
58,625,972 bytes. Polar tiles alone total 4,107,753 bytes. Other locations need
different tiles; this is not a universal byte or latency guarantee. `terrainLoadMs`
includes all download batches; `horizonMs` excludes those waits. Regenerate just
the verified bounds with `python app/tools/pack_horizon_terrain.py --bounds-only`.

`test/terrain-loading.test.ts` checks every decoded tile against its original,
corrupt/missing data rejection, and exact full-resolution horizon hashes captured
before optimization at nine polar, boundary, global and longitude-seam points.
It also verifies every block maximum against the original tiles, bilinear block/tile
corners, six additional unpruned horizon comparisons, cold and reused caches,
corrupt bounds, failed-tile retries and cancellation.

Global frame evidence is the [LDEM16 label](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.lbl)
(DE421 ME, 1737.4 km) and NASA SVS's description of the [lossless TIFF reformat](https://svs.gsfc.nasa.gov/4720/).
The adapter verifies the shipped source hash rather than accepting any `LOLA-ME` label.
Polar evidence is its pinned manifest and [PDS product label](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_875s_20m.lbl).
These grids are approximately 1.9 km globally (latitude sampling) and 20 m at the far
south pole. They are not the published sites' 5 m / 240 m / SLDEM2015 stack. There is
no fine north-polar product here. Features narrower than the source grid can be missed.

## Output and integration

```js
import { createQuickEstimateClient } from './dist/quick/client.js';
const client = createQuickEstimateClient();
const result = await client.estimate({
  lat: -89.4398, lon: 222.83,
  startUtc: '2026-12-01T00:00:00Z', endUtc: '2027-12-01T00:00:00Z'
}, abortController.signal);
// result.index, result.monthly['2026-12'], result.horizon, result.timings
client.dispose();
```

`index` retains id/name/lat/lon/horizon/ephemeris/science/window, start states, months
and daily hours/events/next events. `monthly` retains start/stepMinutes and all ten
hourly Sun/Earth angle, range, angular-diameter and visibility arrays. Both add quality
and model. `science.sources` names coefficient packs and decoded-byte hashes, with
truthful model headers; `horizonSha256` hashes the Float64 calculation array. It does
not impersonate Horizons provenance. `horizon` includes the display and unrounded
calculation grids; it is returned in memory, not published under an existing site path.

The observer and Moon pages share a timeline date picker and host-owned source loader.
Selecting a date updates the scene, Sun/Earth positions and daily readout together.
Both scrubbers follow the manifest coverage in estimate mode. Choosing a date updates
automatically, and scrubbing keeps the picker synchronized. The Moon page's saved
multi-site planning controls are unavailable in daily estimate mode.
The worker returns an exact selected-instant snapshot, with apparent bodies and
separate simultaneous geometric sunlight and Moon-frame directions. These directions
are checked against independent CSPICE vectors. No Earth texture orientation or star
rotation is inferred. The estimate mesh uses the same pinned terrain sampling rule.

`forecast-source.js` validates complete products and replaces an estimate atomically
when accurate results arrive. Cached or faster accurate results can display directly.
Saved accurate data covers December 2026 through November 2027; an optional compatible
service may provide other selections. Without it, those dates stay labelled estimates.
Unsupported years show the inline unavailable message. Cancellation and generation
checks prevent a late result from changing a newer scene, date or readout.

Each estimate product also carries `geometry`, an hourly track over its window in the same
shape and convention as `data/sun/<YYYY-MM>.json`: `{start, stepMinutes: 60, subsolarLat,
subsolarLon, subEarthLat, subEarthLon, quality: "estimate"}`, with sub-points in MOON_ME (Horizons
quantities 14 and 15, UT tags). `productMoonDirections` reads it and interpolates between hours,
as it does for published data. Measured against all 8,760 published hours: within 0.00015°.

## Full-year validation

`node app/computation/scripts/validate-quick.ts` compares every catalog site over
2026-12-01 to 2027-12-01: 52,561 samples/body/site, 365 daily rows and 8,760 saved
hours. The baseline is published Python data at `f6d7fac`, unchanged in merged main
`0aa9697`; it is not independent ground truth.
[quick-validation.json](quick-validation.json) contains per-site mean/max daily-hour
errors; separate sunrise/sunset/Earth-rise/Earth-set median/max timing errors and
unmatched counts; and mean/max Sun/Earth azimuth/elevation errors at saved hours.
Events are matched one-to-one by kind within 24 hours; unmatched events are explicit.
Do not interpret the matched timing statistics without their unmatched counts.

| Site | Sun h/day mean / max error | Earth h/day mean / max error |
| --- | ---: | ---: |
| Connecting Ridge | 0.224 / 9.38 | 0.054 / 1.10 |
| Connecting Ridge Extension | 0.090 / 8.27 | 0.048 / 1.08 |
| Shackleton rim | 0.422 / 19.82 | 0.010 / 0.41 |
| Peak near Shackleton | 0.073 / 6.23 | 0.039 / 0.99 |
| de Gerlache rim | 0.137 / 5.13 | 0.050 / 1.50 |
| Malapert massif | 2.016 / 24.00 | 9.651 / 24.00 |
| Mons Mouton | 5.905 / 24.00 | 2.714 / 24.00 |
| IM-2 Athena, Mons Mouton | 0.370 / 13.17 | 2.411 / 24.00 |
| IM-1 Odysseus, near Malapert A | 1.182 / 24.00 | 0.000 / 0.00 |
| Chandrayaan-3 | 0.136 / 2.80 | 0.000 / 0.00 |
| Apollo 11 | 0.030 / 0.79 | 0.000 / 0.00 |
| Peak near Cabeus B | 4.033 / 24.00 | 2.868 / 24.00 |
| Haworth | 3.148 / 24.00 | 1.993 / 24.00 |
| Mons Mouton Plateau | 4.408 / 24.00 | 10.354 / 24.00 |
| Nobile Rim 1 | 7.613 / 24.00 | 3.453 / 24.00 |
| Nobile Rim 2 | 1.042 / 24.00 | 0.285 / 6.30 |
| Apollo 12 | 0.002 / 0.06 | 0.000 / 0.00 |
| Apollo 14 | 0.175 / 3.74 | 0.000 / 0.00 |
| Apollo 15 | 0.069 / 1.83 | 0.000 / 0.00 |
| Apollo 16 | 0.016 / 0.50 | 0.000 / 0.00 |
| Apollo 17 | 0.063 / 2.17 | 0.000 / 0.00 |
| Luna 24 | 0.016 / 0.31 | 0.000 / 0.00 |
| Chang'e 3 | 0.001 / 0.04 | 0.000 / 0.00 |
| Chang'e 4 | 0.022 / 0.45 | 0.000 / 0.00 |
| Chang'e 5 | 0.016 / 0.29 | 0.000 / 0.00 |
| Chang'e 6 | 0.017 / 0.48 | 0.000 / 0.00 |
| SLIM | 0.064 / 1.27 | 0.000 / 0.00 |
| Blue Ghost Mission 1 | 0.031 / 0.52 | 0.000 / 0.00 |
| Reiner Gamma | 0.022 / 0.59 | 0.000 / 0.00 |
| Mons Gruithuisen Gamma | 0.100 / 3.12 | 0.000 / 0.00 |

Large daily errors concentrate at high-latitude ridges outside the fine polar grid.
For example, the coarse terrain puts Malapert's modeled ground 181.8 m below the
published terrain, and Mons Mouton Plateau's mean Earth-hours discrepancy is 10.35 h/day.
The az/el comparison is much closer: maxima are 0.005000° for Sun angles and 0.005026°
for Earth angles, largely the published 0.01° rounding plus different modeled ground.
Good sky positions do not imply a good skyline or event time.

The independent CSPICE test uses 32 site/date cases, with first/last dates and the
terminal integration endpoint drawn from the manifest, plus the year/month seam and
2028 leap day. Maximum az/el difference: 7.214e-7 degrees;
range: 0.000002522 km; orientation-matrix element: 1.021e-12. This cross-check uses the
same underlying JPL model through a different implementation (CSPICE `CN+S`), so it
is not a measurement of absolute physical accuracy or an independent terrain survey.
Generated fixture provenance and the reproduction script are committed.

## Measured performance

[quick-benchmarks.json](quick-benchmarks.json) and `scripts/benchmark-quick.mjs` record
real Chrome 157 module-worker runs on a Ryzen 5 3600 desktop with 16 GiB RAM. One cold
annual job per site/profile, then warm 7/14/28/90/182/365-day jobs; wall times include
worker startup and result delivery, not UI rendering. Fast 4G uses Chrome DevTools'
9 Mbps × .9 download, 1.5 Mbps × .9 upload and 165 ms latency settings, applied to the
worker with its Network domain enabled. Server-byte counts guard against false cache
or unthrottled measurements. This is not a physical laptop/mobile benchmark.

| Window/cache | Apollo 11 desktop | Ridge desktop | Apollo 11 Fast 4G | Ridge Fast 4G |
| --- | ---: | ---: | ---: | ---: |
| 365 days, cold | 0.938 s | 3.225 s | 2.164 s | 62.292 s |
| 7 days, warm | 0.009 s | 0.008 s | 0.007 s | 0.007 s |
| 14 days, warm | 0.014 s | 0.012 s | 0.011 s | 0.010 s |
| 28 days, warm | 0.022 s | 0.019 s | 0.019 s | 0.017 s |
| 90 days, warm | 0.074 s | 0.059 s | 0.054 s | 0.051 s |
| 182 days, warm | 0.131 s | 0.115 s | 0.103 s | 0.093 s |
| 365 days, warm | 0.251 s | 0.229 s | 0.196 s | 0.185 s |

The <=2 s target is **not met for every cold load**. Connecting Ridge transfers
58,625,972 terrain bytes on first use. Once its horizon is cached, date-window work is
small; a year takes roughly 0.18–0.25 s. These are single-run observations, not latency
guarantees. The all-site Node validation peaked at about 333 MB process RSS, including
validation arrays/reporting; this is not a measured browser memory bound.

Profiling preceded changes: the initial Node CPU profile was dominated by terrain
sampling (about 1.07 s in sampling/pixel access across two cold points), versus tens
to hundreds of milliseconds for a year's astronomy. Scratch typed arrays avoid
per-sample objects; calendar objects are created only at year transitions. Caching
the horizon removes terrain work when dates change. Filtering 28 wholly unused polar
tiles saves 7,091,518 bytes without reducing terrain resolution, ray length or cadence.
HTTP transfer still dominates a cold polar request. No claim of universal speedup over
the accurate pipeline is justified by these results.

## Checks and reproduction

- `npm test` in this directory: 50 tests pass (groups cover independent
  geometry/libration, terrain blocking, month seams/tangencies, a real 2028 forecast,
  cache isolation, unsupported inputs and fail-closed behavior; all manifest sizes and
  checksums, first/last supported dates and the terminal endpoint are also checked).
  Warm packs are revalidated against the current manifest checksum and sizes. Failed
  preparation clears terminal-endpoint authorization; a full final-year forecast agrees
  exactly with a separate terminal-day run, including the century leap-year rule.
- `npm run typecheck`: passes. `node scripts/build.mjs` regenerates browser-native JS,
  including the nested quick modules, without changing the existing static provider.
- `python -m unittest discover -s science/test`: 41 pass, none skipped, with
  `TANAW_TEST_KERNELS` pointing to the existing pinned validation kernels.
- `python science/validate_data.py`: 464 JSON files, coverage and provenance links pass.
- Published `app/data` and the observer renderer are unchanged.
- `node ../observer/verify-quick-estimate.mjs`: real Chrome worker and inline boundary
  checks, on-demand pack loads, and desktop/mobile date controls.
- The 30-site validation was rerun before and after the range change. Every scientific
  error metric equals the committed baseline exactly; only measured timings changed.

From the repository root, with existing NumPy/SpiceyPy validation dependencies:

```sh
python science/prepare_quick_coefficients.py --spk <de440.bsp> --kernels <kernel-folder> --out app/assets/computation/quick
python science/quick_reference.py --spk <de440.bsp> --kernels <kernel-folder> --out app/computation/fixtures/quick-reference.json
node app/computation/scripts/validate-quick.ts
node app/computation/scripts/benchmark-quick.mjs <chrome-executable>
```

The pack preparer validates pinned original hashes, retains complete polynomial records
including light-time margin, and emits deterministic gzip streams. Original kernels,
browser profiles and performance scratch files remain local. Source licences are in
[SOURCES.md](../SOURCES.md); no new JavaScript runtime library is installed.
