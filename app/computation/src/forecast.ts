/** Static forecast contract. Python owns visibility; never recompute it from rounded angles. */
import { parseUtc, requireCondition } from './core.ts';

export interface ForecastMonth {
  start: string;
  stepMinutes: 60;
  sunAz: number[]; sunEl: number[]; earthAz: number[]; earthEl: number[];
  sunRangeKm: number[]; earthRangeKm: number[];
  sunAngularDiameterDeg: number[]; earthAngularDiameterDeg: number[];
  sunVisible: number[]; earthVisible: number[];
}
const fields = ['sunAz', 'sunEl', 'earthAz', 'earthEl', 'sunRangeKm', 'earthRangeKm',
  'sunAngularDiameterDeg', 'earthAngularDiameterDeg', 'sunVisible', 'earthVisible'] as const;
const hour = 3600000;

/** A month may be clipped by the forecast window. The end instant is exclusive. */
export function validateForecastMonth(value: unknown, startUtc: string, endUtc: string): ForecastMonth {
  const start = parseUtc(startUtc), end = parseUtc(endUtc,true), count = (end-start)/hour;
  requireCondition(start % hour === 0 && count > 0 && Number.isInteger(count) && count <= 31*24,
    'INVALID_INPUT', 'Invalid monthly interval');
  requireCondition(value !== null && typeof value === 'object', 'INVALID_RESPONSE', 'Missing forecast month');
  const m = value as ForecastMonth;
  requireCondition(m.start === startUtc && m.stepMinutes === 60, 'INVALID_RESPONSE', 'Wrong monthly origin/cadence');
  for (const field of fields) {
    const xs = m[field];
    requireCondition(Array.isArray(xs) && xs.length === count, 'INVALID_RESPONSE', `Incomplete ${field}`);
    requireCondition(xs.every(x => typeof x === 'number' && Number.isFinite(x) &&
      (field.endsWith('Visible') ? x === 0 || x === 1 :
        field.endsWith('Az') ? x >= 0 && x <= 360 : // 359.999 rounds to 360 in legacy files
        field.endsWith('El') ? Math.abs(x) <= 90 :
        field.endsWith('DiameterDeg') ? x > 0 && x < 180 : x > 0)),
    'INVALID_RESPONSE', `Invalid ${field}`);
  }
  return m;
}

/** Exact saved hours only. Unknown or unsupported times never become a "down" sample. */
export function readForecastHour(month: ForecastMonth, instantUtc: string) {
  const k = (parseUtc(instantUtc) - parseUtc(month.start))/hour;
  requireCondition(Number.isInteger(k) && k >= 0 && k < month.sunAz.length,
    'UNSUPPORTED', 'Only saved hourly timestamps within this month are available');
  const body = (name: 'sun' | 'earth') => ({
    azimuthDeg: month[`${name}Az`][k] % 360,
    elevationDeg: month[`${name}El`][k], rangeKm: month[`${name}RangeKm`][k],
    angularDiameterDeg: month[`${name}AngularDiameterDeg`][k],
    centerVisible: month[`${name}Visible`][k] === 1,
  });
  return { instantUtc, sun: body('sun'), earth: body('earth') };
}
