# Earth visibility accuracy audit

Baseline: `origin/main` at `2ecd7c1`, 31 sites, 2026-12-01 through 2027-12-01.

This is the historical accuracy experiment. Its 31-site counts and unresolved-frame
status describe that baseline; the current catalog was rebuilt
afterwards.
Audit run: 2026-11-14. No UI or published `app/data` files were changed.
Machine-readable measurements and kernel hashes: [earth-validation.json](earth-validation.json).

## What changed

- Python uses the same ground plus observer height as the terrain calculation,
  checks returned coordinates, lunar radii, airless model, API 1.2/1.3 and exact
  `MEAN_ME (high precision)` center frame. Unverified site frames are rejected.
- Monthly cache joins require identical shared endpoints, matching columns and
  continuous cadence. Missing terrain, missing data and different Sun/Earth calendars fail.
- Terrain keeps full precision on a default 0.25-degree calculation grid. The
  rounded one-degree display array and existing forecast filenames/fields remain compatible.
- Event interpolation uses actual timestamps. Both ten-minute and optional one-minute
  inputs produce exact hourly monthly output. Full source headers and hashes accompany
  rebuilt indexes; raw caches preserve source warnings as well.
- Browser computation checks the monthly contract and returns saved center-visibility
  states. It does not calculate visibility from rounded display angles.

## Reference method and evidence

The independent implementation is NASA CSPICE via SpiceyPy 8.4.0, with DE440s,
the DE440 lunar orientation kernel, `MOON_ME_DE440_ME421` frames and NAIF leap seconds.
[`spkcpo`](https://naif.jpl.nasa.gov/pub/naif/toolkit_docs/C/cspice/spkcpo_c.html)
evaluates an observer fixed on the Moon at reception, with converged light time and
stellar aberration (`CN+S`). An independently constructed east/north/up basis gives
azimuth and elevation. This does not implement Horizons' gravitational deflection.
SPICE and Horizons use related JPL models: this checks implementation, frames, units,
altitude and timing, not an independent physical measurement of the Moon.

| Check | Result |
| --- | --- |
| Published Earth positions, one noon per day at all 31 sites | 11,315 samples over all twelve months |
| Maximum angular separation from rounded published directions | 0.006961 degrees (consistent with two angles rounded to 0.01 degrees) |
| Maximum range difference from whole-km published ranges | 0.500974 km |
| Earth center-visible state disagreements at those instants | 0; six samples within 0.01 degrees of the skyline |
| Refetched full-precision Earth positions, three verified sites, December | 2,235 hourly samples including endpoints |
| Maximum angular separation / range difference | 0.000000544 degrees / 0.000189 km (0.189 m) |
| Six December polar crossings, Horizons ten-minute interpolation vs continuous SPICE roots | Maximum 0.079 seconds |
| Same SPICE model/grid: ten-minute vs one-minute interpolation error | Max 0.082 s vs 0.0036 s on these six crossings |
| Equatorial near-side / far-side controls, 2026-12-01 | Earth elevation +83.165 degrees / −83.228 degrees |

All-year comparison uses the legacy zero-altitude convention to test the existing
published data on its own terms. Seventeen sites have verified frame metadata;
fourteen are explicitly unverified. For those fourteen, agreement is conditional on
interpreting the supplied numeric coordinates as mean-Earth. It does not verify their
survey location, and the new strict builder will not silently adopt that assumption.

## December rebuild differences

Three verified sites were regenerated from the documented LOLA 240 m and PGDA 5 m
terrain data, refetched from Horizons, and rebuilt locally. The two polar sites use
their sampled ground elevations plus 2 m; Apollo 11 uses modeled ground zero plus 2 m.

| Site | Observer altitude above reference sphere | Change in summed daily Sun minutes | Change in summed daily Earth minutes |
| --- | --- | --- | --- |
| Malapert Massif | 4.989887 km | +2.4 | −9.0 |
| Leibnitz Beta Plateau | 6.458183 km | 0.0 | +17.4 |
| Apollo 11 (smooth model) | 0.002000 km | 0.0 | 0.0 |

These compare the actual daily JSON hours, rounded to 0.01 hour per day. Isolating
changes with full-precision SPICE on one common ten-minute time grid gives:

| Incremental Earth-visible time change | Malapert | Leibnitz |
| --- | --- | --- |
| Correct observer altitude, retain old rounded skyline | −2.274 min | −3.145 min |
| Remove one-degree skyline rounding | −8.216 min | +4.842 min |
| Refine azimuth grid from one degree to 0.25 degree | +2.067 min | +15.251 min |

The terrain representation dominates the small temporal interpolation error in these
cases. Quarter-degree sampling is a refinement, not proof that terrain error has
converged or that the actual horizon is known to that accuracy.

## Visibility definition matters

The production definition remains **Earth center above the skyline**. A spherical
disc sensitivity calculation (using a 6378.1366 km equatorial radius) changes December
Earth-visible hours at Malapert from 408.326 center hours to 458.537 any-disc hours or
361.003 full-disc hours; at Leibnitz, 431.647 becomes 485.699 or 381.469 hours.
These are vertical-radius approximations, not resolved-disc occultation: Earth is
oblate and the skyline can vary across its roughly two-degree disc. They do not model
which terrestrial ground station is visible, antenna pointing or a radio link budget.
Do not compare these center forecasts directly with NASA products using any-disc
visibility over an 18.6-year window.

## Tests and reproduction

Passed: 12 Python regression tests, 17 TypeScript tests, TypeScript typecheck and
browser build. The TypeScript suite validates all 372 monthly forecast files,
271,560 hourly records and 31 year indexes. This is a format/coverage check, not a
claim to have independently validated every hourly visibility state.
The live Apollo 11 one-day fetch/build also passed at one-minute cadence (24 output hours).
Test comments explain the scientific failure each regression guards against, including
incompatible frames, stale cache altitudes, changed monthly boundaries and a narrow
visibility interval that coarse sampling misses entirely.

Run from the repository root (Node 24.13+; Python with numpy/rasterio for terrain):

```sh
python -m unittest discover -s science/test -v
node --test --test-isolation=none app/computation/test/*.test.ts
npm --prefix app/computation run typecheck
npm --prefix app/computation run build
pip install spiceypy==8.4.0
python science/fetch_validation_kernels.py science/cache/kernels
```

Create `out/review/sites.json` containing the unchanged catalog entries for
`malapert-massif`, `leibnitz-beta-plateau` and `apollo-11`, in that order. Download
terrain using [README.md](README.md), then:

```sh
python science/horizon.py science/cache/raw/ldem_75s_240m.img out/review/sites.json out/review/horizons --fine science/cache/raw/pgda_5mpp
python science/fetch_ephemeris.py out/review/sites.json out/review/cache 2026-12-01 31 --horizons out/review/horizons
python science/build_forecast.py out/review/sites.json out/review/cache out/review/horizons out/review/forecast
python science/earth_accuracy.py science/cache/kernels out/review
```

The output report remains in `out/review`. Source dependencies are attributed in
[SOURCES.md](SOURCES.md). The committed report records the kernel hashes; the download
helper checks those hashes before use. Neither kernels nor generated review forecasts
are shipped to the browser.

## Limits and next validation

This audit does not rebuild all 31 year-long forecasts: fourteen source frames still
need evidence, and only the three-site December refetch was performed. It does not
establish terrain accuracy against ground truth, solve eclipses, validate lunar-pole
azimuths, or provide a universal event tolerance. Future UTC/EOP and related-ephemeris
model limitations remain in the raw headers. Verify narrower terrain/time sampling at
grazing cases and other seasons before claiming a global accuracy bound or publishing
replacement forecast data. No backend, observer integration or Moon UI change is included.
