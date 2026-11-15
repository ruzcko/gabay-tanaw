import type { AnalysisModel, LunarSite, Vector3 } from './contracts.ts';
import { QUICK_RANGE, ESTIMATE_UNAVAILABLE } from './quick/coverage.ts';

export const LUNAR_FRAME = 'MOON_ME_DE421';
export const ELEVATION_DATUM = 'sphere-1737400m';
export const MOON_RADIUS_M = 1737400;
export type ErrorCode = 'INVALID_INPUT' | 'INCOMPATIBLE_FRAME' | 'UNSUPPORTED' | 'ABORTED' | 'STALE' | 'TIMEOUT' | 'UPSTREAM' | 'INVALID_RESPONSE' | 'LIMIT_EXCEEDED';
export class ComputationError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message); this.name = 'ComputationError'; this.code = code; this.details = details;
  }
}
export function requireCondition(value: unknown, code: ErrorCode, message: string): asserts value {
  if (!value) throw new ComputationError(code, message);
}
export function normalizeLongitude(deg: number): number {
  requireCondition(Number.isFinite(deg), 'INVALID_INPUT', 'Longitude must be finite');
  return ((deg % 360) + 360) % 360;
}
/** Equality across longitude wraps, allowing only floating-point arithmetic roundoff. */
export function sameLongitude(a: number, b: number): boolean {
  const delta = Math.abs(normalizeLongitude(a) - normalizeLongitude(b));
  return Math.min(delta, 360 - delta) <= 4 * Number.EPSILON * 360;
}
export function validateSite(site: LunarSite): LunarSite {
  requireCondition(site && typeof site.id === 'string' && site.id.trim(), 'INVALID_INPUT', 'Site ID is required');
  requireCondition(site.referenceFrame === LUNAR_FRAME && site.elevationDatum === ELEVATION_DATUM,
    'INCOMPATIBLE_FRAME', 'Requires MOON_ME_DE421 and sphere-1737400m; no implicit datum/frame conversion');
  requireCondition(Number.isFinite(site.latitudeDeg) && Math.abs(site.latitudeDeg) <= 90, 'INVALID_INPUT', 'Invalid latitude');
  requireCondition(Math.abs(site.latitudeDeg) !== 90, 'UNSUPPORTED', 'Exact polar azimuth is unsupported; choose a nonpolar site');
  requireCondition(Number.isFinite(site.surfaceElevationM) && Math.abs(site.surfaceElevationM) <= 20000,
    'INVALID_INPUT', 'Surface elevation must be within ±20000 m');
  requireCondition(Number.isFinite(site.observerHeightM) && site.observerHeightM >= 0 && site.observerHeightM <= 100000,
    'INVALID_INPUT', 'Observer height must be 0–100000 m above ground');
  return { ...site, longitudeEastDeg: normalizeLongitude(site.longitudeEastDeg) };
}
export function observerAltitudeKm(site: LunarSite): number {
  const s = validateSite(site); return (s.surfaceElevationM + s.observerHeightM) / 1000;
}
/** Strict Gregorian UTC within the shipped manifest; leap-second labels unsupported. */
export function parseUtc(utc: string, allowEnd = false): number {
  requireCondition(typeof utc === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(utc), 'INVALID_INPUT', 'Use ISO UTC with seconds and Z');
  const ms = Date.parse(utc);
  const canonical = utc.includes('.') ? utc.replace(/\.(\d+)Z$/, (_, s: string) => `.${s.padEnd(3, '0')}Z`) : utc.replace('Z', '.000Z');
  requireCondition(Number.isFinite(ms) && new Date(ms).toISOString() === canonical, 'INVALID_INPUT', 'Invalid calendar date or leap-second label');
  requireCondition(ms >= QUICK_RANGE.start && (ms < QUICK_RANGE.end || allowEnd && ms === QUICK_RANGE.end),
    'UNSUPPORTED', ESTIMATE_UNAVAILABLE);
  return ms;
}
export function julianDayUtc(utc: string): number { return parseUtc(utc) / 86400000 + 2440587.5; }
export function validateWindow(startUtc: string, durationDays = 7, maximumDays = 100) {
  const startMs = parseUtc(startUtc);
  requireCondition(Number.isFinite(maximumDays) && maximumDays > 0 && Number.isFinite(durationDays) && durationDays > 0 && durationDays <= maximumDays,
    'LIMIT_EXCEEDED', `Duration must be >0 and <=${maximumDays} days`);
  const endMs = startMs + durationDays * 86400000;
  // Generic series expose the endpoint as an observation. Only explicit integration
  // callers may use parseUtc(..., true) at the manifest's exclusive end.
  requireCondition(Number.isFinite(endMs) && endMs - startMs >= 1 && endMs < QUICK_RANGE.end,
    'UNSUPPORTED', ESTIMATE_UNAVAILABLE);
  const endUtc = new Date(endMs).toISOString(); parseUtc(endUtc);
  return { startUtc: new Date(startMs).toISOString(), endUtc, durationDays };
}
export function validateModel(model: AnalysisModel): AnalysisModel {
  requireCondition(model && ['reference', 'terrain'].includes(model.horizon) &&
    ['center', 'any-disc', 'full-disc'].includes(model.sunVisibility) &&
    ['center', 'any-disc', 'full-disc'].includes(model.earthVisibility) &&
    Number.isFinite(model.minimumEarthElevationDeg) && Math.abs(model.minimumEarthElevationDeg) <= 90 &&
    Number.isFinite(model.eventToleranceSeconds) && model.eventToleranceSeconds > 0,
    'INVALID_INPUT', 'Invalid analysis model');
  return { ...model };
}
/** Right-handed Moon XYZ: X at lon 0, Y at 90 E, Z north. Rows are east,north,up. */
export function localEnuBasis(site: LunarSite): readonly [Vector3, Vector3, Vector3] {
  const s = validateSite(site), p = s.latitudeDeg * Math.PI / 180, l = s.longitudeEastDeg * Math.PI / 180;
  return [[-Math.sin(l), Math.cos(l), 0], [-Math.sin(p)*Math.cos(l), -Math.sin(p)*Math.sin(l), Math.cos(p)],
    [Math.cos(p)*Math.cos(l), Math.cos(p)*Math.sin(l), Math.sin(p)]];
}
export function azElToEnu(azimuthDeg: number, elevationDeg: number): Vector3 {
  requireCondition(Number.isFinite(azimuthDeg) && Number.isFinite(elevationDeg) && Math.abs(elevationDeg) <= 90, 'INVALID_INPUT', 'Invalid direction');
  const a = azimuthDeg * Math.PI / 180, e = elevationDeg * Math.PI / 180;
  return [Math.cos(e)*Math.sin(a), Math.cos(e)*Math.cos(a), Math.sin(e)];
}
/** Renderer +X east,+Y up,-Z north, also right-handed. */
export function enuToRenderer([e,n,u]: Vector3): Vector3 { return [e,u,-n]; }
export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ComputationError('ABORTED', 'Request cancelled');
}
