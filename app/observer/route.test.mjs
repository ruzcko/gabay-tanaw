import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readObserverRoute } from './route.js';
import { createStaticForecastProvider } from '../computation/dist/index.js';

const catalog = JSON.parse(await readFile(new URL('../data/sites.json', import.meta.url), 'utf8'));
const t = '2027-01-01T03:00:00.000Z';
const noFetch = () => assert.fail('Coordinate route should not fetch a catalog');

test('Moon handoff keeps the range anchor separately from the selected minute', async () => {
  const params = new URLSearchParams({ lat: '20.19', lon: '30.77', t: '2027-03-01T01:08:00Z', rangeStart: '2027-02-26T00:00:00Z', rangeDays: '30' });
  const route = await readObserverRoute(params, { fetcher: noFetch });
  assert.deepEqual(route.range, { startUtc: '2027-02-26T00:00:00Z', days: 30 });
  assert.equal(route.instantUtc, '2027-03-01T01:08:00Z');
  for (const [key, value] of [['rangeDays', '0'], ['rangeDays', '366'], ['rangeDays', '1.5'], ['rangeStart', '2027-03-02T00:00:00Z'], ['rangeStart', '2027-02-26T01:00:00Z']]) {
    const invalid = new URLSearchParams(params); invalid.set(key, value);
    await assert.rejects(readObserverRoute(invalid, { fetcher: noFetch }), { code: 'INVALID_INPUT' });
  }
  for (const key of ['rangeStart', 'rangeDays']) {
    const missing = new URLSearchParams(params); missing.delete(key);
    await assert.rejects(readObserverRoute(missing, { fetcher: noFetch }), { code: 'INVALID_INPUT' });
    const duplicate = new URLSearchParams(params); duplicate.append(key, params.get(key));
    await assert.rejects(readObserverRoute(duplicate, { fetcher: noFetch }), { code: 'INVALID_INPUT' });
  }
});
test('full coordinate/time route preserves the exact host UTC and location', async () => {
  const search = new URLSearchParams({ site: 'connecting-ridge', lat: '-89.4398', lon: '222.83', t });
  assert.deepEqual(await readObserverRoute(search, { fetcher: noFetch }), {
    site: { id: 'connecting-ridge', latitudeDeg: -89.4398, longitudeEastDeg: 222.83 }, instantUtc: t
  });
  search.delete('site'); search.set('lon', '-137.17');
  assert.deepEqual((await readObserverRoute(search, { fetcher: noFetch })).site, { latitudeDeg: -89.4398, longitudeEastDeg: -137.17 });
});
test('existing site/t bookmarks resolve catalog coordinates, never rounded display values or heights', async () => {
  const signal = new AbortController().signal;
  const result = await readObserverRoute(`?site=connecting-ridge&t=${t}`, { signal, fetcher: async (url, options) => {
    assert.equal(url.pathname.endsWith('/data/sites.json'), true); assert.equal(options.signal, signal);
    return Response.json(catalog);
  } });
  assert.deepEqual(result, { site: { id: catalog[0].id, latitudeDeg: catalog[0].lat, longitudeEastDeg: catalog[0].lon }, instantUtc: t });
});
test('missing, malformed, duplicate and ambiguous route values fail without defaults', async () => {
  for (const search of ['', '?site=apollo-11', `?t=${t}`, `?lat=0&t=${t}`, `?lon=0&t=${t}`,
    `?lat=&lon=0&t=${t}`, `?lat=0x10&lon=0&t=${t}`, `?lat=NaN&lon=0&t=${t}`,
    `?site=../apollo-11&t=${t}`, `?site=&t=${t}`, '?site=apollo-11&t=2027-01-01',
    `?site=apollo-11&site=apollo-12&t=${t}`, `?lat=0&lat=1&lon=0&t=${t}`, `?site=apollo-11&t=${t}&t=${t}`])
    await assert.rejects(readObserverRoute(search, { fetcher: noFetch }), { code: 'INVALID_INPUT' });
});
test('missing catalog and removed IDs remain unavailable', async () => {
  await assert.rejects(readObserverRoute(`?site=apollo-11&t=${t}`, { fetcher: async () => new Response('', { status: 404 }) }), { code: 'UPSTREAM' });
  await assert.rejects(readObserverRoute(`?site=blue-ghost-2&t=${t}`, { fetcher: async () => Response.json(catalog) }), { code: 'UNSUPPORTED' });
});
test('route to static provider uses saved science and rejects mismatched IDs and unsaved times', async () => {
  const provider = createStaticForecastProvider({ fetcher: async url => Response.json(JSON.parse(await readFile(url, 'utf8'))) });
  const route = async (site, lat, lon, time = t) => readObserverRoute(new URLSearchParams({ site, lat, lon, t: time }), { fetcher: noFetch });
  const result = await provider.observe(await route('connecting-ridge', '-89.4398', '222.83'));
  assert.equal(result.site.id, 'connecting-ridge'); assert.equal(result.instantUtc, t);
  await assert.rejects(provider.observe(await route('apollo-11', '-89.4398', '222.83')), { code: 'UNSUPPORTED' });
  await assert.rejects(provider.observe(await route('connecting-ridge', '-89.4398', '222.83', '2027-01-01T03:30:00Z')), { code: 'UNSUPPORTED' });
  provider.dispose();
});
