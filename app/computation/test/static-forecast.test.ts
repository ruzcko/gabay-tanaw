import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createStaticForecastProvider, toObserverViewSnapshot } from '../src/index.ts';
import { createSnapshotLoader, validateSnapshot } from '../../observer/math.js';

const data = new URL('../../data/', import.meta.url);
const json = async (path: string) => JSON.parse(await readFile(new URL(path, data), 'utf8'));
const sites = await json('sites.json');
const selection = (s = sites[0]) => ({ latitudeDeg: s.lat, longitudeEastDeg: s.lon });
const first = '2026-12-01T00:00:00Z';
function setup(change = (_path: string, value: any) => value) {
  const calls: string[] = [];
  const fetcher = async (input: any, options: any) => {
    assert.equal(options.signal.aborted, false);
    const path = new URL(input).pathname.slice('/data/'.length); calls.push(path);
    const value = change(path, await json(path));
    return value === null ? new Response('', { status: 404 }) : Response.json(value);
  };
  return { calls, provider: createStaticForecastProvider({ baseUrl: new URL('https://test.invalid/data/'), fetcher: fetcher as typeof fetch }) };
}

function batchedSources(index: any, split = false) {
  // Synthetic provenance windows exercise the reader contract. The live Python
  // benchmark separately compares actual raw batches and saved observations.
  const spans = split ? [['2026-12-01', '2027-04-15'], ['2027-04-15', '2027-12-01']]
    : [['2026-12-01', '2027-12-01']];
  const ut = (iso: string) => `${iso.slice(0, 4)}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(iso.slice(5, 7))-1]}-${iso.slice(8)} 00:00:00.0000 UT`;
  return ['sun', 'earth'].flatMap(body => spans.map(([start, end]) => {
    const original = index.science.sources.find((s: any) => s.file === `${body}-2026-12.txt.gz`);
    return { ...original, file: `${body}-${start}_${end}.txt.gz`, header: original.header
      .replace(/^Start time[^\n]*/m, `Start time : A.D. ${ut(start)}`)
      .replace(/^Stop  time[^\n]*/m, `Stop  time : A.D. ${ut(end)}`) };
  }));
}

test('batched source coverage preserves the same observer snapshot at every month boundary', async () => {
  const baseline = setup();
  try {
    for (const split of [false, true]) {
      const { provider } = setup((path, value) => {
        if (path === 'forecast/connecting-ridge.json') value.science.sources = batchedSources(value, split).reverse();
        return value;
      });
      try {
        for (const month of (await json('forecast/connecting-ridge.json')).months) {
          const request = { site: selection(), instantUtc: `${month}-01T00:00:00Z` };
          const before = await baseline.provider.observe(request), after = await provider.observe(request);
          assert.deepEqual(after.bodies, before.bodies);
          assert.deepEqual(after.site, before.site);
          assert.deepEqual(after.capabilities, before.capabilities);
          assert.equal(after.provenance.forecast.science.sources.length, split ? 4 : 2);
          validateSnapshot(toObserverViewSnapshot(after));
        }
      } finally { provider.dispose(); }
    }
  } finally { baseline.provider.dispose(); }
});

test('source gaps, overlaps, wrong bodies/cadence and malformed windows fail closed', async () => {
  const mutations = [
    (s: any[]) => s.pop(),
    (s: any[]) => s.push(s[0]),
    (s: any[]) => { s[0].header = s[0].header.replace('Target body name: Sun (10)', 'Target body name: Earth (399)'); },
    (s: any[]) => { s[0].header = s[0].header.replace(/Step-size\s*:\s*10 minutes/, 'Step-size : 1 minutes'); },
    (s: any[]) => { s[0].header = s[0].header.replace('2026-Dec-01 00:00', '2026-Dec-02 00:00'); s[0].file = s[0].file.replace('2026-12-01', '2026-12-02'); },
    (s: any[]) => { s[1].header = s[1].header.replace('2027-Apr-15 00:00', '2027-Apr-14 00:00'); s[1].file = s[1].file.replace('2027-04-15', '2027-04-14'); },
    (s: any[]) => { s[3].header = s[3].header.replace('2027-Dec-01 00:00', '2027-Dec-02 00:00'); s[3].file = s[3].file.replace('2027-12-01', '2027-12-02'); },
    (s: any[]) => { s[0].header = s[0].header.replace('2026-Dec-01', '2026-Feb-30'); },
    (s: any[]) => { s[0].header += '\nStart time : A.D. 2026-Dec-01 00:00:00.0000 UT\n'; },
    (s: any[]) => { s[0].file = 'sun-2026-12-02_2027-04-15.txt.gz'; },
    (s: any[]) => { s[0].sha256 = 'invalid'; },
    (s: any[]) => { s[0].header = ''; },
  ];
  for (const mutate of mutations) {
    const { provider } = setup((path, value) => {
      if (path === 'forecast/connecting-ridge.json') {
        value.science.sources = batchedSources(value, true); mutate(value.science.sources);
      }
      return value;
    });
    try { await assert.rejects(provider.observe({ site: selection(), instantUtc: first }), { code: 'INVALID_RESPONSE' }); }
    finally { provider.dispose(); }
  }
});

test('coordinate/time handoff maps all 30 saved sites, science heights, evidence and visibility', async () => {
  const { provider } = setup();
  try {
    for (const s of sites) {
      const snapshot = await provider.observe({ site: selection(s), instantUtc: first });
      const index = await json(`forecast/${s.id}.json`), month = await json(`forecast/${s.id}/2026-12.json`);
      assert.equal(snapshot.site.id, s.id);
      assert.equal(snapshot.site.surfaceElevationM, index.science.surfaceElevationM);
      assert.equal(snapshot.site.observerHeightM, index.science.observerHeightM);
      assert.equal(snapshot.site.referenceFrame, index.science.referenceFrame);
      assert.equal(snapshot.site.elevationDatum, index.science.elevationDatum);
      assert.deepEqual(snapshot.provenance.forecast.science, index.science);
      for (const name of ['sun', 'earth'] as const) {
        assert.deepEqual(snapshot.bodies[name], {
          azimuthDeg: month[`${name}Az`][0] % 360, elevationDeg: month[`${name}El`][0],
          rangeKm: month[`${name}RangeKm`][0], angularDiameterDeg: month[`${name}AngularDiameterDeg`][0],
          centerVisible: month[`${name}Visible`][0] === 1
        });
      }
      assert.equal(snapshot.interpolated, false);
      for (const value of Object.values(snapshot.capabilities)) assert.equal(typeof value === 'string' ? value : value.status, 'unsupported');
      for (const key of ['lighting', 'earthAppearance', 'sky', 'overview']) assert.equal(key in snapshot, false);
      const viewSnapshot = validateSnapshot(toObserverViewSnapshot(snapshot));
      assert.ok(viewSnapshot.site.longitudeEastDeg >= -180 && viewSnapshot.site.longitudeEastDeg < 180);
      assert.deepEqual(viewSnapshot.provenance.forecast.science, index.science);
      if (s.positionAccuracy) assert.match(snapshot.provenance.warnings.join(' '), /Approximate planned target/);
    }
  } finally { provider.dispose(); }
});

test('month boundaries use the new month, February length and exclusive year end', async () => {
  const { provider, calls } = setup();
  try {
    const index = await json('forecast/connecting-ridge.json');
    for (const label of index.months) {
      const start = `${label}-01T00:00:00Z`, m = await json(`forecast/connecting-ridge/${label}.json`);
      const begin = await provider.observe({ site: selection(), instantUtc: start });
      assert.equal(begin.bodies.sun.elevationDeg, m.sunEl[0]);
      const last = new Date(Date.parse(start) + (m.sunEl.length - 1) * 3600000).toISOString();
      const end = await provider.observe({ site: selection(), instantUtc: last });
      assert.equal(end.bodies.earth.azimuthDeg, m.earthAz.at(-1) % 360);
    }
    assert.equal(calls.length, 14); // one catalog, one index, twelve monthly downloads
    await assert.rejects(provider.observe({ site: selection(), instantUtc: '2027-12-01T00:00:00Z' }), { code: 'UNSUPPORTED' });
  } finally { provider.dispose(); }
});

test('unsupported coordinates, ID, frame, heights, UTC and unsaved hours fail explicitly', async () => {
  const { provider } = setup();
  try {
    for (const site of [
      { ...selection(), latitudeDeg: -89.44 }, { ...selection(), id: 'blue-ghost-2' },
      { ...selection(), latitudeDeg: 90 }, { ...selection(), longitudeEastDeg: NaN },
      { ...selection(), observerHeightM: 3 }, { ...selection(), surfaceElevationM: sites[0].surfaceElevationM }
    ]) await assert.rejects(provider.observe({ site, instantUtc: first }), { code: 'UNSUPPORTED' });
    for (const site of [{ ...selection(), referenceFrame: 'IAU_MOON' }, { ...selection(), elevationDatum: 'other' }])
      await assert.rejects(provider.observe({ site, instantUtc: first }), { code: 'INCOMPATIBLE_FRAME' });
    for (const instantUtc of ['2026-11-30T23:00:00Z', '2027-12-01T00:00:00Z', '2026-12-01T00:01:00Z', '2026-12-01T00:00:00.001Z'])
      await assert.rejects(provider.observe({ site: selection(), instantUtc }), { code: 'UNSUPPORTED' });
    for (const instantUtc of ['2026-12-01', '2027-02-29T00:00:00Z', '2026-12-01T08:00:00+08:00'])
      await assert.rejects(provider.observe({ site: selection(), instantUtc }), { code: 'INVALID_INPUT' });
    const signed = await provider.observe({ site: { ...selection(), longitudeEastDeg: sites[0].lon - 360 }, instantUtc: first });
    assert.equal(signed.site.id, sites[0].id);
  } finally { provider.dispose(); }
});

test('missing catalog/index/month and malformed metadata/month never produce a snapshot; retry works', async () => {
  for (const path of ['sites.json', 'forecast/connecting-ridge.json', 'forecast/connecting-ridge/2026-12.json']) {
    let missing = true;
    const { provider, calls } = setup((p, value) => p === path && missing ? null : value);
    await assert.rejects(provider.observe({ site: selection(), instantUtc: first }), { code: 'UPSTREAM' });
    missing = false;
    assert.equal((await provider.observe({ site: selection(), instantUtc: first })).site.id, sites[0].id);
    assert.equal(calls.filter(p => p === path).length, 2);
    provider.dispose();
  }
  for (const change of [
    (f: any) => { delete f.science; }, (f: any) => { f.science.surfaceElevationM = null; },
    (f: any) => { f.science.referenceFrame = 'LOLA-ME'; }, (f: any) => { f.science.frameEvidence = 'changed'; },
    (f: any) => { f.science.sources.pop(); }, (f: any) => { f.months.pop(); }, (f: any) => { f.lon += 1; }
  ]) {
    const { provider } = setup((p, value) => { if (p === 'forecast/connecting-ridge.json') change(value); return value; });
    await assert.rejects(provider.observe({ site: selection(), instantUtc: first })); provider.dispose();
  }
  const { provider } = setup((p, value) => { if (p.endsWith('/2026-12.json')) delete value.earthVisible; return value; });
  await assert.rejects(provider.observe({ site: selection(), instantUtc: first }), { code: 'INVALID_RESPONSE' }); provider.dispose();
});

test('returned snapshots cannot mutate cached metadata; saved visibility overrides display angles', async () => {
  const { provider, calls } = setup((path, value) => {
    if (path.endsWith('/2026-12.json')) { value.earthEl[0] = 90; value.earthVisible[0] = 0; }
    return value;
  });
  const a = await provider.observe({ site: selection(), instantUtc: first });
  a.provenance.forecast.science.sources.length = 0;
  a.bodies.sun.elevationDeg = 0;
  const b = await provider.observe({ site: selection(), instantUtc: first });
  assert.equal(b.bodies.earth.centerVisible, false);
  assert.equal(b.provenance.forecast.science.sources.length, 24);
  assert.equal(calls.length, 3); provider.dispose();
});

test('shared in-flight month survives hour changes; obsolete downloads abort and late responses stay stale', async () => {
  const calls: string[] = [], pending = new Map<string, { resolve: (r: Response) => void; signal: AbortSignal }>();
  const fetcher = async (input: any, options: any) => {
    const path = new URL(input).pathname.slice('/data/'.length); calls.push(path);
    if (/\/202[67]-\d\d.json$/.test(path)) return new Promise<Response>(resolve => pending.set(path, { resolve, signal: options.signal }));
    return Response.json(await json(path));
  };
  const provider = createStaticForecastProvider({ baseUrl: new URL('https://test.invalid/data/'), fetcher: fetcher as typeof fetch });
  const applied: any[] = [], errors: Error[] = [];
  const loader = createSnapshotLoader({ computationProvider: { observe: async (r: any) => toObserverViewSnapshot(await provider.observe(r)) },
    observer: { setSnapshot: (s: any) => applied.push(s) }, onError: (e: Error) => errors.push(e) });
  const waitFor = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i++) await new Promise(r => setTimeout(r, 2));
    assert.ok(predicate());
  };
  const dec = 'forecast/connecting-ridge/2026-12.json', jan = 'forecast/connecting-ridge/2027-01.json';
  const a = loader.load(selection(), first);
  await waitFor(() => pending.has(dec));
  const b = loader.load(selection(), '2026-12-01T01:00:00Z');
  await new Promise(r => setTimeout(r, 10));
  assert.equal(pending.get(dec)!.signal.aborted, false);
  assert.equal(calls.filter(p => p === dec).length, 1);
  const c = loader.load(selection(), '2027-01-01T00:00:00Z');
  await waitFor(() => pending.has(jan) && pending.get(dec)!.signal.aborted);
  pending.get(jan)!.resolve(Response.json(await json(jan)));
  assert.equal(await c, true);
  // Deliberately ignore the fetch AbortSignal and return the old result last.
  pending.get(dec)!.resolve(Response.json(await json(dec)));
  assert.equal(await a, false); assert.equal(await b, false);
  assert.equal(applied.length, 1); assert.equal(applied[0].instantUtc, '2027-01-01T00:00:00.000Z');
  assert.equal(errors.length, 0);
  assert.equal(await loader.load(selection(), '2027-01-01T00:30:00Z'), false);
  assert.equal(applied.length, 1); assert.equal(errors.length, 1);
  loader.dispose(); provider.dispose();
});

test('two independent selection streams share downloads without cancelling each other', async () => {
  const { provider, calls } = setup();
  const a = new AbortController(), b = new AbortController();
  const firstRequest = provider.observe({ site: selection(), instantUtc: first, signal: a.signal });
  const secondRequest = provider.observe({ site: selection(), instantUtc: first, signal: b.signal });
  a.abort();
  await assert.rejects(firstRequest, { code: 'ABORTED' });
  assert.equal((await secondRequest).site.id, sites[0].id);
  assert.equal(calls.length, 3);
  provider.dispose();
  await assert.rejects(provider.observe({ site: selection(), instantUtc: first }), { code: 'ABORTED' });
});
