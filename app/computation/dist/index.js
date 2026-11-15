export * from './contracts.js';
export * from './core.js';
export * from './forecast.js';
export * from './static-forecast.js';

import { ComputationError, parseUtc, requireCondition, throwIfAborted, validateSite } from './core.js';

/** Browser-safe facade. Inject a backend client or any compatible provider. */
export function createComputationEngine({ ephemerisProvider }                                          ) {
  return {
    async observe(request                )                            {
      throwIfAborted(request.signal);
      const site = validateSite(request.site), instantUtc = new Date(parseUtc(request.instantUtc)).toISOString();
      const result = await ephemerisProvider.observe({ ...request, site, instantUtc });
      throwIfAborted(request.signal);
      requireCondition(result && typeof result === 'object', 'INVALID_RESPONSE', 'Missing snapshot');
      const returnedSite = validateSite(result.site);
      if ((Object.keys(site)                         ).some(key => returnedSite[key] !== site[key]) || result.instantUtc !== instantUtc)
        throw new ComputationError('INVALID_RESPONSE', 'Provider returned a different site or instant');
      requireCondition(result.directionKind === 'apparent' && result.interpolated === false && result.provenance?.source && result.provenance?.model,
        'INVALID_RESPONSE', 'Unsupported snapshot model');
      for (const name of ['sun','earth']         ) {
        const b = result.bodies?.[name];
        requireCondition(b && Number.isFinite(b.azimuthDeg) && b.azimuthDeg >= 0 && b.azimuthDeg < 360 &&
          Number.isFinite(b.elevationDeg) && Math.abs(b.elevationDeg) <= 90 && Number.isFinite(b.rangeKm) && b.rangeKm > 0 &&
          Number.isFinite(b.angularDiameterDeg) && b.angularDiameterDeg > 0 && b.angularDiameterDeg < 180,
          'INVALID_RESPONSE', `Invalid ${name} observation`);
      }
      return result;
    }
  };
}

/** Existing observer validates [-180,180] longitude. Re-express longitude only; no frame conversion. */
export function toObserverViewSnapshot                                                  (snapshot   )    {
  const copy = structuredClone(snapshot);
  copy.site.longitudeEastDeg = ((copy.site.longitudeEastDeg + 180) % 360 + 360) % 360 - 180;
  return copy;
}
/** One instance per UI selection stream, never shared between independent callers. */
export function createLatestObserver(engine                   ) {
  let generation = 0;
  return async (request                ) => {
    const own = ++generation;
    const result = await engine.observe(request);
    throwIfAborted(request.signal);
    if (generation !== own) throw new ComputationError('STALE', 'A newer selection superseded this observation');
    return result;
  };
}
