import { requireCondition, throwIfAborted } from '../core.ts';
import { coefficientRange, ESTIMATE_UNAVAILABLE } from './coverage.ts';

export const MODEL = 'Tanaw-DE440-ME421-v1';
export type LoadBytes = (url: URL, signal?: AbortSignal) => Promise<ArrayBuffer>;
export const loadBytes: LoadBytes = async (url, signal) => {
  const response = await fetch(url, {signal});
  if (!response.ok) throw new Error(`Cannot load ${url.pathname}: ${response.status}`);
  return response.arrayBuffer();
};
export async function gunzip(raw: ArrayBuffer): Promise<ArrayBuffer> {
  return new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
export async function sha256(raw: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), x => x.toString(16).padStart(2, '0')).join('');
}

export class Series {
  readonly degree: number;
  readonly init:number;readonly step:number;readonly size:number;readonly count:number;readonly rows:Float64Array;
  constructor(init: number, step: number, size: number, count: number, rows: Float64Array) {
    this.init=init;this.step=step;this.size=size;this.count=count;this.rows=rows;this.degree = (size - 2) / 3 - 1;
  }
  /** Type-2 Chebyshev value and analytic derivative, written into caller-owned storage. */
  evaluate(et: number, out: Float64Array): void {
    const row = Math.min(this.count - 1, Math.floor((et - this.init) / this.step));
    requireCondition(row >= 0 && et <= this.init + this.count * this.step, 'UNSUPPORTED', 'Outside coefficient coverage');
    const base = row * this.size, radius = this.rows[base + 1], x = (et - this.rows[base]) / radius;
    for (let axis = 0; axis < 3; axis++) {
      const start = base + 2 + axis * (this.degree + 1);
      let b1 = 0, b2 = 0, d1 = 0, d2 = 0;
      for (let k = this.degree; k >= 1; k--) {
        const b = 2*x*b1 - b2 + this.rows[start+k], d = 2*b1 + 2*x*d1 - d2;
        b2 = b1; b1 = b; d2 = d1; d1 = d;
      }
      out[axis] = x*b1 - b2 + this.rows[start];
      out[axis+3] = (b1 + x*d1 - d2) / radius;
    }
  }
}
export function decodePack(raw: ArrayBuffer): Map<number, Series> {
  requireCondition(raw.byteLength % 8 === 0, 'INVALID_RESPONSE', 'Truncated coefficient pack');
  const values = new Float64Array(raw);
  requireCondition(values[0] === 1 && values[1] === 5, 'INVALID_RESPONSE', 'Unknown coefficient format');
  const result = new Map<number, Series>();
  let offset = 2;
  for (const expected of [3, 10, 301, 399, 31008]) {
    const [code, init, step, size, count] = values.subarray(offset, offset+5); offset += 5;
    requireCondition(code === expected && Number.isFinite(init) && step > 0 &&
      Number.isInteger(size) && size >= 8 && (size-2)%3 === 0 && Number.isInteger(count) && count > 0 &&
      offset + size*count <= values.length, 'INVALID_RESPONSE', 'Invalid coefficient series');
    const rows = values.subarray(offset, offset+size*count); offset += rows.length;
    requireCondition(rows.every(Number.isFinite), 'INVALID_RESPONSE', 'Nonfinite coefficient');
    for (let i = 0; i < count; i++) requireCondition(rows[i*size] === init+(i+.5)*step && rows[i*size+1] === step/2,
      'INVALID_RESPONSE', 'Invalid coefficient interval');
    result.set(code, new Series(init, step, size, count, rows));
  }
  requireCondition(offset === values.length, 'INVALID_RESPONSE', 'Unexpected coefficient bytes');
  return result;
}
interface Manifest { version: number; model: string; start:string; end:string; years: Record<string, {sha256: string; decodedBytes: number; bytes: number}> }
export class Coefficients {
  readonly packs = new Map<number, Map<number, Series>>();
  readonly hashes = new Map<number, string>();
  private readonly identities = new Map<number, string>();
  bytesLoaded = 0;
  private terminalEndpoint = NaN;
  readonly read:LoadBytes;readonly base:URL;
  constructor(read: LoadBytes = loadBytes, base = new URL('../../../assets/computation/quick/', import.meta.url)) {
    this.read=read;this.base=base;
  }
  async prepare(start: number, end: number, signal?: AbortSignal) {
    this.terminalEndpoint=NaN;
    const raw = await this.read(new URL('manifest.json', this.base), signal);
    const m = JSON.parse(new TextDecoder().decode(raw)) as Manifest;
    requireCondition(m.version === 1 && m.model === MODEL && m.years, 'INVALID_RESPONSE', 'Wrong ephemeris manifest');
    const range=coefficientRange(m);
    requireCondition(Number.isFinite(start)&&Number.isFinite(end)&&start>=range.start&&start<range.end&&
      end>=start&&end<=range.end, 'UNSUPPORTED', ESTIMATE_UNAVAILABLE);
    const first = new Date(start).getUTCFullYear(), last = end===range.end ? range.lastYear : new Date(end).getUTCFullYear();
    for (let year = first; year <= last; year++) {
      const info = m.years[year];
      requireCondition(info && /^[a-f0-9]{64}$/.test(info.sha256) && Number.isSafeInteger(info.bytes) && info.bytes>0 &&
        Number.isSafeInteger(info.decodedBytes) && info.decodedBytes>0 && info.decodedBytes%8===0,
        'INVALID_RESPONSE', 'Invalid coefficient metadata');
      const identity=`${info.sha256}:${info.bytes}:${info.decodedBytes}`;
      if (this.packs.has(year) && this.identities.get(year)===identity) continue;
      const packed = await this.read(new URL(`${year}.bin.gz`, this.base), signal);
      requireCondition(packed.byteLength===info.bytes, 'INVALID_RESPONSE', 'Coefficient size mismatch');
      const bytes = await gunzip(packed); throwIfAborted(signal);
      requireCondition(bytes.byteLength === info.decodedBytes && await sha256(bytes) === info.sha256,
        'INVALID_RESPONSE', 'Coefficient checksum mismatch');
      this.bytesLoaded += packed.byteLength;
      this.packs.set(year, decodePack(bytes)); this.hashes.set(year, info.sha256); this.identities.set(year,identity);
    }
    for (const year of this.packs.keys()) if (year < first || year > last) {
      this.packs.delete(year); this.hashes.delete(year); this.identities.delete(year);
    }
    throwIfAborted(signal);
    this.terminalEndpoint=end===range.end ? end : NaN;
  }
  packAt(ms:number) {
    // Only the exact terminal integration endpoint uses the final pack's generated padding.
    // No selected date or missing year may substitute a neighbouring pack.
    const year=new Date(ms===this.terminalEndpoint ? ms-1 : ms).getUTCFullYear();
    const pack=this.packs.get(year);
    requireCondition(pack, 'UNSUPPORTED', ESTIMATE_UNAVAILABLE);
    return pack;
  }
}

// NAIF naif0012.tls: TAI-UTC from 1972, TT=TAI+32.184; future leap seconds unknown.
const leaps = ['1972-01','1972-07','1973-01','1974-01','1975-01','1976-01','1977-01','1978-01','1979-01','1980-01',
  '1981-07','1982-07','1983-07','1985-07','1988-01','1990-01','1991-01','1992-07','1993-07','1994-07',
  '1996-01','1997-07','1999-01','2006-01','2009-01','2012-07','2015-07','2017-01'].map(s => Date.parse(`${s}-01T00:00:00Z`));
// USNO tai-utc.dat: pre-leap UTC uses offset + (MJD - reference) * seconds/day.
const drift = [
  [37300,1.422818,37300,.001296], [37512,1.372818,37300,.001296],
  [37665,1.845858,37665,.0011232], [38334,1.945858,37665,.0011232],
  [38395,3.240130,38761,.001296], [38486,3.340130,38761,.001296],
  [38639,3.440130,38761,.001296], [38761,3.540130,38761,.001296],
  [38820,3.640130,38761,.001296], [38942,3.740130,38761,.001296],
  [39004,3.840130,38761,.001296], [39126,4.313170,39126,.002592],
  [39887,4.213170,39126,.002592],
];
export function ttMinusUtc(ms: number): number {
  if (ms < leaps[0]) {
    const mjd = ms / 86400000 + 40587;
    const segment = drift.findLast(row => mjd >= row[0]);
    requireCondition(segment, 'UNSUPPORTED', ESTIMATE_UNAVAILABLE);
    return 32.184 + segment[1] + (mjd - segment[2]) * segment[3];
  }
  let tai = 10;
  for (let i = 1; i < leaps.length && ms >= leaps[i]; i++) tai = 10+i;
  return tai + 32.184;
}
export function utcToEt(ms: number): number {
  const tt = (ms - Date.UTC(2000,0,1,12))/1000 + ttMinusUtc(ms);
  let et = tt;
  for (let i = 0; i < 3; i++) { const m = 6.239996 + 1.99096871e-7*et; et = tt + .001657*Math.sin(m+.01671*Math.sin(m)); }
  return et;
}
