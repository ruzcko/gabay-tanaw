/** SERVER ONLY. Import browser-safe APIs from index.ts instead. */

import { ComputationError, julianDayUtc, observerAltitudeKm, parseUtc, requireCondition, throwIfAborted, validateSite, validateWindow } from './core.js';
import { parseHorizons } from './horizons-parser.js';

export { parseHorizons } from './horizons-parser.js';

/** Share one queue across every provider in a process; coordinate replicas externally. */
export function createSerialQueue() {
  let tail                   = Promise.resolve();
  return { run   (work                  )             {
    const next = tail.then(work); tail = next.catch(() => {}); return next;
  } };
}
export function createMemoryCache   (maximumEntries = 64)           {
  requireCondition(Number.isInteger(maximumEntries) && maximumEntries > 0, 'INVALID_INPUT', 'Invalid cache capacity');
  const entries = new Map          ();
  return {
    get(key) { const value = entries.get(key); return value === undefined ? undefined : structuredClone(value); },
    set(key, value) { entries.delete(key); entries.set(key, structuredClone(value));
      while (entries.size > maximumEntries) entries.delete(entries.keys().next().value ); }
  };
}
export function buildHorizonsParameters(q               )                        {
  const p                        = { format: 'json', COMMAND: String(q.target), OBJ_DATA: 'YES', MAKE_EPHEM: 'YES',
    CENTER: 'coord@301', COORD_TYPE: 'GEODETIC', SITE_COORD: `${q.site.longitudeEastDeg},${q.site.latitudeDeg},${observerAltitudeKm(q.site)}`,
    TLIST: q.instantsUtc.map(t => `'${julianDayUtc(t).toFixed(12)}'`).join(','), TLIST_TYPE: 'JD', TIME_TYPE: 'UT',
    REF_SYSTEM: 'ICRF', CSV_FORMAT: 'YES', CAL_TYPE: 'GREGORIAN', TIME_DIGITS: 'FRACSEC' };
  if (q.kind === 'observer') Object.assign(p, { EPHEM_TYPE: 'OBSERVER', QUANTITIES: '4,13,14,15,17,20,30,32',
    APPARENT: 'AIRLESS', RANGE_UNITS: 'KM', CAL_FORMAT: 'JD', ANG_FORMAT: 'DEG', EXTRA_PREC: 'YES',
    ELEV_CUT: '-90', SKIP_DAYLT: 'NO', SOLAR_ELONG: '0,180', R_T_S_ONLY: 'NO' });
  else Object.assign(p, { EPHEM_TYPE: 'VECTORS', REF_PLANE: 'FRAME', VEC_CORR: 'NONE', VEC_TABLE: '2', OUT_UNITS: 'KM-S' });
  return p;
}

function abortError() { return new ComputationError('ABORTED', 'Request cancelled'); }
function delay(ms        , signal             ) {
  return new Promise      ((resolve,reject) => {
    if (signal.aborted) { reject(abortError()); return; }
    const done = () => { signal.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(done, ms);
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(abortError()); };
    signal.addEventListener('abort', cancel, { once: true });
  });
}
async function limitedText(response          , max        )                  {
  if (Number(response.headers.get('content-length')) > max) { await response.body?.cancel(); throw new ComputationError('LIMIT_EXCEEDED','Response too large'); }
  requireCondition(response.body, 'INVALID_RESPONSE', 'Empty response');
  const reader = response.body.getReader(), decoder = new TextDecoder(); let bytes = 0, text = '';
  try { while (true) { const {done,value} = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > max) { await reader.cancel(); throw new ComputationError('LIMIT_EXCEEDED','Response too large'); }
    text += decoder.decode(value, { stream: true });
  } return text + decoder.decode(); } finally { reader.releaseLock(); }
}

export function createHorizonsProvider(options                 )

  {
  requireCondition(typeof options.userAgent === 'string' && /\S+\/\S+.*(?:https?:\/\/|@)/.test(options.userAgent) && !/[\r\n]/.test(options.userAgent),
    'INVALID_INPUT', 'Provide application/version and contact URL or email in userAgent');
  const transport = options.fetch ?? globalThis.fetch, queue = options.queue ?? createSerialQueue();
  const cache = options.cache ?? createMemoryCache                ();
  const maxDays = options.maximumDays ?? 100, maxBytes = options.maximumResponseBytes ?? 2_000_000;
  const timeoutMs = options.timeoutMs ?? 30000, retries = options.retries ?? 2, retryBaseMs = options.retryBaseMs ?? 1000;
  const maxPending = options.maximumPendingQueries ?? 32;
  requireCondition(Number.isFinite(maxDays) && maxDays > 0 && Number.isInteger(maxBytes) && maxBytes > 0 &&
    Number.isInteger(maxPending) && maxPending > 0 && Number.isFinite(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000 &&
    Number.isInteger(retries) && retries >= 0 && retries <= 5 && Number.isFinite(retryBaseMs) && retryBaseMs >= 0 && retryBaseMs <= 60000,
    'INVALID_INPUT', 'Invalid provider limits');
  const flights = new Map               ();
  async function retrieve(q               , parameters                       , signal             )                          {
    const url = new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
    for (const [key,value] of Object.entries(parameters)) url.searchParams.set(key, key === 'format' || key === 'TLIST' ? value : `'${value}'`);
    for (let attempt = 0; ; attempt++) {
      throwIfAborted(signal);
      const controller = new AbortController(); let timedOut = false;
      const cancel = () => controller.abort(); signal.addEventListener('abort',cancel,{once:true});
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      let retryAfterMs = 0;
      try {
        const response = await transport(url, { signal: controller.signal, headers: { 'User-Agent': options.userAgent, Accept: 'application/json' } });
        if (!response.ok) {
          const retryAfter = response.headers.get('retry-after');
          retryAfterMs = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter)*1000 : Math.max(0,Date.parse(retryAfter)-Date.now())) : 0;
          await response.body?.cancel();
          throw new ComputationError('UPSTREAM', `Horizons HTTP ${response.status}`, { transient: response.status === 429 || response.status >= 500, status: response.status });
        }
        requireCondition(response.headers.get('content-type')?.includes('application/json'), 'INVALID_RESPONSE','Expected JSON content type');
        const raw = await limitedText(response, maxBytes);
        throwIfAborted(signal);
        return parseHorizons(raw, q, parameters, (options.now?.() ?? new Date()).toISOString());
      } catch (error) {
        if (signal.aborted) throw abortError();
        const e = timedOut ? new ComputationError('TIMEOUT','Horizons request timed out', { transient: true }) :
          error instanceof ComputationError ? error : new ComputationError('UPSTREAM', error instanceof Error ? error.message : 'Transport failed', { transient: error instanceof TypeError });
        if (!e.details.transient || attempt >= retries || retryAfterMs > 60000) throw e;
      } finally { clearTimeout(timer); signal.removeEventListener('abort',cancel); }
      // Queue remains held during retry/backoff, so no caller bypasses upstream rate limiting.
      await delay(Math.max(retryAfterMs || 0, Math.min(60000,retryBaseMs * 2 ** attempt)), signal);
    }
  }
  async function query(request                                          )                          {
    throwIfAborted(request.signal);
    const site = validateSite(request.site);
    requireCondition([10,399].includes(request.target) && ['observer','geometric'].includes(request.kind), 'INVALID_INPUT','Unsupported target/query kind');
    requireCondition(Array.isArray(request.instantsUtc) && request.instantsUtc.length > 0 && request.instantsUtc.length <= 32, 'LIMIT_EXCEEDED','Query requires 1–32 instants');
    const instantsUtc = request.instantsUtc.map(t => new Date(parseUtc(t)).toISOString());
    for (let i=1;i<instantsUtc.length;i++) requireCondition(instantsUtc[i] > instantsUtc[i-1], 'INVALID_INPUT','Instants must be strictly increasing');
    requireCondition((parseUtc(instantsUtc.at(-1) ) - parseUtc(instantsUtc[0])) / 86400000 <= maxDays,'LIMIT_EXCEEDED','Query exceeds duration cap');
    const q                = { site, instantsUtc, kind: request.kind, target: request.target };
    const parameters = buildHorizonsParameters(q), key = 'tanaw-horizons-parser-v1:' + JSON.stringify(parameters);
    const hit = cache.get(key); if (hit) return structuredClone(hit);
    let flight = flights.get(key);
    if (!flight) {
      requireCondition(flights.size < maxPending, 'LIMIT_EXCEEDED','Too many queued queries');
      const controller = new AbortController();
      flight = { controller, users: 0, promise: Promise.resolve(null                             ) };
      const created = flight;
      flight.promise = queue.run(() => retrieve(q,parameters,controller.signal)).then(result => {
        if (!controller.signal.aborted) cache.set(key,result); return result;
      }).finally(() => { if (flights.get(key) === created) flights.delete(key); });
      flights.set(key,flight);
    }
    const shared = flight; shared.users++;
    return new Promise((resolve,reject) => {
      let done = false;
      const finish = (error          , result                 ) => {
        if (done) return; done = true;
        request.signal?.removeEventListener('abort',cancel); shared.users--;
        if (!shared.users) { shared.controller.abort(); if (flights.get(key) === shared) flights.delete(key); }
        if (error) reject(error); else resolve(structuredClone(result ));
      };
      const cancel = () => finish(abortError());
      request.signal?.addEventListener('abort',cancel,{once:true});
      shared.promise.then(value => finish(undefined,value),error => finish(error));
      if (request.signal?.aborted) cancel();
    });
  }
  return {
    query,
    async series(request) {
      const window = validateWindow(request.startUtc,request.durationDays,maxDays), step = request.stepSeconds ?? 3600;
      requireCondition(Number.isFinite(step) && step >= 1,'INVALID_INPUT','Step must be at least one second');
      const start = parseUtc(window.startUtc), end = parseUtc(window.endUtc), count = Math.ceil((end-start)/(step*1000))+1;
      requireCondition(count <= 10000,'LIMIT_EXCEEDED','Series exceeds 10000 samples');
      const instants = Array.from({length:count},(_,i) => new Date(Math.min(end,start+i*step*1000)).toISOString());
      const results                   = [];
      for (let i=0;i<instants.length;i+=32) results.push(await query({ ...request, kind: request.kind ?? 'observer', instantsUtc: instants.slice(i,i+32) }));
      return results;
    },
    async observe(request                )                            {
      const site = validateSite(request.site), instantUtc = new Date(parseUtc(request.instantUtc)).toISOString();
      // Sequential requests comply with JPL's single-request rule even without deduplication.
      const sun = await query({site,instantsUtc:[instantUtc],target:10,kind:'observer',signal:request.signal});
      const earth = await query({site,instantsUtc:[instantUtc],target:399,kind:'observer',signal:request.signal});
      const body = (r                ) => { const s=r.observerSamples[0]; return { azimuthDeg:s.azimuthDeg,elevationDeg:s.elevationDeg,rangeKm:s.rangeKm,angularDiameterDeg:s.angularDiameterDeg }; };
      const unsupported = { status: 'unsupported'         , reason: 'Stage 3 orientation/frame validation pending; apparent angles must not be used as geometric lighting.' };
      const warnings = ['Apparent airless directions; angular diameters are Horizons equatorial disc widths.',
        'Terrain, eclipses, event detection, interpolation and full Earth/star orientation are not implemented.',
        'Future UTC conversions assume currently known leap seconds. Preserve EOP prediction/coverage limits from source headers.'];
      if ([sun,earth].some(r => Math.abs(r.observerSamples[0].elevationDeg) > 89.9)) warnings.push('Azimuth is ill-conditioned near zenith/nadir; use direction vectors for display.');
      return { site,instantUtc,directionKind:'apparent',bodies:{sun:body(sun),earth:body(earth)},interpolated:false,
        provenance:{source:'NASA/JPL Horizons',model:'MOON_ME_DE421 / airless apparent / sphere-1737400m',
          retrievedAtUtc:earth.provenance.retrievedAtUtc,warnings,records:[sun.provenance,earth.provenance]},
        capabilities:{geometricSunlightLocal:unsupported,moonRelativeSun:unsupported,moonRelativeEarth:unsupported,
          earthBodyToLocal:unsupported,earthIlluminationBody:unsupported,starCatalogToLocal:unsupported,eclipses:'unsupported'} };
    }
  };
}
