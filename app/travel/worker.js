import { createTravelPlanner, createTravelSource, globalLandingGrid, landingGrid } from '../computation/dist/travel.js';
import { loadBytes } from '../computation/dist/quick/coefficients.js';

const cache = new Map();
const read = async (url, signal) => {
  const key = String(url);
  if (!cache.has(key)) cache.set(key, loadBytes(url, signal).catch(error => { cache.delete(key); throw error; }));
  return cache.get(key);
};
const source = createTravelSource({ read });
const planner = createTravelPlanner(source, { sourcePolicy: 'prefer-published' });
let preload = Promise.resolve(true);
// Keep locations stable when only dates or filters change, so forecasts can be reused.
const discoverySeed = crypto.getRandomValues(new Uint32Array(1))[0];
function pointFeatures(results) {
  return results.map((result, i) => {
    const p = result.point, halfLat = Math.min(.12, (90 - Math.abs(p.lat)) / 2);
    const halfLon = Math.min(8, .12 / Math.max(.01, Math.cos(p.lat * Math.PI / 180)));
    const [cell] = landingGrid({ south: p.lat - halfLat, north: p.lat + halfLat, west: p.lon - halfLon, east: p.lon + halfLon }, 1, 1);
    // Map rendering needs classification, not another copy of every provenance record.
    return { type: 'Feature', id: `candidate-${i}`, geometry: cell.geometry, properties: { status: result.status, checks: result.checks, sampling: 'Checked centre point only; display area is not a surveyed region' } };
  });
}
// One active request at a time; completed requests reuse this worker's private caches.
// Cancellation terminates it, so in-flight science cannot publish into a changed request.
self.onmessage = async ({ data: request }) => {
  const { startUtc, criteria, catalog } = request;
  try {
    if (request.operation === 'warmup') {
      // Prepare shared data only. A real search still validates its own dates and filters.
      preload = Promise.resolve().then(() => source.warmup?.(startUtc, request.endUtc)).then(() => true, () => false);
      postMessage({ type: 'warmup-complete', ready: await preload });
      return;
    }
    // Serialize preparation with a search opened immediately, avoiding duplicate tile decode.
    await preload;
    if (request.operation === 'map') {
      const features = [], grid = globalLandingGrid();
      for (let i = 0; i < grid.length; i += 8) {
        const map = await planner.regions(grid.slice(i, i + 8), startUtc, criteria);
        features.push(...map.features);
        postMessage({ type: 'regions', features: [...features], mapScan: true, message: `Screened ${features.length} of ${grid.length} whole-Moon bins…` });
      }
      postMessage({ type: 'map-complete', features, mapScan: true }); return;
    }
    const results = request.operation === 'more' ? request.results : [], sampled = request.operation === 'more' ? request.sampled : [];
    for (const site of request.operation === 'more' ? [] : catalog) {
      results.push(await planner.evaluate(site, startUtc, criteria));
      if (results.length % 5 === 0 || results.length === catalog.length)
        postMessage({ type: 'catalog', results: [...results], features: pointFeatures(results), message: `Checked ${results.length} of ${catalog.length} known sites. Finding more destinations…` });
    }
    const key = p => `${p.lat}:${(p.lon + 360) % 360}`, seen = new Set([...results, ...sampled].map(r => key(r.point)));
    const discovery = await planner.discover(startUtc, criteria, { southTarget: 2, elsewhereTarget: 3,
      southAnchors: results.filter(r => r.status === 'pass' && r.point.lat < -80).map(r => r.point),
      exclude: [...catalog, ...sampled.map(r => r.point)], cursor: request.cursor || undefined,
      seed: request.cursor ? undefined : discoverySeed,
      // Browsers need more horizon-tracing headroom than the Node diagnostics. Verified
      // matches stream throughout; cancellation can terminate the worker immediately.
      maxSouthSamples: 48, maxElsewhereSamples: 144, maxElapsedMs: 120000,
      onCandidate: ({ group, result }) => {
        if (seen.has(key(result.point))) return;
        seen.add(key(result.point));
        sampled.push({ ...result, point: { ...result.point, name: `${group === 'south' ? 'South pole' : 'Lunar'} destination ${sampled.length + 1}` } });
        postMessage({ type: 'candidate', sampled: [...sampled], features: pointFeatures([...results, ...sampled]) });
      },
      onProgress: progress => postMessage({ type: 'candidate-progress', progress,
        message: `Finding destinations${progress.current?.group === 'south' ? ' near the south pole' : ' across the Moon'}…` }) });
    postMessage({ type: 'complete', results, features: pointFeatures([...results, ...sampled]), sampled, discovery });
  } catch (error) {
    postMessage({ type: 'error', message: error.message || 'Travel calculation failed. Try again.' });
  }
};
