# Lunar overview and shared host integration

Use `view.setMode('overview')` or `view.setMode('observer')`. Both modes consume the same
copied, validated `ObserverSnapshot` and externally controlled UTC instant. There is
one WebGL renderer and scheduler; only the active scene renders. Terrain work pauses in
overview and resumes from the bounded cache on return. Each camera retains its own state.

The computation module supplies `snapshot.overview`:

```js
overview: {
  axisConvention: 'x0-yNorth-zWest',
  moonRadiusM,
  siteDirectionMoon, // unit vector on the Moon-centered surface
  sunDirectionMoon, // unit vector from Moon center, not observer azimuth/elevation
  earthDirectionMoon,
  moonToLocal       // active xyzw unit quaternion, shared frame contract
}
```

These fields describe the same site and instant as the rest of the snapshot. Axes are
+X at lunar equator/longitude zero, +Y north, east toward -Z; the frame realization is
the site's `referenceFrame`. The view does not derive Moon-relative directions from
topocentric observations. `moonToLocal` is validated for the shared interface; overview
rendering stays entirely in the Moon frame. Its transforms do not change the observer.
Missing overview fields show a waiting state rather than retaining stale markers/bodies.
Malformed vectors, radius, quaternion or axis convention reject the entire snapshot.

Moon remains centered. Distances and sizes are explicitly schematic: Moon radius 1,
Earth radius .18 at distance 3.5, Sun radius .3 at distance 5. The supplied lunar radius
is metadata, not a claim that these display distances are physical. Earth and Sun are
schematic spheres; Earth uses shared texture/orientation/phase inputs when available,
with a neutral fallback otherwise. No rotation/phase is invented. Moon imagery reuses the
existing attributed asset provider. Without assets, a neutral lunar sphere is used.

Drag/arrow keys orbit; scroll or +/− zoom from 2.5 to 18 display units. Orbit elevation
is bounded to ±85°. Surface marker and label disappear when hidden by the Moon, using
the perspective visibility test. Body labels also hide when occluded. Observer-specific
toolbar controls are disabled in the demo overview; their values persist for return.
`lookToward` continues to configure the observer camera only.

## Site requests go through the host

```js
const connection = connectObserver({
  container, computationProvider, terrainProvider, assetProvider,
  onSiteSelect: async coordinates => {
    // The host updates its shared selected site, samples ground if needed,
    // then asks the existing computation module for a complete new snapshot.
    // Use the host's request cancellation/generation guard around async sampling.
    await host.selectSite(coordinates);
    await connection.update(host.selectedSite, host.instantUtc);
  }
});
connection.view.setMode('overview');
```

Clicking the Moon emits east-positive longitude, latitude and `referenceFrame` only.
It never mutates the snapshot. Dragging does not select. The host retains responsibility
for ids, elevation datum, sampled ground and observer height. No second simulation
clock or computation module is introduced. The demo routes clicks through its fixture
host; `overview-fixture.js` is explicitly synthetic and is not a production ephemeris.

Tests: `node --test --test-isolation=none app/observer/*.test.mjs`, plus
`/observer/verify-stage3.html`. Browser checks cover shared site/time, active-only rendering,
marker/label occlusion, camera preservation, missing inputs, ray-picking coordinates,
orbit/zoom bounds and cleanup. Existing Stage 1/2 verification pages remain applicable.
No new dependencies, imagery or datasets were added for this stage.
