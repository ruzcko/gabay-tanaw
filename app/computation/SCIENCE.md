# Scientific conventions, contract v1

The published Python forecasts remain authoritative. An optional browser-only, explicitly
labelled estimate follows these coordinate, datum, visibility and event conventions;
its model and measured differences are documented in [QUICK.md](QUICK.md). It uses
the shipped coarse terrain products, not the finer published-site DEM stack, and it
must not be passed off as a Horizons observation or stored over published data.

## Site and local axes

Only `referenceFrame: "MOON_ME_DE421"` is accepted. This is the DE421 mean-Earth / mean
rotation-axis realization, not lunar principal axes or the low-precision IAU_MOON frame.
Horizons currently labels the high-precision center frame `MEAN_ME (high precision)`;
the Python precompute path requires that exact center-frame label and rejects IAU
fallback. The distinct target-frame label `MOON_ME` applies to the sub-point query. The source header records the actual ephemeris/model revision.

Latitude is planetocentric, north positive. The reference shape is a sphere of radius
1,737,400 m, on which planetocentric and planetographic latitude coincide. Longitude is
east positive and canonicalized to [0,360). Moon scientific XYZ is right-handed: X at
latitude/longitude zero, Y at 90° east on the equator, Z north. Latitude ±90° is rejected
with `UNSUPPORTED` because a polar azimuth convention has not been adopted.

The only datum is `sphere-1737400m`. Surface elevation is radial height above that sphere;
observer height is metres above local ground in the same radial direction. Horizons
`SITE_COORD` is geodetic east longitude, latitude, **(surface elevation + observer height)
/ 1000 km**. Every result checks the returned coordinates and the 1737.4 km center radii.
For precomputed forecasts, take surface elevation and observer height from the horizon
metadata, generated with the same DEM stack as the skyline. Smooth-sphere sites explicitly
use modeled ground zero, even if the catalog records a different real surface elevation.
Never substitute that catalog height into a smooth-model observation.
Other datums/frames need an explicit validated conversion before calling this API.
The reviewed catalog at `79bf18a` has 30 accepted `MOON_ME_DE421` sites with per-site
`frameEvidence`; Blue Ghost 2 is removed pending a mission coordinate. IM-3 and Blue
Ghost 3 retain `positionAccuracy: "approximate"`. The three Gläser points were accepted
on empirical terrain/illumination consistency, not a measured frame registration or
an established positional error bound. The provenance retains that distinction.
Browser validation
checks data contracts, not survey accuracy.

Local ENU is right-handed (east,north,radial up). Azimuth runs clockwise from north;
elevation is above the plane perpendicular to radial up. This reference plane is not
the depressed visible limb for an elevated observer or a terrain horizon. Renderer
axes are (east,up,south): `[e,n,u] → [e,u,-n]`. The globe's X-zero/Y-north/Z-west axes
are similarly a separate axis permutation of the scientific lunar frame. Never relabel
one convention as another without applying its transform.

Frame-tagged directions point from `from` toward `toward`, are unit-length XYZ vectors,
and identify instant and correction. Rotation contracts are right-handed active,
row-major 3×3 matrices acting on column vectors; destination = matrix × source.
Future Earth rotation contracts must name the Earth body-frame realization and epoch.
No Earth rotation or Moon-to-ICRF rotation is inferred from apparent body angles.
Star rotation uses the pinned lunar orientation described below.

## Time

Inputs are Gregorian ISO UTC `YYYY-MM-DDTHH:mm:ss[.sss]Z`, normalized to milliseconds.
Offsets, date-only strings, rolled-over dates and leap-second labels are rejected.
Browser date coverage follows [the coefficient manifest](../assets/computation/quick/manifest.json),
including its exclusive end for selected dates. Generic observation-series windows
keep their sampled endpoints inside that range. Quick-estimate integration may evaluate
the exact end using the final pack's verified padding. JavaScript milliseconds are used only for UTC
labels/window sampling, not as a replacement for dynamical time or precise SI-duration
accounting across leap seconds. A nominal `durationDays` is 86400 UTC-label seconds per
day in this stage; availability-duration APIs must adopt explicit leap handling later.

Python sends Gregorian calendar UTC labels with `TIME_TYPE=UT`; Horizons owns
astronomical time conversions. Supported precompute cadences are 10 and 1 minute.
The monthly reader preserves exact saved hourly instants. The forecast-product adapter
also supports whole-minute selections: normalized direction interpolation between adjacent
hourly samples, linear range/diameter interpolation, and visibility from published daily
rise/set events (zero clearance at an event is hidden). These snapshots set `interpolated`
and retain the source provenance; interpolation is not a new Horizons observation or a
measured minute-accuracy guarantee. Both bracketing samples are required, including across
month boundaries. The final unsampled minutes after the last saved hour use the quick
engine instead of extrapolation. Quick snapshots evaluate their ephemeris at the selected
minute directly; daily forecast integrations keep their existing cadence.
Retain model/EOP headers, future-leap-second warnings and raw responses; a cache makes
a result reproducible, not timeless. The historical TypeScript adapter's JD/quantity-30
path remains a tested prototype, not the static pipeline's upstream source.

## Apparent observations versus geometry

The forecast-product adapter additionally accepts Python-published geometric Sun/Earth
states in monthly `sun/` files. These are CSPICE DE440 states in `MOON_ME_DE440_ME421`
with `NONE` correction, separate from the Horizons apparent arrays. Lighting subtracts
the modeled site position and applies the explicit local-axis transform. Whole-minute
interpolation uses hourly positions and velocities with cubic Hermite interpolation;
it never changes published visibility. Kernel hashes and interpolation endpoints remain
in snapshot provenance. See [PUBLISHED_LIGHTING.md](PUBLISHED_LIGHTING.md).

Static product sky rotation uses optional Python-published hourly `geometric.sky`
quaternions (active J2000 to `MOON_ME_DE440_ME421`, `[x,y,z,w]`) with shortest-path
spherical interpolation. Quick snapshots evaluate the same pinned binary-PCK orientation
directly at the selected UTC. Both apply the site's east/up/south basis in computation,
exposing `sky.catalogFrame: "ICRS-J1991.25"` and `sky.catalogToLocal` to the renderer.
Catalog positions remain fixed at J1991.25: no proper motion, parallax, aberration or
stellar deflection is modeled. This is display orientation, separate from apparent
Sun/Earth observations and terrain visibility. See [SKY.md](SKY.md) for validation.

Python observer quantities 4,13,20 supply airless apparent azimuth/elevation, equatorial
angular diameter and range; separate Moon-target quantities 14/15 supply sub-points.
Quantity 4 includes Horizons' light-time, aberration, gravitational deflection and
orientation corrections; it is not a lighting vector. Refraction is explicitly off.
All elevations are requested, including below-horizon results. Angular diameter is
converted from arcseconds to degrees; ranges are explicitly kilometres. Earth is oblate:
its equatorial diameter alone is not a fully modeled limb for precision disc occultation.

The retained TypeScript prototype's separate VECTORS requests use `REF_SYSTEM=ICRF`, `REF_PLANE=FRAME`, `VEC_CORR=NONE`,
`OUT_UNITS=KM-S`, `VEC_TABLE=2`. These are geometric site-to-body states. They are exposed
as ICRF states only; no unvalidated transformation into local geometric lighting occurs.
Raw apparent sub-observer/sub-solar/pole quantities are preserved for later orientation
validation, not promoted to a body-to-local matrix. Horizons' EOP file and observed/
predicted coverage remain in each record. Missing appearance capabilities mean neutral
rendered bodies, not inferred phases or camera-relative Earth rotation.

Near zenith/nadir, azimuth is ill-conditioned; use vector placement and display the
warning. The static reader does not interpolate sky positions. Python interpolates cyclic terrain
profiles and time-bracketed visibility crossings. No universal event-time, terrain accuracy,
eclipse or link-availability guarantee is claimed; see the measured
[Earth validation](../../science/EARTH_VALIDATION.md). Geometric Earth visibility will mean potential direct-to-
Earth contact; communications still need station, antenna and link-budget models.

Future availability fractions use the whole requested window as denominator, including
unknown intervals. `available + unavailable + unknown = window duration` is required.
Unknown data must never become darkness or a communications interruption.

## Authoritative references (reviewed 2026-11-14)

- [Horizons API parameters and schema](https://ssd-api.jpl.nasa.gov/doc/horizons.html)
- [Horizons manual: coordinates, frames, time and quantity definitions](https://ssd.jpl.nasa.gov/horizons/manual.html)
- [SSD fair-use policy](https://ssd-api.jpl.nasa.gov/): one upstream request at a time,
  reuse/cache results, identify product/version/contact, and back off on errors.

The live API reports 1.2 while the documentation advertises 1.3. The parser explicitly
accepts those versions only and verifies required columns/metadata. New versions fail
closed pending review. Raw responses, not copied manual excerpts, are the fixture reference.
