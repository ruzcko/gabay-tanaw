# Global quick-engine accuracy audit

104 new points, seed 20261117, tested from 1 December 2026 through 30 November
2027: 365 days and 52,561 ten-minute samples per body per point, including the
closing endpoint. Baseline: 698a73b, with the longitude-cache correction described
below. UI and published forecasts are unchanged.

## Coverage and interpretation

The fixture contains 72 stratified random points (12 per latitude band), 16 random
1–10 km offsets around eight nonpolar landing sites, 12 longitude seam points,
and four additional northern-cap points. It covers 82.682°S to 89.143°N:
54 northern, 48 southern and two equatorial points. These deliberately stratified
and clustered samples are not an unbiased estimate of whole-Moon accuracy.

Python independently builds each terrain horizon and runs the existing daily/event
builder. The annual comparison shares the quick engine's DE440 ephemerides at the
Python reference ground height, isolating terrain and builder differences. It is
not an independent annual Horizons or measured-ground-truth comparison.

Separately, pinned CSPICE DE440 / ME421 evaluates 26 instants per point (the first
and fifteenth of every month plus the year seam), at ground + 2 m with CN+S:
2,704 site-instants and 5,408 body comparisons. This is an independent implementation
of the same underlying JPL model. CSPICE checks omit gravitational deflection.

| Independent geometry comparison | Sun | Earth |
| --- | ---: | ---: |
| Maximum angular direction difference | 0.0000000336° | 0.0000001401° |
| Maximum range difference | 0.1192 mm | 2.3973 mm |

These tiny differences demonstrate implementation agreement, not equivalent
absolute knowledge of the lunar terrain or celestial positions.

## Full-year daily availability differences

Absolute differences in hours/day across 37,960 site-days:

| Python terrain reference | Points | Sun mean | Sun maximum day | Earth mean | Earth maximum day |
| --- | ---: | ---: | ---: | ---: | ---: |
| LDEM16, same coarse source | 80 | 0 | 0 | 0 | 0 |
| SLDEM2015, finer nonpolar terrain | 16 | 0.0441 | 3.81 | 0 | 0 |
| LOLA60S240m, southern regional terrain | 7 | 0.7577 | 24.00 | 1.0077 | 24.00 |
| LOLA75S240m, southern regional terrain | 1 | 0.4912 | 14.24 | 0.3098 | 8.69 |

The 16 nonpolar points average about 2.65 minutes/day of Sun-duration difference,
but individual days differ by up to 3.81 hours. Northern and southern subsets have
similar mean Sun differences: 0.0417 and 0.0466 h/day respectively. Zero Earth-duration
difference here does not establish limb-contact accuracy: these selected locations
mostly have persistent near-side or far-side Earth visibility.

The seven LOLA60S points have 102 unmatched events in total; duration errors cannot
be summarized as a simple rise/set time offset. Per-point matched-event statistics,
unmatched counts, direction, range and horizon errors are in
[global-accuracy-results.json](global-accuracy-results.json).

The largest errors include 73.680°S, 124.092°E and 79.350°S, 236.465°E (24-hour Sun
errors on individual days). At 75.607°S, 77.401°E, Earth-duration difference averages
5.182 h/day and reaches 24 h. Thus the terrain problem extends beyond the immediate
south-pole region. These are disagreements with finer DEM calculations, not direct
observations of illumination.

All 18 points north of 60°N use the same coarse LDEM16 source on both sides. Their
agreement is a consistency check only. Finer north-polar accuracy remains unverified.
None of these 104 points uses a PGDA 5 m footprint; an earlier
84-point polar experiment covered that comparison.
Existing source hashes were verified against science/terrain-inputs-30.json;
no new library or dataset was introduced.

## Regression found and corrected

Equivalent longitudes 179.9999° and -180.0001° can normalize with a roughly
3e-14° floating-point difference. Strict equality incorrectly rejected a cached
horizon. The engine now uses the existing sameLongitude contract helper, whose
roundoff tolerance is about 3.2e-13°. A materially different longitude remains
rejected. No astronomy formula, terrain sampling or forecast field changed.

All 12 wrap comparisons now pass. All 19 central far-side points have zero daily
Earth availability throughout the year. Every annual output passes the forecast
product contract; no point was dropped.

## Verification and reproduction

- npm test: 52 passed, zero skipped.
- Python unittest discovery in science/test with pinned kernels: 46 passed, zero skipped.
- Strict computation TypeScript typecheck and generated-JS build: passed.
- science/validate_data.py: 464 JSON files passed coverage/provenance validation.
- Full annual audit: 104/104 completed; all 5,408 independent body comparisons recorded.

From the repository root, with existing reviewed raw data and pinned kernels:

```powershell
python science/test/global_accuracy_audit.py reference --out out/global-audit --south <south-raw-folder> --regional <regional-raw-folder>
node --experimental-strip-types app/computation/scripts/audit-global.ts --out out/global-audit
python science/test/global_accuracy_audit.py compare --out out/global-audit --kernels <pinned-kernel-folder>
```

The frozen input is fixtures/global-audit-points.json. Raw samples and caches stay
in ignored scratch storage. The committed results include kernel and terrain hashes.

## Recommendation

Keep the astronomical formulas unchanged. Expand matched finer-terrain coverage and
cache the resulting horizons, prioritizing the broader southern highlands as well
as the pole. Do not apply a blanket southern-hemisphere correction or assume coarse
240 m terrain always improves the existing estimate. Obtain a reviewed finer northern
reference before claiming north-polar accuracy. This audit does not integrate the
experimental terrain pack into production or change the UI.
