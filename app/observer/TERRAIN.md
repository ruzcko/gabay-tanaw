# Polar terrain

The local provider uses NASA LOLA LDEM_875S_20M V2.0 (20 m grid spacing),
with full weight south of 87.7 S and a smooth transition to the existing global
LOLA source between 87.7 and 87.5 S. Elsewhere the global source remains about
1.9 km per sample. This is an interpolated elevation product, not 20 m accuracy
or a new optical photograph.

The refined polar patch is one continuous 257 x 257 mesh: 20 m spacing within
1,280 m along each local axis, progressively coarser toward the 32,768 m edges.
The coarse pass uses 65 x 65 vertices. Both passes cover the same area without
overlapping meshes or LOD cracks. Normals are derived from actual geometry.
Status reports near-site sampling, not uniform detail across the full patch.

The integrated observer's first polar display uses the existing 240 m regional
grid, so it does not wait for the 20 m tiles. Custom-location refinement keeps
the original 20 m source within 2,560 m along both local axes, smoothly blending
to the regional grid by 5,120 m where the mesh is already sparse. Catalog sites
still refine from their packaged meshes. Ground sampling and scientific horizon
calculations do not use this display simplification.

At Connecting Ridge, a cold display-worker check reads 867,880 bytes in two
requests for the preview and another 1,618,678 bytes in five requests for custom
refinement. The previous first pass alone read 17,361,428 bytes in 58 requests.
These are compressed asset bytes, not end-to-end load times: custom forecasts
must also prepare their scientific terrain horizon before accepting a scene.
Run `node --test --test-isolation=none app/observer/terrain-loading.test.mjs`
to check this budget and exact near-site height preservation.

## Local preparation and reuse

Download the IMG linked by `assets/observer/terrain/polar20/manifest.json`, then:

```sh
python app/tools/prepare_polar_terrain.py .terrain-raw/ldem_875s_20m.img
```

The standard-library script preserves signed half-metre samples in 225 local
512-square gzip tiles (64,195,557 bytes total). The browser requests only needed
tiles from the local app, at most four concurrently. Its worker retains at most
48 decoded tiles (at most 24 MiB); request-local buffers may temporarily add to
this. HTTP cache reuse is requested explicitly; the assets themselves are stored
in the repo, so no NASA runtime connection or service worker is required.
Four resampled patches are cached per view. Time-only updates reuse geometry.

`TerrainTile.axisM` is optional, preserving support for uniform external providers.
The same provider samples ground for the host and produces mesh elevations;
the host must recompute the snapshot if the supplied ground elevation changes.
The renderer still rejects mismatched heights. No ephemerides or scientific
visibility calculations were added here.

## Surface appearance and shadows

Existing NASA lunar color imagery remains the color source. Fine color variation
and a millimetre-scale bump are decorative, distance- and footprint-filtered,
and add no images or GPU textures. The bump changes shading normals only;
it never displaces measured geometry, changes heights, or casts shadows.

Terrain shadows use a GPU shadow map aimed by the shared snapshot's geometric
Sun direction. They are approximate display shadows with bounded coverage and
resolution, not scientific horizon/visibility or irradiance results. Earthlight
is not modeled. Ambient fill is a display aid, not Earthshine. The demo's
directions are synthetic fixtures, even though the terrain is real NASA data.
Scientific shadow/illumination results must come from the existing computation
provider, using the same site, time, frame and elevation model.
