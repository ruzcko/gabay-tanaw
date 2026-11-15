# Tanaw Computation Engine

Browser contracts and checks for Tanaw's static forecasts, with no runtime dependencies.
Python `science/` owns production precompute: upstream Horizons access, terrain, visibility
and events. The reviewed catalog contains 30 sites and twelve monthly files per site.
No backend is deployed. The observer's separate daily quick-estimate readout uses
the optional browser worker described in [QUICK.md](QUICK.md); its year coverage
comes from the shipped coefficient manifest.

[Travel](TRAVEL.md) provides date-to-region screening and six-month arrival searches
through `dist/travel.js`, with configurable terrain/visibility requirements and explicit
unresolved results. The science is integrated; UI integration is separate.

`src/forecast.ts` validates the existing monthly arrays and reads exact saved hours.
It returns Python's visibility state; it does not infer it from rounded sky positions.
Validation here checks data structure, not site survey accuracy. See
[science results](../../science/EARTH_VALIDATION.md).

The historical TypeScript Horizons/server modules and their tests remain isolated
prototypes for compatibility. Do not use them as a second production science path.
A future backend must reuse Python's scientific definitions behind `EphemerisProvider`;
its hosting, arbitrary-site terrain coverage and interpolation remain future work.

## Module layout

| Location | Responsibility |
| --- | --- |
| `src/forecast.ts` | Monthly static forecast checks and exact-hour reading |
| `src/contracts.ts`, `src/core.ts` | Shared types, units, site/frame/time validation and browser-safe coordinate calculations |
| `src/index.ts`, `src/http.ts` | Public browser-safe facade, stale-result guard, observer bridge and backend client |
| `src/horizons.ts`, `src/horizons-parser.ts` | Server-side source access, request queue/cache, parsing and provenance |
| `src/server.ts` | Framework-independent backend request handler |
| `dist/` | Generated JavaScript matching `src/`; separate browser and server entry points, never hand-edit |
| `fixtures/` | Direct-source snapshots, raw responses, exact requests and series evidence |
| `test/` | Offline scientific-contract, adapter, concurrency and integration checks |
| `examples/` | Runnable backend and host-to-observer integration examples |
| `scripts/` | Build and deliberate live-fixture capture tools; not browser runtime |
| `package.json`, `package-lock.json`, `tsconfig.json` | Isolated module tooling and pinned development dependency |
| `README.md`, `SCIENCE.md`, `VERIFICATION.md` | API/layout, scientific conventions and validation limits |

This layout keeps the scientific module independent of the observer renderer and map.
Scientific algorithm improvements belong in Python; the browser module validates and
serves their published contracts. Unsupported orientation capabilities stay explicit. All consumers share these scientific
definitions. The host coordinates results; rendering code owns its visual calculations.

## Run and verify

Requires Node 24.13+. From `app/computation`:

```sh
npm install
npm run typecheck
npm test
npm run build
node examples/server.mjs
```

The generated `dist/*.js` is supplied for the existing browser-native app. Editing the
TypeScript requires rebuilding; the rest of the app still needs no build step. Node's
bundled type eraser is experimental; TypeScript 5.9.3 checks the source separately.
Do not edit generated modules. `npm run fixtures` deliberately refreshes live-source
fixtures (48 serialized requests); normal tests are offline. Review fixture diffs because
upstream ephemerides, EOP and leap-second predictions can change.

## Public entry points

| Entry | Public API | Environment |
| --- | --- | --- |
| `src/index.ts` / `dist/index.js` | contracts, coordinate/time validation, `createComputationEngine`, `createLatestObserver`, `toObserverViewSnapshot` | browser/server |
| `src/http.ts` / `dist/http.js` | `createHttpEphemerisProvider` | browser/server |
| `src/horizons.ts` / `dist/horizons.js` | `createHorizonsProvider`, `createSerialQueue`, `createMemoryCache`, `buildHorizonsParameters`, `parseHorizons` | server only |
| `src/server.ts` / `dist/server.js` | `createObservationHandler` (Fetch Request → Response) | server only |

`provider.observe({site, instantUtc, signal})` obtains a direct apparent snapshot.
`provider.query({site, instantsUtc, target:10|399, kind:'observer'|'geometric', signal})`
returns up to 32 validated samples plus exact source records. Geometric positions and
velocities are observer-relative ICRF, with no light-time or aberration corrections.
`provider.series({site,startUtc,durationDays:7,stepSeconds:3600,target:10,signal})`
chunks bounded samples serially; default duration is seven days, default cap 100 days,
configurable with `maximumDays`. The last sample is exactly the window end. This is a
source series, **not an availability analysis or a playback interpolator**.

Errors are `ComputationError` with `code`, `message`, and `details`; invalid observations
are rejected, never replaced with zero-valued astronomy. Cancellation is per subscriber;
the upstream request is aborted when all subscribers leave. Identical pending queries
are deduplicated. One queue serializes all requests and retry backoff. Shared-cache values
are cloned, and the default cache retains at most 64 response records. Supply a `Cache`
and a shared queue when embedding the adapter. There is no global simulation state.

Each response record includes parameters, retrieval UTC, API signature, exact raw JSON,
and complete model/EOP headers. The cache key includes scientific request parameters and
parser revision. Cache records do not expire automatically: retain them for reproducibility;
replace/clear a deployment cache deliberately when adopting a new source revision.

## Delivery boundaries

- Implemented: contracts, coordinates/time, backend networking, validated observer and
  geometric parsing, cache/deduplication/cancellation/retries, fixture snapshots, backend
  handler, browser client and integration example.
- Stage 3: validate full Earth/body/star/local rotations and geometric illumination.
- Stage 4: reference-horizon events, disc definitions, convergence and unknown intervals.
- Stage 5: site comparison and measured cold/warm performance budgets.
- Stage 6: optional DEM horizon profiles, finite-disc terrain occultation and eclipses.

There is deliberately no `analyze`, `analyzeSites`, `getStateAtInstant`, interpolation,
terrain visibility or eclipse implementation yet. Their numerical validation gates must
pass before they are exposed. See [SCIENCE.md](SCIENCE.md)
and [VERIFICATION.md](VERIFICATION.md).
