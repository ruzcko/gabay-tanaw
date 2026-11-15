# Terrain, textures and lighting

Plain JavaScript, vendored Three.js, no application build step. The observer page is
`/observer/`. Its Earth/Sun observations and sky rotations are visibly labelled
synthetic; terrain can independently use real LOLA or synthetic hills.

## Shared computation and replaceable providers

```js
import { createObserverView } from './observer/index.js';
import { createLocalTerrainProvider, localAssetProvider } from './observer/local-providers.js';
const terrainProvider = createLocalTerrainProvider();
const view = createObserverView({ container, terrainProvider,
  assetProvider: localAssetProvider, onError: console.error,
  onTerrainStatus: console.log });
// Host selection handler: sample once and update the shared host site before science.
site.surfaceElevationM = await terrainProvider.sampleGround({ site, signal });
const snapshot = await computationProvider.observe({ site, instantUtc, signal });
view.setSnapshot(snapshot); // Use this same snapshot in the map and observer.
// After all consumers have finished:
view.dispose();
terrainProvider.dispose();
```

The host owns astronomy, Earth orientation/illumination, sky transformation and scientific
visibility. This module only samples terrain and prepares display geometry, normals,
texture coordinates and render shadows. `integration.js` can connect a map and computation
provider with stale-result protection. Providers can be shared with the globe or replaced
without changing the renderer; the host owns provider disposal.

`contract.d.ts` defines the interfaces. Terrain returns an odd-sized grid (3–513 samples
per side) in `local-orthographic-east-south`, centered on the requested site. Columns
run east, rows south. Metadata includes frame, datum, spherical radius, spacing, missing
values and attribution. Providers resample their native projection. Missing samples
omit triangles and reduce reported coverage. A ground disagreement exceeding 1 cm
rejects the tile and asks the host to recompute, rather than silently moving the observer.

The bundled adapter identifiers are `LOLA-ME` and `sphere-1737400m`; confirm their
correspondence to the computation team's precise frame realization before live use.
The renderer performs no automatic frame or datum conversion. Public angles are degrees,
heights metres, ranges kilometres; local rendering axes are east +X, up +Y, north -Z.

Earth's `bodyFrame` is `earth-fixed-x0-yNorth-zWest`: +X at latitude/longitude zero,
+Y north, east toward -Z. Its active xyzw quaternion maps this frame to local axes;
the supplied Earth-to-Sun vector is in Earth body axes. Camera movement does not change
Earth orientation. Without these inputs, a neutral disc remains. Terrain illumination
uses a separate supplied geometric Sun vector, even for apparent observations. Without
it, only weak display fill lighting is used.

Stars use ICRS axes (+X RA0, +Y RA90, +Z north), epoch J1991.25 and frame identifier
`ICRS-J1991.25`. The host supplies the date-dependent catalog-to-local quaternion.
The compact display catalog does not apply individual proper motion/parallax; precision
astrometry belongs in the shared computation system.

## Preparation, caching and performance

NASA source heights are prepared once into local gzip tiles. A persistent worker fetches
only tiles intersecting the selected patch, with at most four concurrent requests and
48 decoded tiles retained (at most 24 MiB for polar tiles). A view caches at most four
prepared CPU grids. The worker generates a 65.536 km square patch: globally 33×33
then 129×129; in polar coverage 65×65 then 257×257, concentrated near the observer.
The polar refinement has 20 m spacing within 1,280 m along each local axis, increasing
toward the horizon. Both passes sample the same ground source; finer samples may
request additional tiles, while cached tiles are reused. Heavy sampling, decompression,
curvature and normal generation run in workers. Time scrubbing reuses the scene and assets.

Physical curvature uses the supplied radius; vertical exaggeration scales relief around
sampled ground and never camera height. Shadows cover a central 4.4 km square with
512/1024-pixel maps, 0.5 m normal bias and -0.00002 depth bias. They update with time,
site and terrain, and remain independent of scientific visibility. Auto quality selects
512 on low-core devices or after three consecutive render CPU times above 24 ms.

The material pass uses four shared textures: 4096×2048 lunar color, 2048×1024
global normals, 2048×2048 south-pole normals and 2048×1024 Earth color. Baked terrain shading is excluded
from dynamic lighting; only albedo or explicitly marked approximate albedo is accepted.
LROC CGI imagery is aesthetic, not scientific reflectance. Blue Marble includes baked
topographic shading and is identified as such. Stars use one draw call and magnitude-based
brightness; decorative twinkling is off by default and respects reduced motion.

Idle rendering is on demand. One RAF loop runs only while twinkling is active. Hidden
documents stop rendering and cancel terrain/unfinished asset work. Disposal aborts requests,
terminates owned workers and releases listeners, DOM, geometry, materials and textures.

## Limitations

- The global fallback is about 1.9 km/sample. The bundled polar LOLA grid provides
  20 m sampling south of 87.7 S, blending to the fallback by 87.5 S. Source grid
  spacing is not measurement accuracy. See [TERRAIN.md](TERRAIN.md) for coverage,
  projection, preparation and cache details. Overview normal maps are separate from
  the observer elevation mesh and do not claim the same resolution.
- Coverage describes the finite returned patch, not the entire lunar horizon. A flat
  reference surface is shown while waiting. Missing coverage and high-altitude views need
  a larger/finer provider; render shadows are bounded visual approximations.
- Cutaway hides the whole terrain while preserving the reference-horizon line.
- Earth phase, a thin lit-limb rim and ocean highlights are display approximations,
  not atmospheric scattering or reflectance simulations. The ocean mask is a color
  heuristic, not a scientific land/water classification.
- `getDiagnostics()` reports render CPU time, buffer bytes, estimated texture memory and
  resource counts, not GPU elapsed time or exact driver allocations.
- Overview is documented in STAGE3.md and shares these providers and snapshot.
- Earthlight is not modeled. Ambient fill is decorative, not computed Earthshine.

## Reproducing assets and tests

`app/tools/prepare_observer_assets.py` uses Python's standard library for one-time data
preparation, not an app build. Raw inputs in `.terrain-raw/`: NASA SVS 4720
`ldem_16_uint.tif` and HEASARC `hipparcos.xml` VOTable. The latter comes from the official
TAP endpoint `https://heasarc.gsfc.nasa.gov/xamin/vo/tap/sync`, using REQUEST=doQuery,
LANG=ADQL, FORMAT=votable and query
`SELECT hip_number,ra_deg,dec_deg,vmag FROM hipparcos WHERE vmag < 4.5`.
Blue Marble is downloaded separately from the source in `../SOURCES.md`.

```powershell
python app/tools/prepare_observer_assets.py .terrain-raw app/assets/observer
node --test --test-isolation=none app/observer/math.test.mjs app/observer/terrain.test.mjs
```

The terrain manifest records the original TIFF SHA-256. The prepared levels are 4 and
16 pixels/degree (1,296 files, 29,898,762 compressed bytes); the observer currently uses
16 for both mesh levels. The star subset contains 907 entries. Runtime requests are local.
No new runtime or preprocessing libraries were added. See `../SOURCES.md` for credits.
The polar addition has 225 lossless tiles (64,195,557 compressed bytes), prepared
with `prepare_polar_terrain.py`; its separate manifest records source version and hash.

Browser checks: `/observer/verify.html` for regression and `/observer/verify-stage2.html`
for real assets, workers, cancellation, polar sampling, playback, idle rendering and disposal.
