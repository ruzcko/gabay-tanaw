import { test } from 'node:test';
import assert from 'node:assert/strict';
import { direction, validateSnapshot, createSnapshotLoader } from './math.js';
import { fixture } from './fixture.js';
test('cardinal directions, zenith and nadir use east/up/south axes', () => {
  for (const [az, el, expected] of [[0,0,[0,0,-1]],[90,0,[1,0,0]],[180,0,[0,0,1]],[270,0,[-1,0,0]],[0,90,[0,1,0]],[0,-90,[0,-1,0]]]) {
    direction(az, el).forEach((v, i) => assert.ok(Math.abs(v - expected[i]) < 1e-12));
  }
});
test('snapshots are copied and malformed science is rejected', () => {
  const input = fixture(), copy = validateSnapshot(input); input.site.id = 'mutated'; assert.notEqual(copy.site.id, input.site.id);
  for (const change of [s => s.bodies.sun.elevationDeg = NaN, s => s.bodies.earth.rangeKm = 0, s => s.directionKind = 'unknown', s => s.site.referenceFrame = '', s => s.instantUtc = 'tomorrow']) {
    const s = fixture(); change(s); assert.throws(() => validateSnapshot(s));
  }
});
test('rapid changes reject stale responses even when provider ignores abort', async () => {
  const pending = [], applied = [];
  const loader = createSnapshotLoader({ computationProvider: { observe: request => new Promise(resolve => pending.push({ request, resolve })) }, observer: { setSnapshot: s => applied.push(s) } });
  const a = fixture(), b = fixture(); b.site.id = 'second';
  const first = loader.load(a.site, a.instantUtc), second = loader.load(b.site, b.instantUtc);
  assert.equal(pending[0].request.signal.aborted, true);
  pending[1].resolve(b); assert.equal(await second, true);
  pending[0].resolve(a); assert.equal(await first, false); assert.equal(applied.length, 1); assert.equal(applied[0].site.id, 'second'); loader.dispose();
});
test('dispose prevents pending results from reaching view', async () => {
  let resolve; const s = fixture();
  const loader = createSnapshotLoader({ computationProvider: { observe: () => new Promise(r => { resolve = r; }) }, observer: { setSnapshot: () => assert.fail('disposed') } });
  const result = loader.load(s.site, s.instantUtc); loader.dispose(); resolve(s); assert.equal(await result, false);
});

test('coordinates read as degrees N/S and E/W', async () => {
  const { formatLatLon } = await import('./math.js');
  assert.equal(formatLatLon(-89.4398, 222.83), '89.44° S, 137.17° W');
  assert.equal(formatLatLon(0.6741, 23.4733), '0.67° N, 23.47° E');
  assert.equal(formatLatLon(-89.4398, -137.17), '89.44° S, 137.17° W');
});
