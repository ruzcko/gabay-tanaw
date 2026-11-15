/** Saved forecasts only. No ephemeris, interpolation or visibility calculation occurs here. */
import type { LunarSite, ObserverSnapshot } from './contracts.ts';
import { ComputationError, sameLongitude, parseUtc, requireCondition, throwIfAborted, validateSite } from './core.ts';
import { readForecastHour, validateForecastMonth } from './forecast.ts';

/** Coordinates use the catalog's DE421 mean-Earth frame and radial sphere datum.
 * Optional frame/datum/height assertions must match; id is never required. */
export interface ForecastSelection {
  latitudeDeg: number;
  longitudeEastDeg: number;
  id?: string;
  referenceFrame?: string;
  elevationDatum?: string;
  surfaceElevationM?: number;
  observerHeightM?: number;
}
interface CatalogSite {
  id: string; lat: number; lon: number; referenceFrame: string; elevationDatum: string;
  frameEvidence: string; positionAccuracy?: 'approximate';
}
export interface ForecastScience {
  visibility: 'center'; referenceFrame: string; elevationDatum: string;
  surfaceElevationM: number; observerHeightM: number; frameEvidence: string;
  coordinateFrameReview: unknown; positionAccuracy?: 'approximate';
  stepMinutes: number; horizonStepDeg: number; horizonSha256: string;
  sources: { file: string; sha256: string; header: string }[];
}
interface ForecastIndex {
  id: string; lat: number; lon: number; horizon: string; ephemeris: string;
  window: { start: string; end: string }; months: string[]; science: ForecastScience;
}
export interface StaticForecastSnapshot extends Omit<ObserverSnapshot, 'provenance' | 'bodies'> {
  bodies: Pick<ReturnType<typeof readForecastHour>, 'sun' | 'earth'>;
  provenance: {
    source: string; model: string; warnings: string[];
    forecast: { index: string; month: string; window: ForecastIndex['window']; science: ForecastScience };
  };
}
const startUtc = '2026-12-01T00:00:00Z', endUtc = '2027-12-01T00:00:00Z';
const months = ['2026-12', ...Array.from({ length: 11 }, (_, i) => `2027-${String(i + 1).padStart(2, '0')}`)];
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const hash = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

function sourceBoundary(header: string, label: string): number {
  const matches = [...header.matchAll(new RegExp(`${label}\\s*:\\s*A.D. (\\d{4})-([A-Za-z]{3})-(\\d{2}) 00:00:00\\.0000 UT[ \\t]*$`, 'gm'))];
  requireCondition(matches.length === 1, 'INVALID_RESPONSE', 'Missing or duplicate source window');
  const [, y, m, d] = matches[0], month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m);
  const at = Date.UTC(Number(y), month, Number(d)), date = new Date(at);
  requireCondition(month >= 0 && date.getUTCFullYear() === Number(y) && date.getUTCMonth() === month &&
    date.getUTCDate() === Number(d), 'INVALID_RESPONSE', 'Invalid source date');
  return at;
}

/** Validate provenance coverage, not transport chunk count. Python validates the raw samples. */
function sourceCoverage(science: ForecastScience): void {
  const sources = science.sources;
  requireCondition(Array.isArray(sources) && sources.length >= 2, 'INVALID_RESPONSE', 'Missing forecast source evidence');
  const names = new Set<string>(), spans: Record<string, [number, number][]> = { sun: [], earth: [] };
  for (const source of sources) {
    requireCondition(source && typeof source.file === 'string' && hash(source.sha256) && text(source.header),
      'INVALID_RESPONSE', 'Malformed forecast source evidence');
    const name = /^(sun|earth)-(\d{4}-\d{2}(?:-\d{2}_\d{4}-\d{2}-\d{2})?)\.txt\.gz$/.exec(source.file);
    requireCondition(name && !names.has(source.file), 'INVALID_RESPONSE', 'Unknown or duplicate forecast source');
    names.add(source.file);
    const [, body, label] = name;
    const target = body === 'sun' ? 'Sun \\(10\\)' : 'Earth \\(399\\)';
    requireCondition(new RegExp(`Target body name: ${target}`).test(source.header) &&
      new RegExp(`Step-size\\s*:\\s*${science.stepMinutes} minutes\\s*$`, 'm').test(source.header),
      'INVALID_RESPONSE', 'Source target or cadence mismatch');
    const a = sourceBoundary(source.header, 'Start time'), b = sourceBoundary(source.header, 'Stop  time');
    const start = new Date(a).toISOString().slice(0, 10), end = new Date(b).toISOString().slice(0, 10);
    requireCondition(label === (label.includes('_') ? `${start}_${end}` : start.slice(0, 7)),
      'INVALID_RESPONSE', 'Source filename/window mismatch');
    spans[body].push([a, b]);
  }
  for (const body of ['sun', 'earth']) {
    let cursor = Date.parse(startUtc);
    for (const [a, b] of spans[body].sort((x, y) => x[0] - y[0])) {
      requireCondition(a === cursor && b > a, 'INVALID_RESPONSE', 'Source coverage gap or overlap');
      cursor = b;
    }
    requireCondition(cursor === Date.parse(endUtc), 'INVALID_RESPONSE', 'Incomplete forecast source coverage');
  }
}

function catalog(value: unknown): CatalogSite[] {
  requireCondition(Array.isArray(value) && value.length === 30, 'INVALID_RESPONSE', 'Expected the reviewed 30-site catalog');
  const sites = value as CatalogSite[];
  requireCondition(new Set(sites.map(s => s?.id)).size === 30, 'INVALID_RESPONSE', 'Duplicate catalog site');
  for (const s of sites) {
    requireCondition(s && typeof s.id === 'string' && /^[a-z0-9-]+$/.test(s.id) && text(s.frameEvidence) &&
      (s.positionAccuracy === undefined || s.positionAccuracy === 'approximate'), 'INVALID_RESPONSE', 'Invalid catalog identity/evidence');
    validateSite({ id: s.id, latitudeDeg: s.lat, longitudeEastDeg: s.lon, referenceFrame: s.referenceFrame,
      elevationDatum: s.elevationDatum, surfaceElevationM: 0, observerHeightM: 0 });
  }
  return sites;
}
function forecastIndex(value: unknown, selected: CatalogSite): ForecastIndex {
  const f = value as ForecastIndex, s = f?.science;
  requireCondition(f && f.id === selected.id && f.lat === selected.lat && f.lon === selected.lon,
    'INVALID_RESPONSE', 'Forecast coordinates do not match the catalog');
  requireCondition(f.window?.start === startUtc && f.window?.end === endUtc &&
    JSON.stringify(f.months) === JSON.stringify(months), 'INVALID_RESPONSE', 'Incomplete forecast window/month index');
  requireCondition(f.horizon === 'lola' && text(f.ephemeris) && s && s.visibility === 'center' &&
    s.referenceFrame === selected.referenceFrame && s.elevationDatum === selected.elevationDatum &&
    s.frameEvidence === selected.frameEvidence && s.positionAccuracy === selected.positionAccuracy &&
    [1, 10].includes(s.stepMinutes) && s.horizonStepDeg === 0.25 && hash(s.horizonSha256),
    'INVALID_RESPONSE', 'Missing or incompatible forecast science metadata');
  validateSite({ id: f.id, latitudeDeg: f.lat, longitudeEastDeg: f.lon, ...s });
  sourceCoverage(s);
  return f;
}

/** Shared validated downloads, bounded to 64 files. Consumers cancel independently.
 * A one-task grace period lets a newer hour reuse an in-flight monthly download. */
function downloads(baseUrl: URL, fetcher: typeof fetch) {
  type Entry = { controller: AbortController; promise: Promise<unknown>; users: number; done: boolean; timer?: ReturnType<typeof setTimeout> };
  const entries = new Map<string, Entry>();
  let disposed = false;
  const trim = () => {
    for (const [key, cached] of entries) {
      if (entries.size <= 64) break;
      if (cached.done && !cached.users) entries.delete(key);
    }
  };
  return {
    async read<T>(path: string, validate: (value: unknown) => T, signal?: AbortSignal): Promise<T> {
      throwIfAborted(signal);
      requireCondition(!disposed, 'ABORTED', 'Forecast provider disposed');
      let entry = entries.get(path);
      if (!entry) {
        const controller = new AbortController();
        entry = { controller, users: 0, done: false, promise: Promise.resolve() };
        const own = entry;
        entries.set(path, own);
        own.promise = (async () => {
          const response = await fetcher(new URL(path, baseUrl), { signal: controller.signal });
          if (!response.ok) throw new ComputationError('UPSTREAM', `Forecast unavailable: ${path} (HTTP ${response.status})`);
          const result = validate(await response.json());
          throwIfAborted(controller.signal);
          own.done = true;
          // Active requests are never evicted. Completed entries are bounded FIFO.
          trim();
          return result;
        })().catch(error => { if (entries.get(path) === own) entries.delete(path); throw error; });
      }
      const shared = entry;
      clearTimeout(shared.timer); shared.users++;
      return new Promise<T>((resolve, reject) => {
        let finished = false;
        const finish = (error: unknown, value?: unknown) => {
          if (finished) return;
          finished = true; signal?.removeEventListener('abort', abort); shared.users--;
          trim();
          if (!shared.done && !shared.users) shared.timer = setTimeout(() => {
            if (!shared.users && !shared.done) {
              shared.controller.abort();
              if (entries.get(path) === shared) entries.delete(path);
            }
          }, 0);
          if (error) reject(error); else resolve(value as T);
        };
        const abort = () => finish(new ComputationError('ABORTED', 'Forecast selection cancelled'));
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        shared.promise.then(value => finish(null, value), error => finish(error));
      });
    },
    dispose() { disposed = true; for (const e of entries.values()) { clearTimeout(e.timer); e.controller.abort(); } entries.clear(); }
  };
}

export function createStaticForecastProvider({ baseUrl = new URL('../../data/', import.meta.url), fetcher = fetch }: {
  baseUrl?: URL; fetcher?: typeof fetch;
} = {}) {
  const cache = downloads(baseUrl, fetcher);
  return {
    async observe({ site, instantUtc, signal }: { site: ForecastSelection; instantUtc: string; signal?: AbortSignal }): Promise<StaticForecastSnapshot> {
      throwIfAborted(signal);
      // Copy selection before any await: caller mutations cannot change an in-flight request.
      site = structuredClone(site);
      const ms = parseUtc(instantUtc);
      requireCondition(ms >= parseUtc(startUtc) && ms < parseUtc(endUtc) && ms % 3600000 === 0,
        'UNSUPPORTED', 'Forecast unavailable: select a saved UTC hour from 2026-12-01 through 2027-12-01 (end exclusive)');
      requireCondition(site && Number.isFinite(site.latitudeDeg) && Math.abs(site.latitudeDeg) < 90 && Number.isFinite(site.longitudeEastDeg),
        'UNSUPPORTED', 'Forecast unavailable: coordinates must match a saved catalog site');
      const sites = await cache.read('sites.json', catalog, signal);
      const selected = sites.find(s => (site.id === undefined || site.id === s.id) &&
        site.latitudeDeg === s.lat && sameLongitude(site.longitudeEastDeg, s.lon));
      requireCondition(selected, 'UNSUPPORTED', 'Forecast unavailable: coordinates/ID do not match a saved catalog site');
      for (const key of ['referenceFrame', 'elevationDatum'] as const)
        requireCondition(site[key] === undefined || site[key] === selected[key], 'INCOMPATIBLE_FRAME', `Unsupported ${key}; no implicit conversion`);
      const indexPath = `forecast/${selected.id}.json`;
      const index = await cache.read(indexPath, value => forecastIndex(value, selected), signal);
      const science = index.science;
      for (const key of ['surfaceElevationM', 'observerHeightM'] as const)
        requireCondition(site[key] === undefined || site[key] === science[key], 'UNSUPPORTED', `Forecast unavailable for requested ${key}`);
      const modeledSite: LunarSite = validateSite({ id: selected.id, latitudeDeg: selected.lat, longitudeEastDeg: selected.lon,
        surfaceElevationM: science.surfaceElevationM, observerHeightM: science.observerHeightM,
        referenceFrame: science.referenceFrame, elevationDatum: science.elevationDatum });
      const label = instantUtc.slice(0, 7), i = months.indexOf(label);
      const monthPath = `forecast/${selected.id}/${label}.json`;
      const month = await cache.read(monthPath, value => validateForecastMonth(value, `${label}-01T00:00:00Z`,
        i === months.length - 1 ? endUtc : `${months[i + 1]}-01T00:00:00Z`), signal);
      throwIfAborted(signal);
      const hour = readForecastHour(month, instantUtc);
      const unsupported = { status: 'unsupported' as const, reason: 'Saved forecasts contain no validated orientation/geometric inputs' };
      return {
        site: modeledSite, instantUtc: new Date(ms).toISOString(), directionKind: 'apparent', interpolated: false,
        bodies: { sun: hour.sun, earth: hour.earth },
        provenance: {
          source: index.ephemeris, model: 'Saved hourly airless apparent observations; terrain center visibility; radial local up',
          warnings: [
            'Exact saved hours only; no interpolation. Visibility describes body centers, not partial discs or link availability.',
            'Geometric lighting, Earth orientation and phases, star rotation, Moon-frame overview bodies and eclipses are unsupported.',
            'Coordinate evidence is retained as published; empirical terrain consistency is not a measured frame registration or positional error bound.',
            ...(science.positionAccuracy === 'approximate' ? ['Approximate planned target coordinates; not a surveyed landing position.'] : [])
          ],
          forecast: { index: indexPath, month: monthPath, window: structuredClone(index.window), science: structuredClone(science) }
        },
        capabilities: {
          geometricSunlightLocal: { ...unsupported }, moonRelativeSun: { ...unsupported }, moonRelativeEarth: { ...unsupported },
          earthBodyToLocal: { ...unsupported }, earthIlluminationBody: { ...unsupported }, starCatalogToLocal: { ...unsupported }, eclipses: 'unsupported'
        }
      };
    },
    dispose: () => cache.dispose()
  };
}
