# Coordinate and UTC handoff to the observer

The observer is a separate page from the globe/forecast page. Its existing
`connectObserver()` integration now defaults to the saved forecast provider. The first
page owns the selected location and UTC instant; the observer has no separate clock.
The site panel's Observer view link opens `observer/index.html` (driven by `demo.js`),
which loads that selection from the static forecast provider.
Fixture-only controls show saved/unsupported states on the production page.

## Receiving the first page's selection

```js
import { connectObserver } from './integration.js';

const connection = connectObserver({
  container: document.querySelector('#view'),
  onStatusChange: status => { /* host handles loading / ready / error */ },
  onError: error => { /* host shows error.message; prior observation remains old */ }
});

// Values supplied by the originating page (or decoded by the host from its route).
// Site ID is optional. Use full catalog coordinates, not rounded display labels.
await connection.update({
  latitudeDeg: selectedLatitude,
  longitudeEastDeg: selectedLongitude
}, selectedInstantUtc);

// On later selections, call update again; on leaving the page:
connection.dispose();
```

Coordinates mean planetocentric latitude and east longitude in `MOON_ME_DE421`, above
the `sphere-1737400m` datum. Both signed and 0–360 longitude representations work. The
adapter resolves an exact catalog match, allowing only floating-point roundoff in the
longitude wrap (less than 4e-13 degrees), with no geographic nearest-site search.
Optional `id`, `referenceFrame` and `elevationDatum` assertions must agree. An ID alone
cannot substitute for the selected coordinates. Never label coordinates from another
frame as catalog coordinates without a validated conversion.

Pass a full ISO UTC instant such as `2027-01-01T00:00:00Z`; seconds and `Z` are required.
The current forecast page's `tanaw:select` event carries `{site, sites, date, instant, ...}`,
`tanaw:time` carries `{instant}` on autoplay hour ticks, and `tanaw:sky` carries
`{site, hour, ...}` for the autoplay hour or the default lit hour. Resolve the
catalog entry by `site`, pass its full `lat`/`lon`, and use the host's actual `hour`.
Do not replace that selected hour with midnight or recalculate it in the observer.

The enabled site panel link passes `observer/?site=<id>&lat=<latitude>&lon=<longitude>&t=<UTC>`.
Its `t` is the host's autoplay instant when set, including after pausing; otherwise it
is the lit hour unchanged, or selected-day midnight while that hour is unknown.
Changing sites retains an autoplay hour; manually changing the day resets to the
default lit-hour selection, matching the host. `route.js` accepts full coordinates,
direct `lat`/`lon`/`t` links without
an ID, and existing `site`/`t` bookmarks (resolving their catalog coordinates). Duplicate,
missing and malformed values fail explicitly; absent selections never default to a fixture
or the current time. If ID and coordinates are both supplied, the provider checks both.

`demo.js` reads `site`, `lat`, `lon` and `t` through `route.js`, selects the matching
catalog site, and loads its published forecast. On static hosting, custom coordinates
and map picks automatically use quick estimates without an `estimate=1` link. The
selected UTC hour is preserved and the timeline uses the coefficient manifest's range.
Accurate data replaces the estimate when available; otherwise it stays labelled as an
estimate. When a local observer service is available, its progressive custom-window
workflow remains available.

## What reaches the renderer

`connectObserver.update()` → `createSnapshotLoader()` → `createStaticForecastProvider()`
→ `toObserverViewSnapshot()` → the real view's `setSnapshot()`.

The provider loads `data/sites.json`, `data/forecast/<id>.json`, and
`data/forecast/<id>/YYYY-MM.json`. It checks catalog identity, index window, frame,
evidence and science metadata, then reuses `validateForecastMonth` and `readForecastHour`.
Saved apparent angles, ranges, angular diameters and Python's `centerVisible` values
travel together. Visibility is never inferred from rounded angles or rendered terrain.

The index's `science` supplies modeled ground elevation, observer height, frame and
datum. Do not pass the catalog's rounded `surfaceElevationM` as the model height.
If explicit `surfaceElevationM` or `observerHeightM` is supplied, it is an assertion
and must exactly match the saved model. The renderer does not resample or change it.
All source headers/hashes, horizon hash/cadence, `frameEvidence`,
`coordinateFrameReview` and optional `positionAccuracy: "approximate"` are preserved
under `snapshot.provenance.forecast.science`. Snapshot copies cannot mutate the cache.
Evidence strings remain as published; empirical terrain consistency is not a measured
frame registration or a positional error bound.

The validated longitude bridge changes representation to [-180,180) for the observer;
it does not rotate frames or change physical directions. Rendering, camera behavior,
controls, styles and layout are unchanged. `centerVisible` is available in the snapshot;
this change does not add visibility labels or use it to change renderer occlusion.

## Availability, requests and ownership

Only the 30 catalog locations and exact saved hourly instants in
`[2026-12-01T00:00:00Z, 2027-12-01T00:00:00Z)` have forecasts. Coordinates and times
are accepted as selection inputs; unavailable selections return `false` from `update`
and invoke `onStatusChange('error')` and `onError`. No snapping, interpolation, fixture
fallback, all-down fill or arbitrary-site simulation occurs. Missing files, missing
metadata, invalid arrays and unsupported height/frame/date selections stay explicit.
The last coherent view is retained during loading/error; the host must label that
state and must not present the retained view as the newly requested selection.

Downloads are cached by file, up to 64 files per provider. Same-month hours reuse
validated arrays, including concurrent consumers. Cancelling the last consumer aborts
obsolete transport after one event-loop turn, allowing an immediate new hour to reuse
the pending month. Failed/cancelled entries can be retried. The existing generation
guard rejects late results even if a provider ignores cancellation. Disposal cancels
the connection and its owned provider; injected/shared providers remain caller-owned.

Geometric sunlight, Earth orientation/illumination/phases, star rotation, Moon-frame
overview body directions and eclipses remain explicitly unsupported. No `lighting`,
`earthAppearance`, `sky` or `overview` is invented. Existing neutral/reference-ground
fallbacks remain. Visual terrain is optional and requires its own validated frame,
datum and modeled-ground agreement; this adapter does not relabel `LOLA-ME` assets or
claim the renderer's DEM matches the forecast's scientific horizon.

## Verification

From the repository root:

```sh
node app/computation/scripts/build.mjs
node --test --test-isolation=none app/computation/test/*.test.ts app/observer/*.test.mjs
npm --prefix app/computation run typecheck
python -m http.server 8000 --directory app
```

Open `/observer/verify-forecast.html`. It calls the actual `connectObserver()` with
coordinates/UTC, checks the values passed through the real `setSnapshot()`, observes
WebGL rendering/readouts, camera persistence, monthly reuse, rapid handoffs, unavailable
selections, a real HTTP 404, and cleanup. `/observer/verify.html` remains the separate
synthetic renderer regression suite. Node data-adapter/loader tests alone do not prove
browser rendering or production navigation. No production route is mounted by these tests.

`verify-window-loading.mjs` (run in CI against static hosting) follows the Moon page's
actual Observer view link into the observer page and checks the selected site and UTC.

Local review results: 42 Node tests passed (5 route tests, 7 static-adapter/loader tests,
30 existing checks); computation and observer declaration typechecks passed. In the
in-app browser, all 26 production page/navigation checks, 20 forecast integration checks
and 13 existing renderer checks passed. The harnesses used real static HTTP files and
WebGL; the deliberate missing-file check returned HTTP 404. Desktop and narrow-screen
layouts were inspected. These results do not validate terrain agreement or unsupported
physical appearance. Renderer/camera source, synthetic demo, science and data remain unchanged.
