# Stages 1–2 verification

Validated on 2026-11-14 with Node 24.13.0, Windows x64, TypeScript 5.9.3 in strict mode.
Run `npm run typecheck`, `npm test`, and `npm run build` from this directory. The sandbox
does not permit Node test subprocesses, so tests use `--test-isolation=none`. No source
requests occur in tests. The source capture script uses the same public provider APIs.
The renderer compatibility test is optional when the separately developed observer
module is absent: an isolated computation checkout runs 14 tests and skips that one
integration check. With the observer available, all 15 tests run.

## Direct-source evidence

Seven sites cover near-side, far-side, north/south, ±89.9° latitude, longitude −1°/359°,
and March/June/September/November/December dates. Each has a renderer-compatible base
snapshot plus two-sample observer and geometric responses for Sun (10) and Earth (399).
All raw responses and request parameters are retained. Horizon fixtures have Sun center
elevation −0.018135623° and Earth center elevation −0.000497658° at their respective
selected instants. They test source parsing near a horizon, not an event-time algorithm.

The default seven-day public `series()` was also executed against live Horizons: 169
hourly samples including both endpoints, in six serialized requests. Responses are in
`fixtures/near-side-seven-day-series.json`. A warm-cache replay makes zero additional
requests. Larger 64-instant GET batches produced HTTP 502 in this environment despite
bounded retries; 32-instant batches completed. The adapter now caps discrete queries at
32 to keep URLs small. This is an operational observation, not a NASA numerical limit.

The 15 offline tests verify strict calendar/frame/datum validation; coordinate axes and
height units; all direct-source fixture round-trips; named-column angle/range/diameter
conversion; malformed metadata, missing/duplicated/unordered samples; cache isolation
and parameter identity; independent and total cancellation; retry/timeout/size limits;
public observation replay; stale selections; browser-to-backend integration; all seven
snapshots through the existing observer validator; shared-queue serialization; and the
full default series plus its warm-cache replay.

## Tolerances and limits

| Check | Tolerance / interpretation |
| --- | --- |
| Response timestamp vs requested JD UTC | 1 ms, allowing JD floating-point and printed-date quantization; not physical ephemeris accuracy |
| Header longitude/latitude | 0.00001° (header printing precision) |
| Header observer altitude | 0.00001 km = 1 cm (header printing precision) |
| Local basis orthogonality | 1e−14 in tests |
| Parsed azimuth vs independent named raw column | 1e−10°; permits modulo roundoff |
| Elevation and range vs raw printed value | Exact parsed numeric equality |
| Angular diameter | Exact source arcseconds divided by 3600 |

These establish adapter fidelity to Horizons under identical settings, not an independent
validation of JPL dynamics. Source uncertainty, printed precision, model revision,
observer coordinates, EOP predictions and future leap seconds limit physical accuracy.
No interpolated observations or fine event-time claims are made. The raw headers preserve
which EOP intervals are data-based and which are predictions.

Continuous-light/dark cases, short/grazing intervals, boundary events, duration accounting,
disc thresholds and missing-data interval propagation are **stage 4 tests pending**, not
passed tests. Full frame/orientation comparisons belong to stage 3; independent terrain
reference comparisons belong to stage 6. One/seven/31-day and multi-site performance
profiling with memory/source-request counts and machine-specific budgets is stage 5.
The seven-day validation above is functional evidence, not a performance-budget claim.
