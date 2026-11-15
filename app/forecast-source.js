// Host-owned source selection. Each emission is a complete, single-quality product.
import { createStaticForecastProvider } from './computation/dist/index.js';
import { validateProduct, meaningfulChanges, validateProductAppearance, productSnapshot } from './computation/dist/forecast-product.js';

const aborted = () => new DOMException('Selection replaced', 'AbortError');
// Use the same custom-site identity for the initial forecast and every playback frame.
const quickSelection = selection => ({ ...selection, id: selection.id ?? `custom-${selection.lat.toFixed(6)}-${(((selection.lon % 360) + 360) % 360).toFixed(6)}` });
const labels = (start, end) => {
  const result = [];
  for (let at = Date.parse(start); at < Date.parse(end);) {
    const d = new Date(at); result.push(d.toISOString().slice(0, 7));
    at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  return result;
};

// The local science service runs only on a developer's machine; static hosting has no /api, so
// the page doesn't ask for it there (an injected fetcher, as in tests, always asks).
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;

export function createForecastSource({ fetcher = fetch, quick, accurate, baseUrl = new URL('./data/', import.meta.url) } = {}) {
  async function serviceInfo(signal) {
    if (fetcher === fetch && !LOCAL_HOST.test(globalThis.location?.hostname ?? '')) return null;
    const health = await fetcher('/api/health', { signal });
    return health.ok ? health.json() : null;
  }
  let generation = 0, controller, client, disposed = false, latest;
  const windowKey = s => JSON.stringify([s.id, s.lat, s.lon, s.startUtc, s.endUtc]);
  const files = new Map(), completed = new Map();
  async function read(path, signal) {
    if (signal?.aborted) throw aborted();
    let entry = files.get(path);
    if (!entry || (!entry.value && entry.signal?.aborted)) {
      entry = { signal };
      entry.promise = (async () => {
        // Monthly geometry may be republished at the same URL. Revalidate HTTP
        // caches once per load; the parsed file cache still serves playback.
        const response = await fetcher(new URL(path, baseUrl), { signal,
          cache: path.startsWith('sun/') ? 'no-cache' : 'default',
          priority: /^(forecast|horizons|sun|sites)/.test(path) ? 'high' : 'auto' });
        if (!response.ok) throw new Error(`${path}: ${response.status}`);
        entry.text = await response.text();
        const value = JSON.parse(entry.text);
        if (signal?.aborted) throw aborted();
        entry.value = value;
        while (files.size > 128) {
          const key = [...files].find(([k, v]) => k !== path && v.value)?.[0];
          if (!key) break;
          files.delete(key);
        }
        return value;
      })().catch(error => { if (files.get(path) === entry) files.delete(path); throw error; });
      files.set(path, entry);
    }
    return entry.value ?? entry.promise;
  }
  const staticProvider = createStaticForecastProvider({ baseUrl, fetcher: async (url, options) => {
    const value = await read(new URL(url).pathname.slice(baseUrl.pathname.length), options?.signal);
    // Reuse the parsed object; the static provider validates it without reparsing JSON.
    return { ok: true, json: async () => value };
  }});
  async function staticProduct(selection, signal) {
    const sites = await read('sites.json', signal);
    const site = sites.find(s => (!selection.id || s.id === selection.id) && s.lat === selection.lat &&
      Math.abs(((s.lon - selection.lon + 540) % 360) - 180) < 1e-7);
    if (!site || selection.startUtc.slice(0, 10) < '2026-12-01' || selection.endUtc.slice(0, 10) > '2027-12-01') return null;
    const selectedMonths = labels(selection.startUtc, selection.endUtc);
    const t = Date.parse(selection.instantUtc ?? selection.startUtc);
    if (t % 3600000) {
      const right = new Date(Math.floor(t / 3600000) * 3600000 + 3600000).toISOString();
      if (right >= '2027-12-01') return null; // never extrapolate beyond saved coverage
      if (!selectedMonths.includes(right.slice(0,7))) selectedMonths.push(right.slice(0,7));
    }
    const [index, horizon, monthEntries, geometryEntries] = await Promise.all([
      read(`forecast/${site.id}.json`, signal), read(`horizons/${site.id}.json`, signal),
      Promise.all(selectedMonths.map(async label => [label, await read(`forecast/${site.id}/${label}.json`, signal)])),
      Promise.all(selectedMonths.map(async label => [label, await read(`sun/${label}.json`, signal)])),
      staticProvider.observe({ site: { id: site.id, latitudeDeg: site.lat, longitudeEastDeg: site.lon }, instantUtc: t % 3600000 ? new Date(Math.floor(t / 3600000) * 3600000 + 3600000).toISOString() : selection.startUtc, signal })
    ]);
    const bytes = new TextEncoder().encode(files.get(`horizons/${site.id}.json`).text.replaceAll('\r\n', '\n'));
    const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join('');
    if (digest !== index.science.horizonSha256) throw new Error('Forecast and terrain provenance disagree');
    return { index, horizon, monthly: Object.fromEntries(monthEntries), geometryMonthly: Object.fromEntries(geometryEntries), quality: 'accurate' };
  }
  async function accurateProduct(selection, signal) {
    const saved = await staticProduct(selection, signal);
    if (saved) return saved;
    const info = await serviceInfo(signal);
    if (info?.service !== 'tanaw-observer' || info.forecastProduct?.version !== 1) return null;
    const params = new URLSearchParams({ lat: selection.lat, lon: selection.lon,
      t: selection.instantUtc ?? selection.startUtc, startUtc: selection.startUtc, endUtc: selection.endUtc });
    const response = await fetcher(`/api/forecast?${params}`, { signal });
    if (!response.ok) throw new Error('Accurate forecast unavailable');
    return response.json();
  }
  async function estimate(selection, signal) {
    if (quick) return quick(selection, signal);
    const { createQuickEstimateClient } = await import('./computation/dist/quick/client.js');
    if (signal.aborted) throw aborted();
    client ??= createQuickEstimateClient();
    // Service and browser use the same identity for an arbitrary selection.
    return client.estimate(quickSelection(selection), signal);
  }
  async function appearance(data, selection, signal) {
    if (accurate) return null; // injected sources own their complete contract (including tests).
    try {
      const info = await serviceInfo(signal);
      if (info?.forecastProduct?.version !== 1) return null;
      const instant = selection.instantUtc ?? selection.startUtc;
      const params = new URLSearchParams({lat: selection.lat, lon: selection.lon, t: instant});
      if (selection.id) params.set('site', selection.id);
      const response = await fetcher(`/api/forecast-appearance?${params}`, {signal});
      if (!response.ok) return null;
      return validateProductAppearance(await response.json(), data, instant);
    } catch { return null; } // Unsupported appearance does not discard validated body forecasts.
  }
  return {
    catalog: signal => read('sites.json', signal).then(structuredClone),
    // Published-only reads for comparison/navigation owned by the host, never a renderer.
    published: (path, signal) => read(path, signal).then(structuredClone),
    async sample(request) {
      if (disposed || !latest || windowKey(request) !== windowKey(latest.selection)) return null;
      if (latest.quality === 'accurate') return productSnapshot(latest.data, request.instantUtc);
      return client ? client.snapshot(quickSelection(request), controller?.signal) : null;
    },
    cancel() { ++generation; controller?.abort(); },
    async load(request, onResult) {
      if (disposed) throw new Error('Forecast source disposed');
      const own = ++generation;
      controller?.abort(); controller = new AbortController();
      const signal = controller.signal, selection = structuredClone(request);
      // A range may cross the saved year: accurate data still wins for its selected instant.
      const at = selection.instantUtc ?? selection.startUtc;
      const savedSelection = at >= '2026-12-01' && at < '2027-12-01' ? {...selection,
        startUtc: selection.startUtc < '2026-12-01' ? '2026-12-01T00:00:00Z' : selection.startUtc,
        endUtc: Date.parse(selection.endUtc) > Date.parse('2027-12-01T00:00:00Z') ? '2027-12-01T00:00:00Z' : selection.endUtc} : selection;
      if (Date.parse(selection.endUtc) > Date.parse(savedSelection.endUtc) && Date.parse(savedSelection.endUtc)-Date.parse(savedSelection.startUtc)<30*86400000) {
        savedSelection.startUtc = new Date(Math.max(Date.parse('2026-12-01T00:00:00Z'),Date.parse(savedSelection.endUtc)-30*86400000)).toISOString();
      }
      const workerController = new AbortController();
      signal.addEventListener('abort', () => workerController.abort(), {once: true});
      const stale = () => own !== generation || signal.aborted || disposed;
      const key = JSON.stringify([selection.id, selection.lat, selection.lon, selection.startUtc, selection.endUtc, selection.instantUtc]);
      let accepted, accurateDone = false, accurateFailed = false, quickError, deliveryError;
      const emit = (quality, data, reason) => {
        if (stale() || (accepted?.quality === 'accurate' && quality !== 'accurate')) return;
        const changes = quality === 'accurate' && accepted?.quality === 'estimate' ? meaningfulChanges(accepted.data, data) : accepted?.changedDates ?? [];
        accepted = { quality, data: structuredClone(data), selection: quality === 'accurate' ? savedSelection : selection, changedDates: changes, ...(reason ? { reason } : {}) };
        latest = accepted;
        try { onResult(structuredClone(accepted)); } catch (error) { deliveryError = error; }
      };
      const cached = completed.get(key) ?? [...completed.values()].find(entry => {
        try { if (entry.data.snapshot && entry.quality === 'estimate' && entry.data.snapshot.instantUtc !== new Date(selection.instantUtc ?? selection.startUtc).toISOString()) return false; validateProduct(entry.data, entry.quality === 'accurate' ? savedSelection : selection, entry.quality); if (selection.instantUtc) productSnapshot(entry.data, selection.instantUtc); return true; } catch { return false; }
      });
      const enrich = async () => {
        if (accepted?.quality !== 'accurate') return;
        const geometry = await appearance(accepted.data, selection, signal);
        if (geometry && !stale()) emit('accurate', {...accepted.data, appearance: geometry});
      };
      if (cached) { emit(cached.quality, cached.data, cached.reason); if (cached.quality === 'accurate') { await enrich(); if (deliveryError) throw deliveryError; return accepted; } }
      const accurateWork = (async () => {
        try {
          const data = await (accurate ?? accurateProduct)(savedSelection, signal);
          if (stale()) return;
          if (!data) throw new Error('No accurate source');
          validateProduct(data, savedSelection, 'accurate');
          if (selection.instantUtc) productSnapshot(data, selection.instantUtc);
          accurateDone = true; emit('accurate', data); // Let the range preload finish for dates beyond saved coverage.
          completed.set(key, accepted);
        } catch (error) {
          if (stale()) return;
          accurateFailed = true;
          if (accepted) emit('estimate', accepted.data, 'unavailable');
        }
      })();
      const quickWork = (async () => {
        try {
          if (cached) return;
          const data = await estimate(selection, workerController.signal);
          if (stale() || accurateDone) return;
          validateProduct(data, selection, 'estimate');
          emit('estimate', data, accurateFailed ? 'unavailable' : undefined);
        } catch (error) { if (!stale()) quickError = error; }
      })();
      await Promise.all([accurateWork, quickWork]);
      await enrich();
      if (accepted && !stale()) completed.set(key, structuredClone(accepted));
      while (completed.size > 8) completed.delete(completed.keys().next().value);
      if (deliveryError) throw deliveryError;
      if (!accepted && !stale()) throw quickError ?? new Error('No forecast is available');
      return accepted;
    },
    dispose() { disposed = true; ++generation; controller?.abort(); client?.dispose(); staticProvider.dispose(); files.clear(); completed.clear(); }
  };
}
