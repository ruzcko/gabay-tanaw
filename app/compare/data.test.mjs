import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareSites, rankBy, summarize, NEEDS, COMPARE_METRICS } from './data.js';

const data = new URL('../data/', import.meta.url);
const read = async (path) => JSON.parse(await readFile(new URL(path, data), 'utf8'));
const sites = (await read('sites.json')).filter((s) => ['connecting-ridge', 'apollo-11', 'shackleton-rim'].includes(s.id));
// A forecast-source stand-in: published files from app/data; load() returns those files as an estimate.
const source = {
  published: (path) => read(path),
  async load(selection) {
    const index = await read(`forecast/${selection.id}.json`);
    const month = selection.startUtc.slice(0, 7);
    return { quality: 'estimate', data: { index, monthly: { [month]: await read(`forecast/${selection.id}/${month}.json`) } } };
  },
};

test('published window: daily series and summaries agree with the forecasts', async () => {
  const seen = [];
  const result = await compareSites({ sites, startUtc: '2026-12-01T00:00:00Z', days: 30, source, onSite: (s) => seen.push(s.id) });
  assert.deepEqual(seen, sites.map((s) => s.id), 'sites report one at a time, in order');
  for (const site of result.sites) {
    assert.equal(site.quality, 'accurate');
    assert.equal(site.series.length, 30);
    const index = await read(`forecast/${site.id}.json`), days = index.days.slice(0, 30);
    assert.equal(site.summary.sunHours, Math.round(days.reduce((s, d) => s + d.sunHours, 0) * 10) / 10);
    assert.equal(site.summary.goDays, days.filter((d) => d.sunHours >= NEEDS.sunHours && d.earthHours >= NEEDS.earthHours).length);
    // Both up never exceeds either body, and agrees with the hourly flags to within an hour a day.
    const month = await read(`forecast/${site.id}/2026-12.json`);
    site.series.forEach((d, k) => {
      assert.ok(d.bothHours <= Math.min(d.sunHours, d.earthHours) + 1e-9);
      const hourly = month.sunVisible.slice(k * 24, k * 24 + 24).filter((v, h) => v && month.earthVisible[k * 24 + h]).length;
      assert.ok(Math.abs(d.bothHours - hourly) <= 1.01, `${site.id} ${d.date}: ${d.bothHours} vs ${hourly}`);
      assert.equal(d.maxSunElDeg, Math.round(Math.max(...month.sunEl.slice(k * 24, k * 24 + 24)) * 10) / 10);
    });
    assert.ok(site.summary.longestDarkHours >= 0 && site.summary.longestDarkHours <= 30 * 24);
  }
});

test('a failed site reports its error; custom points come from the estimate, marked as such', async () => {
  const result = await compareSites({ sites: sites.slice(0, 1), startUtc: '2026-12-01T00:00:00Z', days: 31,
    source: { ...source, published: () => { throw new Error('not published'); } } });
  assert.equal(result.sites[0].error, 'not published');
  const custom = { ...sites[0], id: 'custom-test' };
  const estimate = await compareSites({ sites: [custom], startUtc: '2026-12-01T00:00:00Z', days: 31,
    source: { ...source, load: (sel) => source.load({ ...sel, id: sites[0].id }) } });
  assert.equal(estimate.sites[0].quality, 'estimate');
  assert.equal(estimate.sites[0].series.length, 31);
});

test('longest darkness and Earth gap follow the up intervals across days', () => {
  const day = (date, sunUp, earthUp, extra = {}) => ({ date, sunHours: 0, earthHours: 0, sunrise: [], sunset: [], earthrise: [], earthset: [], sunUpAt0: sunUp, earthUpAt0: earthUp, ...extra });
  const days = [day('2030-01-01', true, false, { sunset: ['2030-01-01T06:00:00Z'], earthrise: ['2030-01-01T12:00:00Z'] }),
    day('2030-01-02', false, true, { sunrise: ['2030-01-02T18:00:00Z'] })];
  const { series, summary } = summarize(days, {}, Date.parse('2030-01-01T00:00:00Z'), Date.parse('2030-01-03T00:00:00Z'));
  assert.equal(summary.longestDarkHours, 36); // 06:00 on the 1st to 18:00 on the 2nd
  assert.equal(summary.longestEarthGapHours, 12); // until Earth rises at 12:00
  assert.deepEqual(series.map((d) => d.bothHours), [0, 6]); // both up from 18:00 to midnight on the 2nd
  assert.equal(summary.maxSunElDeg, null);
});

test('ranking follows each metric’s better direction; errors sort last', () => {
  const c = { sites: [{ id: 'a', summary: { bothHours: 5, longestDarkHours: 50 } }, { id: 'b', error: 'x' },
    { id: 'c', summary: { bothHours: 9, longestDarkHours: 10 } }] };
  assert.deepEqual(rankBy(c, 'bothHours').map((s) => s.id), ['c', 'a', 'b']);
  assert.deepEqual(rankBy(c, 'longestDarkHours').map((s) => s.id), ['c', 'a', 'b']);
  assert.ok(COMPARE_METRICS.every((m) => m.id && m.label && m.unit && /high|low/.test(m.better)));
  assert.throws(() => rankBy(c, 'nope'));
});
