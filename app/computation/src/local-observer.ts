import { parseUtc, validateSite, normalizeLongitude, requireCondition } from './core.ts';

export interface LocalSelection { latitudeDeg: number; longitudeEastDeg: number; id?: string }
export interface LocalObserverWindow { startUtc: string; endUtc: string }
function windowParameters(params: URLSearchParams, window: LocalObserverWindow, instantUtc: string) {
  const start = parseUtc(window.startUtc), end = parseUtc(window.endUtc), instant = parseUtc(instantUtc);
  requireCondition(start % 86400000 === 0 && end-start === 30*86400000 && instant % 3600000 === 0 && instant >= start && instant < end &&
    start >= parseUtc('2026-12-01T00:00:00Z') && end <= parseUtc('2027-12-01T00:00:00Z'),
    'INVALID_INPUT', 'Select 30 consecutive UTC days containing the selected hour');
  params.set('startUtc', window.startUtc); params.set('endUtc', window.endUtc);
}
/** The Python service owns observations, orientation and terrain; this reader only checks. */
export async function readLocalObserver(site: LocalSelection, instantUtc: string, signal?: AbortSignal, window?: LocalObserverWindow) {
  const params = new URLSearchParams({ lat: String(site.latitudeDeg), lon: String(site.longitudeEastDeg), t: instantUtc });
  if (site.id) params.set('site', site.id);
  if (window) windowParameters(params, window, instantUtc);
  const response = await fetch(`/api/observer?${params}`, { signal });
  const result = await response.json();
  requireCondition(response.ok, 'UPSTREAM', result.error || 'Local science service unavailable');
  return validateLocalObserver(result, site, instantUtc);
}

export async function readLocalObserverWindow(site: LocalSelection, instantUtc: string, window: LocalObserverWindow, signal?: AbortSignal) {
  const params = new URLSearchParams({ lat: String(site.latitudeDeg), lon: String(site.longitudeEastDeg), t: instantUtc });
  if (site.id) params.set('site', site.id);
  windowParameters(params, window, instantUtc);
  const response = await fetch(`/api/observer-window?${params}`, { signal });
  const result = await response.json();
  requireCondition(response.ok, 'UPSTREAM', result.error || 'Local science service unavailable');
  return validateLocalObserverWindow(result, site, instantUtc, window);
}

export function validateLocalObserverWindow(value: any, site: LocalSelection, instantUtc: string, window: LocalObserverWindow) {
  windowParameters(new URLSearchParams(), window, instantUtc);
  const coverage = value?.coverage;
  requireCondition(coverage && parseUtc(coverage.startUtc) === parseUtc(window.startUtc) &&
    parseUtc(coverage.endUtc) === parseUtc(window.endUtc) && coverage.stepSeconds === 3600 && coverage.sampleCount === 720,
    'INVALID_RESPONSE', 'Service returned incomplete or different window coverage');
  const observation = validateLocalObserver(value.observation, site, instantUtc);
  requireCondition(observation.site.id.startsWith('custom-'), 'INVALID_RESPONSE', 'Expected a custom-site window');
  let observations: any[] | undefined;
  if (value.observations !== undefined) {
    requireCondition(Array.isArray(value.observations) && value.observations.length === 30, 'INVALID_RESPONSE', 'Incomplete daily display snapshots');
    const hour = parseUtc(instantUtc) % 86400000, start = parseUtc(window.startUtc);
    observations = value.observations.map((sample: any, day: number) =>
      validateLocalObserver(sample, site, new Date(start + day*86400000 + hour).toISOString()));
    requireCondition(JSON.stringify(observations!.find(sample => sample.instantUtc === observation.instantUtc)) === JSON.stringify(observation),
      'INVALID_RESPONSE', 'Selected observation and daily snapshots disagree');
  }
  return { coverage: structuredClone(coverage), observation, observations };
}

export function validateLocalObserver(value: any, requested: LocalSelection, instantUtc: string) {
  const result = structuredClone(value), site = validateSite(result?.site);
  const lonDifference = Math.abs(normalizeLongitude(site.longitudeEastDeg - requested.longitudeEastDeg + 180) - 180);
  requireCondition(Math.abs(site.latitudeDeg - requested.latitudeDeg) < 1e-7 && lonDifference < 1e-7 &&
    (!requested.id || requested.id === site.id) && parseUtc(result.instantUtc) === parseUtc(instantUtc), 'INVALID_RESPONSE', 'Service returned another site or date');
  requireCondition(result.directionKind === 'apparent' && result.interpolated === false && result.provenance?.source &&
    result.provenance?.model && result.provenance?.appearance?.frame === 'MOON_ME_DE440_ME421', 'INVALID_RESPONSE', 'Missing science provenance');
  for (const name of ['sun', 'earth']) {
    const b = result.bodies?.[name];
    requireCondition(b && Number.isFinite(b.azimuthDeg) && b.azimuthDeg >= 0 && b.azimuthDeg < 360 &&
      Number.isFinite(b.elevationDeg) && Math.abs(b.elevationDeg) <= 90 && Number.isFinite(b.rangeKm) && b.rangeKm > 0 &&
      Number.isFinite(b.angularDiameterDeg) && b.angularDiameterDeg > 0 && b.angularDiameterDeg < 180 && typeof b.centerVisible === 'boolean',
      'INVALID_RESPONSE', `Invalid ${name} observation`);
  }
  const unit = (v: any, n: number) => Array.isArray(v) && v.length === n && v.every(Number.isFinite) && Math.abs(Math.hypot(...v)-1) < 1e-6;
  requireCondition(unit(result.lighting?.sunDirectionLocal, 3) && result.sky?.catalogFrame === 'ICRS-J1991.25' && unit(result.sky?.catalogToLocal, 4),
    'INVALID_RESPONSE', 'Invalid geometric lighting or star rotation');
  const o = result.overview;
  if (result.earthAppearance) requireCondition(result.earthAppearance.bodyFrame === 'earth-fixed-x0-yNorth-zWest' &&
    unit(result.earthAppearance.bodyToLocal, 4) && unit(result.earthAppearance.sunDirectionBody, 3), 'INVALID_RESPONSE', 'Invalid Earth appearance frame');
  requireCondition(o?.axisConvention === 'x0-yNorth-zWest' && o.moonRadiusM === 1737400 && unit(o.moonToLocal, 4) &&
    ['siteDirectionMoon', 'sunDirectionMoon', 'earthDirectionMoon'].every(key => unit(o[key], 3)), 'INVALID_RESPONSE', 'Invalid overview frame');
  result.site = site;
  return result;
}
