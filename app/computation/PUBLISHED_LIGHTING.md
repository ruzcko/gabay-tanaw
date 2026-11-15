# Published snapshot lighting

Apollo 17 at 2027-03-19 01:08 UTC has a published Sun elevation of 65.980379°
and `centerVisible: true`. The dark ground was caused by missing `lighting` in
the accurate snapshot. The renderer treats missing lighting as unsupported;
the service-only appearance enrichment cannot supply it on static hosting.

`science/publish_geometry.py` now adds an optional `geometric` object to each
existing `app/data/sun/YYYY-MM.json`. It contains hourly Sun and Earth six-component
states `[x,y,z,vx,vy,vz]`, in km and km/s, from the Moon centre in
`MOON_ME_DE440_ME421`, correction `NONE`. Source kernel hashes, model, units and
interpolation method are explicit. Existing Horizons sub-point arrays are preserved:
they are apparent quantities, not relabelled geometric vectors.

The existing host already downloads these monthly files. `productSnapshot` consumes
the additive states for accurate products, subtracts the published radial observer
position (ground + 2 m), and rotates into east/up/south renderer axes. It supplies
lighting and overview together with geometric provenance. Apparent positions,
visibility, daily durations and events remain from the published Python forecast.
No quick-estimate snapshot is borrowed. Optional [published sky rotations](SKY.md) now
support the fixed star catalog. Earth texture orientation and eclipses remain explicitly
unsupported. Exact service appearance keeps its existing priority.

Whole-minute playback uses cubic Hermite interpolation of position and velocity.
It requires both endpoints, including across month boundaries, and matching provenance.
There is no extrapolation beyond the existing final saved hour. Publishing rejects
leap-second intervals; this publication window has none under the pinned leap table.
Old files without geometric states retain the explicit unsupported behavior.

## Validation

- 83 computation tests pass; TypeScript and generated build pass.
- All 30 catalog sites: 720 selected-minute snapshots across every publication month,
  with coherent quality, unit lighting vectors and day/night checks away from the horizon.
- Four estimate points across both hemispheres, near/far sides and a longitude seam:
  12 selected minutes outside the publication year verify current lighting during cached
  playback without annual recomputation. These are regression checks, not new accuracy bounds.
- 57 Python tests pass with pinned kernels, no skips.
- 467 JSON files pass schema, coverage and manifest validation.
- 48 direct CSPICE fixtures: Apollo 17, Shackleton rim and Chang'e 4 over all
  publication months, exact hours, selected minutes and the December/January seam.
  Maximum local lighting direction difference: **4.93e-11 degrees**.
  All fixtures also pass the existing observer snapshot validator.
- The unchanged host loader supplies Apollo 17 lighting with all service requests
  returning unavailable; the accurate product retains priority.
- Seven real Chrome integration checks passed against the UI branch on local port 4181:
  Apollo 17 minute/hour, Chang'e 4 month seam, Shackleton rim, north/south custom
  estimates and custom playback. The actual renderer received current lighting,
  terrain reached `ready`, and no runtime exceptions occurred. Screenshots confirm
  sunlit Apollo 17 ground. These integration checks include the companion UI changes.
- Apollo 17 corrected vector: `[0.25422170134, 0.91341009815, 0.31788884719]`.
- Original monthly sub-point fields compare exactly equal; forecast and horizon
  files are unchanged. Snapshot scrubbing cannot mutate cached provenance.

These are independent evaluation paths through the same pinned DE440 model, not
independent astronomical or surveyed-terrain truth. The tiny difference is a numerical
interpolation check, not an absolute accuracy claim. No UI rendering changes were made.

The additive annual data costs 2,082,723 uncompressed bytes, about 1,001,361 extra
gzip bytes across 12 months (~83 kB/month). A local Node run took 488 ms for 10,000
snapshot adaptations (~0.049 ms each), excluding network, parsing and rendering.
This is a single desktop microbenchmark, not end-to-end browser latency.

## Reproduce

After the normal `sun_points.py` publication, run:

```sh
python science/publish_geometry.py <pinned-kernel-directory> app/data
python science/test/check_published_geometry.py <pinned-kernel-directory> app/computation/fixtures/published-geometry.json
python science/validate_data.py
npm test --prefix app/computation
```

The publisher refreshes only the changed sun-month hashes in the existing manifest.
It reuses `observer_appearance.load_kernels`; no new library or dataset is introduced.
Publish the adapter, additive data and manifest together. No UI update or service is
needed for this product-adapter path. The older standalone static-provider API remains
unchanged and still declares its advanced appearance capabilities unsupported.

## Companion host change required

The UI branch routes static catalog whole-hour selections through the complete product
path instead of the legacy standalone provider. That host fix is required to cover
ordinary whole-hour bookmarks, and belongs to the separate UI PR. Playback already
requests a fresh quick snapshot or the current accurate product snapshot atomically.
Sun-month requests must revalidate previously cached JSON on deployment; Cloudflare's
existing `/data/*` header specifies `no-cache`, and the companion host change also
requests explicit revalidation for local/static servers. Existing in-memory reuse is kept.

Reproduce the combined browser checks with the companion app served locally:

```powershell
$env:TANAW_INTEGRATION_ORIGIN='http://127.0.0.1:4181'
node app/computation/scripts/verify-published-lighting.mjs
```

The test uses response-only capture hooks to inspect accepted renderer inputs and light
intensity, without modifying UI source. Screenshots/results stay in ignored `out/`.
