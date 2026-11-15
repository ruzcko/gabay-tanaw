const DAY = 86400000;
const iso = value => new Date(value).toISOString();
const locationKey = site => JSON.stringify([site.latitudeDeg, ((site.longitudeEastDeg % 360) + 360) % 360]);

/** UTC coverage planning only. Every displayed observation comes from the science service. */
export function planForecastChunks(window) {
  const start = Date.parse(window.startUtc), end = Date.parse(window.endUtc), days = (end - start) / DAY;
  if (!Number.isInteger(days) || days < 1 || days > 365 || start % DAY || end % DAY ||
      start < Date.parse('2026-12-01T00:00:00Z') || end > Date.parse('2027-12-01T00:00:00Z')) throw new Error('Unsupported forecast range');
  const chunks = [];
  for (let cursor = start; cursor < end; cursor += 30 * DAY) {
    const chunkStart = Math.max(Date.parse('2026-12-01T00:00:00Z'), Math.min(cursor, end - 30 * DAY));
    chunks.push({ startUtc: iso(chunkStart), endUtc: iso(chunkStart + 30 * DAY) });
  }
  return chunks;
}

/** One bounded request at a time; cached dates stay usable during preparation and failure. */
export function createProgressiveForecast(readWindow, onProgress = () => {}) {
  let session, samples = new Map(), contextKey, serial = 0;
  const pending = new Set();
  const abortError = () => new DOMException('Selection changed', 'AbortError');
  function settle(error) {
    for (const waiter of [...pending]) {
      if (!error && !samples.has(waiter.instantUtc)) continue;
      pending.delete(waiter); waiter.cleanup();
      if (error) waiter.reject(error); else waiter.resolve(samples.get(waiter.instantUtc));
    }
  }
  function stop() {
    ++serial; session?.controller.abort(); session = undefined; settle(abortError());
  }
  const dates = chunk => Array.from({ length: 30 }, (_, day) => iso(Date.parse(chunk.startUtc) + day * DAY + session.hour));
  function state() {
    if (!session) return undefined;
    const start = Date.parse(session.window.startUtc), end = Date.parse(session.window.endUtc);
    const readyDays = [...samples.keys()].filter(utc => Date.parse(utc) >= start && Date.parse(utc) < end).length;
    return { site: session.site, window: session.window, samples, readyDays, totalDays: (end - start) / DAY,
      loading: session.loading, error: session.error };
  }
  function emit() { onProgress(state()); }
  async function pump(active) {
    if (active.loading || active.error || active !== session) return;
    active.loading = true; emit();
    try {
      while (active === session) {
        const chunks = active.chunks.filter(chunk => dates(chunk).some(utc => !samples.has(utc)));
        const cursor = Date.parse(active.selected);
        const distance = chunk => Math.max(Date.parse(chunk.startUtc) - cursor, cursor - Date.parse(chunk.endUtc) + 1, 0);
        chunks.sort((a, b) => distance(a) - distance(b));
        if (!chunks.length) break;
        const chunk = chunks[0], start = Date.parse(chunk.startUtc), end = Date.parse(chunk.endUtc);
        const instant = cursor >= start && cursor < end ? active.selected : iso(start + active.hour);
        const result = await readWindow(active.site, instant, chunk, active.controller.signal);
        if (active !== session || active.serial !== serial) return;
        const expected = dates(chunk);
        if (!Array.isArray(result.observations) || result.observations.length !== 30 ||
            result.observations.some((sample, i) => sample.instantUtc !== expected[i]))
          throw new Error('Update the local science service to return complete daily scenes.');
        for (const sample of result.observations) samples.set(sample.instantUtc, sample);
        settle(); emit();
      }
      if (active === session) { active.loading = false; emit(); }
    } catch (error) {
      if (active !== session || active.serial !== serial) return;
      active.loading = false; active.error = error; settle(error); emit();
    }
  }
  return {
    get state() { return state(); },
    select(site, window, instantUtc, signal) {
      const chunks = planForecastChunks(window), instant = Date.parse(instantUtc), hour = instant % DAY;
      if (!Number.isFinite(instant) || instant % 3600000 || instant < Date.parse(window.startUtc) || instant >= Date.parse(window.endUtc))
        return Promise.reject(new Error('Selected date is outside the forecast range'));
      const nextContext = `${locationKey(site)}:${hour}`;
      const key = JSON.stringify([nextContext, window]);
      if (session?.key !== key) {
        stop();
        if (contextKey !== nextContext) { samples = new Map(); contextKey = nextContext; }
        session = { key, serial, site: { ...site }, window: { ...window }, chunks, hour, selected: instantUtc, controller: new AbortController(), loading: false, error: undefined };
      }
      session.selected = instantUtc;
      if (signal?.aborted) return Promise.reject(abortError());
      const result = samples.has(instantUtc) ? Promise.resolve(samples.get(instantUtc)) : session.error ? Promise.reject(session.error) : new Promise((resolve, reject) => {
        const waiter = { instantUtc, resolve, reject, cleanup: () => signal?.removeEventListener('abort', cancel) };
        const cancel = () => { pending.delete(waiter); waiter.cleanup(); reject(abortError()); };
        signal?.addEventListener('abort', cancel, { once: true }); pending.add(waiter);
      });
      void pump(session);
      return result;
    },
    retry() { if (session) { session.error = undefined; void pump(session); } },
    stop
  };
}
