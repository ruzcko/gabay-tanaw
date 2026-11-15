import { Coefficients, utcToEt } from './coefficients.ts';

/**
 * Earth's heliocentric and the Moon's geocentric ecliptic coordinates for any UTC instant the
 * quick-estimate coefficients cover: the estimate counterpart of data/orbit/ (science/make_orbit.py).
 * Geometric (no light time or aberration), ecliptic and mean equinox of J2000, UTC tags.
 */
export interface QuickOrbit {
  utc: string;
  earthHelioLonDeg: number;
  moonGeoLonDeg: number;
  moonGeoLatDeg: number;
  quality: 'estimate';
}

const DEG = 180 / Math.PI;
// Mean obliquity of J2000 (84381.448"), the "Ecliptic of J2000.0" Horizons uses for data/orbit/.
const EPS = 84381.448 / 3600 / DEG, COS = Math.cos(EPS), SIN = Math.sin(EPS);

/** Ecliptic longitude and latitude (degrees) of an ICRF equatorial vector. */
function ecliptic(x: number, y: number, z: number): [number, number] {
  const ye = COS * y + SIN * z, ze = -SIN * y + COS * z;
  return [((Math.atan2(ye, x) * DEG) % 360 + 360) % 360, Math.atan2(ze, Math.hypot(x, ye)) * DEG];
}

/** Orbit geometry at each instant (UTC milliseconds), sharing one coefficient load per call. */
export async function quickOrbit(utcMs: readonly number[], options: { coefficients?: Coefficients; signal?: AbortSignal } = {}): Promise<QuickOrbit[]> {
  if (!utcMs.length) return [];
  const coefficients = options.coefficients ?? new Coefficients();
  await coefficients.prepare(Math.min(...utcMs), Math.max(...utcMs), options.signal);
  const sun = new Float64Array(6), emb = new Float64Array(6), earth = new Float64Array(6), moon = new Float64Array(6);
  return utcMs.map((ms) => {
    const pack = coefficients.packAt(ms), et = utcToEt(ms);
    pack.get(10)!.evaluate(et, sun); pack.get(3)!.evaluate(et, emb);
    pack.get(399)!.evaluate(et, earth); pack.get(301)!.evaluate(et, moon); // both relative to the EMB
    const [earthHelioLonDeg] = ecliptic(emb[0] + earth[0] - sun[0], emb[1] + earth[1] - sun[1], emb[2] + earth[2] - sun[2]);
    const [moonGeoLonDeg, moonGeoLatDeg] = ecliptic(moon[0] - earth[0], moon[1] - earth[1], moon[2] - earth[2]);
    return { utc: new Date(ms).toISOString(), earthHelioLonDeg, moonGeoLonDeg, moonGeoLatDeg, quality: 'estimate' };
  });
}
