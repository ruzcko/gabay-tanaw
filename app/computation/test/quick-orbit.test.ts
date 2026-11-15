import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Coefficients } from '../src/quick/coefficients.ts';
import { quickOrbit } from '../src/quick/orbit.ts';

const read = async (url: URL) => { const b = await readFile(url); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length) as ArrayBuffer; };
const orbitMonth = async (month: string) => JSON.parse(await readFile(new URL(`../../data/orbit/${month}.json`, import.meta.url), 'utf8'));
const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

test('quick orbit longitudes match the published data/orbit/ across Dec 2026 – Nov 2027', async () => {
  // Published values are rounded to 0.01°, so 0.01° allows for that rounding plus the model.
  let earth = 0, moonLon = 0, moonLat = 0;
  for (const month of ['2026-12', '2027-03', '2027-06', '2027-09', '2027-11']) {
    const file = await orbitMonth(month), start = Date.parse(file.start), step = file.stepMinutes * 60000;
    const hours = [0, 101, 333, file.earthHelioLonDeg.length - 1];
    const result = await quickOrbit(hours.map((k) => start + k * step), { coefficients: new Coefficients(read) });
    result.forEach((r, i) => {
      assert.equal(r.quality, 'estimate');
      earth = Math.max(earth, angle(r.earthHelioLonDeg, file.earthHelioLonDeg[hours[i]]));
      moonLon = Math.max(moonLon, angle(r.moonGeoLonDeg, file.moonGeoLonDeg[hours[i]]));
      moonLat = Math.max(moonLat, Math.abs(r.moonGeoLatDeg - file.moonGeoLatDeg[hours[i]]));
    });
  }
  console.log(`max |Δ| vs data/orbit: Earth lon ${earth.toFixed(4)}°, Moon lon ${moonLon.toFixed(4)}°, Moon lat ${moonLat.toFixed(4)}°`);
  assert.ok(earth <= 0.01 && moonLon <= 0.01 && moonLat <= 0.01);
});

test('quick orbit covers the first and last estimate years', async () => {
  const [first, last] = await quickOrbit([Date.UTC(1969, 6, 20, 20, 17), Date.UTC(2100, 11, 31, 23)], { coefficients: new Coefficients(read) });
  for (const r of [first, last]) for (const v of [r.earthHelioLonDeg, r.moonGeoLonDeg]) assert.ok(v >= 0 && v < 360);
  assert.ok(Math.abs(first.moonGeoLatDeg) < 5.4 && Math.abs(last.moonGeoLatDeg) < 5.4);
});
