import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateForecastMonth, readForecastHour } from '../src/forecast.ts';

const data = new URL('../../data/', import.meta.url);
const json = async (path: string) => JSON.parse(await readFile(new URL(path,data),'utf8'));
const sites = await json('sites.json');

test('rebuilt metadata follows all reviewed coordinates and terrain heights', async () => {
  const manifest = await json('forecast-manifest.json');
  assert.equal(manifest.completeCatalog, true);
  assert.deepEqual(manifest.excluded, []);
  assert.deepEqual(manifest.included.map((s: {id: string}) => s.id).sort(), sites.map((s: {id: string}) => s.id).sort());
  for (const site of sites) {
    const index = await json(`forecast/${site.id}.json`);
    const horizon = await json(`horizons/${site.id}.json`);
    // Five reviewed Artemis locations moved while the old forecast indexes had not.
    for (const value of [index, horizon]) {
      assert.equal(value.lat, site.lat);
      assert.equal(value.lon, site.lon);
    }
    assert.equal(index.science.surfaceElevationM, horizon.surfaceElevation);
    assert.equal(index.science.observerHeightM, horizon.observerHeight);
    assert.equal(index.science.frameEvidence, site.frameEvidence);
    assert.equal(index.science.positionAccuracy, site.positionAccuracy);
    assert.equal(horizon.calculation.step, 0.25);
    assert.equal(horizon.calculation.elevations.length, 1440);
    assert.equal(horizon.elevations.length, 360);
    assert.notEqual(horizon.terrain, 'smooth');
  }
});

test('all 30 reviewed sites: 365 days and 360 complete hourly month files', async () => {
  assert.equal(sites.length,30);
  assert.equal(sites.some((site: {id: string}) => site.id === 'blue-ghost-2'), false);
  let hours = 0, files = 0;
  for (const site of sites) {
    const index = await json(`forecast/${site.id}.json`);
    assert.equal(index.id, site.id);
    assert.equal(index.days.length,365);
    assert.equal(index.months.length,12);
    for (let i=0; i<index.months.length; i++) {
      const label = index.months[i];
      const start = i ? `${label}-01T00:00:00Z` : index.window.start;
      const end = i+1<index.months.length ? `${index.months[i+1]}-01T00:00:00Z` : index.window.end;
      const month = validateForecastMonth(await json(`forecast/${site.id}/${label}.json`),start,end);
      hours += month.sunAz.length; files++;
      assert.equal(readForecastHour(month,start).earth.centerVisible,month.earthVisible[0]===1);
      assert.throws(()=>readForecastHour(month,end)); // Exclusive month endpoint, not a stale last sample.
    }
  }
  assert.equal(hours,30*365*24); assert.equal(files,360);
});

test('reject missing arrays, nonfinite values, fractional visibility and unsaved instants', async () => {
  const original=await json('forecast/apollo-11/2026-12.json');
  const validate=(m: unknown)=>validateForecastMonth(m,'2026-12-01T00:00:00Z','2027-01-01T00:00:00Z');
  for (const mutate of [
    (m:any)=>m.earthEl.pop(), (m:any)=>m.earthRangeKm[0]=NaN,
    (m:any)=>m.earthVisible[0]=0.5, (m:any)=>m.stepMinutes=10,
  ]) { const m=structuredClone(original); mutate(m); assert.throws(()=>validate(m)); }
  const m=validate(original);
  assert.throws(()=>readForecastHour(m,'2026-12-01T00:30:00Z'));
  assert.throws(()=>readForecastHour(m,'2026-11-30T23:00:00Z'));
  // Rounded display angles are not evidence to override the authoritative saved state.
  m.earthVisible[0]=0; m.earthEl[0]=90;
  assert.equal(readForecastHour(m,m.start).earth.centerVisible,false);
});
