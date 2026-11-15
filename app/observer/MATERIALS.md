# Display materials

`display-materials.js` owns the aesthetic shader changes. It does not import the
computation interface, sample elevation, modify terrain geometry, or calculate visibility.
The same snapshot and clock remain authoritative in both views.

- Moon overview: the existing 4K lunar color asset is retained. Global object-space
  normals are supplemented by the existing stereographic south-pole LOLA map, blended
  from 75°S to 77°S. Baked 4×/3× slopes are reduced to restrained display strength;
  this is not an exact recovery of unexaggerated elevation. Polar color fill blends
  toward a neutral regolith tone. Low ambient fill improves crater contrast.
- Ground: procedural noise scales lightly modulate color, fading with distance
  and pixel footprint to avoid visible repetition and distant shimmer. They add no
  rocks, craters, displacement, geometry normals or shadow-casting features. A 6 mm
  amplitude coefficient adds restrained cosmetic bump shading at close range. The demo
  explicitly identifies this as decorative detail.
- Earth: both views reuse the same texture and shader. Supplied orientation/illumination
  determine phase. In overview, inverse `moonToLocal` converts the supplied body-to-local
  quaternion into body-to-Moon. Camera position affects only the view-dependent highlight
  and rim, never the body orientation. A blue-color heuristic restricts faint highlights;
  this is not a measured ocean mask. Blue Marble retains baked photographic shading.
- South-pole sites get an initial overview elevation of -65°, while other sites retain
  the existing global overview. Subsequent site changes preserve the user's orbit.
  The demo starts at the south pole; equatorial and synthetic options remain available.

Four shared image textures are bounded to 4K color / 2K normals / 2K polar normals /
2K Earth. Their decoded RGBA footprint is approximately 64 MiB; estimated GPU texture
storage with mipmaps is approximately 85 MiB, excluding shadows and driver overhead.
They are shared between presentations within an instance and disposed by its asset layer.
Quality controls continue to bound DPR and shadow resolution; they do not reload textures.
Custom providers may omit `moonRelief` for a lighter neutral-relief fallback.

Sources and licences remain in `../SOURCES.md`; the materials add no new image assets
or dependencies. Actual polar geometry now uses the finer source described in `TERRAIN.md`.
