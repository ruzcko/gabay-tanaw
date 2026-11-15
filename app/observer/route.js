import { ComputationError, parseUtc } from '../computation/dist/index.js';

/** Decode the host handoff without defaults, rounding, or a second selection clock. */
export async function readObserverRoute(search, { signal, fetcher = fetch } = {}) {
  const params = new URLSearchParams(search);
  const invalid = message => { throw new ComputationError('INVALID_INPUT', message); };
  for (const key of ['site', 'lat', 'lon', 't', 'tripEnd', 'rangeStart', 'rangeDays'])
    if (params.getAll(key).length > 1) invalid(`Observer link contains more than one ${key} value`);
  const instantUtc = params.get('t');
  if (!instantUtc) invalid('Observer link needs a selected UTC time');
  parseUtc(instantUtc);
  const tripEnd = params.get('tripEnd');
  let trip = {};
  if (params.has('rangeStart') || params.has('rangeDays')) {
    const startUtc = params.get('rangeStart'), days = params.get('rangeDays');
    if (!startUtc || !/^[1-9]\d{0,2}$/.test(days) || Number(days) > 365)
      invalid('Observer range needs a start date and 1–365 days.');
    const start = parseUtc(startUtc), selected = parseUtc(instantUtc);
    if (start % 86400000 || selected < start || selected >= start + Number(days) * 86400000)
      invalid('Selected time must be inside the observer date range.');
    trip.range = { startUtc, days: Number(days) };
  }
  if (tripEnd !== null) {
    const durationDays = (parseUtc(tripEnd, true) - parseUtc(instantUtc)) / 86400000;
    if (!(durationDays > 0 && durationDays <= 30)) invalid('Travel stay must be greater than zero and at most 30 days.');
    trip.trip = { startUtc: instantUtc, endUtc: tripEnd, durationDays };
  }
  const id = params.get('site');
  if (id !== null && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) invalid('Observer link has an invalid site ID');
  const hasLatitude = params.has('lat'), hasLongitude = params.has('lon');
  if (hasLatitude !== hasLongitude) invalid('Observer link needs both latitude and longitude');
  if (hasLatitude) {
    const coordinate = key => {
      const value = params.get(key);
      if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value)))
        invalid(`Observer link has an invalid ${key} coordinate`);
      return Number(value);
    };
    return { site: { latitudeDeg: coordinate('lat'), longitudeEastDeg: coordinate('lon'), ...(id ? { id } : {}) }, instantUtc, ...trip };
  }
  if (!id) invalid('Observer link needs a selected site or latitude and longitude');
  // Keep existing site/t bookmarks valid. The normal link includes full coordinates.
  const response = await fetcher(new URL('../data/sites.json', import.meta.url), { signal });
  if (!response.ok) throw new ComputationError('UPSTREAM', `Site catalog unavailable (HTTP ${response.status})`);
  const catalog = await response.json();
  if (!Array.isArray(catalog)) throw new ComputationError('INVALID_RESPONSE', 'Site catalog is invalid');
  const selected = catalog.find(site => site.id === id);
  if (!selected) throw new ComputationError('UNSUPPORTED', 'Observer link does not identify a saved catalog site');
  return { site: { id, latitudeDeg: selected.lat, longitudeEastDeg: selected.lon }, instantUtc, ...trip };
}
