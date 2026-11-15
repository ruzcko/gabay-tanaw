import { TRAVEL_DEFAULTS, landingCriteria, sixMonthsAfter } from '../computation/dist/travel.js';
import { QUICK_RANGE } from '../computation/dist/quick/coverage.js';

export { TRAVEL_DEFAULTS };
export const DAY = 86400000;
// Stable display identity across equivalent longitude representations and floating-point wrap.
export const travelPointKey = p => `${Math.round(p.lat * 1e7)}:${Math.round((((p.lon % 360) + 360) % 360) * 1e7) % 3600000000}`;
// Selection validation only. All physical screening stays in the computation module.
export function travelRequest({ mode, startUtc, endUtc, point, criteria }) {
  const start = Date.parse(startUtc), end = Date.parse(endUtc);
  if (!['date', 'region'].includes(mode) || !Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Choose valid arrival and departure dates.');
  const resolved = landingCriteria({ ...criteria, durationDays: (end - start) / DAY });
  const searchEnd = mode === 'region' ? Date.parse(sixMonthsAfter(new Date(start).toISOString())) + resolved.durationDays * DAY : end;
  if (start < QUICK_RANGE.start || searchEnd > QUICK_RANGE.end) throw new Error('The full stay and search must fit within 1969–2100 coverage.');
  if (mode === 'region' && (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || Math.abs(point.lat) >= 90 || point.lon < -180 || point.lon > 360))
    throw new Error('Choose coordinates between the exact poles, with longitude from −180° to 360°.');
  return { mode, startUtc: new Date(start).toISOString(), endUtc: new Date(end).toISOString(), point, criteria: resolved };
}

// Presentation only: compare the existing science metrics without changing results or filters.
export function sortTravelResults(results, { field = 'sunlight', direction = 'desc', knownFirst = true, knownIds = new Set() } = {}) {
  const sign = direction === 'asc' ? 1 : -1;
  const compare = (a, b) => {
    const missingA = a == null || (typeof a === 'number' && !Number.isFinite(a));
    const missingB = b == null || (typeof b === 'number' && !Number.isFinite(b));
    if (missingA || missingB) return Number(missingA) - Number(missingB); // Unknown stays last in either direction.
    return sign * (typeof a === 'string' ? a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) : a - b);
  };
  const longitude = point => Number.isFinite(point.lon) ? ((point.lon % 360) + 360) % 360 : null;
  const value = result => field === 'terrain' ? result.terrain?.slopeDeg
    : field === 'name' ? result.point.name?.trim() || null
    : field === 'coordinates' ? longitude(result.point) : result[field]?.hours;
  return [...results].sort((a, b) => {
    if (knownFirst) {
      const group = Number(knownIds.has(b.point.id)) - Number(knownIds.has(a.point.id));
      if (group) return group;
    }
    return compare(value(a), value(b)) || (field === 'coordinates' ? compare(a.point.lat, b.point.lat) : 0);
  });
}

export function resultSource(result) {
  const segments = result.segments || [];
  if (!segments.length || segments.some(s => !s.available || !['accurate', 'estimate'].includes(s.quality))) return 'Unknown · forecast unavailable';
  const kinds = new Set(segments.map(s => s.quality));
  return kinds.size > 1 ? 'Mixed · published forecast and estimate' : kinds.has('estimate') ? 'Estimate · quick compute' : 'Published Python forecast';
}

export function observerLink(result, catalog) {
  const { point, startUtc, endUtc } = result;
  const query = new URLSearchParams({ lat: String(point.lat), lon: String(point.lon), t: startUtc, tripEnd: endUtc });
  if (catalog.some(s => s.id === point.id)) query.set('site', point.id);
  return `observer/?${query}`;
}

// A worker can be terminated even during synchronous engine work. Generation also protects
// against already queued messages from a previous date, location or criteria selection.
export function createTravelJobs(makeWorker = () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })) {
  let worker, generation = 0, active = false;
  const cancel = () => { generation++; worker?.terminate(); worker = null; active = false; };
  const watchIdle = () => {
    const idle = worker;
    if (!idle) return;
    idle.onmessage = null;
    idle.onerror = event => {
      if (worker === idle && !active) cancel();
      event.preventDefault?.();
    };
  };
  return {
    cancel,
    warmup(request) {
      if (worker) return;
      try {
        worker = makeWorker();
        watchIdle();
        worker.postMessage({ ...request, operation: 'warmup' });
      } catch { cancel(); } // Speculative startup failure must not prevent a real Search retry.
    },
    invalidate() {
      if (active) cancel();
      else { generation++; watchIdle(); }
    },
    run(request, onMessage, { reuse = false } = {}) {
      // Completed requests can reuse forecasts and terrain; active work is always stopped.
      if (!reuse || !worker || active) cancel(); else generation++;
      const own = generation;
      worker ||= makeWorker();
      active = true;
      worker.onmessage = event => { if (own === generation) {
        if (event.data.type === 'warmup-complete') return;
        if (['complete', 'map-complete', 'error'].includes(event.data.type)) active = false;
        onMessage(event.data);
      } };
      worker.onerror = event => { if (own === generation) { active = false; onMessage({ type: 'error', message: event.message || 'Travel calculation failed. Try again.' }); } };
      worker.postMessage({ ...request, generation: own });
    }
  };
}
