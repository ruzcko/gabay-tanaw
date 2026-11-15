// Map layers (the Layers menu, forecast.js): slope, sunlight or permanent shadow, as value
// textures in up to three slots from data/layers/index.json. A global grid (equirectangular, lon
// -180 at the left, north at the top) and a south and a north polar grid (polar stereographic,
// half-width in Moon radii; south lon 0 up, north lon 0 down, east to the right as seen from
// above each pole), each polar grid only within its coverage in degrees from the pole. Values:
// slope band 0-3, sunlight 0-100 (%), shadow 0/1; 255 is no data. The globe (globe.js) and the
// site view's far ground (site.js) sample them the same way; each colours them by token.
import * as THREE from 'three';
import { loadMaxMipTexture } from './layer-mips.js';

export const LAYER_KINDS = { slope: 1, sunlight: 2, shadow: 3 };
export const layerIndex = fetch('data/layers/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);

export const noLayer = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
noLayer.needsUpdate = true;

function texture(url, map, global) {
  // Shadow is a flag: its mips keep any shadow in a texel (layer-mips.js), so small crater floors
  // still show zoomed out. The others: nearest when magnified (bands and flags stay cells;
  // sunlight, a smooth value, linear), mipmapped when zoomed out.
  if (map === 'shadow') return loadMaxMipTexture(url, global);
  return new THREE.TextureLoader().loadAsync(url).then((t) => {
    t.colorSpace = THREE.NoColorSpace;
    t.magFilter = map === 'sunlight' ? THREE.LinearFilter : THREE.NearestFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    if (global) t.wrapS = THREE.RepeatWrapping;
    return t;
  });
}

const slots = new Map(); // layer → Promise of { south, north, global, southHalf, northHalf, southEdge, northEdge }
export function loadLayer(map) {
  if (!slots.has(map)) {
    slots.set(map, layerIndex.then(async (index) => {
      const g = index?.layers?.[map]?.globe;
      if (!g) throw new Error(`No ${map} layer in the index`);
      const out = { southHalf: g.southHalf ?? 0.26329, northHalf: g.northHalf ?? 0.26329, southEdge: g.southEdge ?? 25, northEdge: g.northEdge ?? 25 };
      await Promise.all(['south', 'north', 'global'].filter((k) => g[k]).map((k) =>
        texture(`data/layers/${g[k]}`, map, k === 'global').then((t) => { out[k] = t; })));
      return out;
    }).catch((err) => { slots.delete(map); throw err; }));
  }
  return slots.get(map);
}

// The shaders' uniforms for the slots, and setting them from a loaded layer (or none). Two sets
// can be on at once: the fill (prefix "layer": slope or sunlight) and the shadow outline
// (prefix "shade").
export function layerSlotUniforms(p = 'layer') {
  return {
    [`${p}South`]: { value: noLayer },
    [`${p}North`]: { value: noLayer },
    [`${p}Global`]: { value: noLayer },
    [`${p}Has`]: { value: new THREE.Vector3() }, // south, north, global
    [`${p}Half`]: { value: new THREE.Vector2(0.26329, 0.26329) },
    [`${p}Edge`]: { value: new THREE.Vector2(25, 25) },
    [`${p}Kind`]: { value: 0 },
  };
}
export function setLayerSlots(u, map, t, p = 'layer') {
  u[`${p}South`].value = t?.south ?? noLayer;
  u[`${p}North`].value = t?.north ?? noLayer;
  u[`${p}Global`].value = t?.global ?? noLayer;
  u[`${p}Has`].value.set(t?.south ? 1 : 0, t?.north ? 1 : 0, t?.global ? 1 : 0);
  u[`${p}Half`].value.set(t?.southHalf ?? 0.26329, t?.northHalf ?? 0.26329);
  u[`${p}Edge`].value.set(t?.southEdge ?? 25, t?.northEdge ?? 25);
  u[`${p}Kind`].value = t ? LAYER_KINDS[map] : 0;
}

// GLSL: the uniforms, and <p>Raw(lat, lon) in radians (east longitude): the layer's value at that
// place, 0-255 (255 where no slot has data). Call it in uniform control flow (it takes
// derivatives). <p>Top() is the largest real value; a value above it has mixed with no data.
export const layerGlsl = (p = 'layer') => /* glsl */ `
  uniform sampler2D ${p}South;
  uniform sampler2D ${p}North;
  uniform sampler2D ${p}Global;
  uniform vec3 ${p}Has;
  uniform vec2 ${p}Half;
  uniform vec2 ${p}Edge;
  uniform float ${p}Kind;
  float ${p}Top() { return ${p}Kind < 1.5 ? 3.5 : ${p}Kind < 2.5 ? 100.5 : 1.01; }
  float ${p}Raw(float lat, float lon) {
    const float PI_L = 3.141592653589793;
    float top = ${p}Top(), latDeg = degrees(lat);
    float rs = 2.0 * tan(PI_L / 4.0 + lat / 2.0), rn = 2.0 * tan(PI_L / 4.0 - lat / 2.0);
    vec2 su = 0.5 + vec2(rs * sin(lon), rs * cos(lon)) / (2.0 * ${p}Half.x);
    vec2 nu = 0.5 + vec2(rn * sin(lon), -rn * cos(lon)) / (2.0 * ${p}Half.y);
    vec2 sdx = dFdx(su), sdy = dFdy(su), ndx = dFdx(nu), ndy = dFdy(nu);
    // The global grid, with gradients from whichever longitude wrap has no jump here, the
    // longitude one shrunk by cos(latitude) so the poles don't streak.
    vec2 gu = vec2(lon / (2.0 * PI_L) + 0.5, lat / PI_L + 0.5), gb = vec2(fract(gu.x + 0.5), gu.y);
    vec2 ga = dFdx(gu), gc = dFdy(gu), ba = dFdx(gb), bc = dFdy(gb);
    bool useB = abs(ga.x) + abs(gc.x) > abs(ba.x) + abs(bc.x);
    vec2 gdx = useB ? ba : ga, gdy = useB ? bc : gc;
    float k = max(cos(lat), 0.002);
    gdx.x *= k; gdy.x *= k;
    float raw = 255.0;
    if (${p}Has.z > 0.5) raw = textureGrad(${p}Global, gu, gdx, gdy).r * 255.0;
    if (${p}Has.x > 0.5 && latDeg < -90.0 + ${p}Edge.x && all(greaterThan(su, vec2(0.0))) && all(lessThan(su, vec2(1.0)))) {
      float s = textureGrad(${p}South, su, sdx, sdy).r * 255.0;
      if (s <= top) raw = s;
    }
    if (${p}Has.y > 0.5 && latDeg > 90.0 - ${p}Edge.y && all(greaterThan(nu, vec2(0.0))) && all(lessThan(nu, vec2(1.0)))) {
      float n = textureGrad(${p}North, nu, ndx, ndy).r * 255.0;
      if (n <= top) raw = n;
    }
    return raw;
  }`;
export const LAYER_GLSL = layerGlsl('layer');
