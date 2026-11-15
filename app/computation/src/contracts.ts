/** Scientific contracts v1. See SCIENCE.md before connecting a map or DEM. */
export interface LunarSite {
  id: string;
  latitudeDeg: number;
  longitudeEastDeg: number;
  surfaceElevationM: number;
  observerHeightM: number;
  referenceFrame: string;
  elevationDatum: string;
}
export type DiscVisibility = 'center' | 'any-disc' | 'full-disc';
export interface AnalysisModel {
  horizon: 'reference' | 'terrain';
  sunVisibility: DiscVisibility;
  earthVisibility: DiscVisibility;
  minimumEarthElevationDeg: number;
  eventToleranceSeconds: number;
}
export interface AnalysisRequest {
  site: LunarSite;
  startUtc: string;
  durationDays: number;
  model: AnalysisModel;
}
export type Vector3 = readonly [number, number, number];
export type Frame = 'ICRF' | 'MOON_ME_DE421' | 'ITRF93' | 'LOCAL_ENU' | 'LOCAL_EUN_RENDER';
export interface Direction {
  components: Vector3;
  frame: Frame;
  from: string;
  toward: string;
  correction: 'geometric' | 'horizons-airless-apparent';
  instantUtc: string;
}
/** Row-major active rotation: destination column vector = matrix * source column vector. */
export interface Rotation {
  fromFrame: string;
  toFrame: string;
  matrix: readonly [number, number, number, number, number, number, number, number, number];
  instantUtc: string;
  model: string;
}
export type Capability<T> = { status: 'available'; value: T } | { status: 'unsupported'; reason: string };
export interface BodyObservation {
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
  angularDiameterDeg: number;
}
export interface Provenance {
  source: string;
  model: string;
  retrievedAtUtc: string;
  warnings: string[];
  records: SourceRecord[];
}
export interface SourceRecord {
  parameters: Readonly<Record<string, string>>;
  endpoint: string;
  retrievedAtUtc: string;
  apiVersion: string;
  source: string;
  /** Exact JSON response text, including headers, table and column definitions. */
  rawResponse: string;
  header: string;
}
export interface ObserverSnapshot {
  site: LunarSite;
  instantUtc: string;
  directionKind: 'apparent';
  bodies: { sun: BodyObservation; earth: BodyObservation };
  provenance: Provenance;
  interpolated: false;
  capabilities: {
    geometricSunlightLocal: Capability<Direction>;
    moonRelativeSun: Capability<Direction>;
    moonRelativeEarth: Capability<Direction>;
    earthBodyToLocal: Capability<Rotation>;
    earthIlluminationBody: Capability<Direction>;
    starCatalogToLocal: Capability<Rotation>;
    eclipses: 'unsupported';
  };
}
export interface ObserveRequest { site: LunarSite; instantUtc: string; signal?: AbortSignal }
export interface EphemerisProvider {
  observe(request: ObserveRequest): Promise<ObserverSnapshot>;
}
export interface TimeInterval {
  startUtc: string; endUtc: string; startClipped: boolean; endClipped: boolean;
}
/** Fractions use the entire requested window, including unknown time. */
export interface AvailabilitySummary {
  availableSeconds: number; unavailableSeconds: number; unknownSeconds: number;
  availableFractionOfWindow: number;
  longestAvailableSeconds: number; longestUnavailableSeconds: number;
  intervals: TimeInterval[];
}
/** Future terrain interface; no terrain visibility implementation in stages 1–2. */
export interface TerrainProvider {
  sampleElevation(request: { site: LunarSite; signal?: AbortSignal }): Promise<{
    elevationM: number | null; dataset: string; projection: string;
    referenceFrame: string; elevationDatum: string; resolutionM: number;
    coverage: 'complete' | 'partial' | 'none';
  }>;
}
export interface Cache<T> { get(key: string): T | undefined; set(key: string, value: T): void }
