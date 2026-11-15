import { connectObserver } from './integration.js';
import { createStaticForecastProvider } from '../computation/dist/index.js';

const output = document.querySelector('#results'), container = document.querySelector('#view'), lines = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  lines.push(`PASS ${message}`); output.textContent = lines.join('\n');
};
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const json = async path => (await fetch(new URL(`../data/${path}`, import.meta.url))).json();
let connection, missingProvider;
try {
  const sites = await json('sites.json'), ridge = sites.find(s => s.id === 'connecting-ridge');
  const coord = s => ({ latitudeDeg: s.lat, longitudeEastDeg: s.lon });
  const index = await json(`forecast/${ridge.id}.json`), december = await json(`forecast/${ridge.id}/2026-12.json`);
  const errors = [], statuses = [], applied = [], requests = [];
  const originalFetch = window.fetch;
  // Observe real static HTTP downloads used by the default provider.
  window.fetch = (...args) => { requests.push(String(args[0])); return originalFetch(...args); };
  try {
    connection = connectObserver({ container, onError: e => errors.push(e), onStatusChange: s => statuses.push(s) });
  } finally { window.fetch = originalFetch; }
  const setSnapshot = connection.view.setSnapshot;
  connection.view.setSnapshot = snapshot => {
    const accepted = setSnapshot(snapshot); // The actual renderer still validates and receives every snapshot.
    if (accepted !== false) applied.push(structuredClone(snapshot));
    return accepted;
  };
  // Same inputs the first page will pass: coordinates and explicit UTC, without a site ID.
  assert(await connection.update(coord(ridge), '2026-12-31T23:00:00Z'), 'coordinate/UTC handoff reaches connectObserver and setSnapshot');
  await frame();
  const snapshot = applied.at(-1), k = december.sunAz.length - 1;
  assert(snapshot.site.id === ridge.id && snapshot.site.longitudeEastDeg < 0, 'catalog resolution and signed-longitude bridge');
  assert(snapshot.site.surfaceElevationM === index.science.surfaceElevationM && snapshot.site.observerHeightM === index.science.observerHeightM,
    'modeled ground and observer height reach the renderer');
  assert(snapshot.bodies.sun.azimuthDeg === december.sunAz[k] % 360 && snapshot.bodies.earth.rangeKm === december.earthRangeKm[k] &&
    snapshot.bodies.earth.angularDiameterDeg === december.earthAngularDiameterDeg[k] && snapshot.bodies.earth.centerVisible === !!december.earthVisible[k],
    'selected saved angles, range, diameter and visibility reach the renderer');
  assert(snapshot.provenance.forecast.science.frameEvidence === ridge.frameEvidence && !snapshot.lighting && !snapshot.earthAppearance && !snapshot.sky && !snapshot.overview,
    'coordinate evidence retained and missing physical capabilities omitted');
  assert(connection.view.getDiagnostics().observerRenderCount > 0 && container.querySelector('canvas'), 'real WebGL observer renders the selected forecast');
  assert(container.querySelector('.observer-message').textContent.includes('2026-12-31 23:00 UTC') &&
    connection.view.getDiagnostics().instantUtc === '2026-12-31T23:00:00.000Z', 'observer readout shows the selected UTC');
  connection.view.lookToward('earth'); await frame();
  const cameraRequests = requests.length;
  const canvas = container.querySelector('canvas');
  for (let i = 0; i < 9; i++) canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  await frame();
  const arrow = container.querySelectorAll('.observer-arrow')[1].style.transform;
  assert(await connection.update(coord(ridge), '2026-12-31T23:00:00.000Z'), 'equivalent millisecond UTC labels accepted'); await frame();
  assert(container.querySelectorAll('.observer-arrow')[1].style.transform === arrow && requests.length === cameraRequests,
    'camera heading persists and camera/same-month updates add no downloads');
  assert(await connection.update(coord(ridge), '2027-01-01T00:00:00Z'), 'month boundary loads January');
  const january = await json(`forecast/${ridge.id}/2027-01.json`);
  assert(applied.at(-1).bodies.sun.azimuthDeg === january.sunAz[0] % 360, 'month boundary uses the new first sample');
  const acceptedCount = applied.length;
  assert(!await connection.update(coord(ridge), '2027-01-01T00:30:00Z') && errors.at(-1).code === 'UNSUPPORTED', 'unsaved time is explicit');
  assert(!await connection.update({ latitudeDeg: 0, longitudeEastDeg: 0 }, '2027-01-01T00:00:00Z'), 'arbitrary coordinates are unavailable');
  assert(applied.length === acceptedCount && connection.view.getDiagnostics().instantUtc === '2027-01-01T00:00:00.000Z',
    'unsupported requests retain the prior coherent observation without applying all-down data');
  const approximate = sites.find(s => s.id === 'im3-reiner-gamma');
  const results = await Promise.all([
    connection.update(coord(sites[10]), '2027-03-01T00:00:00Z'),
    connection.update(coord(ridge), '2027-04-01T00:00:00Z'),
    connection.update(coord(approximate), '2027-11-30T23:00:00Z')
  ]);
  await frame();
  assert(results.join() === 'false,false,true' && applied.length === acceptedCount + 1 && connection.view.getDiagnostics().siteId === approximate.id,
    'rapid location/time changes apply only the final selected forecast');
  assert(applied.at(-1).provenance.forecast.science.positionAccuracy === 'approximate', 'planned-position flag survives actual observer integration');
  assert(!await connection.update(coord(approximate), '2027-12-01T00:00:00Z'), 'exclusive year end is unavailable');
  assert(statuses.includes('loading') && statuses.includes('ready') && statuses.includes('error'), 'host receives loading, ready and explicit error states');
  connection.dispose();
  assert(!container.querySelector('canvas'), 'disposing connection removes its renderer');
  missingProvider = createStaticForecastProvider({ fetcher: (url, options) =>
    fetch(String(url).endsWith('/2026-12.json') ? new URL('../data/forecast/missing-browser-check.json', import.meta.url) : url, options) });
  connection = connectObserver({ container, computationProvider: missingProvider, onError: e => errors.push(e) });
  assert(!await connection.update(coord(ridge), '2026-12-01T00:00:00Z') && errors.at(-1).code === 'UPSTREAM' && !connection.view.getDiagnostics().instantUtc,
    'real HTTP 404 reports unavailable and never applies a fabricated snapshot');
  output.textContent += '\nAll static forecast browser checks passed.';
  document.documentElement.dataset.result = 'passed';
} catch (error) {
  output.textContent += `\nFAIL ${error.stack}`;
  document.documentElement.dataset.result = 'failed';
} finally { connection?.dispose(); missingProvider?.dispose(); }
