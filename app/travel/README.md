# Travel UI

`forecast.js` owns the selected location, UTC time and trip range. `panel.js` adds the
Travel controls; `worker.js` calls the existing `computation/dist/travel.js` planner.
The existing forecast and pins retain their normal behavior when Travel is closed.

Date searches check catalog locations, then call the computation planner's bounded
discovery API targeting three south-pole and twelve other matching destinations.
Known south-pole sites seed discovery; other points are sampled independently.
The search reports progress and explicit shortfalls without weakening filters.
An optional 288-cell whole-Moon scan is available under About these results.
Region searches check daily arrivals for six calendar months, including each complete stay.
Published forecasts are preferred. Missing published coverage falls back to labelled
quick-compute estimates; mixed stays retain both sources. Unavailable data remains unknown.

Defaults come directly from `TRAVEL_DEFAULTS`: seven days, terrain enabled with slope
below 10 degrees over 100 m, full sunlight and Earth visibility, and no interruptions.
The hour sliders translate to coverage fractions and allowable unavailable hours;
More options can impose a tighter longest interruption. Known sites first changes only
ordering. Edits debounce for 450 ms, terminate obsolete work, and reject queued messages
from old workers. Failed and unknown checks remain in the science results but are not
listed as destinations. The independent map layers retain those distinctions.

`globe-layer.js` only projects scientific display polygons and Travel diamonds.
`thumbnail.js` renders the existing Moon mesh, shader and NASA maps from a camera
centred on each result. `thumbnail-worker.js` obtains arrival-time Sun directions from
published geometry through `productMoonDirections`, or the existing quick ephemeris
API outside publication coverage. Missing lighting produces an unavailable preview.
These are model views, with the main renderer's fill lighting, not survey photographs
or terrain-shadow certification. No new external imagery or production libraries.

Observer links preserve exact coordinates, arrival and `tripEnd`; its date scrubber
opens on the requested stay. Fractional stays retain exact endpoints in the route
and note, while the existing timeline remains a daily control.

## Verification

Serve `app/` with a static server. Run:

```powershell
node --test --test-isolation=none app/travel/model.test.mjs app/observer/route.test.mjs app/observer/date-scrubber.test.mjs
# Set TANAW_PLAYWRIGHT_PATH to an existing Playwright installation if needed.
$env:TANAW_TEST_BASE_URL = 'http://127.0.0.1:4189'
node app/travel/verify.mjs
node app/travel/verify-layout.mjs
node app/travel/verify-layers.mjs
node app/travel/verify-sources.mjs
node app/verify-main-page.mjs
```

The browser regression uses real workers/data and captures desktop, 390 px and 320 px
views. It covers baseline filters, automatic refresh/cancellation, unknown exclusion,
arrival selection and thumbnails, information tooltips, Observer handoff, animation,
whole-Moon layers, bounded discovery, compact forecast geometry, quick-source fallback,
mixed-source stays and coverage-end validation. The layer integration check keeps
map overlays on the main Moon while verifying that thumbnails remain surface previews.
Run browser suites serially.
Computation contracts retain their
existing tests under `app/computation`.
