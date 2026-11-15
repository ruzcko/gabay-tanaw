// Far ground for the site view (site.js): the Moon's surface from the edge of the detailed disc
// out past the horizon, so the ground runs on and curves away instead of ending. Display only:
// shipped LOLA heights (assets/observer/terrain), sampled onto rings around the site and placed
// on the sphere in the site's local frame (km: +X east, +Y up, +Z south, the site's ground at the
// origin, like the detailed tile). Nearer than BLEND_KM the 240 m south-polar grid
// (LDEM_60S_240M) south of 60°S, elsewhere the 16 pixels-per-degree global grid; further out the
// 4 pixels-per-degree global grid, with a linear blend between.
const R = 1737.4; // km, the terrain's sphere datum
const POLAR = { dir: 'polar240', centre: 3879.5, spacingM: 240, tile: 512, tiles: 15 };
const GLOBAL = { dir: '4', ppd: 4, tile: 40 }; // 10 degrees a tile; metres = value / 2 - 10000
const GLOBAL16 = { dir: '16', ppd: 16, tile: 160 }; // the same, finer
export const FAR = { innerKm: 8, outerKm: 500, rings: 112, around: 256 };
const BLEND_KM = [45, 60];

const base = new URL('./assets/observer/terrain/', import.meta.url);
const cache = new Map(); // tile path → Promise of samples
function tileAt(path, kind) {
  if (!cache.has(path)) {
    const p = fetch(new URL(`${path}.bin.gz`, base))
      .then((res) => {
        if (!res.ok) throw new Error(`${path}: ${res.status}`);
        return new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      })
      .then((buf) => (kind === 'polar' ? new Int16Array(buf) : new Uint16Array(buf)));
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path);
}

// Unit vector of the point at local orthographic (x, z) km, as the observer's terrain worker
// frames it (x0-yNorth-zWest), and its latitude and east longitude in degrees.
function frame(latDeg, lonDeg) {
  const lat = latDeg * Math.PI / 180, lon = lonDeg * Math.PI / 180;
  return {
    up: [Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon)],
    east: [-Math.sin(lon), 0, -Math.cos(lon)],
    south: [Math.sin(lat) * Math.cos(lon), -Math.cos(lat), -Math.sin(lat) * Math.sin(lon)],
  };
}

// Pixel positions in each grid for a latitude and east longitude (degrees).
function polarXY(lat, lon) {
  const rho = 2 * R * 1000 * Math.tan(Math.PI / 4 + lat * Math.PI / 360), l = lon * Math.PI / 180;
  return [POLAR.centre + rho * Math.sin(l) / POLAR.spacingM, POLAR.centre - rho * Math.cos(l) / POLAR.spacingM];
}
function globalXY(G, lat, lon) {
  return [(((lon + 180) % 360) + 360) % 360 * G.ppd - 0.5, Math.max(0, Math.min(180 * G.ppd - 1, (90 - lat) * G.ppd - 0.5))];
}
const polarKey = (x, y) => `${POLAR.dir}/${Math.floor(y / POLAR.tile)}-${Math.floor(x / POLAR.tile)}`;
const globalKey = (G, x, y) => {
  const w = 360 * G.ppd;
  y = Math.max(0, Math.min(180 * G.ppd - 1, y));
  return `${G.dir}/${Math.floor(y / G.tile)}-${Math.floor((((x % w) + w) % w) / G.tile)}`;
};

// Bilinear height in metres from loaded tiles; null where a tile is missing.
function polarHeight(tiles, x, y) {
  const c = Math.floor(x), r = Math.floor(y), fx = x - c, fy = y - r;
  const at = (col, row) => {
    const t = tiles.get(polarKey(col, row));
    return t ? t[(row % POLAR.tile) * POLAR.tile + (col % POLAR.tile)] * 0.5 : null;
  };
  const a = at(c, r), b = at(c + 1, r), d = at(c, r + 1), e = at(c + 1, r + 1);
  if ([a, b, d, e].some((v) => v === null)) return null;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
}
function globalHeight(G, tiles, x, y) {
  const w = 360 * G.ppd, h = 180 * G.ppd;
  const c = Math.floor(x), r = Math.floor(y), fx = x - c, fy = y - r;
  const at = (col, row) => {
    col = ((col % w) + w) % w; row = Math.max(0, Math.min(h - 1, row));
    const t = tiles.get(globalKey(G, col, row));
    return t ? t[(row % G.tile) * G.tile + (col % G.tile)] * 0.5 - 10000 : null;
  };
  const a = at(c, r), b = at(c + 1, r), d = at(c, r + 1), e = at(c + 1, r + 1);
  if ([a, b, d, e].some((v) => v === null)) return null;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
}

// The rings: radii from innerKm to outerKm, closer together near the disc. Each vertex is
// [x, relief, z] (relief: exaggerated height above the site's ground, km) with its curve, the
// sphere's drop below the site's level (km), kept apart so the lift can scale relief alone.
export async function buildFarGround(site, groundM, exaggeration, signal) {
  const { up, east, south } = frame(site.lat, site.lon > 180 ? site.lon - 360 : site.lon);
  const { innerKm, outerKm, rings, around } = FAR;
  const radii = Array.from({ length: rings }, (_, i) => innerKm * Math.pow(outerKm / innerKm, i / (rings - 1)));
  const points = [];
  for (const d of radii) {
    const theta = d / R, s = Math.sin(theta), c = Math.cos(theta);
    for (let k = 0; k < around; k++) {
      const az = (k / around) * 2 * Math.PI; // clockwise from north
      const x = R * s * Math.sin(az), z = -R * s * Math.cos(az), y = R * c;
      const v = [0, 1, 2].map((i) => (up[i] * y + east[i] * x + south[i] * z) / R);
      const lat = Math.asin(Math.max(-1, Math.min(1, v[1]))) * 180 / Math.PI, lon = Math.atan2(-v[2], v[0]) * 180 / Math.PI;
      points.push({ d, s, c, az, lat, lon });
    }
  }
  // The tiles these points need, loaded together.
  const need = new Map();
  for (const p of points) {
    if (p.d <= BLEND_KM[1] + 2 && p.lat > -60) {
      const [x, y] = globalXY(GLOBAL16, p.lat, p.lon);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) need.set(globalKey(GLOBAL16, Math.floor(x) + dx, Math.floor(y) + dy), 'global');
    }
    if (p.d <= BLEND_KM[1] + 2 && p.lat <= -60) {
      const [x, y] = polarXY(p.lat, p.lon);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) need.set(polarKey(Math.floor(x) + dx, Math.floor(y) + dy), 'polar');
    }
    if (p.d >= BLEND_KM[0] - 2) {
      const [x, y] = globalXY(GLOBAL, p.lat, p.lon);
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) need.set(globalKey(GLOBAL, Math.floor(x) + dx, Math.floor(y) + dy), 'global');
    }
  }
  const tiles = new Map();
  await Promise.all([...need].map(([path, kind]) => tileAt(path, kind).then((t) => tiles.set(path, t), () => {})));
  if (signal?.aborted) return null;

  const position = new Float32Array(points.length * 3), curve = new Float32Array(points.length);
  // Each vertex's latitude and east longitude (radians), where the map layers sample it.
  const latLon = new Float32Array(points.length * 2);
  let last = 0;
  points.forEach((p, i) => {
    const near = p.d > BLEND_KM[1] ? null : p.lat <= -60 ? polarHeight(tiles, ...polarXY(p.lat, p.lon))
      : globalHeight(GLOBAL16, tiles, ...globalXY(GLOBAL16, p.lat, p.lon));
    const far = globalHeight(GLOBAL, tiles, ...globalXY(GLOBAL, p.lat, p.lon));
    const t = Math.min(1, Math.max(0, (p.d - BLEND_KM[0]) / (BLEND_KM[1] - BLEND_KM[0])));
    let m = near === null ? far : far === null || t === 0 ? near : near * (1 - t) + far * t;
    if (m === null) m = last; // a tile that failed: the last height, so the ground stays whole
    last = m;
    const relief = ((m - groundM) * exaggeration) / 1000;
    // On the sphere through the site's ground, then the relief along the local vertical.
    const rr = R + groundM / 1000;
    position[i * 3] = rr * p.s * Math.sin(p.az);
    position[i * 3 + 1] = relief * p.c;
    position[i * 3 + 2] = -rr * p.s * Math.cos(p.az);
    curve[i] = rr * p.c - rr;
    latLon[i * 2] = p.lat * Math.PI / 180;
    latLon[i * 2 + 1] = p.lon * Math.PI / 180;
  });
  const index = [];
  for (let r = 0; r < rings - 1; r++) for (let k = 0; k < around; k++) {
    const a = r * around + k, b = r * around + ((k + 1) % around), c = a + around, d = b + around;
    index.push(a, b, c, b, d, c); // counter-clockwise from above
  }
  return { position, curve, latLon, index: new Uint32Array(index) };
}
