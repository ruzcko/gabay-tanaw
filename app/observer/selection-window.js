/** Resolve catalog identity before deciding whether a location needs preparation. */
export function catalogSiteAt(sites, coordinates) {
  return sites.find(site => Math.abs(site.lat - coordinates.latitudeDeg) < 1e-7 &&
    Math.abs(((site.lon - coordinates.longitudeEastDeg + 540) % 360) - 180) < 1e-7);
}

/** UTC labels only; the Python service owns every scientific sample in this window. */
export function requestedWindow(state) {
  const start = Date.parse(state.startUtc);
  const end = start + state.length * 86400000;
  const instant = Date.parse(state.instantUtc);
  if (!Number.isInteger(state.length) || state.length < 1 || state.length > 365 || !Number.isFinite(start) ||
      start % 86400000 !== 0 || !Number.isFinite(instant) || instant < start || instant >= end)
    throw new Error('The selected UTC hour is outside the requested data window.');
  return { startUtc: new Date(start).toISOString(), endUtc: new Date(end).toISOString() };
}
