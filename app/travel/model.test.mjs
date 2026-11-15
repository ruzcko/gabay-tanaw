import test from 'node:test';
import assert from 'node:assert/strict';
import { travelRequest, TRAVEL_DEFAULTS, resultSource, observerLink, createTravelJobs, travelPointKey, sortTravelResults } from './model.js';
import { readObserverRoute } from '../observer/route.js';
import { createDateWindow } from '../observer/date-scrubber.js';

const base = { mode: 'date', startUtc: '2027-01-01T00:00:00Z', endUtc: '2027-01-08T00:00:00Z', criteria: TRAVEL_DEFAULTS };
test('host, result cards and diamonds share identity across longitude wrap and roundoff', () => {
  assert.equal(travelPointKey({lat:-85.9685,lon:357.6851}), travelPointKey({lat:-85.9685,lon:357.6850999999999}));
  assert.equal(travelPointKey({lat:0,lon:-0.0000000001}), travelPointKey({lat:0,lon:360}));
  assert.notEqual(travelPointKey({lat:0,lon:1}), travelPointKey({lat:0,lon:1.0001}));
});
test('Travel imports the full scientific baseline, including terrain, without weakening it', () => {
  const request = travelRequest(base);
  assert.equal(request.criteria.terrainEnabled, true);
  assert.equal(request.criteria.maxSlopeDeg, 10);
  assert.equal(request.criteria.minSunFraction, 1);
  assert.equal(request.criteria.maxEarthOutageHours, 0);
  assert.equal(request.criteria.durationDays, 7);
  assert.equal(travelRequest({ ...base, endUtc: '2027-01-07T12:00:00Z' }).criteria.durationDays, 6.5);
});
test('invalid stays, exact poles and searches running past coverage fail before starting a job', () => {
  for (const endUtc of ['2027-01-01T00:00:00Z', '2026-12-31T00:00:00Z', '2027-02-02T00:00:00Z']) assert.throws(() => travelRequest({ ...base, endUtc }));
  assert.throws(() => travelRequest({ ...base, mode: 'region', point: { lat: 90, lon: 0 } }));
  assert.throws(() => travelRequest({ ...base, mode: 'region', point: { lat: 20, lon: 270 }, startUtc: '2100-10-01T00:00:00Z', endUtc: '2100-10-08T00:00:00Z' }), /coverage/);
  assert.doesNotThrow(() => travelRequest({ ...base, mode: 'region', point: { lat: -89.999, lon: -179.9 } }));
  assert.equal(travelRequest({ ...base, mode: 'region', point: { lat: 0, lon: 180 }, startUtc: '2027-01-01T00:00Z' }).startUtc, '2027-01-01T00:00:00.000Z');
});
test('source labels retain missing forecasts and mixed publication boundaries', () => {
  assert.match(resultSource({ segments: [] }), /^Unknown/);
  assert.match(resultSource({}), /^Unknown/);
  assert.match(resultSource({ segments: [{ available: false, quality: 'accurate' }] }), /^Unknown/);
  assert.match(resultSource({ segments: [{ available: true, quality: 'accurate' }, { available: true, quality: 'estimate' }] }), /^Mixed/);
  assert.match(resultSource({ segments: [{ available: true, quality: 'estimate' }] }), /^Estimate/);
  assert.equal(resultSource({ segments: [{ available: true, quality: 'estimate', requestedQuality: 'accurate', reason: 'published-unavailable' }] }), 'Estimate · quick compute');
  assert.equal(resultSource({ segments: [{ available: true, quality: 'accurate' }] }), 'Published Python forecast');
});
test('restart and cancellation reject queued worker messages', () => {
  const workers = [], messages = [];
  const jobs = createTravelJobs(() => { const worker = { postMessage() {}, terminate() { this.terminated = true; } }; workers.push(worker); return worker; });
  jobs.run(base, m => messages.push(m)); const old = workers[0];
  jobs.run({ ...base, criteria: { ...TRAVEL_DEFAULTS, terrainEnabled: false } }, m => messages.push(m));
  old.onmessage({ data: 'stale result' }); old.onerror({ message: 'stale error' });
  workers[1].onmessage({ data: 'current' });
  jobs.cancel(); workers[1].onmessage({ data: 'cancelled' });
  assert.deepEqual(messages, ['current']); assert.ok(workers.every(w => w.terminated));
});
test('Observer carries exact coordinates and the full fractional stay, while old routes stay unchanged', async () => {
  const result = { point: { id: 'connecting-ridge', lat: -89.4398, lon: 222.83 }, startUtc: base.startUtc, endUtc: '2027-01-07T12:00:00Z' };
  const route = await readObserverRoute(observerLink(result, [result.point]).split('?')[1]);
  assert.equal(route.site.latitudeDeg, result.point.lat); assert.equal(route.trip.durationDays, 6.5); assert.equal(route.trip.endUtc, result.endUtc);
  const window = createDateWindow('2026-12-01T00:00:00Z', '2027-12-01T00:00:00Z', route.instantUtc, { fromSelection: true });
  window.range(Math.ceil(route.trip.durationDays)); assert.equal(window.state.length, 7); assert.equal(window.state.startUtc, '2027-01-01T00:00:00.000Z');
  for (const suffix of ['tripEnd=2026-01-01T00:00:00Z', 'tripEnd=2027-04-01T00:00:00Z', 'tripEnd=bad', 'tripEnd=2027-01-08T00:00:00Z&tripEnd=2027-01-09T00:00:00Z'])
    await assert.rejects(readObserverRoute(`lat=0&lon=0&t=${base.startUtc}&${suffix}`));
});
test('completed discovery pages reuse their worker cache, while cancellation discards it', () => {
  const workers = [], messages = [];
  const jobs = createTravelJobs(() => { const worker = { postMessage() {}, terminate() { this.terminated = true; } }; workers.push(worker); return worker; });
  jobs.run(base, m => messages.push(m));
  const oldHandler = workers[0].onmessage;
  oldHandler({ data: { type: 'complete' } }); messages.length = 0;
  jobs.run({ ...base, operation: 'more' }, m => messages.push(m), { reuse: true });
  assert.equal(workers.length, 1);
  oldHandler({ data: 'old page' }); workers[0].onmessage({ data: 'next page' });
  assert.deepEqual(messages, ['next page']);
  jobs.cancel();
  jobs.run(base, m => messages.push(m), { reuse: true });
  assert.equal(workers.length, 2); assert.equal(workers[0].terminated, true);
});

test('filter and date edits retain only idle computation caches and reject stale callbacks', () => {
  const workers = [], messages = [];
  const jobs = createTravelJobs(() => { const worker = { postMessage() {}, terminate() { this.terminated = true; } }; workers.push(worker); return worker; });
  jobs.run(base, m => messages.push(m), { reuse: true });
  const firstHandler = workers[0].onmessage;
  firstHandler({ data: { type: 'complete' } }); messages.length = 0;
  jobs.invalidate(); jobs.invalidate();
  firstHandler({ data: { type: 'candidate', stale: true } });
  jobs.run({ ...base, criteria: { ...base.criteria, minSunFraction: .2 } }, m => messages.push(m), { reuse: true });
  assert.equal(workers.length, 1, 'completed forecast cache survives draft edits');
  assert.equal(workers[0].terminated, undefined);
  assert.deepEqual(messages, []);
  const activeHandler = workers[0].onmessage;
  jobs.invalidate();
  jobs.run({ ...base, startUtc: '2027-02-01T00:00:00Z' }, m => messages.push(m), { reuse: true });
  activeHandler({ data: { type: 'complete', stale: true } });
  assert.equal(workers.length, 2, 'active work must be terminated before a changed request');
  assert.equal(workers[0].terminated, true);
  assert.deepEqual(messages, []);
});

test('panel warmup prepares one reusable worker without becoming a search or defeating cancellation', () => {
  const workers = [], posted = [], messages = [];
  const jobs = createTravelJobs(() => { const worker = { postMessage(m) { posted.push(m); }, terminate() { this.terminated = true; } }; workers.push(worker); return worker; });
  jobs.warmup(base); jobs.warmup(base); jobs.invalidate();
  assert.equal(workers.length, 1); assert.equal(posted.length, 1); assert.equal(posted[0].operation, 'warmup');
  jobs.run(base, m => messages.push(m), { reuse: true });
  assert.equal(workers.length, 1, 'immediate search keeps the pending preload');
  workers[0].onmessage({ data: { type: 'warmup-complete', ready: false } });
  assert.deepEqual(messages, [], 'failed speculative preload is not a failed search');
  const handler = workers[0].onmessage;
  jobs.cancel(); handler({ data: { type: 'complete' } });
  assert.equal(workers[0].terminated, true); assert.deepEqual(messages, []);
  jobs.warmup(base); assert.equal(workers.length, 2);
});

test('failed speculative worker startup is retried by Search', () => {
  const workers = [];
  const jobs = createTravelJobs(() => { const worker = { postMessage() {}, terminate() { this.terminated = true; } }; workers.push(worker); return worker; });
  jobs.warmup(base); jobs.invalidate(); workers[0].onerror({});
  jobs.run(base, () => {}, { reuse:true });
  assert.equal(workers.length, 2); assert.equal(workers[0].terminated, true);
  let calls = 0;
  const unavailable = createTravelJobs(() => { calls++; throw Error('Worker unavailable'); });
  assert.doesNotThrow(() => unavailable.warmup(base));
  assert.throws(() => unavailable.run(base, () => {}, { reuse:true }), /Worker unavailable/);
  assert.equal(calls, 2);
});


test('display sorts preserve source results, real zeroes and unknowns in both directions', () => {
  const result = (id, hours, slope) => ({ point: { id, name: id, lat: 0, lon: 0 }, sunlight: { hours }, earth: { hours: 100 - hours }, terrain: { slopeDeg: slope } });
  const rows = [result('high', 80, 8), result('unknown', null, null), result('flat', 0, 0), result('low', 20, 2)];
  const before = structuredClone(rows), ids = options => sortTravelResults(rows, options).map(r => r.point.id);
  assert.deepEqual(ids({ field: 'sunlight', direction: 'asc' }), ['flat', 'low', 'high', 'unknown']);
  assert.deepEqual(ids({ field: 'sunlight', direction: 'desc' }), ['high', 'low', 'flat', 'unknown']);
  assert.deepEqual(ids({ field: 'terrain', direction: 'asc' }), ['flat', 'low', 'high', 'unknown']);
  assert.deepEqual(ids({ field: 'terrain', direction: 'desc' }), ['high', 'low', 'flat', 'unknown']);
  assert.deepEqual(ids({ field: 'earth', direction: 'asc' }), ['high', 'low', 'unknown', 'flat']);
  assert.deepEqual(rows, before);
  assert.deepEqual(ids({ knownIds: new Set(['low']), field: 'sunlight', direction: 'desc' }), ['low', 'high', 'flat', 'unknown']);
  assert.deepEqual(ids({ knownIds: new Set(['low']), knownFirst: false, field: 'sunlight', direction: 'desc' }), ['high', 'low', 'flat', 'unknown']);
});

test('name and coordinate sorting use natural names and normalized east longitude before latitude', () => {
  const rows = [
    { point: { name: 'Site 10', lon: -10, lat: 20 } },
    { point: { name: 'site 2', lon: 350, lat: -20 } },
    { point: { name: 'Alpha', lon: 0, lat: 0 } },
    { point: { lon: 180, lat: 0 } }
  ];
  const sorted = (field, direction) => sortTravelResults(rows, { field, direction });
  assert.deepEqual(sorted('name', 'asc'), [rows[2], rows[1], rows[0], rows[3]]);
  assert.deepEqual(sorted('name', 'desc'), [rows[0], rows[1], rows[2], rows[3]]);
  assert.deepEqual(sorted('coordinates', 'asc'), [rows[2], rows[3], rows[1], rows[0]]);
  assert.deepEqual(sorted('coordinates', 'desc'), [rows[0], rows[1], rows[3], rows[2]]);
  assert.deepEqual(sorted('sunlight', 'desc'), rows, 'equal or missing values retain their existing order');
});
