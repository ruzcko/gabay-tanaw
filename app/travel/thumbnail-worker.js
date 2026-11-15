import { productMoonDirections } from '../computation/dist/forecast-product.js';
import { Coefficients } from '../computation/dist/quick/coefficients.js';
import { QuickEphemeris } from '../computation/dist/quick/ephemeris.js';

// Scientific geometry comes from the same published track/API used by the existing globe.
const months = new Map();
let coefficients;
async function month(label) {
  if (!months.has(label)) months.set(label, fetch(new URL(`../data/sun/${label}.json`, import.meta.url)).then(response => {
    if (!response.ok) throw new Error('Published lighting unavailable'); return response.json();
  }));
  return months.get(label);
}
let queue = Promise.resolve();
self.onmessage = ({ data: { id, instantUtc } }) => {
  queue = queue.then(async () => {
    try {
      const at = Date.parse(instantUtc);
      if (at >= Date.parse('2026-12-01T00:00:00Z') && at < Date.parse('2027-12-01T00:00:00Z')) {
        const labels = [...new Set([instantUtc.slice(0, 7), new Date(Math.ceil(at / 3600000) * 3600000).toISOString().slice(0, 7)])];
        const geometryMonthly = Object.fromEntries(await Promise.all(labels.map(async label => [label, await month(label)])));
        postMessage({ id, sun: productMoonDirections({ index: { quality: 'accurate' }, geometryMonthly }, instantUtc).sun, quality: 'published' });
      } else {
        coefficients ??= new Coefficients(); await coefficients.prepare(at, at + 1000);
        const geometry = new QuickEphemeris(coefficients, 0, 0, 0).geometry(at);
        postMessage({ id, sun: geometry.sunMoon, quality: 'estimated' });
      }
    } catch (error) { postMessage({ id, error: error.message }); }
  });
};
