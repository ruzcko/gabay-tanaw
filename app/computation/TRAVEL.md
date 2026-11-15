# Travel science

Travel is the provisional feature name. Data and computation only: no host, renderer,
controls or app UI are connected. The public entry point is `dist/travel.js` in the
browser, or `@tanaw/computation/travel` / `src/travel.ts` in Node. Existing landing
helpers stay available; the Travel facade composes the same implementations.
They reuse Python forecast events and the existing QuickEngine; no new ephemeris model.

```js
import {createTravelPlanner, globalLandingGrid, landingGrid} from './computation/dist/travel.js';
const planner = createTravelPlanner();
const point = { lat: -89.487, lon: 222.62 };
const criteria = {
  durationDays: 7, maxSlopeDeg: 10,
  minSunFraction: 1, minEarthFraction: 1,
  maxDarkHours: 0, maxEarthOutageHours: 0,
  terrainEnabled: true, sunlightEnabled: true, earthEnabled: true,
};
const site = await planner.evaluate(point, '2028-01-01T00:00:00Z', criteria);
const arrivals = await planner.windows(point, '2028-01-01T00:00:00Z', criteria,
  {stepHours: 24, signal});
const cells = landingGrid({south:-89.5,north:-89.47,west:222.5,east:222.65}, 2, 2);
const map = await planner.regions(cells, '2028-01-01T00:00:00Z', criteria, signal);
```

For Node/offline use, pass `createTravelSource({read})` to `createTravelPlanner`.
The default source reads `app/data/landing-terrain.json` in addition to existing saved
forecasts. Keep expensive custom/global calls in a worker when integrating the UI;
check cancellation and selection generation before publishing results. The host owns
one coherent date, area, criteria and result. Do not recalculate science in renderers.
The generated `dist/travel.js` entry is committed and introduces no app initialization
or automatic network work until called.

Travel estimates use `QuickEngine.forecast()` rather than constructing an observer
scene. It retains the same ephemeris, ten-minute samples, 0.25-degree horizon grid,
interpolation, 150 km range and 20/60 m ray spacing. It traces only the two horizon
bins needed by each Sun/Earth azimuth. Uncomputed bearings remain unavailable, never
flat. Provenance explicitly records `science.horizonCoverage` and its computed bins;
the horizon hash covers a 1440-value Float64 buffer with NaN at uncomputed bins.
This is not a full horizon suitable for display. Observer `run()` still produces one.

Both paths can stop a ray only after the maximum height of all loaded DEM pixels
proves that no remaining sample can exceed the current horizon. For target radius
`M = R + maxHeight`, eye radius `E`, and angular distance `a`, the upper slope is
`(M*cos(a)-E)/(M*sin(a))`; it decreases once `E*cos(a) <= M`. Bounds include numerical
margins. This changes computational work, not model resolution or pass thresholds.
Tests compare against unpruned full horizons, exact event times and full candidate
results. `scripts/benchmark-travel-quick.ts` measures identical two-south/three-elsewhere
batches using the original full-ray and optimized paths with the reported filters
(optional arguments: seed and elsewhere target). UI batch sizes are independent of filters.

`evaluate` returns individual `pass / fail / unknown` checks, duration-weighted
coverage, longest outages, a terrain screen, source segments and corrective guidance.
The combined status uses only enabled criteria: any failure wins; otherwise any unknown
stays unknown. Disabling a criterion does not erase its independent result.
Each evaluation also includes `days`: UTC calendar bins clipped to the stay, with
`startUtc`, `endUtc`, `durationHours`, `sunHours`, `earthHours` and source `quality`.
These reuse the same visibility intervals as the totals, without another forecast
request. Partial first/last days remain partial; missing coverage yields null hours,
never zero. Known days remain available even when another day is unknown.
`nearestLunarFeature(point, catalog)` provides the distance on the shared lunar sphere
and compass direction **from the catalogue coordinate to the destination**, not to a
feature boundary. Coincident/antipodal points have no direction.
`regions` returns FeatureCollection-shaped lunar polygons plus separate ID lists for
terrain, sunlight, Earth and their enabled intersection. Coordinates are lunar
planetocentric latitude / east-positive longitude in MOON_ME_DE421, **not terrestrial
WGS84**. Unwrapped longitude bounds can cross the map seam; the future renderer must
wrap/split those polygons. Each polygon is a display bin evaluated at its centre, not
an assertion that its whole area is flat. At most 256 cells per batch.

`windows` searches arrivals in [start, start + six calendar months), preserving the
UTC time and clamping month-end dates. It evaluates the **entire stay**, even past the
search end. Cadence defaults to 24 hours and accepts 1–168 hours. Results are sampled
arrival opportunities, not continuous optimal intervals. All passing dates are ranked
by the weaker enabled sunlight/Earth coverage fraction, then earliest arrival; `best`
is null when none pass. `results` retains failures and unresolved dates for explanations.
The solar/communications ranking is a product heuristic, not a NASA mission optimizer.

## Source selection and missing data

- 2026-12-01 00:00 UTC through 2027-12-01 00:00 UTC exclusive: prefer saved **Python** data.
  The adapter checks point identity, science conventions and the horizon SHA-256.
- Outside that year: the existing quick model, explicitly marked `estimate`, inside
  the shipped manifest's 1969–2100 range. No extrapolation beyond its endpoint.
- Crossing requests are split at each publication boundary. Every result retains
  per-segment quality and science provenance; it is never relabelled wholly accurate.
- Default `sourcePolicy: 'prefer-published'`: if the accurate source explicitly returns
  null for a custom location, compute a labelled quick estimate even within the year.
  Each segment includes `requestedQuality`, actual `quality`, `reason` and provenance;
  `reason: 'published-unavailable'` identifies this fallback. Display its estimate label.
  File corruption, invalid products and network failures still throw, never fall back.
- For strict coverage checks, use `createTravelPlanner(source, {sourcePolicy:'published-only'})`.
  This retains unknown for missing in-year products; outside the publication year it
  still uses quick estimates. Inject `accurate` or a prepared data directory as `baseUrl`
  to supply custom Python products. AbortSignal cancels between provider work.

## Bounded candidate discovery

```js
const result = await planner.discover('2027-01-10T00:00:00Z', criteria, {
  southTarget: 3, elsewhereTarget: 12,
  exclude: catalogAndDisplayedPoints,
  southAnchors: knownPassingPoints.filter(p => p.lat < -80),
  southLatitudeLimit: -80, anchorRadiusKm: 10,
  cursor: previousPage?.cursor, // Reset on a different date or criteria.
  maxSouthSamples: 48, maxElsewhereSamples: 144,
  seed: 20261115, maxElapsedMs: 60000, signal,
  onCandidate: event => postMessage({type:'candidate', ...event}),
  onProgress: progress => postMessage({type:'progress', progress}),
});
```

This searches random **points**, not all 288 grid cells. Seeded stratified samples
cover the south cap (-90 to -80 degrees by default) and the rest of the Moon (-80 to +90),
with exact poles excluded. Every block of 12 broad samples visits every 30-degree longitude
sector, with uniform-sine latitude strata. The south boundary is a configurable product
search region, not the -87.5-degree fine-DEM boundary or a NASA slope standard.
Four elsewhere attempts precede each south attempt because fine polar horizons cost
substantially more. Sampling continues until each quota is met or exhausted, or the
shared soft time budget expires. Targets are goals,
never guaranteed counts. Neither filters nor terrain quality are relaxed to fill them.
Optional `southAnchors` (up to 32 points within the south region) guide every other south
random attempt into a fresh random point within `anchorRadiusKm` (default 10, maximum 50).
The other south attempts retain broad coverage. Nearby points are independent evaluations;
an anchor's pass never transfers to a neighbor. Use known passing points as hints.
Legacy `southSeeds` still evaluate exact supplied points, interleaved with random points
so a long failing seed list cannot starve exploration. Omit them for new random pages.
Elsewhere samples remain broad and independently evaluated.
Use a worker; the time budget is checked between points and cannot interrupt a running
synchronous horizon calculation. Cancellation rejects instead of presenting a completed search.

`onCandidate({group,sampling,result,elapsedMs})` fires immediately for each verified pass;
append it rather than waiting for `discover()` to finish. The callback receives a detached
evaluation. `sampling` is `seed`, `random`, or `nearby`; these describe search strategy,
while `result.segments` describes accurate/estimate science provenance.

For **Load more**, pass the returned opaque `cursor`, the same seed/region/anchors/radius,
and `exclude` containing catalog and already displayed coordinates (maximum 10,000).
Each page requests additional passes. Independent per-group offsets avoid replaying early
points when one group reaches its quota first. Coordinate exclusions normalize longitude
and compare at 1e-7-degree precision; excluded points do not consume evaluation budgets.
`excluded` counters report skipped points. Changing seed, partition or anchors while reusing
a cursor is rejected. Reset on date/criteria changes. Keep one planner in a live worker
between pages to reuse loaded terrain/coefficients; terminate it when canceling an active job.

The result contains `candidates.south/elsewhere` (ordinary passing evaluation results),
`found`, `target`, `attempted`, `shortfall`, `terrainSkipped`, `elapsedMs`, `stopReason`
(`targets-met`, `time-budget`, or `sample-budget`), `seed`, `budget`, `cursor` and `samples`.
Each sample has its group, `sampling`, point, terrain, status, nullable evaluation `result`
and `timings` (`terrainMs`, `forecastMs`, `totalMs`).
When enabled terrain fails or is unknown, visibility computation is skipped and
`result` is null: no visibility conclusion is implied. `onProgress` receives snapshots
of attempted/found/target/terrainSkipped/excluded/elapsedMs initially and after each point,
plus `current: {group,point,stage:'terrain'|'forecast'}` before costly stages. `current` is
undefined initially and after a completed point. Progress is not a fabricated percent;
the number of failed points needed to find passes is unknown in advance.

With the shipped global terrain, random points outside the fine south-pole coverage
cannot pass the default terrain criterion. Return that shortfall honestly. A user may
explicitly disable terrain to find **visibility-only** candidates, which retain the
unknown terrain check, or supply a validated 20 m-or-finer screen via the source's
`terrain` callback. A coarser DEM, a catalogue name or a successful visibility check
does not establish flatness. Candidate results do not certify whole regions or safety.

Run `node app/computation/scripts/simulate-travel-candidates.ts` for bounded real-data
comparisons of default and visibility-only criteria inside the published year.
`node app/computation/scripts/diagnose-travel-discovery.ts guided` reproduces the reported
2027-02-26 01:47 UTC, seven-day stay with 18.3 h Sun / 13.2 h Earth minimums and
149.7 / 154.8 h maximum gaps, terrain disabled. `page2` resumes its saved cursor;
`continuous` and `terrain` exercise stricter filters. Reports under `out/` retain
actual known and random coordinates, hours, terrain, source segments and engine timings.

Intervals come from rise/set events and midnight states, not rounded daily-hour totals.
Coverage refers to body centres above the modelled terrain at 2 m observer height.
It does not imply a fully illuminated solar disk, usable irradiance or a radio link.
Nominal days are 86,400 UTC-label seconds, consistent with the existing forecast model;
this is not leap-second-aware SI-duration planning. Event cadence and model uncertainty
remain those of the source (normally ten-minute samples, interpolated event times).

## Defaults and terrain

The seven-day default follows the requested product behaviour. NASA's historical
[2022 candidate-region announcement](https://www.nasa.gov/news-release/nasa-identifies-candidate-regions-for-landing-next-americans-on-moon/)
used 6.5 days of continuous sunlight; `durationDays: 6.5` is supported. That announcement
also considers terrain and communications, but does **not** establish a universal
Earth-visibility percentage. Requiring continuous Earth-centre visibility is our
adjustable conservative preset, not an official NASA requirement.

NASA's [2025 Space Apps Artemis overview](https://ntrs.nasa.gov/api/citations/20250009323/downloads/ArtemisOverview2025IntSPAPPSChallenge.pdf)
lists a regional landing slope below 10 degrees on a 100 m baseline. This is a useful
screening basis, not a universal spacecraft limit. Actual vehicle limits differ.
The slope comparison is strict `< maxSlopeDeg`.

`science/landing_terrain.py` publishes four-point central-difference slopes across
100 m from the existing NASA LOLA 20 m south-polar product. Optional `--fine` uses one
PGDA fine DEM covering all four samples. Source pixels must be <=20 m to pass our
resolution screen (five pixels per baseline, an explicit implementation rule).
The shipped catalog has five resolved terrain screens and 25 unknowns. Coarse global
terrain cannot establish 100 m flatness. The TypeScript custom-point sampler uses the
same baseline and the shipped polar DEM, and is checked against Python. No height
texture, visual mesh or rounded horizon angle is used to infer slope.

Slope alone misses boulders, small craters, bearing strength and roughness. There is no
descent trajectory, thermal/energy budget, ground-station availability or relay model.
The output is regional screening data, never landing safety certification.

## Prepare new grid points

Make a JSON list containing one sample per cell with `id`, `name`, `lat`, `lon`,
`referenceFrame: "MOON_ME_DE421"`, `elevationDatum: "sphere-1737400m"` and coordinate
evidence. Use unique safe IDs. The existing NASA terrain inputs are documented in
`science/README.md`; do not treat a missing terrain file as a smooth surface.

```sh
python science/prepare_landing.py points.json science/cache/landing-data \
  --ldem /path/ldem_75s_240m.img --fine /path/pgda_5mpp \
  --windows /path/sldem2015 --polar60 /path/ldem_60s_240m.img --fetch
```

This orchestrates the existing horizon, Horizons fetch and forecast builder, and adds
the terrain screens. It writes an isolated static dataset, never the shipped catalog.
Omit `--fetch` to rebuild from the prepared cache. `createLandingSource({baseUrl})`
consumes that directory directly. Large region sweeps need offline preparation; the
default static catalog cannot supply high-resolution predictions at every lunar point.

## Verification and simulations

```sh
cd app/computation
npm test
npm run typecheck
npm run build
node scripts/simulate-landing.ts
```

Python: `python -m unittest discover -s science/test -p test_landing_terrain.py`.
Regenerate screens with `python science/landing_terrain.py app/data/sites.json
app/data/landing-terrain.json`. NumPy is the existing science dependency.

The simulation script writes `out/landing-review/simulations.json` and
`regions.geojson`. Run recorded on 2026-11-15: all 30 sites screened on 2027-01-01;
5,430 sampled arrivals across the next six months; five sites have passing arrivals
under the strict defaults. Connecting Ridge first passes on 2027-01-10 (27 passing
daily arrivals). The four-cell 2028-01-01 grid near that site has two combined matches.
Historical Apollo 11, future 2028 and publication-boundary cases retain their correct
quality labels. Apollo terrain is unresolved at the available resolution.

Separate editable wireframes are in `out/landing-review/mockups.html`; their
schematic Moon placement is illustrative, while the cited results match this run.

## Whole-Moon regression simulations

`globalLandingGrid()` produces 288 equal-area geographic bins (12 bands in
sin(latitude), 24 longitude sectors), covering both polar caps and the entire
longitude seam. Polygon edges reach the poles; sample points never do. Custom grid
dimensions support up to 4096 cells; call `regions` in batches of at most 256.
These are broad screening bins evaluated at their centres, not continuously surveyed
terrain polygons. No catalog membership is required.

Worker-local reuse keeps up to 32 forecast products, 64 partial point horizons, 64
visibility bounds, 64 validated published products, and one ephemeris sample buffer.
Filter edits reassess cached scientific products; date edits reuse exact terrain rays
and compute any missing bearings. Cached products are cloned and cancellation remains
active. Destroying the worker clears these caches.

Travel forecast, visibility prechecks and warmup prepare the full required terrain
footprint using the lossless tile transport. Observer full horizons retain on-demand
tile loading. Loaded extrema are unavailable while tiles are demand-loaded (positive
and negative infinity), so incomplete coverage cannot prune rays or prove darkness.
Both paths share the same pixel interpolation, ray spacing and horizon values.

`source.warmup?.(startUtc, endUtc, signal)` optionally loads and decodes the shared
south-cap terrain and requested ephemeris packs before Search. It computes no rays,
forecasts or candidates. Hosts must await an in-flight warmup before other source
operations, terminate/abort on close, and validate actual search dates normally.
For the 2027 benchmark, this loads about 58.6 MB of compressed terrain and 105 KB of
coefficients/manifest data; memory and network use start when Travel opens instead
of when Search is clicked. Report immediate cold searches separately from searches
after preloading. `profile-travel.ts label --warmup` measures that distinction.

The terrain hot loop reads a bilinear footprint from one tile when all four pixels
are inside it; seam/pole/edge footprints retain the original lookup path. Pixel
conversion and interpolation arithmetic order are unchanged. Ray-tail upper bounds
are calculated once per distance, not once per bearing. Regression tests compare
against the original four-lookup sampler and unpruned full horizons exactly.
`node app/computation/scripts/profile-travel.ts` records a fixed-seed CPU/load
breakdown under `out/travel-quick-performance/`.

Discovery may reject an impossible visibility candidate before tracing its horizon.
The proof uses the loaded DEM minimum at 150 km as a conservative negative horizon
bound, checked against every unchanged ten-minute ephemeris sample. It never assumes
a zero-degree horizon or overrides a prioritized published/prepared product. Strict
in-year missing coverage remains unknown. Progress adds `visibilityRejected` counts
and the `visibility-bound` stage; rejected samples have `result: null` and a
`rejection` proof, not invented full visibility metrics. All passing candidates still
receive the complete forecast and unchanged filters.

Run `node app/computation/scripts/simulate-global-landing.ts` from the repository root.
It evaluates all 288 bins, 96 seeded random non-catalog locations on two dates, 12
additional polar stress points, and six-month searches at 12 geographically spread
random points. Random points use seed 20261115 and one point per equal-area stratum
so the poles are not overrepresented and every broad lunar region is sampled.
All 396 distinct coordinates are synthetic tests, not mission landing sites.

Outputs are `out/landing-review/global/regions.geojson`, `simulations.json` and
`test-points.json`. The full-globe polygon file uses lunar MOON_ME_DE421 coordinates.
The 2028 cases exercise real quick computations with terrain horizons; 12 in-year
cases verify that absent custom Python forecasts stay unresolved. Global 100 m
flatness remains unresolved where only the coarse DEM is available. Sunlight and
Earth visibility still have independent populated layers. Split `test-points.json`
into batches of <=256 before using the Python preparation command.

Recorded global run: 492 point/date evaluations plus 2,184 sampled arrivals across
12 six-month searches. On 2028-01-01, 68 of the 288 grid cells meet the continuous
sunlight criterion and 130 meet continuous Earth visibility. The combined screen has
263 failures and 25 unresolved cells, with no full passes. The 192 random-date tests
have 160 failures and 32 unresolved results; all 12 polar stress cases fail at least
one criterion. Of 492 point/date evaluations, 486 have unresolved fine terrain.
The historical missing-custom-coverage check is retained under the explicit
`published-only` policy. The newer default policy additionally tests labelled in-year
fallback, source failures, bounded discovery, progress, cancellation and honest shortfalls.
