import type { BodyObservation, LunarSite, SourceRecord, Vector3 } from './contracts.ts';
import { ComputationError, julianDayUtc, normalizeLongitude, observerAltitudeKm, parseUtc, requireCondition } from './core.ts';

export type QueryKind = 'observer' | 'geometric';
export interface HorizonsQuery { site: LunarSite; instantsUtc: readonly string[]; target: 10 | 399; kind: QueryKind }
export interface ObserverSample extends BodyObservation {
  instantUtc: string;
  tdbMinusUtcSeconds: number;
  /** Raw source aspect quantities; not a validated Earth rotation matrix. */
  aspect: Record<string, number | null>;
}
export interface GeometricSample {
  instantUtc: string;
  positionKm: Vector3;
  velocityKmPerSecond: Vector3;
  frame: 'ICRF';
  origin: 'observer';
  correction: 'NONE';
}
export interface HorizonsResult {
  kind: QueryKind;
  observerSamples: ObserverSample[];
  geometricSamples: GeometricSample[];
  provenance: SourceRecord;
}
const fields = (line: string) => line.split(',').map(s => s.trim());
const fail = (value: unknown, message: string) => requireCondition(value, 'INVALID_RESPONSE', message);

/** Parses only explicitly supported formats. Never guesses units, frames or missing values. */
export function parseHorizons(rawResponse: string, query: HorizonsQuery, parameters: Record<string,string>, retrievedAtUtc: string): HorizonsResult {
  let payload: { signature?: { source?: string; version?: string }; result?: string; error?: string };
  try { payload = JSON.parse(rawResponse); } catch { throw new ComputationError('INVALID_RESPONSE','Invalid Horizons JSON'); }
  fail(payload && typeof payload === 'object', 'Invalid JSON envelope');
  fail(!payload.error, `Horizons error: ${payload.error}`);
  fail(payload.signature?.source === 'NASA/JPL Horizons API', 'Unrecognized source');
  // 1.2 remains the live endpoint version on 2026-11-14; both versions checked by full schema validation.
  fail(['1.2','1.3'].includes(payload.signature?.version ?? ''), 'Unreviewed Horizons API version');
  fail(typeof payload.result === 'string', 'Missing ephemeris result');
  const result = payload.result!;
  const parts = result.split('$$SOE'); fail(parts.length === 2, 'Missing/duplicate start marker');
  const [header, rest] = parts;
  const ends = rest.split('$$EOE'); fail(ends.length === 2, 'Missing/duplicate end marker');
  fail(new RegExp(`Target body name: ${query.target === 10 ? 'Sun' : 'Earth'} \\(${query.target}\\)`).test(header), 'Wrong target');
  fail(/Center body name: Moon \(301\)/.test(header), 'Wrong center');
  fail(/Center-site name: \(user defined site below\)/.test(header), 'Not a surface observer');
  fail(/Center pole\/equ\s*:\s*(?:MEAN_ME \(high precision\)|MOON_ME)\s*\{East-longitude positive\}/.test(header), 'Unsupported lunar orientation');
  fail(/Center radii\s*:\s*1737\.4,\s*1737\.4,\s*1737\.4 km/.test(header), 'Unexpected lunar reference shape');
  fail(/Calendar mode\s*:\s*Gregorian/.test(header), 'Unexpected calendar');
  fail(/EOP file\s*:\s*\S+/.test(header) && /EOP coverage\s*:\s*[^\n]+/.test(header), 'Missing Earth orientation provenance');
  const coord = header.match(/Center geodetic\s*:\s*([^\n{]+)/);
  fail(coord, 'Missing site coordinates');
  const actual = fields(coord![1]).map(Number);
  const longitudeError = Math.abs(((actual[0] - normalizeLongitude(query.site.longitudeEastDeg) + 540) % 360) - 180);
  fail(actual.length === 3 && longitudeError <= 0.00001 && Math.abs(actual[1] - query.site.latitudeDeg) <= 0.00001 &&
    Math.abs(actual[2] - observerAltitudeKm(query.site)) <= 0.00001, 'Observer location mismatch');
  if (query.kind === 'observer') {
    fail(/Atmos refraction:\s*NO \(AIRLESS\)/.test(header), 'Not airless');
    fail(/Units: KM and KM\/S/.test(ends[1]), 'Range units are not KM');
    fail(/Units: ARCSECONDS/.test(ends[1]), 'Missing angular diameter units');
  } else {
    fail(/Output units\s*:\s*KM-S/.test(header) && /Output type\s*:\s*GEOMETRIC cartesian states/.test(header) &&
      /Reference frame\s*:\s*ICRF\s*\n/.test(header), 'Geometric frame/correction/units mismatch');
  }
  const headerLine = header.split('\n').find(l => query.kind === 'observer' ? l.startsWith('Date_________JDUT,') : /^\s*JDUT\s*,/.test(l));
  fail(headerLine, 'Missing documented timestamp header');
  const columns = fields(headerLine!).map(c => c === 'Azimuth_(a-app)' ? 'Azi_(a-app)' : c === 'Elevation_(a-app)' ? 'Elev_(a-app)' : c);
  const required = query.kind === 'observer' ? ['Azi_(a-app)','Elev_(a-app)','Ang-diam','delta','TDB-UT',
    'ObsSub-LON','ObsSub-LAT','SunSub-LON','SunSub-LAT','NP.ang','NP.dist','N.Pole-RA','N.Pole-DC'] : ['X','Y','Z','VX','VY','VZ'];
  for (const name of required) fail(columns.filter(c => c === name).length === 1, `Missing/duplicate column ${name}`);
  const rows = ends[0].trim().split('\n').filter(l => l.trim()).map(fields);
  fail(rows.length === query.instantsUtc.length, 'Missing or excess samples');
  let previous = -Infinity;
  const observerSamples: ObserverSample[] = [], geometricSamples: GeometricSample[] = [];
  rows.forEach((row, i) => {
    fail(row.length === columns.length, 'Malformed row width');
    const jd = Number(row[0]);
    fail(Number.isFinite(jd) && jd > previous, 'Duplicate or unordered sample'); previous = jd;
    fail(Math.abs(jd - julianDayUtc(query.instantsUtc[i])) * 86400 <= 0.001, 'Timestamp mismatch');
    const get = (name: string, optional = false): number | null => {
      const text = row[columns.indexOf(name)];
      if (optional && text === 'n.a.') return null;
      fail(!!text && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/.test(text), `Missing/invalid ${name}`);
      const n = Number(text); fail(Number.isFinite(n), `Nonfinite ${name}`); return n;
    };
    if (query.kind === 'observer') {
      const sample: ObserverSample = { instantUtc: new Date(parseUtc(query.instantsUtc[i])).toISOString(), azimuthDeg: get('Azi_(a-app)')!, elevationDeg: get('Elev_(a-app)')!,
        rangeKm: get('delta')!, angularDiameterDeg: get('Ang-diam')! / 3600, tdbMinusUtcSeconds: get('TDB-UT')!, aspect: {} };
      fail(sample.azimuthDeg >= 0 && sample.azimuthDeg <= 360 && Math.abs(sample.elevationDeg) <= 90 &&
        sample.rangeKm > 0 && sample.angularDiameterDeg > 0 && sample.angularDiameterDeg <= 180, 'Invalid observation values');
      sample.azimuthDeg = normalizeLongitude(sample.azimuthDeg);
      for (const name of required.slice(5)) sample.aspect[name] = get(name, true);
      observerSamples.push(sample);
    } else geometricSamples.push({ instantUtc: new Date(parseUtc(query.instantsUtc[i])).toISOString(), positionKm: [get('X')!,get('Y')!,get('Z')!],
      velocityKmPerSecond: [get('VX')!,get('VY')!,get('VZ')!], frame: 'ICRF', origin: 'observer', correction: 'NONE' });
  });
  return { kind: query.kind, observerSamples, geometricSamples, provenance: { parameters: { ...parameters },
    endpoint: 'https://ssd.jpl.nasa.gov/api/horizons.api', retrievedAtUtc, apiVersion: payload.signature!.version!,
    source: payload.signature!.source!, rawResponse, header } };
}
