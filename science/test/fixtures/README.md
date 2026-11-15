# Offline Horizons fixture

`apollo-11-earth-2026-12.txt.gz` is an unmodified text response from NASA/JPL
Horizons, retrieved 2026-11-14 using `fetch_ephemeris.query`. It covers
2026-12-01 to 2027-01-01 inclusive, at ten-minute cadence, target 399,
center `coord@301`, quantities 4/13/20, airless, range KM, Gregorian UT.
The accompanying catalog entry supplies longitude/latitude. The modeled smooth
ground is explicitly zero and the observer is 2 m above it (`SITE_COORD` altitude
0.002 km). This is a modeled observer, not the site's surveyed ground elevation.

The entire response retains model, units, EOP coverage and warnings. See
[science sources](../../SOURCES.md) and [existing NASA attribution](../../../app/SOURCES.md).
