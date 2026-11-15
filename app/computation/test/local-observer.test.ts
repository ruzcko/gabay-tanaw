import test from 'node:test';
import assert from 'node:assert/strict';
import { readLocalObserver, readLocalObserverWindow, validateLocalObserverWindow } from '../src/local-observer.ts';

const site = { latitudeDeg: -10.123456, longitudeEastDeg: 25.123456 };
const instant = '2027-01-01T13:00:00.000Z';
const window = { startUtc: '2026-12-22T00:00:00.000Z', endUtc: '2027-01-21T00:00:00.000Z' };
const body = { azimuthDeg: 90, elevationDeg: 1, rangeKm: 1000000, angularDiameterDeg: .5, centerVisible: true };
const response = () => ({
  coverage: { ...window, stepSeconds: 3600, sampleCount: 720 },
  observation: {
    site: { ...site, id: 'custom--10.123456-25.123456', referenceFrame: 'MOON_ME_DE421', elevationDatum: 'sphere-1737400m', surfaceElevationM: 0, observerHeightM: 2 },
    instantUtc: instant, directionKind: 'apparent', interpolated: false, bodies: { sun: body, earth: body },
    provenance: { source: 'JPL Horizons', model: 'airless', appearance: { frame: 'MOON_ME_DE440_ME421' } },
    lighting: { sunDirectionLocal: [1,0,0] }, sky: { catalogFrame: 'ICRS-J1991.25', catalogToLocal: [0,0,0,1] },
    overview: { axisConvention: 'x0-yNorth-zWest', moonRadiusM: 1737400, moonToLocal: [0,0,0,1], siteDirectionMoon: [1,0,0], sunDirectionMoon: [1,0,0], earthDirectionMoon: [1,0,0] },
  },
});

test('prepared coverage and selected observation must match the requested window', () => {
  assert.equal(validateLocalObserverWindow(response(), site, instant, window).observation.instantUtc, instant);
  for (const change of [
    (r: any) => r.coverage.sampleCount = 719,
    (r: any) => r.coverage.stepSeconds = 600,
    (r: any) => r.coverage.endUtc = '2027-01-22T00:00:00.000Z',
    (r: any) => r.observation.instantUtc = window.startUtc,
    (r: any) => r.observation.site.latitudeDeg = 10,
    (r: any) => r.observation.site.id = 'catalog',
  ]) {
    const damaged = response(); change(damaged);
    assert.throws(() => validateLocalObserverWindow(damaged, site, instant, window));
  }
  assert.throws(() => validateLocalObserverWindow(response(), site, window.endUtc, window));
  assert.throws(() => validateLocalObserverWindow(response(), site, instant, { ...window, startUtc: '2026-12-22T01:00:00Z' }));
});

test('preparation and playback send identical explicit coverage and preserve abort signals', async (t) => {
  const calls: string[] = []; const signal = new AbortController().signal;
  t.mock.method(globalThis, 'fetch', async (url: string, options: any) => {
    calls.push(url); assert.equal(options.signal, signal);
    return Response.json(url.startsWith('/api/observer-window?') ? response() : response().observation);
  });
  await readLocalObserverWindow(site, instant, window, signal);
  await readLocalObserver(site, instant, signal, window);
  assert.equal(calls.length, 2);
  for (const url of calls) {
    const params = new URL(url, 'http://127.0.0.1').searchParams;
    assert.equal(params.get('startUtc'), window.startUtc); assert.equal(params.get('endUtc'), window.endUtc);
    assert.equal(params.get('t'), instant);
  }
});

test('unprepared service responses remain errors, without daily fallback', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: 'Window is not prepared' }, { status: 400 }); });
  await assert.rejects(readLocalObserver(site, instant, undefined, window), /Window is not prepared/);
  assert.equal(calls, 1);
});

test('daily scenes must cover every selected UTC hour exactly and agree with the selected result', () => {
  const value: any = response();
  value.observations = Array.from({length:30}, (_,day) => ({ ...structuredClone(value.observation),
    instantUtc: new Date(Date.parse(window.startUtc)+day*86400000+13*3600000).toISOString() }));
  assert.equal(validateLocalObserverWindow(value,site,instant,window).observations?.length,30);
  const invalid = structuredClone(value); invalid.observations[4].instantUtc = invalid.observations[3].instantUtc;
  assert.throws(() => validateLocalObserverWindow(invalid,site,instant,window));
  const mismatch = structuredClone(value); mismatch.observations[10].bodies.sun.azimuthDeg = 4;
  assert.throws(() => validateLocalObserverWindow(mismatch,site,instant,window));
});
