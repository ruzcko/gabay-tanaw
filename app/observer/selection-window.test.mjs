import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSiteAt, requestedWindow } from './selection-window.js';
import { createDateWindow } from './date-scrubber.js';

test('preloaded coordinates retain identity across longitude representations', () => {
  const sites = [{ id: 'saved', lat: -89.4398, lon: 222.83 }];
  assert.equal(catalogSiteAt(sites, { latitudeDeg: -89.4398, longitudeEastDeg: -137.17 }), sites[0]);
  assert.equal(catalogSiteAt(sites, { latitudeDeg: -89.44, longitudeEastDeg: -137.17 }), undefined);
});

test('30 days means consecutive UTC days across month and year boundaries', () => {
  assert.deepEqual(requestedWindow({ startUtc: '2026-12-20T00:00:00Z', length: 30, instantUtc: '2027-01-01T14:00:00Z' }),
    { startUtc: '2026-12-20T00:00:00.000Z', endUtc: '2027-01-19T00:00:00.000Z' });
  assert.equal(requestedWindow({ startUtc: '2027-02-20T00:00:00Z', length: 30, instantUtc: '2027-02-28T14:00:00Z' }).endUtc,
    '2027-03-22T00:00:00.000Z');
});

test('exclusive endpoint and invalid windows fail without shifting the cursor', () => {
  for (const state of [
    { startUtc: '2027-11-01T00:00:00Z', length: 30, instantUtc: '2027-12-01T00:00:00Z' },
    { startUtc: '2027-11-01T14:00:00Z', length: 30, instantUtc: '2027-11-02T14:00:00Z' },
    { startUtc: 'invalid', length: 30, instantUtc: '2027-11-02T14:00:00Z' },
    { startUtc: '2027-11-01T00:00:00Z', length: 366, instantUtc: '2027-11-02T14:00:00Z' }
  ]) assert.throws(() => requestedWindow(state));
});

test('30-day preparation fits the published boundaries and retains the chosen hour', () => {
  for (const utc of ['2026-12-01T14:00:00Z', '2027-02-28T14:00:00Z', '2027-11-30T23:00:00Z']) {
    const model = createDateWindow('2026-12-01T00:00:00Z', '2027-12-01T00:00:00Z', utc);
    model.range(365); model.range(30);
    const window = requestedWindow(model.state);
    assert.equal(model.state.instantUtc, utc.replace('Z', '.000Z'));
    assert.equal(Date.parse(window.endUtc) - Date.parse(window.startUtc), 30 * 86400000);
    assert.ok(window.startUtc >= '2026-12-01T00:00:00.000Z');
    assert.ok(window.endUtc <= '2027-12-01T00:00:00.000Z');
    model.select(29);
    assert.ok(Date.parse(model.state.instantUtc) < Date.parse(window.endUtc));
  }
});
