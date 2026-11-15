# Tanaw observer â€” Stages 1â€“3

## Custom locations and loading

The timeline's date picker updates the scene and daily Sun/Earth-hours
readout together at 00:00 UTC. The date picker and estimate scrubber use the shipped
[coefficient manifest](../assets/computation/quick/manifest.json). Unsupported years
show `Estimate not available for this year.` inline; the previous scene retains its
actual UTC label. Only requested year packs load. Deep links preserve the selected
date, site and estimate mode between the observer and Moon page.
On static hosting, custom coordinate links and Moon-map selections enter estimate
mode automatically, preserving the chosen UTC hour and range without a special URL.

Both hosts share `forecast-source.js`: estimates appear while accurate data loads,
and a validated accurate product replaces the complete result. A cached or faster
accurate result can display directly. Saved accurate forecasts cover December 2026
through November 2027. Other selections stay explicitly estimated when the optional
accurate service is unavailable. Late responses cannot replace a newer selection.
Estimate Sun/Earth placement, geometric sunlight and Moon-frame directions come from
the computation module; dated Earth texture orientation and stars remain unsupported.
The overview uses the NASA Blue Marble texture with explicitly illustrative rotation
when no Earth orientation is supplied. Sun granulation is illustrative, not dated imagery.
Coarse display relief appears first; detailed terrain then loads independently of
whether the forecast is estimated or accurate. All 30 catalog sites have detailed
meshes. Custom locations south of 60.3°S refine to 240 m LOLA sampling (20 m near the
south pole); elsewhere the UI explicitly reports that detail is unavailable.
The mesh is uniformly aligned to the snapshot's ground height, without changing
the scientific observer, horizon or visibility. A failed refinement retains coarse relief.

Run `node app/observer/verify-quick-estimate.mjs` from the repository root for both
viewers' real worker, scene-date, boundary-message, accurate-upgrade and layout checks.

In the observer page (`index.html`), custom and catalog locations support durations up to
365 days, chosen in days, weeks, months or a year, preserving the selected UTC minute. The window fits
inside the manifest coverage in estimate mode, or the published year in saved mode; an unsupported initial date is an
error, never shifted. Matching catalog coordinates retain the published-data path.
Changing location preserves the chosen range. The range picker remains available while loading.

The host composes the existing validated 30-day endpoint into a progressive range,
with one request in flight. The selected date's chunk loads first; selecting an unloaded
date prioritizes its chunk after the current request. The final chunk overlaps earlier
dates to stay inside the requested range and forecast year. Daily snapshots deduplicate
by exact UTC instant and remain in memory for the active site/hour, so server cache
eviction cannot interrupt playback. The bright timeline segments and ready-day count
show validated coverage as it arrives. Failure retains loaded dates; Retry resumes
missing chunks. New sites/ranges cancel obsolete work and reject late results. No new
science calculations, interpolation or annual service response are introduced.
See [the service contract](../../science/OBSERVER_SERVICE.md).

Loading labels reflect catalog, preparation, observation and terrain-mesh work. Small
indeterminate indicators stop when that work finishes or fails, and become static
under reduced motion. The previous observation keeps its site and UTC label. Late
responses cannot replace a newer selection, even if transport ignores cancellation.

Run the deterministic browser integration checks against a static `app/` server:

```sh
node app/observer/verify-window-loading.mjs
```

The harness uses Playwright from the testing environment (`TANAW_PLAYWRIGHT_PATH`
optionally selects its installation), defaults to Edge and `http://127.0.0.1:4410`,
and writes screenshots to `out/window-review`. Set `TANAW_TEST_BROWSER`,
`TANAW_TEST_BASE_URL` or `TANAW_TEST_OUTPUT` to override those defaults. Responses are
explicit synthetic UI fixtures: this tests orchestration, races, errors, coverage
checks, boundary dates, catalog behavior, accessibility and 320/375 px layouts, not
scientific accuracy. Real service checks remain separate.

The renderer retains the [lunar overview API](STAGE3.md) for integration checks.
The Observer page stays in Observer view; site selection uses the Moon navigator,
without a duplicate catalog picker or presentation dropdown.

The demo follows the Moon page's Atkinson typography, black background and outlined
controls. View options opens secondary settings beside the scene on desktop and replaces
the scene with a scrollable settings sheet on phones; Close or Escape returns to the scene.
UI motion respects reduced-motion preferences. The upper-right Moon navigator supports
drag/arrow-key orbit, wheel/+/- zoom, click to choose a location, and Enter/Space to select
the center. A header button hides/shows it; Whole Moon returns to the main Moon page
with the selected date and location. The redundant navigator overview button is removed.
The date line below the site data shares the Moon page's number-and-unit duration picker.
Dates preserve the selected UTC hour (00:00 by default). One accepted snapshot owns both views.
The upper-right Moon navigator is about 24% smaller than the original default
(15%, then another 10%), with a camera-relative N/E/S/W compass around it.
Textured Earth and shaded Sun models stay visible on fixed screen-space rings
while the Moon zooms. Their bearings follow snapshot directions; the rings are
schematic guides, not predicted orbital paths. Sizes and distances are not to scale;
Earth lighting is illustrative, and its rotation uses snapshot orientation when
available. Lunar overview default framing contains
the Moon, Sun and Earth at schematic distances of 2.5 and 1.9 Moon radii; real directions
remain unchanged. Body labels stay inside the viewport. Orbiting can reveal bodies
behind the Moon; zooming can intentionally move them out of frame.
A fixed-size white site highlight and Current site label identify the selected location;
they hide when that site is behind the Moon. Back to observer retains the site, time and
observer camera, returning keyboard focus to the navigator canvas.

### Local science preview

Run from the repository root, using Python with numpy, jsonschema and SpiceyPy 8.4.0 installed:

```sh
python science/fetch_validation_kernels.py science/cache/kernels
python science/observer_service.py --kernels science/cache/kernels --port 4400
```

Open `http://127.0.0.1:4400/observer/`. The service binds only to loopback;
no public hosting or deployment is added. It preserves published forecasts at catalog
sites, and calls the existing Python Horizons path for arbitrary coordinates. The last
coherent scene remains visible during loading/failure; Retry forecast repeats the request.
Raw custom-site days are cached under `science/cache/observer-cache`, capped at 256 files.

Custom sites use the existing global LDEM16 product (~1.9 km equatorial sampling),
not the reviewed high-resolution catalog horizon stack. Python owns their 0.25Â°,
150 km horizon and 2 m eye-height observations. The displayed patch is 20 km across.
The renderer's catalog mesh restores only the center vertex's catalog rounding (at most
0.051 m) to the precise forecast ground; it never changes the scientific observer height.

The service adds DE440 geometric sunlight and date-dependent Hipparcos catalog rotation.
Stars retain J1991.25 positions without proper motion, parallax or stellar aberration;
the result is a visual star field, not precision astrometry. Star light controls exposure.
Automatic exposure fades magnitudes above roughly 1.5 when the published Sun center is
visible, versus 4.5 in darkness. These are illustrative display thresholds, not measured
human/camera sensitivity. No atmospheric twilight or physical twinkling is implied.
Earth orientation uses a low-accuracy IAU display model with geometric illumination;
the Blue Marble cloud mosaic is static, and eclipse effects remain unavailable.

On a plain static server, catalog dates still work; custom coordinates and stars require
the local service. See [the service contract](../../science/OBSERVER_SERVICE.md).

The [display material pass](MATERIALS.md) adds south-pole relief shading, restrained
ground detail and shared Earth appearance. The demo starts at the south pole.

Stage 2 is implemented. See [STAGE2.md](STAGE2.md) for terrain/assets integration,
source preparation, performance and current limitations. The basic API below still
works without providers; the historical Stage 1 limits describe that fallback only.

Plain JavaScript ES modules, using the already-vendored Three.js. No install or build.
Serve `app/` as described in the parent README, then open `/observer/`.
Import `observer.css` once and give the container a nonzero height.

For the separate observer page receiving coordinates and UTC from the globe/forecast
page, use [the static forecast handoff](INTEGRATION.md). The enabled Observer view link
opens `observer/?site=...&lat=...&lon=...&t=...`, which uses the saved forecasts.
`verify-window-loading.mjs` tests that navigation from the Moon page.

## Module layout

| Location | Responsibility |
| --- | --- |
| `app/observer/index.js`, `index.d.ts`, `contract.d.ts`, `observer.css` | Public rendering API, declarations, shared snapshot shape and styles |
| `app/observer/integration.js` | Optional adapter to the host's computation provider and clock |
| Other runtime `.js` files in `app/observer/` | Rendering, materials, geometry, local providers and workers |
| `app/observer/demo.*`, `*-fixture.js`, `fixture.js` | Standalone synthetic demonstration; not imported by the rendering entry point |
| `app/observer/*.test.mjs`, `verify*` | Colocated automated and browser checks; not runtime dependencies |
| `app/assets/observer/` | Prepared Earth/star assets and compressed terrain tiles with source manifests |
| `app/assets/moon-*`, `app/vendor/three/` | Existing shared lunar textures and Three.js; reused without copying |
| `app/tools/prepare_observer_assets.py`, `prepare_polar_terrain.py` | One-time source preparation, outside browser runtime |
| `.terrain-raw/` | Ignored local downloads; not required to run the prepared app |

Keep these relative locations when copying the module with the bundled local providers;
provider/worker URLs resolve relative to their ES modules. A host may instead supply its
own terrain and asset providers. The observer has no package manifest, generated `dist`,
or separate build. The integration and snapshot loader import the computation module's
committed browser JavaScript for static forecasts and coordinate/time checks. Include
`app/computation/dist/` and `app/data/` when deploying this integration.

Module usage and technical notes remain beside the implementation. The existing globe entry point is
unchanged; the demo is a separate route rather than a replacement for `app/index.html`.

## Basic usage

```js
import { createObserverView } from './observer/index.js';
const observer = createObserverView({ container, onError: console.error });
observer.setSnapshot(snapshot);
observer.lookToward('earth');
observer.setOptions({ earthPointer: true, belowHorizonCutaway: false });
// Host time/site changes call setSnapshot. No internal simulation clock.
// Before removing the container:
observer.dispose();
```

The Sun and Earth readouts and Look toward controls share a 650 ms camera turn along the
shorter azimuth arc. Readouts retain their plain text appearance and support Enter/Space.
Dragging or using arrow keys interrupts the turn; retargeting starts from the current view.
Reduced-motion preferences skip the animation. Hosts that need immediate framing can call
`lookToward('earth', { animate: false })`; snapshot updates still own all body positions.

`integration.js` defaults to saved forecasts and accepts coordinates plus UTC. Call its
`update(site, utc)` on host selection changes. Changed heights require corresponding
saved data; arbitrary heights and fractional hours return explicit errors. Its generation guard
rejects obsolete results even if the provider ignores cancellation. The previous snapshot
remains visible while loading; use its status callback for a host loading indicator.

`contract.d.ts` documents degrees, metres, kilometres, frame/datum, and direction kind.
The rendering axes are east +X, up +Y, north -Z. Longitude is east-positive [-180,180].
Observations must already correspond to the site's supplied UTC instant and height.
This module computes no ephemerides, Earth rotation, phase, or scientific visibility.
The host owns the frame/datum conversion and must confirm the local up convention.

Controls: drag or arrow keys to look; wheel or +/- to zoom. The observer uses
rectilinear perspective, starting at 60 degrees diagonal FOV. Zoom runs from 10 degrees
diagonally out to 90 degrees tall or 150 degrees wide, whichever comes first.
The page opens facing Earth when the forecast shows it, else the Sun, with the horizon
in the lower part of the view; with neither in view it looks level toward the body
nearest above the horizon, else toward Earth. Later dates keep the camera.
The Sun is a `--sun` disc over the main page's soft glow. Without supplied Earth
orientation, Earth is textured and lit along the snapshot's Sun direction, with its
north along the Moon's and an illustrative rotation.
Sun and untextured Earth discs face the camera to keep their display circular;
their centers retain the supplied astronomical directions. The overview keeps its independent 45-degree perspective camera
and distance-based zoom.
The observer timeline shows the host forecast's daily Sun-above-terrain and Earth-in-view
hours in the Moon page's date-column layout, without the mission Call row. Columns select
dates and scroll horizontally for longer windows. Controls run Play, date/time, slider,
then duration. Playback advances a frame-driven UTC clock through whole minutes, reusing
loaded forecast data and exact estimate geometry. The speed button beside Play cycles
1×, 2×, 4×, 8×, then 1×. Clock, slider and scene commit together; pause/resume waits for any
old frame to finish without displaying it. Playback waits for each shared scene and
pauses on manual selection, hidden tabs, errors or the last minute of the range.
The top-right eye enters cinematic mode. Only the Moon navigator and playback controls
remain, fading after 3.5 seconds of inactivity. Move or tap to reveal controls; Esc or
the eye restores the UI. Hovering the playback bar, open pickers and keyboard-focused
controls keep it visible. Cinematic mode hides the geometric horizon guide; exiting
restores the user's Horizon line toggle setting. The toggle sits beside the camera view
controls. The playback bar slides between layouts over 280 ms without pausing playback;
reduced-motion settings disable that movement.
Buttons with changing labels reserve the widest label using the shared `stable-label`
grid pattern; hidden labels remain in layout but are excluded from accessibility names.
Look commands support horizon, Sun and Earth, including exact zenith/nadir.
Manual movement disables tracking. Pointer readouts are outside the canvas and give
offscreen direction, including a behind-you indicator. They can be toggled independently.
Enhanced visibility raises body diameters to a minimum 4Â° and is explicitly labelled.

## Stage 1 fallback limits (without Stage 2 providers)

- Supply Stage 2 providers as described in STAGE2.md to enable terrain and appearance.
- Continuous flat reference ground is a placeholder. No measured terrain, curvature,
  scientific horizon profile, lighting, shadows, textures or stars are claimed.
  Elevation sets the host datum; the local ground origin is zero. Zero-height cameras
  use a 1 cm rendering offset to avoid a degenerate view on the ground plane.
- Cutaway hides the whole ground plane while keeping the reference-horizon line.
- Both bodies are neutral untextured discs; Earth orientation data is reserved for Stage 2.
- `quality: low` caps DPR at 1; auto/high cap it at 2. The renderer draws on demand,
  pauses while the document is hidden, and runs continuously only for enabled twinkling.
- Stage 2/3 fields are validated when supplied; missing optional providers retain
  the applicable neutral appearance or reference-ground fallback.
- Synthetic fixtures are authored for rendering checks, not actual predictions.

## Verification

Run from the repository root:

```sh
node --test --test-isolation=none app/observer/math.test.mjs app/observer/terrain.test.mjs app/observer/local-terrain.test.mjs app/observer/overview.test.mjs
```

Open `/observer/verify.html` for browser checks of multiple instances, snapshot bursts,
tracking, extreme elevations, resize, invalid input and disposal. The fixture demo supports
manual physical/enlarged-size, navigation, pointer and ground/cutaway checks.
Also open `/observer/verify-stage2.html` for real terrain, assets, caching and cleanup,
and `/observer/verify-stage3.html` for shared-snapshot overview integration. Diagnostics
report render CPU time, buffer sizes and estimated texture memory, not exact GPU usage.

## Attribution

The runtime library is the existing MIT-licensed Three.js; see `../vendor/three/LICENSE`.
NASA LOLA/LROC terrain and lunar imagery, NASA Earth imagery and the compact Hipparcos
catalog are recorded in [SOURCES.md](../SOURCES.md). Providers remain replaceable.

## Polar terrain refinement

See [TERRAIN.md](TERRAIN.md) for the locally tiled 20 m LOLA source, concentrated
mesh spacing, cache budgets, reproduction command and scientific-shadow limitations.
Run `node --test --test-isolation=none app/observer/local-terrain.test.mjs` from the
repo root to verify real tiles, pole/boundary sampling and ground/mesh agreement.

## Scientific boundary

Display refinement uses packaged catalog meshes and pinned LOLA regional tiles;
published terrain horizons and visibility remain authoritative. Reproduce the new
240 m regional tiles and 16 additional catalog meshes with
`python science/prepare_observer_detail.py --raw <pinned-terrain-input-directory>`
from the repository root. It verifies source sizes and SHA-256 before generating
assets and their manifests. Tiles load only for the selected patch, with four
concurrent requests and a 48-tile cache; the full regional dataset is never downloaded.

GPU shadows use the snapshot's geometric Sun direction, with bounded shadow-map
coverage and resolution. They are not scientific visibility or irradiance results.
Earthlight is not modeled; ambient fill and surface grain/bump are display aids.
Sample ground through the shared terrain provider before requesting a new host
snapshot. Do not run a second ephemeris, clock or visibility engine in the view.
## Interactive preview updates

The Moon navigator and overview rotate freely through both poles. Drag or use arrow
keys; scroll or `+`/`-` zooms. A selected site produces a brief pin pulse and confirmation;
pending work keeps a visible, indeterminate loading indicator and identifies the retained
scene. The clicked point immediately gains a ring and loading arc while the accepted
site stays marked. Success settles into the accepted pin; failure stops the arc and
offers Retry without replacing the scene. The active date-range button also indicates
loading without moving the timeline. Reduced-motion preferences keep these states
visible without the pulse or rotation.

Each prepared custom chunk includes 30 checked daily scenes at the selected UTC hour.
The host progressively combines up to 365 scenes. Scrubbing ready dates uses those
in-memory snapshots immediately, updating the Sun, Earth, star
rotation, geometric illumination and terrain shadows together. Static catalog dates
use the complete published product for both whole-hour selections and minute playback;
the optional local appearance service can enrich that same selected snapshot.
Earth uses the main Moon page's NASA Blue Marble mosaic and diffuse lighting style,
with the supplied dated Earth orientation and geometric sunlight when available.
Without orientation it uses an illustrative fixed frame; without sunlight it shows the
texture neutrally. The Sun uses the main page's gold disc and soft glow, not solar imagery.
The local service sends revalidation headers to avoid stale preview modules.

The observer and main Moon page share range dropdown number and unit wheels: 1–365 days, 1–52 weeks,
1–12 calendar months, or 1 year, capped at 365 days. Confirm applies the draft;
Escape or clicking outside discards it. Month ends clamp to the last valid day.
Date labels beneath the timeline follow the active window. Desktop Sun/Earth readouts
stay in two fixed columns; long text is available in the tooltip, while mobile wraps.

The small Moon map renders the Sun and Earth in the same 3D scene, with no orbit rings.
Directions, lighting and the yellow/blue surface points use the host's selected snapshot.
Sizes and distances remain schematic. North/south rods extend from the actual lunar axis.
Hover previews coordinates; clicking requests a site and smoothly rotates toward it.
Click N/S to center the respective pole, or E/W for the ±90° hemispheres.
Keyboard activation works too; reduced motion skips the rotation animation.
