import { sameLongitude, parseUtc } from '../computation/dist/core.js';

const rad = Math.PI / 180;
/** "89.44° S, 137.17° W": the way coordinates read everywhere in Tanaw. */
export function formatLatLon(latitudeDeg, longitudeEastDeg) {
  const lon = ((longitudeEastDeg + 540) % 360) - 180;
  return `${Math.abs(latitudeDeg).toFixed(2)}° ${latitudeDeg < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? 'W' : 'E'}`;
}

export function direction(azimuthDeg, elevationDeg) {
  const a = azimuthDeg * rad, e = elevationDeg * rad;
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
}
export function validateSnapshot(value) {
  const s = structuredClone(value);
  const number = (v, min, max, name) => {
    if (!Number.isFinite(v) || v < min || v > max) throw new TypeError(`Invalid ${name}`);
  };
  const text = (v, name) => { if (typeof v !== 'string' || !v.trim()) throw new TypeError(`Missing ${name}`); };
  if (!s?.site || !s.bodies || !s.provenance) throw new TypeError('Incomplete observer snapshot');
  for (const key of ['id', 'referenceFrame', 'elevationDatum']) text(s.site[key], key);
  number(s.site.latitudeDeg, -90, 90, 'latitude');
  number(s.site.longitudeEastDeg, -180, 180, 'longitude');
  number(s.site.surfaceElevationM, -Infinity, Infinity, 'surface elevation');
  number(s.site.observerHeightM, 0, 100000, 'observer height');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s.instantUtc) || !Number.isFinite(Date.parse(s.instantUtc))) throw new TypeError('Expected UTC timestamp with Z suffix');
  if (!['apparent', 'geometric'].includes(s.directionKind)) throw new TypeError('Expected directionKind');
  for (const name of ['sun', 'earth']) {
    const b = s.bodies[name];
    if (!b) throw new TypeError(`Missing ${name}`);
    number(b.azimuthDeg, 0, 360 - Number.EPSILON * 360, 'azimuth');
    number(b.elevationDeg, -90, 90, 'elevation');
    number(b.rangeKm, Number.MIN_VALUE, Infinity, 'range');
    number(b.angularDiameterDeg, Number.MIN_VALUE, 179, 'angular diameter');
    if (b.centerVisible !== undefined && typeof b.centerVisible !== 'boolean') throw new TypeError('Invalid saved center visibility');
  }
  text(s.provenance.source, 'source'); text(s.provenance.model, 'model');
  if (s.lighting) {
    const v = s.lighting.sunDirectionLocal;
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite) || Math.abs(Math.hypot(...v) - 1) > 1e-6) throw new TypeError('Geometric Sun direction must be a unit vector in local east/up/south axes');
  }
  const unit=(v,length)=>Array.isArray(v)&&v.length===length&&v.every(Number.isFinite)&&Math.abs(Math.hypot(...v)-1)<1e-6;
  if(s.earthAppearance && (!unit(s.earthAppearance.bodyToLocal,4) || !unit(s.earthAppearance.sunDirectionBody,3) || s.earthAppearance.bodyFrame!=='earth-fixed-x0-yNorth-zWest'))throw new TypeError('Invalid Earth orientation/illumination frame');
  if(s.sky && (!unit(s.sky.catalogToLocal,4) || typeof s.sky.catalogFrame!=='string'))throw new TypeError('Invalid sky rotation');
  if(s.overview){const o=s.overview;if(o.axisConvention!=='x0-yNorth-zWest'||!Number.isFinite(o.moonRadiusM)||o.moonRadiusM<=0||!unit(o.moonToLocal,4)||!['siteDirectionMoon','sunDirectionMoon','earthDirectionMoon'].every(key=>unit(o[key],3)))throw new TypeError('Invalid Moon-frame overview inputs');}
  return s;
}

/** Host adapter: generation guard also covers providers that ignore AbortSignal. */
export function createSnapshotLoader({ computationProvider, observer, onStatusChange = () => {}, onError = () => {} }) {
  let generation = 0, controller, disposed = false;
  return {
    async load(site, instantUtc) {
      if (disposed) return false;
      const request = structuredClone({ site, instantUtc });
      const current = ++generation;
      controller?.abort(); controller = new AbortController();
      onStatusChange('loading');
      try {
        const snapshot = validateSnapshot(await computationProvider.observe({ ...request, signal: controller.signal }));
        if (disposed || current !== generation) return false;
        if (parseUtc(snapshot.instantUtc) !== parseUtc(request.instantUtc) || Object.keys(request.site).some(key =>
          request.site[key] !== undefined && (key === 'longitudeEastDeg'
            ? !sameLongitude(snapshot.site[key], request.site[key])
            : snapshot.site[key] !== request.site[key]))) throw new Error('Computation returned a different site or instant');
        if (observer.setSnapshot(snapshot) === false) throw new Error('Observer rejected snapshot');
        onStatusChange('ready'); return true;
      } catch (error) {
        if (disposed || current !== generation) return false;
        onStatusChange('error'); onError(error); return false;
      }
    },
    dispose() { disposed = true; ++generation; controller?.abort(); }
  };
}
