import { createComputationEngine, createLatestObserver, toObserverViewSnapshot } from '../dist/index.js';
import { createHttpEphemerisProvider } from '../dist/http.js';

/** Host calls this once; the view remains the existing observer renderer. */
export function connectObserver(view, { endpoint = '/api/observation', onError = console.error } = {}) {
  const engine = createComputationEngine({ ephemerisProvider: createHttpEphemerisProvider(endpoint) });
  const observeLatest = createLatestObserver(engine);
  let pending;
  return {
    async select(site, instantUtc) {
      pending?.abort(); pending = new AbortController();
      try {
        const snapshot = await observeLatest({ site, instantUtc, signal: pending.signal });
        view.setSnapshot(toObserverViewSnapshot(snapshot)); // Atomic handoff with legacy signed longitude.
        return snapshot;
      } catch (error) {
        if (!['ABORTED', 'STALE'].includes(error.code)) onError(error);
      }
    },
    dispose() { pending?.abort(); }
  };
}

/** Offline direct-Horizons fixture for local integration; no NASA request. */
export async function showSample(view) {
  const response = await fetch(new URL('../fixtures/near-side-snapshot.json', import.meta.url));
  if (!response.ok) throw new Error('Sample snapshot unavailable');
  const snapshot = await response.json();
  view.setSnapshot(toObserverViewSnapshot(snapshot));
  return snapshot;
}
