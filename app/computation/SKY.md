# Observer sky orientation

The host supplies one selected-UTC snapshot. Its optional `sky` contains
`catalogFrame: "ICRS-J1991.25"` and `catalogToLocal: [x,y,z,w]`, a unit active
quaternion from catalog XYZ (+X RA 0, +Y RA 90, +Z celestial north) to local
east/up/south. The renderer applies it to both catalog stars and a sky background
registered in those same ICRS axes. Camera movement never changes scientific time.

The Moon's rotation is numerical DE440 libration from the existing pinned binary PCK,
aligned to `MOON_ME_DE440_ME421`. Quick snapshots reuse `QuickEphemeris.orientation`
at the selected instant. Static products use the Python publisher's optional
`geometric.sky` field in the existing `sun/YYYY-MM.json` files:

```json
{
  "fromFrame": "J2000",
  "toFrame": "MOON_ME_DE440_ME421",
  "interpolation": "slerp",
  "quaternionOrder": "xyzw",
  "rotations": [[0, 0, 0, 1]]
}
```

The identity above illustrates shape only. Real arrays have one rotation per existing
hourly timestamp and share the geometric track's pinned kernel hashes. Intermediate
minutes use shortest-path spherical interpolation, then the site's local basis.
Both endpoints and matching geometric provenance are required across month seams.
There is no extrapolation beyond the last stored hour. Legacy files without `sky`
remain valid, with star orientation explicitly unsupported. Exact service appearance
retains priority. Quick coverage follows the coefficient manifest and existing guards.

Catalog stars stay at their J1991.25 directions. Proper motion, parallax, aberration
and gravitational deflection of stars are not modeled. This is a fixed-catalog display,
not a precision apparent-star prediction. The snapshot retains its forecast quality;
its sky model and limitations are separately recorded in provenance/warnings.
This change does not affect apparent Sun/Earth angles, lighting, visibility or events.

## Validation

| Check | Result |
| --- | --- |
| Static rotation vs direct CSPICE, 48 snapshots at 3 sites over all publication months, including minutes and year seam | Maximum basis-axis difference 1.46283e-7 degrees (0.000527 arcsec) |
| Quick rotation vs 32 CSPICE matrices throughout coefficient coverage | Maximum matrix-element difference 1.02047e-12 |
| All 30 catalog sites, 720 selected-minute snapshots | Valid unit sky quaternions, coherent selected UTC and forecast quality |
| Regression suite | 98 computation tests, 58 observer tests, 57 Python tests with pinned kernels; no skips |
| Contracts | TypeScript/build pass; all 467 published JSON files validated |
| Existing data preservation | All 12 sun months equal previous values after removing the new `geometric.sky` field; forecast/horizon files untouched |

Tests also exercise half turns, quaternion sign equivalence, known ICRS axes, repeated
time selection, minute movement, missing seam endpoints and malformed rotations.
The CSPICE comparisons check evaluation/interpolation of the same model, not independent
observational ground truth or an absolute star-position accuracy bound.

The addition is 720,650 raw bytes / 323,784 gzip bytes across the year, approximately
27 kB compressed per month, with no extra HTTP request. Quick snapshots need no extra
coefficient assets. A desktop Node microbenchmark of 10,000 complete Apollo 17 product
snapshot adaptations took 605 ms (0.061 ms each), excluding fetch, parsing and rendering.
This is a single-run computational cost, not end-to-end browser latency.

## Reproduce and integrate

Use the existing `publish_geometry.py` and `check_published_geometry.py` commands in
[PUBLISHED_LIGHTING.md](PUBLISHED_LIGHTING.md), then run computation tests, typecheck,
Python tests and `science/validate_data.py`. Publish updated sun months and manifest
together with the adapter. No new dependency or scientific source was introduced.

`scripts/verify-published-lighting.mjs` also checks received sky quaternions for static
and custom selections, and that custom playback changes the orientation. The companion
renderer branch owns star brightness, the NASA sky background, and visual browser QA;
those changes are outside this computation commit.
