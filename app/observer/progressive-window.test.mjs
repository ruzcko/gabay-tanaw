import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressiveForecast, planForecastChunks } from './progressive-window.js';

const DAY = 86400000, start = Date.parse('2026-12-01T00:00:00Z');
const utc = (day, hour = 14) => new Date(start + day * DAY + hour * 3600000).toISOString();
const range = days => ({ startUtc: utc(0, 0), endUtc: utc(days, 0) });
const site = { latitudeDeg: -81, longitudeEastDeg: -82 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const requests = [], states = [];
  const loader = createProgressiveForecast((site, instantUtc, window, signal) => new Promise((resolve, reject) => {
    requests.push({ site, instantUtc, window, signal, resolve, reject });
  }), value => states.push({ ready: value.readyDays, loading: value.loading, error: !!value.error }));
  const release = async index => {
    const request = requests[index], hour = Date.parse(request.instantUtc) % DAY;
    request.resolve({ observations: Array.from({ length: 30 }, (_, day) => ({
      site: request.site, instantUtc: new Date(Date.parse(request.window.startUtc) + day * DAY + hour).toISOString()
    })) });
    await tick();
  };
  return { loader, requests, states, release };
}

test('30/91/365-day plans cover every date using bounded 30-day requests inside the forecast year', () => {
  for (const days of [30, 91, 365]) {
    const chunks = planForecastChunks(range(days)), covered = new Set();
    assert.equal(chunks.length, Math.ceil(days / 30));
    for (const chunk of chunks) {
      const first = Date.parse(chunk.startUtc), end = Date.parse(chunk.endUtc);
      assert.equal(end - first, 30 * DAY);
      assert.ok(first >= start && end <= start + days * DAY);
      for (let day = first; day < end; day += DAY) covered.add(day);
    }
    assert.equal(covered.size, days);
  }
  assert.throws(() => planForecastChunks(range(366)));
});

test('short and arbitrary ranges keep 30-day service requests inside published coverage', () => {
  for (const days of [1, 7, 14, 28, 31, 90, 364]) {
    for (const offset of [0, 365 - days]) {
      const window = { startUtc: utc(offset, 0), endUtc: utc(offset + days, 0) };
      const chunks = planForecastChunks(window);
      for (const chunk of chunks) {
        assert.ok(Date.parse(chunk.startUtc) >= start);
        assert.ok(Date.parse(chunk.endUtc) <= start + 365 * DAY);
        assert.equal(Date.parse(chunk.endUtc) - Date.parse(chunk.startUtc), 30 * DAY);
      }
      for (let day = offset; day < offset + days; day++) assert.ok(chunks.some(chunk => Date.parse(utc(day, 0)) >= Date.parse(chunk.startUtc) && Date.parse(utc(day, 0)) < Date.parse(chunk.endUtc)));
    }
  }
});

test('selected chunk arrives first, ready dates remain usable while the year loads, and overlaps deduplicate', async () => {
  const f = fixture(), selected = f.loader.select(site, range(365), utc(180));
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].window.startUtc, utc(180, 0));
  await f.release(0);
  assert.equal((await selected).instantUtc, utc(180));
  assert.equal(f.loader.state.readyDays, 30);
  assert.equal(f.loader.state.loading, true);
  const count = f.requests.length;
  assert.equal((await f.loader.select(site, range(365), utc(181))).instantUtc, utc(181));
  assert.equal(f.requests.length, count, 'scrubbing a ready date does not duplicate the active request');
  for (let i = 1; i < 13; i++) await f.release(i);
  assert.equal(f.requests.length, 13);
  assert.equal(f.loader.state.readyDays, 365);
  assert.equal(f.loader.state.samples.size, 365);
  assert.equal(f.loader.state.loading, false);
  assert.ok(f.states.some(state => state.ready === 30 && state.loading));
});

test('scrubbing an unloaded date prioritizes its chunk after the single in-flight request', async () => {
  const f = fixture(), first = f.loader.select(site, range(365), utc(0));
  await f.release(0); await first;
  const next = f.loader.select(site, range(365), utc(364));
  assert.equal(f.requests.length, 2);
  await f.release(1);
  assert.equal(f.requests[2].window.endUtc, utc(365, 0));
  await f.release(2);
  assert.equal((await next).instantUtc, utc(364));
  f.loader.stop();
});

test('background failure retains available dates and Retry resumes missing chunks', async () => {
  const f = fixture(), first = f.loader.select(site, range(91), utc(0));
  await f.release(0); await first;
  f.requests[1].reject(new Error('Upstream unavailable')); await tick();
  assert.equal(f.loader.state.readyDays, 30);
  assert.equal(f.loader.state.loading, false);
  assert.equal((await f.loader.select(site, range(91), utc(1))).instantUtc, utc(1));
  await assert.rejects(f.loader.select(site, range(91), utc(45)), /Upstream unavailable/);
  f.loader.retry();
  assert.equal(f.requests[2].window.startUtc, utc(30, 0));
  for (let i = 2; i < 5; i++) await f.release(i);
  assert.equal(f.loader.state.readyDays, 91);
  assert.equal(f.loader.state.error, undefined);
});

test('new site ignores late old results even if the transport ignores cancellation', async () => {
  const f = fixture(), first = f.loader.select(site, range(30), utc(0));
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const nextSite = { ...site, latitudeDeg: -80 };
  const next = f.loader.select(nextSite, range(30), utc(0));
  await rejected; assert.equal(f.requests[0].signal.aborted, true);
  await f.release(0); assert.equal(f.loader.state.readyDays, 0);
  await f.release(1); assert.equal((await next).site.latitudeDeg, -80);
  assert.equal(f.loader.state.readyDays, 30);
});

test('range changes preserve loaded dates, equivalent longitude reuses cache, and cancelled waiters cannot settle', async () => {
  const f = fixture(), first = f.loader.select(site, range(30), utc(0));
  await f.release(0); await first;
  const controller = new AbortController();
  const missing = f.loader.select({ ...site, longitudeEastDeg: 278 }, range(91), utc(45), controller.signal);
  const rejected = assert.rejects(missing, { name: 'AbortError' }); controller.abort(); await rejected;
  assert.equal(f.loader.state.readyDays, 30);
  assert.equal(f.requests.length, 2);
  await f.release(1);
  assert.equal((await f.loader.select(site, range(91), utc(45))).instantUtc, utc(45));
  f.loader.stop();
});

test('incomplete daily scenes fail without marking unvalidated dates as ready', async () => {
  const f = fixture(), selected = f.loader.select(site, range(30), utc(0));
  const rejected = assert.rejects(selected, /complete daily scenes/);
  f.requests[0].resolve({ observations: [{ instantUtc: utc(0) }] }); await rejected;
  assert.equal(f.loader.state.readyDays, 0);
  assert.equal(f.loader.state.loading, false);
});

test('changing range during preparation ignores late chunks and changing UTC hour clears old samples', async () => {
  const f = fixture(), first = f.loader.select(site, range(365), utc(180));
  const cancelled = assert.rejects(first, { name: 'AbortError' });
  const short = f.loader.select(site, range(30), utc(0));
  await cancelled;
  assert.equal(f.requests[0].signal.aborted, true);
  await f.release(0);
  assert.equal(f.loader.state.readyDays, 0, 'Cancelled annual chunk must not populate the new range');
  await f.release(1); await short;
  const differentHour = f.loader.select(site, range(30), utc(0, 23));
  assert.equal(f.loader.state.readyDays, 0, 'Daily snapshots at another hour are not interchangeable');
  await f.release(2);
  assert.equal((await differentHour).instantUtc, utc(0, 23));
  assert.ok([...f.loader.state.samples.keys()].every(value => value.endsWith('T23:00:00.000Z')));
});
