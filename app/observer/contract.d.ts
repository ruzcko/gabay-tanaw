/** Shared input contract for both presentations. */
export type BodyName = 'sun' | 'earth';
export type Vector3 = readonly [number, number, number];
/** Quaternion ordering x,y,z,w; active rotation, unit length. */
export type Quaternion = readonly [number, number, number, number];
export interface LunarSite {
  terrainModel?: string;
  id: string;
  name?: string;
  latitudeDeg: number;
  longitudeEastDeg: number;
  surfaceElevationM: number;
  observerHeightM: number;
  referenceFrame: string;
  elevationDatum: string;
}
export interface BodyObservation {
  /** Clockwise from north, [0,360). */
  azimuthDeg: number;
  /** Above the local reference horizon, [-90,90]. */
  elevationDeg: number;
  rangeKm: number;
  angularDiameterDeg: number;
  /** Computed terrain-center visibility; never inferred from rendered terrain. */
  centerVisible?: boolean;
}
export interface ObserverSnapshot {
  quality?: 'estimate' | 'accurate';
  site: LunarSite;
  /** ISO 8601 UTC with Z suffix. All fields describe this same instant/site. */
  instantUtc: string;
  directionKind: 'apparent' | 'geometric';
  bodies: Record<BodyName, BodyObservation>;
  provenance: { source: string; model: string; warnings?: readonly string[];
    forecast?: import('../computation/src/static-forecast').StaticForecastSnapshot['provenance']['forecast'] };
  interpolated?: boolean;
  capabilities?: import('../computation/src/contracts').ObserverSnapshot['capabilities'];
  /** Stage 2: separate geometric illumination, even with apparent observations. */
  lighting?: { sunDirectionLocal: Vector3 };
  earthAppearance?: {
    /** Earth texture/body frame to local rendering axes; never camera-derived. */
    bodyToLocal: Quaternion;
    /** Geometric direction from Earth toward Sun, in Earth body axes. */
    sunDirectionBody: Vector3;
    bodyFrame: string;
  };
  sky?: { catalogFrame: string; catalogToLocal: Quaternion };
  /** Stage 3: same lunar frame and explicit axis convention as site. */
  overview?: {
    axisConvention: 'x0-yNorth-zWest';
    moonRadiusM: number;
    siteDirectionMoon: Vector3;
    sunDirectionMoon: Vector3;
    earthDirectionMoon: Vector3;
    moonToLocal: Quaternion;
  };
}
export interface ComputationProvider {
  observe(request: { site: LunarSite; instantUtc: string; signal: AbortSignal }): Promise<ObserverSnapshot>;
}
export interface ObserverOptions {
  sunPointer: boolean;
  horizonLine: boolean;
  earthPointer: boolean;
  belowHorizonCutaway: boolean;
  bodySize: 'physical' | 'enhanced';
  quality: 'auto' | 'low' | 'high';
  tracking: BodyName | null;
  verticalExaggeration: number;
  decorativeTwinkling: boolean;
  starBrightness: number;
  autoStarExposure: boolean;
}
export interface ObserverView {
  setSnapshot(snapshot: ObserverSnapshot): boolean | void;
  setMode(mode: 'observer' | 'overview', options?: { focusSite?: boolean }): void;
  lookToward(target: BodyName | 'horizon'): void;
  /** Opening framing: Earth if in view, else the Sun, with the horizon low; else level toward the nearest risen body or Earth. */
  frameOpening(): void;
  setOptions(options: Partial<ObserverOptions>): void;
  resize(): void;
  getDiagnostics(): { mode: 'observer' | 'overview'; observerRenderCount: number; overviewRenderCount: number; siteId?: string; instantUtc?: string; overview: {distance:number; azimuth:number; elevation:number; siteMarkerVisible:boolean} | null; frameCpuMs: number; renderCount: number; geometryBufferBytes: number; assetMemory: { bitmapBytes: number; estimatedTextureBytesWithMipmaps: number } | null; terrain: TerrainStatus; geometries: number; textures: number; drawCalls: number; shadowMapSize: number };
  dispose(): void;
}
export interface ObserverConfig {
  container: HTMLElement;
  onSiteSelect?: (coordinates: {latitudeDeg:number; longitudeEastDeg:number; referenceFrame:string}) => void;
  terrainProvider?: TerrainProvider;
  assetProvider?: AssetProvider;
  onTerrainStatus?: (status: TerrainStatus) => void;
  onAssetStatus?: (status: { state: string; stars?: number; message?: string; earthShading?: string }) => void;
  onError?: (error: Error) => void;
  onStatusChange?: (status: 'waiting' | 'ready' | 'error' | 'disposed') => void;
}
export interface TerrainTile {
  width: number;
  height: number;
  spacingM: number;
  /** Optional monotonic site-centered axis for square, concentrated-detail grids. */
  axisM?: Float32Array;
  elevationsM: Float32Array;
  /** Optional equirectangular imagery UVs, two floats per sample. */
  uv?: Float32Array;
  metadata: {
    projection: 'local-orthographic-east-south';
    latitudeDeg: number;
    longitudeEastDeg: number;
    referenceFrame: string;
    elevationDatum: string;
    radiusM: number;
    noData: number | null;
    source: string;
    license: string;
    sourceResolutionM?: number;
  };
}
export interface TerrainProvider {
  loadTile(request: { site: LunarSite; level: 0 | 1; signal: AbortSignal }): Promise<TerrainTile>;
  sampleGround?(request: { site: LunarSite; signal: AbortSignal }): Promise<number>;
  /** Provider belongs to host, which disposes it after all sharing views are removed. */
  dispose?(): void;
}
export interface TerrainStatus {
  state: string;
  coverage?: number;
  resolutionM?: number;
  meshSpacingM?: number;
  loadMs?: number;
  source?: string;
  message?: string;
  cpuCacheEntries?: number;
}
export interface TextureAsset { url: string; source: string; license: string; shading: 'albedo' | 'albedo-approximation' | 'baked' }
export interface AssetProvider {
  getAssets(request: { signal: AbortSignal }): Promise<{
    earth: TextureAsset;
    terrain: TextureAsset;
    /** Optional existing object-space normal maps, kept in linear/data color space. */
    moonRelief?: {normal: Omit<TextureAsset,'shading'> & {shading:'data'}; polar: Omit<TextureAsset,'shading'> & {shading:'data'}};
    catalog: { frame: string; source: string; license: string; stars: [number, number, number, number][] };
  }>;
}
