# Optional local observer service

A loopback Python service gives observer results for arbitrary clicked coordinates.
Published static forecasts and their audited build path remain unchanged.
This is a local preview capability, not a public deployment or a replacement forecast model.

`observer_service.py --kernels PATH --port 4400` serves only `app/` and four same-origin
GET endpoints: `/api/health`, `/api/observer`, `/api/observer-window`, `/api/terrain`. Calculation requests take
`lat`, `lon`, `t` (exact UTC hour within the published year), and optional catalog `site`.
Nonfinite inputs, exact poles, wrong IDs, duplicate keys and unsupported dates fail closed.
`app/computation/src/local-observer.ts` checks returned site/time, body units, frames and
unit vectors/quaternions before the host publishes the snapshot to any view.

Catalog samples come unchanged from published monthly files; the browser also compares
them with `createStaticForecastProvider`. Custom points use `fetch_ephemeris.query` and
`validate_response` for two one-day, 10-minute Horizons series. Python selects the exact
hour; it does not interpolate apparent directions or substitute a nearby catalog site.
Raw model/EOP headers and source hashes are retained. All NASA and SPICE operations share
one service lock, with a bounded request queue. Disconnected queued work is skipped;
already-running NASA requests may finish and warm the cache after browser cancellation.

The coordinated loading UI can prepare `/api/observer-window` with the same selection
plus `startUtc` (inclusive UTC midnight) and `endUtc` (exclusive UTC midnight). This
endpoint accepts exactly 30 consecutive days inside the published year, with `t` inside
that interval, for custom locations only. It fetches two bounded 10-minute Horizons
series, validates them, and retains 720 exact hourly body observations. Its response is
`{coverage: {startUtc, endUtc, stepSeconds: 3600, sampleCount: 720}, observation}`; the
selected observation preserves `t`. The optional `observations` array contains 30 exact
daily scenes at the selected UTC hour, each including lighting, Earth appearance and sky
rotation. The browser validates all timestamps and then scrubs this array without network
requests or interpolating scientific values. Nothing reports ready until both bodies are complete.
`/api/health` advertises `observerWindow: {durationDays: 30}`. The TypeScript
`readLocalObserverWindow` checks coverage and the selected observation before returning.

Prepared playback calls `/api/observer` with the same boundaries; this path never fetches
NASA data or falls back to daily calculation. Missing/evicted coverage returns an error
requiring explicit preparation. Eight prepared windows are retained in memory using LRU
eviction, while validated compressed raw responses share the 256-file disk cache. Raw
keys include the site, both boundaries, body and format version. Re-preparing an evicted
window can reuse those raw files. Requests without boundaries preserve the existing
single-day behavior. Catalog forecast requests and their full-year coverage are unchanged.

`observer_terrain.py` reads the pinned bundled LDEM16 tiles with bilinear sampling across
tile and longitude seams. It reuses `horizon.horizon` at 0.25° azimuth spacing, 150 km range,
and 2 m eye height. The terrain protocol extension leaves existing array/window paths
unchanged. This global product is coarse (~1.9 km at the equator), especially unsuitable
for assessing local polar ridges, landing safety or communications. The UI labels it.
The 20 km display mesh uses that same ground; mesh spacing does not imply source resolution.

`observer_appearance.py` verifies the four pinned validation kernels and bundled
`science/kernels/pck00011.tpc` before use. `pxform`
rotates ICRS/J2000 axes into `MOON_ME_DE440_ME421`, the DE421-aligned realization used in
the existing independent validation. Local display rows are east, radial up, south;
Moon display axes are x at zero longitude, y north, z west. CSPICE scalar-first
quaternions are reordered explicitly to x/y/z/w. `spkpos(..., NONE)` supplies geometric
Moon-to-Sun/Earth vectors; site-to-Sun subtracts the observer's radial position. Apparent
Horizons angles never become lighting vectors.

Hipparcos catalog directions remain fixed at epoch J1991.25. Proper motion, parallax,
stellar aberration/deflection and eclipse dimming are omitted. Earth uses the low-accuracy
IAU_EARTH text-PCK orientation for display, transformed into the same local frame. Its
geometric Sun direction produces the illuminated phase; the Blue Marble mosaic and clouds
are fixed imagery. This is not a precision Earth-orientation or weather model.
Star exposure uses catalog magnitudes and user gain. Daylight attenuation is an explicit
display approximation (magnitude limit 1.5 when the Sun center clears the terrain, 4.5
otherwise), not a calibrated camera or dark-adaptation model. The sky remains black.

Run unit checks with `python -m unittest discover -s science/test -v`; set
`TANAW_TEST_KERNELS` to the pinned kernel directory to include all-catalog and rotation
integration checks. Custom cache tests mock transport; live preview checks additionally
exercise the unchanged NASA response validator. Do not run concurrent live tests against
NASA while the separate benchmark workflow is measuring network performance.
