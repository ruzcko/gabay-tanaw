import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { createTravelGlobe } from './travel/globe-layer.js';
import { createCompareGlobe } from './compare/globe-layer.js';
import { configureTravelThumbnails } from './travel/thumbnail.js';
import { LAYER_GLSL, layerGlsl, layerSlotUniforms, setLayerSlots, loadLayer } from './map-layers.js';
import { createMoonSky } from './moon-sky.js';
import { createEarth, createSun, loadEarthMap } from './bodies.js';

const canvas = document.getElementById('moon');
const status = document.getElementById('status');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
// Shader errors are checked during development only (the check blocks on each compile).
renderer.debug.checkShaderErrors = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// While the site view covers the globe, the globe draws only when redraw asks (see the loop).
let redraw = false;

const scene = new THREE.Scene();
const starSky = createMoonSky(scene, () => { redraw = true; });
document.addEventListener('tanaw:star-sky', e => starSky.setSnapshot(e.detail));
window.addEventListener('pagehide', () => starSky.dispose(), { once: true });
const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
camera.position.set(0, 0, 3.6);
const HOME_D = camera.position.length(); // the distance on load, which the View menu returns to

// Trackball rather than orbit controls, so a drag turns the Moon freely in any direction
// with no stop at the top or bottom; north can end up anywhere, and the "View" menu puts it back.
const controls = new TrackballControls(camera, canvas);
controls.noPan = true;
const MIN_DISTANCE = 1.15; // lowered only while diving into the site view (diveTo)
controls.minDistance = MIN_DISTANCE;
controls.maxDistance = 10; // far enough to see Earth (2.2) and the Sun disc (2.6) beside the Moon

// Turn the Moon at the speed the cursor moves across it, at any zoom: the controls turn by
// the drag length in half-canvas widths, so divide by the Moon's drawn radius in those units.
function grabSpeed() {
  const angularRadius = Math.asin(1 / camera.position.length());
  const radiusPx = Math.tan(angularRadius) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * canvas.clientHeight / 2;
  return canvas.clientWidth / 2 / radiusPx;
}

// Moon model: radius 1, lon 0 on +x, east towards -z, north pole on +y.
// Turn it so the south pole faces the camera and the near side (lon 0) is at the top.
const moon = new THREE.Group();
moon.rotation.order = 'ZYX';
moon.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
scene.add(moon);

// Selenographic direction (lat, lon in degrees) to a unit vector in the Moon's frame.
function moonVector(latDeg, lonDeg) {
  const lat = THREE.MathUtils.degToRad(latDeg);
  const lon = THREE.MathUtils.degToRad(lonDeg);
  return new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

// Sun direction in world axes, shared with the shader. It starts from a placeholder (Sun just
// below the equator, lighting the pole from the side) and follows the subsolar point from the
// science pipeline at the host's current instant (tanaw:select and tanaw:time: the planned day's
// 00:00 UTC, or the autoplay hour): data/sun.json lists the months, and data/sun/<YYYY-MM>.json
// holds each month's hours, loaded when first needed.
const sunDir = moonVector(-1.5, 60).applyEuler(moon.rotation).normalize();
// The night-side fill (shader uniform fill): decorative, not a lighting result (an
// earthshine-like level, not the forecast's Earth), so the night side still shows its ground
// faintly. ES_FILL in the Earth & Sun view, so a Moon lit from behind still reads as the Moon;
// CLOSE_FILL in the close view, low enough that the day/night line stays plain (lit ground
// 5 to 10% of a radius from the line stays about 4.6 times brighter than the night side next to it).
const ES_FILL = 0.06, CLOSE_FILL = 0.03;
const moonFill = { value: CLOSE_FILL };
// months: "YYYY-MM" → Promise of its file. subsolar and subEarth: unit vectors in the Moon's
// frame at the instant (ISO time); known: whether they come from the data (not the placeholder).
const sun = { index: null, instant: '', months: new Map(), subsolar: new THREE.Vector3(), subEarth: new THREE.Vector3(), known: false };

fetch('data/sun.json')
  .then((res) => (res.ok ? res.json() : null))
  .then((index) => { sun.index = index; applySun(); })
  .catch(() => {});

function sunMonth(month) {
  if (!sun.months.has(month)) {
    sun.months.set(month, fetch(`data/sun/${month}.json`).then((res) => {
      if (!res.ok) throw new Error(`data/sun/${month}.json: ${res.status}`);
      return res.json();
    }));
  }
  return sun.months.get(month);
}

function applySun() {
  if (sun.estimateScene) return;
  const { index, instant } = sun;
  if (!index || !instant) return;
  const month = instant.slice(0, 7);
  // The month 4 days ahead loads early, so autoplay crosses into it without a pause.
  const ahead = new Date(Date.parse(instant) + 4 * 86400000).toISOString().slice(0, 7);
  if (ahead !== month && index.months.includes(ahead)) sunMonth(ahead).catch(() => { sun.months.delete(ahead); });
  if (!index.months.includes(month)) return;
  sunMonth(month).then((track) => {
    if (sun.estimateScene || sun.instant !== instant) return; // a later instant came while this month loaded
    const i = Math.round((Date.parse(instant) - Date.parse(track.start)) / (track.stepMinutes * 60000));
    if (!(i >= 0 && i < track.subsolarLat.length && i < track.subEarthLat.length)) return;
    sun.subsolar.copy(moonVector(track.subsolarLat[i], track.subsolarLon[i]));
    sun.subEarth.copy(moonVector(track.subEarthLat[i], track.subEarthLon[i]));
    sun.known = true;
    sunDir.copy(sun.subsolar).applyEuler(moon.rotation).normalize();
    redraw = true; // also under the site view, where the dimmed globe shows
    // The same hourly entry for the host's Sun–Earth–Moon diagram (forecast.js).
    document.dispatchEvent(new CustomEvent('tanaw:sun', { detail: { instant,
      subsolarLat: track.subsolarLat[i], subsolarLon: track.subsolarLon[i],
      subEarthLat: track.subEarthLat[i], subEarthLon: track.subEarthLon[i] } }));
  }).catch(() => { sun.months.delete(month); });
}

const vertexShader = /* glsl */ `
  varying vec3 vObj;
  varying vec3 vWorldPos;
  void main() {
    vObj = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

// Colour and relief are looked up per pixel from the surface direction, so the
// poles stay sharp instead of pinching like a normal sphere texture.
const fragmentShader = /* glsl */ `
  uniform sampler2D colorMap;
  uniform sampler2D normalMap;
  uniform sampler2D poleNormalMap;
  uniform vec3 poleAlbedo;
  uniform float poleHalf;
  uniform vec3 sunDir;
  uniform float fill;
  uniform mat4 modelMatrix;
  ${LAYER_GLSL}
  ${layerGlsl('shade')}
  uniform vec3 layerBands[4];
  uniform vec3 layerSunLow;
  uniform vec3 layerSunHigh;
  uniform vec3 layerShadow;
  varying vec3 vObj;
  varying vec3 vWorldPos;
  const float PI = 3.141592653589793;

  vec2 lonLatUv(vec3 p) {
    float lon = atan(-p.z, p.x);
    float lat = asin(clamp(p.y, -1.0, 1.0));
    return vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
  }

  // Pick texture gradients from whichever longitude wrap has no jump at this pixel,
  // which hides the seam at 180 degrees. Near the poles the map repeats the same
  // ground across many longitude texels, so the longitude gradient is shrunk by
  // cos(latitude); otherwise the poles blur into radial streaks.
  vec4 sampleWrapped(sampler2D tex, vec2 uv, float cosLat) {
    vec2 uvB = vec2(fract(uv.x + 0.5), uv.y);
    vec2 dxA = dFdx(uv), dyA = dFdy(uv);
    vec2 dxB = dFdx(uvB), dyB = dFdy(uvB);
    bool useB = abs(dxA.x) + abs(dyA.x) > abs(dxB.x) + abs(dyB.x);
    vec2 dx = useB ? dxB : dxA;
    vec2 dy = useB ? dyB : dyA;
    float k = max(cosLat, 0.002);
    dx.x *= k;
    dy.x *= k;
    return textureGrad(tex, uv, dx, dy);
  }

  void main() {
    vec3 p = normalize(vObj);
    vec2 uv = lonLatUv(p);
    float cosLat = sqrt(max(1.0 - p.y * p.y, 0.0));
    vec3 albedo = sampleWrapped(colorMap, uv, cosLat).rgb;
    vec3 nObj = sampleWrapped(normalMap, uv, cosLat).xyz * 2.0 - 1.0;

    // South of 75 degrees, relief comes from LOLA's polar map (south polar
    // stereographic, lon 0 up, east right), which is sharp where the world map smears.
    float lat = asin(clamp(p.y, -1.0, 1.0));
    float lon = atan(-p.z, p.x);
    float r = 2.0 * tan(PI / 4.0 + lat / 2.0);
    vec2 puv = 0.5 + vec2(r * sin(lon), r * cos(lon)) / (2.0 * poleHalf);
    vec3 nPole = textureGrad(poleNormalMap, puv, dFdx(puv), dFdy(puv)).xyz * 2.0 - 1.0;
    float latDeg = degrees(lat);
    nObj = normalize(mix(nObj, nPole, 1.0 - smoothstep(-76.5, -75.5, latDeg)));
    // The world map's colour near the pole is a stretched fill, so use one flat tone there.
    albedo = mix(albedo, poleAlbedo, 1.0 - smoothstep(-85.0, -81.0, latDeg));

    mat3 rot = mat3(modelMatrix);
    vec3 n = normalize(rot * nObj);
    vec3 ng = normalize(rot * p);
    vec3 v = normalize(cameraPosition - vWorldPos);

    // Lunar-Lambert: a mix of Lambert and Lommel-Seeliger, which keeps the
    // Moon's flat-looking brightness out to the limb.
    float mu0 = max(dot(n, sunDir), 0.0);
    float mu = max(dot(n, v), 0.0);
    float lit = 1.4 * mix(mu0, mu0 / (mu0 + mu + 1e-4), 0.6);
    lit *= smoothstep(-0.01, 0.03, dot(ng, sunDir));

    // fill: the faint decorative light on the night side (see ES_FILL and CLOSE_FILL),
    // brightest where the ground faces the camera, so the dark Moon still reads as a sphere.
    vec3 color = albedo * lit + albedo * (0.02 + fill * (0.4 + 0.6 * mu));

    // Map layer (tanaw:layers): value textures in up to three slots, coloured here and drawn
    // over the ground at 80%, half-lit even in shadow so they read at night. A south and a north
    // polar grid (polar stereographic, layerHalf = their half-widths in Moon radii; south lon 0
    // up, north lon 0 down, east to the right as seen from above each pole) take priority where
    // they have data; elsewhere the global grid (equirectangular, lon -180 at the left, like the
    // colour map). Values: slope band 0-3, sunlight 0-100 (%), shadow 0/1; 255 is no data, and
    // a place no slot covers stays uncoloured. Mipmapped, so zoomed out a pixel shows the area's
    // typical value (rounded to a band); a value past the layer's range has mixed with no data
    // and is left out.
    if (layerKind > 0.5) {
      float raw = layerRaw(lat, lon), top = layerTop();
      float v = floor(raw + 0.5), a = raw > top ? 0.0 : 0.8;
      vec3 lc = layerShadow;
      if (layerKind < 1.5) lc = v < 0.5 ? layerBands[0] : v < 1.5 ? layerBands[1] : v < 2.5 ? layerBands[2] : layerBands[3];
      else if (layerKind < 2.5) lc = mix(layerSunLow, layerSunHigh, clamp(v / 100.0, 0.0, 1.0));
      else a *= step(0.5, raw);
      color = mix(color, lc * (0.55 + 0.45 * clamp(lit, 0.0, 1.0)), a);
    }
    // Permanent shadow stacks over either fill as an outline: where the flag changes from one
    // pixel to the next, about 2 px of --layer-shadow at full strength.
    if (shadeKind > 0.5) {
      float sr = shadeRaw(lat, lon), f = sr > shadeTop() ? 0.0 : step(0.5, sr);
      color = mix(color, layerShadow, clamp(fwidth(f), 0.0, 1.0));
    }
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

// Moon maps: [colour, normal, pole normal]. The small set shows the Moon quickly; the full set
// replaces it in one swap once all three have loaded.
const MOON_MAPS_LOW = ['assets/moon-color-1k.webp', 'assets/moon-normal-1k.webp', 'assets/moon-pole-normal-512.webp'];
const MOON_MAPS_FULL = ['assets/moon-color-4k.webp', 'assets/moon-normal-4k.webp', 'assets/moon-pole-normal-2k.webp'];

async function loadMoonMaps(urls) {
  const loader = new THREE.TextureLoader();
  const [colorMap, normalMap, poleNormalMap] = await Promise.all(urls.map((url) => loader.loadAsync(url)));
  colorMap.colorSpace = THREE.SRGBColorSpace;
  normalMap.colorSpace = THREE.NoColorSpace;
  poleNormalMap.colorSpace = THREE.NoColorSpace;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  for (const t of [colorMap, normalMap]) t.wrapS = THREE.RepeatWrapping;
  for (const t of [colorMap, normalMap, poleNormalMap]) t.anisotropy = aniso;
  return { colorMap, normalMap, poleNormalMap };
}

// Map layers (tanaw:layers' map and shadow, forecast.js): a fill, slope or sunlight, and the
// permanent shadow outline over it, sampled from data/layers/ by map-layers.js and coloured in
// the shader by token.
const layerColour = (name) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
const layerUniforms = {
  ...layerSlotUniforms(),
  ...layerSlotUniforms('shade'),
  layerBands: { value: ['--layer-0', '--layer-1', '--layer-2', '--layer-3'].map(layerColour) },
  layerSunLow: { value: layerColour('--glass-solid') },
  layerSunHigh: { value: layerColour('--sun') },
  layerShadow: { value: layerColour('--layer-shadow') },
};
let layerWanted = '';
function showLayer(map) {
  layerWanted = map || '';
  if (!layerWanted) { setLayerSlots(layerUniforms, '', null); redraw = true; return; }
  loadLayer(map).then((t) => {
    if (layerWanted !== map) return;
    setLayerSlots(layerUniforms, map, t);
    redraw = true;
  }, (err) => console.warn(`No ${map} layer:`, err));
}

let shadeWanted = false;
function showShade(on) {
  shadeWanted = on;
  if (!on) { setLayerSlots(layerUniforms, '', null, 'shade'); redraw = true; return; }
  loadLayer('shadow').then((t) => {
    if (!shadeWanted) return;
    setLayerSlots(layerUniforms, 'shadow', t, 'shade');
    redraw = true;
  }, (err) => console.warn('No shadow layer:', err));
}

async function loadMoon() {
  const { colorMap, normalMap, poleNormalMap } = await loadMoonMaps(MOON_MAPS_LOW);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      colorMap: { value: colorMap },
      normalMap: { value: normalMap },
      poleNormalMap: { value: poleNormalMap },
      // Mean colour of the map between 80 and 84 degrees south.
      poleAlbedo: { value: new THREE.Color().setRGB(199 / 255, 193 / 255, 188 / 255, THREE.SRGBColorSpace) },
      // Half the width of the polar map, in Moon radii (3812 px x 240 m / 2 / 1737.4 km).
      poleHalf: { value: 0.26329 },
      sunDir: { value: sunDir },
      fill: moonFill,
      ...layerUniforms,
    },
    vertexShader,
    fragmentShader,
  });
  const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), material);
  moon.add(moonMesh);
  configureTravelThumbnails(moonMesh, moonVector);

  loadMoonMaps(MOON_MAPS_FULL)
    .then((full) => {
      for (const [name, tex] of Object.entries(full)) {
        material.uniforms[name].value.dispose();
        material.uniforms[name].value = tex;
      }
      redraw = true;
    })
    .catch((err) => console.warn('Full-resolution Moon maps did not load; keeping the small ones.', err));
}

// Framing: the canvas fills the screen, but the Moon is centred in the free band between the
// top bar and the bottom UI, and left of the site panel when it is open. The host sends that
// band (viewport px) as tanaw:frame; until it does, the band is the whole canvas. A new band
// glides in; a window resize applies at once.
const FRAME_MS = 400;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let band = null;
let framing = null;

// Band edges in canvas px, from the top left of the canvas.
function bandInCanvas() {
  const { clientWidth: w, clientHeight: h } = canvas;
  if (!band) return { top: 0, bottom: h, left: 0, right: w };
  const { left: x0, top: y0 } = canvas.getBoundingClientRect();
  const clamp = THREE.MathUtils.clamp;
  const top = clamp(band.top - y0, 0, h);
  const left = clamp(band.left - x0, 0, w);
  return {
    top,
    bottom: clamp(band.bottom - y0, top + 1, Math.max(h, top + 1)),
    left,
    right: clamp(band.right - x0, left + 1, Math.max(w, left + 1)),
  };
}

// Keep 35 degrees across the narrower of the band's width and height, so the whole Moon fits
// on a phone too, and shift the view so the orbit target (the Moon's centre) sits mid-band.
const HALF_FOV = THREE.MathUtils.degToRad(17.5);
function frameTarget() {
  const { clientWidth: w, clientHeight: h } = canvas;
  const { top, bottom, left, right } = bandInCanvas();
  return {
    fov: THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(HALF_FOV) * h / Math.min(right - left, bottom - top))),
    x: w / 2 - (left + right) / 2,
    y: h / 2 - (top + bottom) / 2,
  };
}

function applyFrame(fov, x, y) {
  const { clientWidth: w, clientHeight: h } = canvas;
  camera.fov = fov;
  camera.setViewOffset(w, h, x, y, w, h); // also sets the aspect and updates the projection
}

function resize() {
  const { clientWidth: w, clientHeight: h } = canvas;
  renderer.setSize(w, h, false);
  redraw = true; // a resize clears the canvas, also under the site view
  framing = null;
  const { fov, x, y } = frameTarget();
  applyFrame(fov, x, y);
  controls.handleResize();
}
window.addEventListener('resize', resize);
resize();

document.addEventListener('tanaw:frame', (e) => {
  const { top, bottom, left, right } = e.detail;
  band = { top, bottom, left, right };
  // Earth & Sun, untouched since it was framed: frame it again for the new band.
  if (mode === 'es' && !esTouched && Math.abs(esDistance() - esD) > 0.01 * esD) frameEs();
  const to = frameTarget();
  // A changed canvas size means a resize is under way: apply at once, as resize() does.
  const sized = camera.view.fullWidth === canvas.clientWidth && camera.view.fullHeight === canvas.clientHeight;
  if (!sized || reduceMotion.matches || !revealed) { // the first band applies before the Moon is first shown
    framing = null;
    applyFrame(to.fov, to.x, to.y);
    return;
  }
  framing = { from: { fov: camera.fov, x: camera.view.offsetX, y: camera.view.offsetY }, to, t0: performance.now() };
});

function stepFrame(now) {
  if (!framing) return;
  const t = Math.min(1, (now - framing.t0) / FRAME_MS);
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // ease in and out
  const { from, to } = framing;
  const mix = (k) => from[k] + (to[k] - from[k]) * e;
  applyFrame(mix('fov'), mix('x'), mix('y'));
  if (t === 1) framing = null;
}

// Fly-to: glide the camera round the Moon to face a direction, ending at a set distance
// from the centre (in Moon radii). A drag stops it; reduced motion jumps straight there.
// Options: ms, the length; log, change the height above the ground by a steady ratio (a dive
// or a rise from near the ground, which would otherwise rush at one end); done, called when it
// lands; jump, land at once; descent, part of the dive into the site view or the rise out of it.
const FLY_MS = 1200;
let flight = null;

function flyTo(localDir, distance, { ms = FLY_MS, log = false, done = null, jump = reduceMotion.matches, descent: part = false } = {}) {
  if (descent && !part) {
    if (!descent.rising) return; // the dive into the site view carries on
    endDescent(); // anything else may take over the rise
  }
  const from = camera.position.clone().normalize();
  const to = localDir.clone().applyQuaternion(moon.quaternion).normalize();
  flight = {
    from,
    up: camera.up.clone(),
    turn: new THREE.Quaternion().setFromUnitVectors(from, to),
    d0: camera.position.length(),
    d1: THREE.MathUtils.clamp(distance, controls.minDistance, controls.maxDistance),
    ms, log, done,
    t0: performance.now() - (jump ? ms : 0),
  };
}

// A glide to a whole camera pose: the camera's turn q (it looks at the Moon's centre along -z,
// with +y up) and its distance d.
function flyPose(q, d) {
  if (descent?.rising) endDescent();
  flight = {
    q0: camera.quaternion.clone(),
    q1: q,
    d0: camera.position.length(),
    d1: d,
    ms: FLY_MS,
    t0: performance.now() - (reduceMotion.matches ? FLY_MS : 0),
  };
}

const partTurn = new THREE.Quaternion();
function stepFlight(now) {
  if (!flight) return;
  const t = Math.min(1, (now - flight.t0) / flight.ms);
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // ease in and out
  const { d0, d1 } = flight;
  const d = flight.log ? 1 + (d0 - 1) * ((d1 - 1) / (d0 - 1)) ** e : d0 + (d1 - d0) * e;
  if (flight.q1) {
    partTurn.slerpQuaternions(flight.q0, flight.q1, e);
    camera.position.set(0, 0, d).applyQuaternion(partTurn);
    camera.up.set(0, 1, 0).applyQuaternion(partTurn);
  } else {
    partTurn.identity().slerp(flight.turn, e);
    camera.position.copy(flight.from).applyQuaternion(partTurn).multiplyScalar(d);
    camera.up.copy(flight.up).applyQuaternion(partTurn); // turn "up" too, so it never lines up with the view
  }
  if (t === 1) {
    const { done } = flight;
    flight = null;
    if (mode === 'close') controls.maxDistance = CLOSE_MAX;
    done?.();
  }
}

// The dive into the site view (site.js) and the rise out of it. After the turn to the site, the
// camera drops straight down over DIVE_MS until the site's 5 km ring spans DIVE_FILL of half the
// band's narrower side: the size of the site view's ring from straight overhead, which then
// fades in at this pose (tanaw:dive gives it the ring's size and where lunar north points).
// Once the site view covers it, the globe glides back out to the whole Moon (HOME_D, WHOLE_MS),
// still facing the site, faded out behind the site view's own ground (style.css) until it leaves.
// Leaving, it glides back down to the dive pose while the site view returns overhead
// (RETURN_MS, site.js DEPART_MS), so the view fades out over the matching ground. Once it
// has gone, the camera rises back to the distance it dived from, turning to the selected site.
// The distance limit drops to the dive pose and the controls are off from the select to the
// end of the rise. Reduced motion has no dive: the site view just swaps in.
const MOON_KM = 1737.4, RING_KM = 5; // the site view's ring (site.js RING_KM)
const RING_ANGLE = RING_KM / MOON_KM; // its radius on the sphere, in radians
const DIVE_FILL = 0.4, DIVE_MS = 700, WHOLE_MS = 1200, RETURN_MS = 700;
const DIVE_D = Math.cos(RING_ANGLE) + Math.sin(RING_ANGLE) / (DIVE_FILL * Math.tan(HALF_FOV));
// descent: { site, local, back, wanted, landed, rising, to, whole }. site and local: the site the camera
// dives to or waits over; back: the distance to rise back to; wanted: the host still wants the
// site view; landed: at the dive pose; to: { site, local } to rise towards once the host has
// left the site view; rising: the site the rise is heading for; whole: out at the whole Moon
// behind the site view.
let descent = null;
let siteVisible = false; // the site view is in, or fading (tanaw:siteview)
let announce = false; // tell the site view the dive pose after the next frame (tanaw:dive)
const facing = new THREE.Vector3(), siteDir = new THREE.Vector3();

function diveTo(site, local) {
  if (descent && descent.wanted && descent.site === site) {
    if (descent.landed && !covered) announce = true; // the site view may be waiting for it
    return;
  }
  const was = descent, es = mode === 'es';
  descent = { site, local, back: 0, wanted: true, landed: false, rising: null, to: null, whole: false };
  if (es) {
    aimClose(local);
    setMode('close'); // glides back to the close view, now facing the site
  }
  descent.back = was ? was.back : flight ? flight.d1 : camera.position.length();
  controls.enabled = false;
  controls.minDistance = DIVE_D;
  const land = () => {
    descent.landed = true;
    announce = true;
  };
  const dive = () => flyTo(local, DIVE_D, { ms: DIVE_MS, log: true, descent: true, done: land });
  if (siteVisible && was?.whole) {
    // The site view is up and swaps sites itself: the whole Moon behind it turns to the new site.
    descent.whole = true;
    flyTo(local, HOME_D, { log: true, descent: true, done: land });
  } else if (siteVisible) {
    // The same, before the glide out: jump to the new dive pose under it.
    flyTo(local, DIVE_D, { jump: true, descent: true, done: land });
    redraw = true;
  } else if (es) Object.assign(flight, { done: dive });
  else {
    siteDir.copy(local).applyQuaternion(moon.quaternion).normalize();
    if (facing.copy(camera.position).normalize().dot(siteDir) > 0.9999) dive();
    else flyTo(local, camera.position.length(), { descent: true, done: dive });
  }
}

// Rise once the host has left the site view and the site view has gone.
function riseOut() {
  if (!descent || descent.wanted || siteVisible) return;
  const { site, local } = descent.to || descent;
  if (descent.rising === site) return;
  descent.rising = site;
  descent.landed = false;
  flyTo(local, descent.back, { log: true, descent: true, done: endDescent });
}

function endDescent() {
  descent = null;
  announce = false;
  controls.minDistance = MIN_DISTANCE;
  controls.enabled = true;
}

// Where lunar north points on screen at the dive pose, clockwise from up: the north pole's
// direction in the site's tangent plane, against the camera's screen axes (as lookAt builds
// them: right = up × back, screen up = back × right, back = from the Moon's centre to the camera).
const axisRight = new THREE.Vector3(), axisUp = new THREE.Vector3(), axisBack = new THREE.Vector3(), northV = new THREE.Vector3();
function northOnScreen() {
  axisBack.copy(camera.position).normalize();
  axisRight.crossVectors(camera.up, axisBack).normalize();
  axisUp.crossVectors(axisBack, axisRight);
  northV.set(0, 1, 0).applyQuaternion(moon.quaternion);
  northV.addScaledVector(axisBack, -northV.dot(axisBack));
  return Math.atan2(northV.dot(axisRight), northV.dot(axisUp));
}
controls.addEventListener('start', () => {
  flight = null;
  esTouched = true;
  if (mode === 'close') controls.maxDistance = CLOSE_MAX;
});

// Globe views, switched by the top bar's "Earth & Sun" toggle: "close" (the Moon framed, as on
// load; toggle off) and "es" (Earth & Sun, toggle on: side-on along the Moon's equator plane, Moon
// north up, pulled back so Earth and the Sun fit the free band beside the Moon). Turning the
// toggle off glides back to the view that was left. Turning and zooming stay free in both.
const CLOSE_MAX = controls.maxDistance;
const esBtn = document.getElementById('mode-es');
let mode = 'close';
let closeView = null; // { q, d }: the close view to return to
let esTouched = false; // a drag or zoom since the Earth & Sun view was framed
let esD = 0; // the distance it was framed at

// The Earth & Sun pose: square to the Moon–Earth line, from the side that puts Earth on the right
// (the data's sub-Earth point, or lon 0 until it loads), and ES_TILT below the equator plane, so
// the Sun's monthly path round the Moon reads as a ring that never crosses the Moon's disc, and
// the south polar sites face the camera. Moon north up.
const ES_TILT = THREE.MathUtils.degToRad(25);
function esPose() {
  const toEarth = sun.known ? sun.subEarth.clone() : new THREE.Vector3(1, 0, 0);
  toEarth.y = 0;
  if (toEarth.lengthSq() < 1e-9) toEarth.set(1, 0, 0);
  const north = new THREE.Vector3(0, 1, 0);
  const side = toEarth.normalize().clone().cross(north);
  const back = side.multiplyScalar(Math.cos(ES_TILT)).addScaledVector(north, -Math.sin(ES_TILT)).applyQuaternion(moon.quaternion).normalize();
  const up = north.clone().applyQuaternion(moon.quaternion).addScaledVector(back, -north.clone().applyQuaternion(moon.quaternion).dot(back)).normalize();
  const right = up.clone().cross(back);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, back));
  return { q, d: esDistance() };
}

// The distance at which the Sun's distance (beside the Moon) fits the band's width and the Moon
// with its pole mark fits its height, with a small margin, at the band's field of view (see
// frameTarget).
function esDistance() {
  const { top, bottom, left, right } = bandInCanvas();
  const w = right - left, h = bottom - top;
  const k = Math.tan(THREE.MathUtils.degToRad(17.5)) / Math.min(w, h);
  const fit = (r, tan) => r * Math.sqrt(1 + 1 / (tan * tan));
  // Across: the Sun's path (its distance) and its drawn radius; up: that path seen ES_TILT from
  // its plane, with the Sun's radius, Earth's loop (its latitude, under 7°) with its radius, or
  // the pole mark.
  const sunR = ES_SUN_SIZE * ES_EARTH_R, tilt = Math.sin(ES_TILT);
  const across = ES_SUN_AT + sunR;
  const up = Math.max(POLE_END, ES_SUN_AT * tilt + sunR, ES_EARTH_AT * (tilt + Math.sin(THREE.MathUtils.degToRad(7))) + ES_EARTH_R);
  return Math.max(fit(1.1 * across, k * w), fit(1.15 * up, k * h));
}

function frameEs() {
  const pose = esPose();
  esD = pose.d;
  esTouched = false;
  controls.maxDistance = Math.max(CLOSE_MAX, pose.d * 1.5);
  flyPose(pose.q, pose.d);
}

function setMode(next) {
  if (next === mode) return;
  mode = next;
  esBtn.setAttribute('aria-pressed', String(mode === 'es'));
  moonFill.value = mode === 'es' ? ES_FILL : CLOSE_FILL;
  if (mode === 'es') {
    closeView = { q: camera.quaternion.clone(), d: camera.position.length() };
    frameEs();
  } else {
    const view = closeView || { q: new THREE.Quaternion(), d: HOME_D };
    flyPose(view.q, view.d);
  }
}
esBtn.addEventListener('click', () => setMode(mode === 'es' ? 'close' : 'es'));

// Travel's Whole Moon is a camera action, not a click on the context-sensitive View
// menu. Keep the lunar facing direction, return from Earth & Sun, and undo zoom.
document.addEventListener('tanaw:frame-moon', () => {
  const pose = mode === 'es' && closeView ? closeView.q.clone() : camera.quaternion.clone();
  // Finish residual wheel/drag damping before it can displace the target pose,
  // including when reduced motion makes the framing flight instantaneous.
  const damping = controls.dynamicDampingFactor;
  controls.dynamicDampingFactor = 1;
  controls.update();
  controls.dynamicDampingFactor = damping;
  setMode('close');
  controls.maxDistance = CLOSE_MAX;
  if (descent) {
    descent.back = HOME_D;
    descent.rising = null;
    riseOut(); // waits for the existing site-view exit, if it is still covering the Moon
  } else flyPose(pose, HOME_D);
});

// A new site while in Earth & Sun: the close view to return to turns to face it.
function aimClose(local) {
  closeView ||= { q: new THREE.Quaternion(), d: HOME_D };
  const from = new THREE.Vector3(0, 0, 1).applyQuaternion(closeView.q);
  const to = local.clone().applyQuaternion(moon.quaternion).normalize();
  closeView.q.premultiply(new THREE.Quaternion().setFromUnitVectors(from, to));
}

// The top bar's "View" menu (#view-menu, opened by #reset while no site is focused; forecast.js
// sets the button's label and whether it opens the menu). While a site is focused the host uses
// the same button to end focus, so the globe keeps facing the site.
// Default view: the view on load, or in Earth & Sun that view framed again. The others turn the
// camera to face a pole or a side, at the default distance (the Earth & Sun distance in that
// view): "back" is the direction from the Moon's centre to the camera and "up" what points up
// on screen, both in the Moon's frame. The south pole has the near side up, like the view on
// load; the north pole has the near side down, as in north polar maps.
// The menu waits while the globe dives into or rises out of the site view.
let focused = false;
const VIEWS = [
  ['Default view', null],
  ['North up', 'north'],
  ['South pole', [0, -1, 0], [1, 0, 0]],
  ['North pole', [0, 1, 0], [-1, 0, 0]],
  ['Near side', [1, 0, 0], [0, 1, 0]],
  ['Far side', [-1, 0, 0], [0, 1, 0]],
];
const resetBtn = document.getElementById('reset');
const viewMenu = document.getElementById('view-menu');

function facePose(back, up) {
  const b = new THREE.Vector3(...back).applyQuaternion(moon.quaternion);
  const r = new THREE.Vector3(...up).applyQuaternion(moon.quaternion).cross(b).normalize();
  const u = b.clone().cross(r);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, b));
}

function showView(back, up) {
  if (focused || descent) return;
  // North up: the whole Moon with lunar north at the top, as maps show it: the same longitude
  // as the view, from no more than 30° above or below the equator (lon 0 from over a pole).
  if (back === 'north') {
    const b = camera.position.clone().normalize().applyQuaternion(moon.quaternion.clone().invert());
    const flat = new THREE.Vector3(b.x, 0, b.z);
    if (flat.lengthSq() < 1e-4) flat.set(1, 0, 0);
    const lat = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(b.y, -1, 1)), -Math.PI / 6, Math.PI / 6);
    const dir = flat.normalize().multiplyScalar(Math.cos(lat)).setY(Math.sin(lat));
    const n = new THREE.Vector3(0, 1, 0), u = n.addScaledVector(dir, -dir.y).normalize();
    if (mode === 'es') esTouched = true;
    flyPose(facePose(dir.toArray(), u.toArray()), camera.position.length());
    return;
  }
  if (!back) {
    if (mode === 'es') return frameEs();
    flight = null;
    controls.reset();
    return;
  }
  if (mode === 'es') esTouched = true; // a new band keeps this pose rather than framing Earth & Sun again
  flyPose(facePose(back, up), mode === 'es' ? esDistance() : HOME_D);
}

viewMenu.prepend(...VIEWS.map(([name, back, up]) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.setAttribute('role', 'menuitem');
  b.textContent = name;
  b.addEventListener('click', () => {
    viewMenu.hidePopover();
    showView(back, up);
  });
  return b;
}));
// The last row turns the lat/lon grid and the pointer readout on and off; the menu stays open.
const gridRow = document.createElement('button');
gridRow.type = 'button';
gridRow.className = 'btn';
gridRow.setAttribute('role', 'menuitemcheckbox');
gridRow.dataset.toggleDot = '';
gridRow.setAttribute('aria-checked', 'false');
gridRow.textContent = 'Lat/lon grid';
gridRow.addEventListener('click', () => {
  gridOn = !gridOn;
  if (!grid.children.length) grid.add(gridLines(false, 0.25), gridLines(true, 0.45));
  gridRow.setAttribute('aria-checked', String(gridOn));
});
const starsRow = document.createElement('button');
starsRow.type = 'button'; starsRow.className = 'btn'; starsRow.id = 'show-stars';
starsRow.setAttribute('role', 'menuitemcheckbox'); starsRow.dataset.toggleDot = '';
starsRow.textContent = 'Stars';
async function setStarsEnabled(enabled) {
  starsRow.setAttribute('aria-checked', String(enabled));
  document.dispatchEvent(new CustomEvent('tanaw:stars-change', { detail: enabled }));
  starsRow.setAttribute('aria-busy', String(enabled));
  try { await starSky.setEnabled(enabled); }
  catch {
    starsRow.setAttribute('aria-checked', 'false');
    starSky.setEnabled(false);
    document.dispatchEvent(new CustomEvent('tanaw:stars-change', { detail: false }));
    status.textContent = 'Stars could not load. Select Stars to retry.';
  } finally { starsRow.setAttribute('aria-busy', 'false'); }
}
starsRow.addEventListener('click', () => setStarsEnabled(starsRow.getAttribute('aria-checked') !== 'true'));
setStarsEnabled(true);
viewMenu.append(gridRow, starsRow, document.getElementById('cinematic-mode'));
// Under the button, right-aligned with it and kept on screen; the first row takes focus.
viewMenu.addEventListener('beforetoggle', (e) => {
  if (e.newState !== 'open') return;
  const r = resetBtn.getBoundingClientRect();
  Object.assign(viewMenu.style, { top: `${r.bottom + 8}px`, right: `${Math.max(8, innerWidth - r.right)}px`, left: 'auto' });
});
viewMenu.addEventListener('toggle', (e) => {
  const open = e.newState === 'open';
  if (resetBtn.hasAttribute('aria-haspopup')) resetBtn.setAttribute('aria-expanded', String(open));
  if (open) viewMenu.querySelector('[role^="menuitem"]').focus();
});
// Up and down arrows move between the rows, wrapping round. Escape closes only the menu (the
// popover itself), not the panels the page's own Escape closes.
viewMenu.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') e.stopPropagation();
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const rows = [...viewMenu.querySelectorAll('[role^="menuitem"]')];
  const i = rows.indexOf(document.activeElement);
  rows[(i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length].focus();
});

// While the site view covers the globe (site.js), the globe stops drawing once its glide out to
// the whole Moon ends, after one last frame without the ring (the site view tilts away from it); redraw asks for a
// frame when something under the site view changes. siteVisible: the rise waits until the
// site view has gone.
let covered = false;
document.addEventListener('tanaw:siteview', (e) => {
  if (e.detail.covering !== covered) redraw = true;
  covered = e.detail.covering;
  siteVisible = e.detail.visible;
  if (covered && descent?.wanted && descent.landed && !descent.whole) {
    descent.whole = true;
    flyTo(descent.local, HOME_D, { ms: WHOLE_MS, log: true, descent: true });
  }
  riseOut();
});

// Lat/lon grid (the View menu's "Lat/lon grid"): latitude circles every 10° and meridians every
// 30°, a hair above the ground in the Moon's frame, so they turn with it and use the same
// directions as the pins (moonVector). Faint --text lines, the equator and longitude 0 brighter.
// Shown in the close view and in Earth & Sun, not while the site view is in or on its way.
const GRID_R = 1.002, GRID_STEP = 2; // degrees between the points along each line
let gridOn = false;
function gridLines(major, opacity) {
  const pts = [];
  const line = (at, from, to) => {
    for (let t = from; t < to; t += GRID_STEP) pts.push(...at(t).toArray(), ...at(Math.min(t + GRID_STEP, to)).toArray());
  };
  for (let lat = -80; lat <= 80; lat += 10) {
    if ((lat === 0) === major) line((lon) => moonVector(lat, lon).multiplyScalar(GRID_R), -180, 180);
  }
  for (let lon = -150; lon <= 180; lon += 30) {
    if ((lon === 0) === major) line((lat) => moonVector(lat, lon).multiplyScalar(GRID_R), -90, 90);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: new THREE.Color(token('--text')), transparent: true, opacity, depthWrite: false,
  }));
}
const grid = new THREE.Group(); // its lines are made when first turned on
grid.visible = false;
moon.add(grid);

// The readout while the grid is on, in the close view only: the latitude and longitude under the
// pointer (on touch, of the last tapped point), from the Moon's sphere under it, turned back
// into the Moon's frame and read as moonVector's inverse: east-positive longitude, -180 to 180
// (data/sites.json gives 0 to 360 east, the same directions). Hidden off the Moon. placeBodies
// places it.
const readout = document.createElement('span');
readout.className = 'body-label lat-readout';
readout.setAttribute('aria-hidden', 'true');
readout.hidden = true;
const readoutSize = { w: 0, h: 0, text: '' };
const pointer = { x: 0, y: 0, mouse: false, tap: '' }; // mouse: a mouse is over the Moon's canvas or pins
const raycaster = new THREE.Raycaster();
const moonSphere = new THREE.Sphere(new THREE.Vector3(), 1);
const ndcP = new THREE.Vector2(), hitP = new THREE.Vector3(), unturn = new THREE.Quaternion();

// Latitude and longitude (degrees, east positive) on the Moon under a screen point, or null.
function pointAt(x, y) {
  const r = canvas.getBoundingClientRect();
  ndcP.set((x - r.left) / r.width * 2 - 1, 1 - (y - r.top) / r.height * 2);
  raycaster.setFromCamera(ndcP, camera);
  if (!raycaster.ray.intersectSphere(moonSphere, hitP)) return null;
  hitP.applyQuaternion(unturn.copy(moon.quaternion).invert()).normalize();
  return { lat: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(hitP.y, -1, 1))),
    lon: THREE.MathUtils.radToDeg(Math.atan2(-hitP.z, hitP.x)) };
}
function latLonAt(x, y) {
  const at = pointAt(x, y);
  if (!at) return '';
  const { lat, lon } = at;
  const part = (v, pos, neg) => `${Math.abs(v).toFixed(2)}° ${v.toFixed(2).startsWith('-') ? neg : pos}`;
  return `${part(lat, 'N', 'S')}, ${part(lon, 'E', 'W')}`;
}

// Mouse: wherever it is over the Moon's canvas or a pin. Touch: a tap (a touch that barely moves).
const overMoon = (e) => e.target === canvas || pinLayer.contains(e.target);
const tapFrom = { x: 0, y: 0, primary: false };
canvas.parentElement.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  pointer.mouse = overMoon(e);
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});
canvas.parentElement.addEventListener('pointerleave', () => { pointer.mouse = false; });
canvas.parentElement.addEventListener('pointerdown', (e) => {
  Object.assign(tapFrom, { x: e.clientX, y: e.clientY, primary: e.isPrimary && e.button === 0 });
});
canvas.parentElement.addEventListener('pointerup', (e) => {
  const still = Math.hypot(e.clientX - tapFrom.x, e.clientY - tapFrom.y) <= (e.pointerType === 'mouse' ? 4 : 8);
  if (e.pointerType !== 'mouse' && overMoon(e) && still) pointer.tap = latLonAt(e.clientX, e.clientY);
  // A click or tap on the Moon's face itself (not a pin, not a drag, close view) opens that
  // point: forecast.js estimates it and fills the panels (tanaw:point).
  if (!still || !tapFrom.primary || e.target !== canvas || mode !== 'close') return;
  const at = pointAt(e.clientX, e.clientY);
  if (at) document.dispatchEvent(new CustomEvent('tanaw:point', { detail: at }));
});

// Site pins. The host (forecast.js) sends the sites and the selected one with each
// selection; tapping a pin asks the host to select it. Pins whose 44 px hit areas would
// overlap merge into one numbered pin that opens a list. Pins under a panel are hidden.
const PIN = 44;
const pinLayer = document.getElementById('pins');
const pinList = document.getElementById('pin-list');
const pins = { sites: [], local: [], selected: '', key: '', els: [] };
const tmpV = new THREE.Vector3();
const toCam = new THREE.Vector3();

document.addEventListener('tanaw:select', (e) => {
  const { site, sites, instant } = e.detail;
  focused = e.detail.focus;
  sun.instant = instant;
  sun.estimateScene = !!e.detail.estimateScene;
  if (sun.estimateScene) {
    sun.subsolar.fromArray(e.detail.directions.sun); sun.subEarth.fromArray(e.detail.directions.earth);
    sun.known = true; sunDir.copy(sun.subsolar).applyEuler(moon.rotation).normalize();
    redraw = true;
  } else applySun();
  pins.terrain = new Set(e.detail.terrain || []);
  if (!pins.sites.length) {
    pins.sites = [...sites]; // a copy: sites added later (typed coordinates) get no pin
    pins.local = sites.map((s) => moonVector(s.lat, s.lon));
  }
  pickMark.classList.remove('pending');
  focusSelection(e.detail);
});

// A requested point is a navigation target before its science is ready.
document.addEventListener('tanaw:preview-site', e => {
  if (e.detail.failed) { pickMark.classList.remove('pending'); return; }
  focused = e.detail.focus;
  pickMark.classList.add('pending');
  focusSelection(e.detail);
  redraw = true;
});

function focusSelection({ site, sites, view, tile }) {
  // A site that opens in the site view: the dive (diveTo). Leaving the site view: the rise,
  // turning to the selected site (riseOut). Otherwise a new site after the first selection:
  // turn the globe to face it at the same distance, so the Moon stays framed clear of the text
  // (zooming in is left to the user).
  // In Earth & Sun the view stays put and the close view turns instead, unless the site opens in
  // the site view, which starts from the close view.
  // A site added after the pins were made (coordinates typed in the picker) has no pin; its
  // direction comes from its own latitude and longitude.
  const pinAt = pins.sites.findIndex((s) => s.id === site), chosen = sites.find((s) => s.id === site);
  const local = pinAt >= 0 ? pins.local[pinAt] : moonVector(chosen.lat, chosen.lon);
  pickAt = pinAt < 0 ? local.clone() : null; // a typed or clicked point has no pin: it gets the mark
  if (view === 'site' && tile && !reduceMotion.matches) diveTo(site, local);
  else if (descent) {
    if (descent.wanted && descent.whole) flyTo(descent.local, DIVE_D, { ms: RETURN_MS, log: true, descent: true });
    descent.whole = false;
    descent.wanted = false;
    descent.to = { site, local };
    riseOut();
  } else if (pins.selected && site !== pins.selected) {
    if (mode === 'es') {
      aimClose(local);
      if (view === 'site') setMode('close');
    } else flyTo(local, camera.position.length());
  }
  pins.selected = site;
  pins.key = '';
  if (pinList.matches(':popover-open')) pinList.hidePopover();
}

// An autoplay hour tick moves only the instant.
document.addEventListener('tanaw:time', (e) => {
  sun.instant = e.detail.instant;
  if (!e.detail.smooth) applySun(); // during smooth autoplay tanaw:directions places them
});
// Smooth autoplay (forecast.js): the Sun's and Earth's Moon-frame directions at a whole minute,
// interpolated by the computation module (productMoonDirections) between the published hours,
// or along an estimate's hourly track (estimateScene).
document.addEventListener('tanaw:directions', (e) => {
  if (sun.estimateScene !== !!e.detail.estimateScene) return; // from the scene the globe shows
  sun.subsolar.fromArray(e.detail.sun);
  sun.subEarth.fromArray(e.detail.earth);
  sun.known = true;
  sunDir.copy(sun.subsolar).applyEuler(moon.rotation).normalize();
  redraw = true;
});

// Whether Earth is in view from the selected site at the globe's instant, from the forecast
// (tanaw:sky's now); the Earth & Sun view draws the site-to-Earth line solid or dashed by it.
let contact = null;
document.addEventListener('tanaw:sky', (e) => {
  const { site, now } = e.detail;
  contact = now ? { site, instant: now.instant, earthVisible: now.earthVisible } : null;
});

function pick(id) {
  if (pinList.matches(':popover-open')) pinList.hidePopover();
  document.dispatchEvent(new CustomEvent('tanaw:pick', { detail: { site: id } }));
}

function openList(group, x, y) {
  pinList.replaceChildren(...group.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = s.name;
    b.setAttribute('aria-pressed', String(s.id === pins.selected));
    b.addEventListener('click', () => pick(s.id));
    return b;
  }));
  pinList.showPopover();
  const w = pinList.offsetWidth, h = pinList.offsetHeight;
  pinList.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, x + PIN / 2))}px`;
  pinList.style.top = `${Math.max(8, Math.min(innerHeight - h - 8, y - PIN / 2))}px`;
}

// Screen position of each site that faces the camera, then merged into groups.
function pinGroups(box) {
  const at = new Map();
  pins.local.forEach((v, i) => {
    tmpV.copy(v).applyQuaternion(moon.quaternion);
    toCam.copy(camera.position).sub(tmpV);
    if (tmpV.dot(toCam) <= 0.02 * toCam.length()) return; // behind the limb
    tmpV.project(camera);
    at.set(i, { x: box.left + (tmpV.x + 1) / 2 * box.width, y: box.top + (1 - tmpV.y) / 2 * box.height });
  });
  const sel = pins.sites.findIndex((s) => s.id === pins.selected);
  const anchor = (g) => at.get(g.includes(sel) ? sel : g[0]);
  const groups = [...at.keys()].map((i) => [i]);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < groups.length && !merged; i++) {
      for (let j = i + 1; j < groups.length && !merged; j++) {
        const a = anchor(groups[i]), b = anchor(groups[j]);
        if (Math.abs(a.x - b.x) < PIN && Math.abs(a.y - b.y) < PIN) {
          groups[i] = [...groups[i], ...groups.splice(j, 1)[0]].sort((p, q) => p - q);
          merged = true;
        }
      }
    }
  }
  return groups.map((g) => ({ members: g, ...anchor(g), on: g.includes(sel) }));
}

function centre(members) {
  return members.reduce((sum, i) => sum.add(pins.local[i]), new THREE.Vector3()).normalize();
}

// Distance from the Moon's centre at which a group's spread fills 40% of the narrower side of
// the free band (looking straight down), so every pin stays in view and the outer ones split.
function fitDistance(members) {
  let spread = 0;
  for (const i of members) for (const j of members) if (i < j) spread = Math.max(spread, pins.local[i].distanceTo(pins.local[j]));
  const { top, bottom, left, right } = bandInCanvas();
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(right - left, bottom - top) / canvas.clientHeight;
  return 1 + spread / (0.4 * 2 * halfHeight);
}

// Each kind of site, as its pin's label says it (the mark's shape shows it: style.css).
const PIN_KINDS = { 'base-candidate': 'base candidate', visited: 'past landing', upcoming: 'upcoming landing' };

// Rebuild the pin buttons when the grouping or selection changes.
function buildPins(groups) {
  pins.els = groups.map((g) => {
    const sites = g.members.map((i) => pins.sites[i]);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = sites.length > 1 ? 'pin many' : 'pin';
    button.setAttribute('aria-pressed', String(g.on));
    if (sites.length > 1) {
      const count = document.createElement('span');
      count.textContent = sites.length;
      button.append(count);
      button.setAttribute('aria-label', `${sites.length} sites: ${sites.map((s) => s.name).join(', ')}`);
      button.addEventListener('click', () => {
        // Zoom in on the group so its pins split; once at the closest zoom, list the sites.
        const now = camera.position.length();
        const to = Math.max(controls.minDistance, Math.min(now, fitDistance(g.members)));
        if (now - to > 0.01) {
          flyTo(centre(g.members), to);
          return;
        }
        const r = button.getBoundingClientRect();
        openList(sites, r.left + PIN / 2, r.top + PIN / 2);
      });
    } else {
      // The mark's shape says the site's kind (a dot, a ring or a diamond); a ring round it marks
      // a site that opens in the 3D site view. Clusters stay plain.
      const terrain = pins.terrain?.has(sites[0].id);
      const kind = PIN_KINDS[sites[0].category];
      if (terrain) button.classList.add('terrain');
      if (kind) button.classList.add(sites[0].category);
      button.setAttribute('aria-label', [sites[0].name, kind, terrain && '3D terrain'].filter(Boolean).join(', '));
      button.addEventListener('click', () => pick(sites[0].id));
    }
    // Only the selected site is labelled; the others show their name on hover (CSS, data-name).
    const selSite = sites.find((s) => s.id === pins.selected);
    const texts = selSite ? [selSite.name] : [];
    button.dataset.name = sites.length === 1 ? sites[0].name : `${sites.length} sites`;
    pinLayer.append(button);
    let label = null, variants = [];
    if (texts.length) {
      label = document.createElement('span');
      label.className = 'pin-label';
      label.setAttribute('aria-hidden', 'true');
      pinLayer.append(label);
      variants = texts.map((text) => { label.textContent = text; return { text, w: label.offsetWidth, h: label.offsetHeight }; });
    }
    return { button, label, variants, on: g.on };
  });
}

// The discs of Earth and the Sun while in front of the Moon (placeBodies), and whether a
// screen point lies under one: what is on the Moon there is hidden.
let frontDiscs = [];
// pad: the marker's own radius, so none of it shows over the body's edge.
const underFront = (x, y, pad = 0) => frontDiscs.some((b) => Math.hypot(x - b.x, y - b.y) < b.r + pad);

// The overlay text and buttons the pins and bodies keep clear of: measured once per frame
// (frameNo, the animation loop's count) and shared by placeBodies and placePins.
let frameNo = 0;
const hudCache = { frame: -1, rects: [] };
function hudRects() {
  if (hudCache.frame !== frameNo) {
    hudCache.frame = frameNo;
    hudCache.rects = [...document.querySelectorAll('.hud .ov, .hud .btn')]
      .map((n) => n.getBoundingClientRect()).filter((r) => r.width && r.height);
  }
  return hudCache.rects;
}

function placePins() {
  if (!pins.sites.length) return;
  const box = canvas.getBoundingClientRect();
  // The Earth & Sun view shows no pins: only the selected site, as a pulsing dot with no label,
  // where it faces the camera (sitePulse, style.css).
  const es = mode === 'es';
  pinLayer.classList.toggle('es', es);
  sitePulse.hidden = true;
  pickMark.hidden = true;
  if (es) {
    const i = pins.sites.findIndex((s) => s.id === pins.selected);
    if (i < 0) return;
    // On the face where it faces the camera; otherwise on the limb, in its direction from the
    // Moon's centre on screen (a polar site side-on: where its pole meets the limb).
    tmpV.copy(pins.local[i]).applyQuaternion(moon.quaternion);
    toCam.copy(camera.position).sub(tmpV);
    const facing = tmpV.dot(toCam) > 0.02 * toCam.length();
    tmpV.project(camera);
    let x = box.left + (tmpV.x + 1) / 2 * box.width, y = box.top + (1 - tmpV.y) / 2 * box.height;
    if (!facing) {
      tmpV.set(0, 0, 0).project(camera);
      const cx = box.left + (tmpV.x + 1) / 2 * box.width, cy = box.top + (1 - tmpV.y) / 2 * box.height;
      const dx = x - cx, dy = y - cy, len = Math.hypot(dx, dy);
      if (len < 2) return; // straight behind the centre: no direction to show
      const pxPerUnit = box.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      const limb = pxPerUnit / Math.sqrt(Math.max(camera.position.lengthSq() - 1, 1e-6)); // the Moon's radius on screen
      x = cx + dx / len * limb;
      y = cy + dy / len * limb;
    }
    sitePulse.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    sitePulse.hidden = underFront(x, y, 6);
    return;
  }
  const groups = pinGroups(box);
  const key = groups.map((g) => g.members.join(',')).join('|') + '#' + pins.selected;
  if (key !== pins.key) {
    pinLayer.replaceChildren();
    buildPins(groups);
    pins.key = key;
  }
  const blocked = hudRects();
  const hits = (x, y, w, h) => blocked.some((r) => x < r.right && x + w > r.left && y < r.bottom && y + h > r.top);
  const shown = groups.map((g) => g.x - PIN / 2 >= 0 && g.y - PIN / 2 >= 0 && g.x + PIN / 2 <= innerWidth &&
    g.y + PIN / 2 <= innerHeight && !hits(g.x - PIN / 2, g.y - PIN / 2, PIN, PIN) && !underFront(g.x, g.y, 12)); // 12: a numbered pin's badge
  groups.forEach((g, i) => {
    const { button } = pins.els[i];
    button.hidden = !shown[i];
    button.style.transform = `translate(${(g.x - PIN / 2).toFixed(1)}px, ${(g.y - PIN / 2).toFixed(1)}px)`;
  });

  // The selected site's label, beside its pin wherever it collides with nothing.
  // A label may reach into its own pin's hit area (it doesn't take taps), but no other.
  const taken = groups.map((g, i) => shown[i] && [g.x - PIN / 2, g.y - PIN / 2, PIN, PIN, i]).filter(Boolean);
  const clear = (x, y, w, h, own) => x >= 0 && y >= 0 && x + w <= innerWidth && y + h <= innerHeight && !hits(x, y, w, h) &&
    !taken.some(([tx, ty, tw, th, ti]) => ti !== own && x < tx + tw && x + w > tx && y < ty + th && y + h > ty);
  const order = groups.map((g, i) => i).sort((a, b) => pins.els[b].on - pins.els[a].on);
  for (const i of order) {
    const { label, variants, on } = pins.els[i];
    if (!label) continue;
    const g = groups[i];
    let spot = null;
    for (const v of shown[i] ? variants : []) {
      const y = g.y - v.h / 2;
      const x = [g.x + PIN / 2 - 6, g.x - PIN / 2 + 6 - v.w].find((x) => clear(x, y, v.w, v.h, i));
      if (x !== undefined) { spot = { ...v, x, y }; break; }
    }
    if (!spot && on && shown[i]) { // the selected label always shows, kept on screen
      const v = variants[variants.length - 1];
      spot = { ...v, x: Math.max(4, Math.min(innerWidth - v.w - 4, g.x + PIN / 2 - 6)), y: g.y - v.h / 2 };
    }
    label.hidden = !spot;
    if (!spot) continue;
    if (label.textContent !== spot.text) label.textContent = spot.text;
    label.style.transform = `translate(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px)`;
    taken.push([spot.x, spot.y, spot.w, spot.h, -1]);
  }
  placePick(box, hits);
}

// The selected typed or clicked point (no pin of its own): a diamond-and-dot mark where it faces
// the camera, in the close view only, never under a panel or a body in front (style.css .pick).
const pickMark = document.createElement('span');
pickMark.className = 'pick';
pickMark.setAttribute('aria-hidden', 'true');
pickMark.hidden = true;
let pickAt = null;
let travelPickAt = null;
document.addEventListener('tanaw:travel', ({ detail }) => {
  travelPickAt = detail.open && detail.placement ? moonVector(detail.placement.lat, detail.placement.lon) : null;
});
const PICK = 18;
function placePick(box, hits) {
  pickMark.hidden = true;
  const placement = travelPickAt || pickAt;
  if (!placement || covered || descent) return;
  tmpV.copy(placement).applyQuaternion(moon.quaternion);
  toCam.copy(camera.position).sub(tmpV);
  if (tmpV.dot(toCam) <= 0.02 * toCam.length()) return; // on the far side of the Moon
  tmpV.project(camera);
  const x = box.left + (tmpV.x + 1) / 2 * box.width, y = box.top + (1 - tmpV.y) / 2 * box.height;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight || hits(x - PICK / 2, y - PICK / 2, PICK, PICK) || underFront(x, y, PICK / 2)) return;
  pickMark.style.transform = `translate(${(x - PICK / 2).toFixed(1)}px, ${(y - PICK / 2).toFixed(1)}px)`;
  pickMark.hidden = false;
}

// Sun and Earth: their real directions at the current instant (see applySun), not their real
// distances or sizes. On wider screens Earth is a small globe 2.2 Moon radii out along the
// sub-Earth direction and the Sun a small flat disc 2.6 out along the subsolar one. When a body
// isn't drawn (out of the band, behind the Moon, under overlay text, or on a phone), a marker at
// the band's edge points to it. Rings on the Moon mark where each is overhead. Earth's own spin
// isn't in the data, so its map keeps one fixed orientation.
const EARTH_AT = 2.2, EARTH_R = 0.12, SUN_AT = 2.6, SUN_R = 0.08;
// The Earth & Sun view draws them bigger and further out, with one size rule for all three so
// the sizes read in the real order, Sun > Earth > Moon (still not to scale; About says so): each
// body's drawn radius is its true radius to the power SIZE_POWER, in Moon radii (the Moon 1,
// Earth about 1.14, the Sun about 1.82). Earth at 4.2 out, the Sun 2.5 times as far, so its
// path stays well outside Earth's loop and never seems to jump over Earth; the Sun is drawn at
// ES_SUN_SIZE times Earth's drawn size on screen, so the ratio holds wherever it moves. The
// plane's ring and the pole-to-Earth line follow Earth's distance.
const SIZE_POWER = 0.1;
const ES_EARTH_AT = 4.2, ES_EARTH_R = (6371 / MOON_KM) ** SIZE_POWER, ES_SUN_AT = 2.5 * ES_EARTH_AT;
const ES_SUN_SIZE = (696000 / MOON_KM) ** SIZE_POWER / ES_EARTH_R;
const earthAt = () => (mode === 'es' ? ES_EARTH_AT : EARTH_AT);
const PHONE_BODIES = 5; // camera distance (Moon radii)
const EDGE_GAP = 12; // markers keep this far inside the band
const RING = 14;
const phone = matchMedia('(max-width: 760px)');
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Earth and the Sun as every 3D view draws them (bodies.js). Earth is lit along the same Sun
// direction as the Moon, so its phase shows; a faint fill (EARTH_FILL, towards the camera) keeps
// a night-side Earth reading as a sphere; it is decorative, not a lighting result. Its map loads
// on first use on a wider screen.
const EARTH_FILL = 0.04;
const earth = createEarth({ radius: EARTH_R, fill: EARTH_FILL });
const earthMesh = earth.mesh;
earthMesh.visible = false;
moon.add(earthMesh); // in the Moon's frame, so Earth's north stays the Moon's north
let earthMap = null; // null, 'loading', 'failed' or the texture
function loadEarth() {
  earthMap = 'loading';
  loadEarthMap().then((map) => { earth.setMap(map); earthMap = map; }, () => { earthMap = 'failed'; }); // Earth then shows by its edge marker only
}
const SUN_GLOW = 2.5;
const sunBody = createSun({ radius: SUN_R, glow: SUN_GLOW });
const sunDisc = sunBody.object;
sunDisc.visible = false;
scene.add(sunDisc); // the depth test hides it behind the Moon

// The focused site's 5 km ring, the border it shares with the site view: a circle RING_KM round
// the site on the sphere, a hair above the ground, a 1 px line in --text at 70% like the site
// view's ring. Shown once it is at least RING_MIN_PX in radius on screen (so during the dive,
// not as a blob from afar), and hidden under the site view, which tilts away from it, and while
// the host's "5 km ring" option is off (tanaw:layers, forecast.js).
const RING_POINTS = 128, RING_LIFT = 1 + 1e-5, RING_MIN_PX = 6;
const ringLine = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
  color: new THREE.Color(token('--text')), transparent: true, opacity: 0.7, depthWrite: false,
}));
ringLine.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(RING_POINTS * 3), 3));
ringLine.visible = false;
moon.add(ringLine);
const ringAt = { site: '', centre: new THREE.Vector3() };
let ringOn = true;
document.addEventListener('tanaw:layers', (e) => {
  ringOn = e.detail.ring;
  if ((e.detail.map || '') !== layerWanted) showLayer(e.detail.map);
  if (Boolean(e.detail.shadow) !== shadeWanted) showShade(Boolean(e.detail.shadow));
});
const ringE1 = new THREE.Vector3(), ringE2 = new THREE.Vector3(), ringP = new THREE.Vector3(), ringToCam = new THREE.Vector3();

function buildRing(id) {
  ringAt.site = id;
  ringAt.centre.copy(pins.local[pins.sites.findIndex((s) => s.id === id)]).normalize();
  // Two directions across the site's tangent plane (any pair will do for a circle).
  ringE1.set(0, 1, 0).cross(ringAt.centre);
  if (ringE1.lengthSq() < 1e-12) ringE1.set(1, 0, 0);
  ringE1.normalize();
  ringE2.crossVectors(ringAt.centre, ringE1);
  const pos = ringLine.geometry.attributes.position;
  const c = Math.cos(RING_ANGLE), s = Math.sin(RING_ANGLE);
  for (let k = 0; k < RING_POINTS; k++) {
    const a = (k / RING_POINTS) * 2 * Math.PI;
    ringP.copy(ringAt.centre).multiplyScalar(c)
      .addScaledVector(ringE1, s * Math.cos(a)).addScaledVector(ringE2, s * Math.sin(a)).multiplyScalar(RING_LIFT);
    pos.setXYZ(k, ringP.x, ringP.y, ringP.z);
  }
  pos.needsUpdate = true;
  ringLine.geometry.computeBoundingSphere();
}

function placeRing() {
  const id = descent ? descent.site : pins.selected;
  ringLine.visible = false;
  if (!id || !ringOn || !(focused || descent) || covered) return;
  if (!pins.sites.some((s) => s.id === id)) return; // typed coordinates have no pin and no ring
  if (id !== ringAt.site) buildRing(id);
  ringP.copy(ringAt.centre).applyQuaternion(moon.quaternion);
  ringToCam.copy(camera.position).sub(ringP);
  const dist = ringToCam.length();
  const px = Math.sin(RING_ANGLE) / dist * canvas.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  ringLine.visible = ringP.dot(ringToCam) > 0 && px >= RING_MIN_PX;
}

// Tabler "arrow-up" (outline), turned to point along the marker's ray.
const ARROW = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5l0 14"/><path d="M18 11l-6 -6"/><path d="M6 11l6 -6"/></svg>';
const bodyLayer = document.getElementById('bodies');
bodyLayer.append(pickMark);
const bodyLabel = document.createElement('span');
bodyLabel.className = 'body-label';
bodyLabel.setAttribute('aria-hidden', 'true');
bodyLabel.textContent = 'Earth';
bodyLabel.hidden = true;

function bodyMarks(name, cls) {
  const ring = document.createElement('span');
  ring.className = `overhead ${cls}`;
  ring.setAttribute('role', 'img');
  ring.setAttribute('aria-label', `${name} overhead`);
  ring.title = `${name} overhead`;
  const edge = document.createElement('span');
  edge.className = `edge ${cls}`;
  edge.setAttribute('aria-hidden', 'true');
  edge.innerHTML = ARROW;
  edge.append(name);
  ring.hidden = edge.hidden = true;
  bodyLayer.append(ring, edge);
  return { ring, edge, arrow: edge.firstElementChild, w: 0, h: 0 };
}
const earthMarks = bodyMarks('Earth', 'earth');
const sunMarks = bodyMarks('Sun', 'sun');
bodyLayer.append(bodyLabel);
const label = { w: 0, h: 0 };

// Earth & Sun view only, drawn as SVG over the canvas (so strokes are exact and use the tokens)
// wherever the Moon doesn't hide them: the Moon's equator plane as a faint ring at Earth's
// distance, so Earth sits visibly above or below it; a short mark down the axis below the pole;
// and, for a polar site (the pole stands for it), a line from the mark's tip to Earth's centre,
// solid while the forecast has Earth in view from the site, dashed while it doesn't. The ring's
// label sits by its left end. The Sun is drawn at
// Earth's size with a "Sun" chip, and moved just off the Moon's limb when it would cover the face.
const POLE_END = 1.18;
const POLAR_LAT = 80; // sites at least this close to a pole get the line
const SUN_GAP = 6; // px between the Moon's limb and a Sun moved off its face
const topbar = document.querySelector('.topbar');
const COL_GAP = 16; // px the ring and the Sun keep clear of the sky clock column
const CHIP_GAP = 12; // px the Earth & Sun view's body chips keep from the screen's edges
function textChip(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.setAttribute('aria-hidden', 'true');
  el.textContent = text;
  el.hidden = true;
  return el;
}
const planeLabel = textChip('plane-label', "Moon's equator plane");
const sunLabel = textChip('body-label', 'Sun');
const planeSize = { w: 0, h: 0 }, sunSize = { w: 0, h: 0 };
const skyCol = document.getElementById('ring'); // the sky clock column, while it stands top left
const SVGNS = 'http://www.w3.org/2000/svg';
const esSvg = document.createElementNS(SVGNS, 'svg');
esSvg.setAttribute('class', 'es-lines');
esSvg.setAttribute('aria-hidden', 'true');
const [sunPath, loopPath, planePath, polePath, contactPath] = ['sun-path', 'earth-loop', 'plane', 'pole', 'contact'].map((cls) => {
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('class', cls);
  return path;
});
esSvg.append(sunPath, loopPath, planePath, polePath, contactPath);

// The Earth & Sun view's paths over the shown range (tanaw:track, forecast.js): the Sun's and
// Earth's Moon-frame directions every few hours, from the computation module (the published
// hourly points, or the estimate's track). Drawn as the Sun's path round the Moon at its
// distance and Earth's small libration loop at its distance; nothing is computed here.
let track = null; // { sun: [x, y, z, ...], earth: [...] }
document.addEventListener('tanaw:track', (e) => { track = e.detail; redraw = true; });
bodyLayer.prepend(esSvg);
const sitePulse = document.createElement('span'); // the selected site in the Earth & Sun view
sitePulse.className = 'site-pulse';
sitePulse.setAttribute('aria-hidden', 'true');
sitePulse.hidden = true;
bodyLayer.append(planeLabel, sunLabel, readout, sitePulse);
// Chip sizes are measured once shown, and again once the web font has loaded.
document.fonts.ready.then(() => { earthMarks.w = sunMarks.w = label.w = planeSize.w = sunSize.w = 0; readoutSize.text = ''; });

// A world point in viewport px, with its depth in front of the camera (negative behind it).
const clipV = new THREE.Vector4();
function onScreen(p, box) {
  clipV.set(p.x, p.y, p.z, 1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  return {
    x: box.left + (clipV.x / clipV.w + 1) / 2 * box.width,
    y: box.top + (1 - clipV.y / clipV.w) / 2 * box.height,
    depth: clipV.w,
  };
}

// Whether the Moon (radius 1 at the origin) lies between the camera and a world point.
const rayV = new THREE.Vector3();
function behindMoon(p) {
  const c = camera.position;
  rayV.copy(p).sub(c);
  const len = rayV.length();
  rayV.divideScalar(len);
  const along = -c.dot(rayV);
  const miss = c.lengthSq() - along * along;
  return along > 0 && miss < 1 && along - Math.sqrt(1 - miss) < len;
}

// The marker's centre on the ray from the Moon's centre (from) along (dx, dy), clamped inside
// the band; when that spot hits overlay text or another marker, it slides along the band's edge
// to the nearest clear spot. null when there is none.
function edgeSpot(from, dx, dy, w, h, bandBox, clear) {
  const L = bandBox.left + EDGE_GAP + w / 2, R = bandBox.right - EDGE_GAP - w / 2;
  const T = bandBox.top + EDGE_GAP + h / 2, B = bandBox.bottom - EDGE_GAP - h / 2;
  if (L > R || T > B) return null;
  const ox = THREE.MathUtils.clamp(from.x, L, R), oy = THREE.MathUtils.clamp(from.y, T, B);
  const tx = dx > 0 ? (R - ox) / dx : dx < 0 ? (L - ox) / dx : Infinity;
  const ty = dy > 0 ? (B - oy) / dy : dy < 0 ? (T - oy) / dy : Infinity;
  const t = Math.min(tx, ty);
  const px = THREE.MathUtils.clamp(ox + t * dx, L, R), py = THREE.MathUtils.clamp(oy + t * dy, T, B);
  const slideY = tx <= ty; // on a side edge, slide up or down; on the top or bottom, sideways
  const [lo, hi, at] = slideY ? [T, B, py] : [L, R, px];
  for (let off = 0; at - off >= lo || at + off <= hi; off += 4) {
    for (const v of off ? [at - off, at + off] : [at]) {
      if (v < lo || v > hi) continue;
      const x = slideY ? px : v, y = slideY ? v : py;
      if (clear(x - w / 2, y - h / 2, w, h)) return { x, y };
    }
  }
  return null;
}

// Show a text chip at a spot (or hide it without one), and keep later chips clear of it.
function putChip(el, spot, size, taken) {
  el.hidden = !spot;
  if (!spot) return;
  el.style.transform = `translate(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px)`;
  taken.push({ left: spot.x, right: spot.x + size.w, top: spot.y, bottom: spot.y + size.h });
}
function measure(el, size) {
  el.hidden = false;
  if (!size.w) { size.w = el.offsetWidth; size.h = el.offsetHeight; }
  return size;
}

const bodyPos = new THREE.Vector3();
const surface = new THREE.Vector3();
const ndcV = new THREE.Vector3();
function placeBodies() {
  const box = canvas.getBoundingClientRect();
  const { top, bottom, left, right } = bandInCanvas();
  const bandBox = { left: box.left + left, right: box.left + right, top: box.top + top, bottom: box.top + bottom };
  const es = mode === 'es';
  // Phones show the bodies only in the Earth & Sun view, or once pulled back past PHONE_BODIES.
  const small = phone.matches && !es && camera.position.length() < PHONE_BODIES;
  if (!small && !earthMap) loadEarth();
  earth.setSun(sun.subsolar); // in the Moon's frame, Earth's parent
  earth.update(camera);

  // The sky clock column, while it stands top left: its whole box, which can run taller than its
  // overlay blocks (the diagram, and Times while a site is focused).
  const colBox = skyCol.parentElement?.classList.contains('hud') && skyCol.checkVisibility({ visibilityProperty: true }) ?
    skyCol.getBoundingClientRect() : null;
  const blocked = [...hudRects()];
  if (colBox) blocked.push(colBox);
  // Markers and the Earth label keep clear of the site pins and their labels as well as of
  // each other.
  const taken = [...document.querySelectorAll('#pins .pin:not([hidden]), #pins .pin-label:not([hidden])')]
    .map((n) => n.getBoundingClientRect()).filter((r) => r.width && r.height);
  const overlaps = (x, y, w, h, list) => list.some((r) => x < r.right && x + w > r.left && y < r.bottom && y + h > r.top);
  const inBand = (x, y, w, h) => x >= bandBox.left && y >= bandBox.top && x + w <= bandBox.right && y + h <= bandBox.bottom;
  const clear = (x, y, w, h) => inBand(x, y, w, h) && !overlaps(x, y, w, h, blocked) && !overlaps(x, y, w, h, taken);

  // The lat/lon readout, first, in the band's bottom-left corner (EDGE_GAP inside it, and right of
  // the sky clock column where the two would meet), or bottom right or centre when a pin is within
  // 12 px; the markers keep clear of it.
  const at = gridOn && !es && !siteVisible && !descent ? (pointer.mouse ? latLonAt(pointer.x, pointer.y) : pointer.tap) : '';
  readout.hidden = !at;
  if (at) {
    if (at !== readoutSize.text) {
      readout.textContent = readoutSize.text = at;
      readoutSize.w = readout.offsetWidth;
      readoutSize.h = readout.offsetHeight;
    }
    const y = bandBox.bottom - EDGE_GAP - readoutSize.h, w = readoutSize.w, h = readoutSize.h;
    let left = bandBox.left + EDGE_GAP;
    if (colBox && overlaps(left, y, w, h, [colBox])) left = colBox.right + COL_GAP;
    // The first spot clear of every pin's 44 px hit area (which keeps the chip at least 12 px from
    // the pin's dot) and of the controls: bottom left, bottom right, bottom centre; then up from
    // the bottom in 8 px steps, left and then right; then the band's top left and top right, just
    // under the top bar; last, along the row just under the top bar from the left.
    const right = bandBox.right - EDGE_GAP - w, top = bandBox.top + EDGE_GAP;
    const spots = [[left, y], [right, y], [(bandBox.left + bandBox.right - w) / 2, y]];
    for (let up = y - 8; up >= top; up -= 8) spots.push([left, up], [right, up]);
    spots.push([left, top], [right, top]);
    const under = topbar.getBoundingClientRect().bottom + 4;
    for (let x = EDGE_GAP; x + w <= innerWidth - EDGE_GAP; x += 8) spots.push([x, under]);
    const [x, yy] = spots.find(([cx, cy]) => !overlaps(cx, cy, w, h, taken) && !overlaps(cx, cy, w, h, blocked)) ?? [left, y];
    readout.style.transform = `translate(${x.toFixed(1)}px, ${yy.toFixed(1)}px)`;
    taken.push({ left: x, right: x + w, top: yy, bottom: yy + h });
  }
  const centre = onScreen(bodyPos.set(0, 0, 0), box);
  const pxPerUnit = box.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  // The Moon's drawn radius: the camera always looks at its centre, so its outline is a circle.
  const moonPx = pxPerUnit / Math.sqrt(Math.max(camera.position.lengthSq() - 1, 1e-6));
  let earthDrawn = null, sunDrawn = null, earthPx = 0;
  // The left limit of the Earth & Sun view's ring and Sun: the band, and 16 px clear of the sky
  // clock column while it stands top left (with Times under it while a site is focused).
  let ringMin = bandBox.left;
  if (colBox) ringMin = Math.max(ringMin, colBox.right + COL_GAP);

  // First each body and its overhead ring, so the markers can keep clear of both.
  const seen = [[earthMarks, earthMesh, sun.subEarth, earthAt(), es ? ES_EARTH_R : EARTH_R], [sunMarks, sunDisc, sun.subsolar, es ? ES_SUN_AT : SUN_AT, SUN_R]].map(([marks, mesh, local, at, radius]) => {
    const isEarth = mesh === earthMesh;
    if (!sun.known) {
      mesh.visible = false;
      marks.ring.hidden = marks.edge.hidden = true;
      return null;
    }
    bodyPos.copy(local).applyQuaternion(moon.quaternion).multiplyScalar(at);
    const s = onScreen(bodyPos, box);
    let r = s.depth > 0 ? radius * pxPerUnit / s.depth : Infinity;
    if (isEarth) earthPx = r;
    let drawn;
    if (es && !isEarth) {
      // Earth & Sun: the Sun at Earth's drawn size, at its real direction unless that falls on
      // the Moon's disc (in front or behind); then just outside the limb, on the line from the
      // Moon's centre towards it. It keeps its depth, so its size holds wherever it moves.
      r = ES_SUN_SIZE * (Number.isFinite(earthPx) && earthPx > 0 ? earthPx : ES_EARTH_R * pxPerUnit / camera.position.length());
      ndcV.copy(bodyPos).project(camera);
      let dx = s.x - centre.x, dy = s.y - centre.y;
      const len = Math.hypot(dx, dy), off = moonPx + r + SUN_GAP;
      // Off the Moon's disc, and off Earth's: further out along its own direction on screen
      // until it is clear of both (its direction stays real; only its distance changes).
      // Earth's outline is drawn a little larger than radius / distance (a near sphere), so 2% more.
      const clearOfEarth = (x, y) => !earthDrawn || Math.hypot(x - earthDrawn.x, y - earthDrawn.y) >= earthDrawn.r * 1.02 + r + SUN_GAP;
      if (len < off || !clearOfEarth(s.x, s.y)) {
        // On the Moon's disc its direction is nearly along the line of sight, so its direction
        // on screen means little: it goes to the side away from Earth.
        if (len < off && earthDrawn) { dx = centre.x - earthDrawn.x; dy = centre.y - earthDrawn.y; }
        const n = Math.hypot(dx, dy);
        if (n < 0.5) { dx = 0; dy = -1; } else { dx /= n; dy /= n; }
        let t = Math.max(len, off);
        while (!clearOfEarth(centre.x + dx * t, centre.y + dy * t) && t < off + 4 * (moonPx + r)) t += 4;
        s.x = centre.x + dx * t;
        s.y = centre.y + dy * t;
        // Pushed out of the band (a narrow screen): beside Earth instead, the first spot round
        // it, from its own side, that is inside the band and off the Moon's disc.
        if (earthDrawn && !inBand(s.x - r, s.y - r, 2 * r, 2 * r)) {
          const d0 = earthDrawn.r + r + SUN_GAP, a0 = Math.atan2(s.y - earthDrawn.y, s.x - earthDrawn.x);
          for (let k = 1; k <= 24; k++) {
            const a = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.PI / 12;
            const x = earthDrawn.x + Math.cos(a) * d0, y = earthDrawn.y + Math.sin(a) * d0;
            if (inBand(x - r, y - r, 2 * r, 2 * r) && Math.hypot(x - centre.x, y - centre.y) >= off) { s.x = x; s.y = y; break; }
          }
        }
        ndcV.x = (s.x - box.left) / box.width * 2 - 1;
        ndcV.y = 1 - (s.y - box.top) / box.height * 2;
      }
      // Never in the sky clock column: the disc, and its chip when that goes on the left (the
      // side away from the Moon), stay right of ringMin, and the chip CHIP_GAP from the screen's edge.
      const minX = r + (s.x < centre.x ? Math.max(ringMin, CHIP_GAP) + measure(sunLabel, sunSize).w + 6 : ringMin);
      if (s.x < minX) {
        s.x = minX;
        ndcV.x = (s.x - box.left) / box.width * 2 - 1;
      }
      // Framed to fit, but drawn at Earth's size on screen, which perspective can make a few px
      // larger than the framing allowed: nudged back inside the band rather than dropped.
      if (s.depth > 0 && 2 * r + 2 <= bandBox.right - bandBox.left && 2 * r + 2 <= bandBox.bottom - bandBox.top) {
        const nx = THREE.MathUtils.clamp(s.x, bandBox.left + r + 1, bandBox.right - r - 1), ny = THREE.MathUtils.clamp(s.y, bandBox.top + r + 1, bandBox.bottom - r - 1);
        if (Math.hypot(nx - s.x, ny - s.y) <= r) {
          s.x = nx;
          s.y = ny;
          ndcV.x = (s.x - box.left) / box.width * 2 - 1;
          ndcV.y = 1 - (s.y - box.top) / box.height * 2;
        }
      }
      drawn = s.depth > 0 && inBand(s.x - r, s.y - r, 2 * r, 2 * r) && !overlaps(s.x - r, s.y - r, 2 * r, 2 * r, blocked);
      sunDisc.position.copy(ndcV.unproject(camera));
      sunDisc.scale.setScalar(s.depth > 0 ? r * s.depth / pxPerUnit / SUN_R : 1);
      sunDisc.quaternion.copy(camera.quaternion);
    } else {
      drawn = !small && s.depth > 0 && (!isEarth || earthMap?.isTexture === true) && !behindMoon(bodyPos) &&
        inBand(s.x - r, s.y - r, 2 * r, 2 * r) && !overlaps(s.x - r, s.y - r, 2 * r, 2 * r, blocked);
      if (isEarth) {
        earthMesh.position.copy(local).multiplyScalar(at);
        earthMesh.scale.setScalar(radius / EARTH_R);
      }
      else {
        sunDisc.position.copy(bodyPos);
        sunDisc.scale.setScalar(1);
        sunDisc.quaternion.copy(camera.quaternion); // face the camera
      }
    }
    // A body in front of the Moon draws over its face, with its chip; one behind it is hidden
    // by the Moon (behindMoon and the depth test). inFront: its disc overlaps the Moon's on
    // screen while nearer than the plane of the Moon's limb; its chip may then sit on the face.
    const reach = isEarth ? r : r * SUN_GLOW; // px
    const limbDepth = centre.depth - 1 / centre.depth;
    const inFront = s.depth > 0 && s.depth * (1 - reach / pxPerUnit) < limbDepth &&
      Math.hypot(s.x - centre.x, s.y - centre.y) < moonPx + reach;
    mesh.visible = drawn;
    if (drawn) {
      const disc = { left: s.x - r, right: s.x + r, top: s.y - r, bottom: s.y + r };
      taken.push(disc);
      if (isEarth) earthDrawn = { x: s.x, y: s.y, r, disc, inFront };
      else sunDrawn = { x: s.x, y: s.y, r, disc, inFront };
    }

    // The overhead ring: where the body is straight up, on the side of the Moon facing the
    // camera, unless the drawn body covers it.
    surface.copy(local).applyQuaternion(moon.quaternion);
    toCam.copy(camera.position).sub(surface);
    let ring = null;
    if (!es && surface.dot(toCam) > 0.02 * toCam.length()) {
      const p = onScreen(surface, box);
      const x = p.x - RING / 2, y = p.y - RING / 2;
      const underBody = drawn && Math.hypot(p.x - s.x, p.y - s.y) < r + RING / 2;
      if (x >= 0 && y >= 0 && x + RING <= innerWidth && y + RING <= innerHeight && !overlaps(x, y, RING, RING, blocked) && !underBody) ring = { x, y };
    }
    marks.ring.hidden = !ring;
    if (ring) {
      marks.ring.style.transform = `translate(${ring.x.toFixed(1)}px, ${ring.y.toFixed(1)}px)`;
      taken.push({ left: ring.x, right: ring.x + RING, top: ring.y, bottom: ring.y + RING });
    }
    return { marks, s, drawn };
  });
  // A body in front of the Moon covers what lies on the Moon under it: the overhead rings
  // here, and the pins and the selected site's pulse (placePins, which runs after this).
  frontDiscs = [earthDrawn, sunDrawn].filter((b) => b?.inFront);
  for (const body of seen) {
    if (!body || body.marks.ring.hidden) continue;
    const r = body.marks.ring.getBoundingClientRect();
    if (underFront(r.left + r.width / 2, r.top + r.height / 2, RING / 2)) body.marks.ring.hidden = true;
  }

  // Then the edge marker of each body that isn't drawn, on the ray from the Moon's centre
  // towards it (flipped when the body is behind the camera, whose projection mirrors it).
  for (const body of seen) {
    if (!body) continue;
    const { marks, s, drawn } = body;
    let spot = null;
    let dx = s.x - centre.x, dy = s.y - centre.y;
    if (s.depth < 0) { dx = -dx; dy = -dy; }
    const len = Math.hypot(dx, dy);
    // In the Earth & Sun view too: a body the interface or the screen's edge would hide is
    // pointed to, never dropped silently.
    if (!drawn && len > 0.5 && Number.isFinite(len)) {
      marks.edge.hidden = false;
      if (!marks.w) { marks.w = marks.edge.offsetWidth; marks.h = marks.edge.offsetHeight; }
      spot = edgeSpot(centre, dx / len, dy / len, marks.w, marks.h, bandBox, clear);
    }
    marks.edge.hidden = !spot;
    if (spot) {
      const x = spot.x - marks.w / 2, y = spot.y - marks.h / 2;
      marks.edge.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      marks.arrow.style.transform = `rotate(${Math.atan2(dx, -dy).toFixed(3)}rad)`;
      taken.push({ left: x, right: x + marks.w, top: y, bottom: y + marks.h });
    }
  }

  // "Earth" beside the drawn Earth, and "Sun" beside the Earth & Sun view's Sun,
  // right or left (the side away from the Moon first), else above or below it, wherever it is
  // clear and off the Moon's face (the whole chip, 4 px clear of the disc); a body in front of
  // the Moon may have its chip on the face when no spot off it is clear. In the Earth & Sun
  // view also CHIP_GAP inside the screen's edges.
  const inScreen = (x, y, w, h) => x >= CHIP_GAP && y >= CHIP_GAP && x + w <= innerWidth - CHIP_GAP && y + h <= innerHeight - CHIP_GAP;
  const beside = (el, size, body) => {
    if (!body) return null;
    measure(el, size);
    const { x: bx, y: by, r, disc, inFront } = body;
    const y = by - size.h / 2;
    const others = taken.filter((t) => t !== disc);
    const sides = [bx + r + 6, bx - r - 6 - size.w];
    if (bx < centre.x) sides.reverse();
    const offFace = (x, y) => Math.hypot(THREE.MathUtils.clamp(centre.x, x, x + size.w) - centre.x,
      THREE.MathUtils.clamp(centre.y, y, y + size.h) - centre.y) > moonPx + 4;
    // Beside it first, then centred above or below it.
    const spots = [...sides.map((x) => [x, y]), [bx - size.w / 2, by - r - 6 - size.h], [bx - size.w / 2, by + r + 6]];
    const fits = ([x, y]) => inBand(x, y, size.w, size.h) && (!es || inScreen(x, y, size.w, size.h)) &&
      !overlaps(x, y, size.w, size.h, blocked) && !overlaps(x, y, size.w, size.h, others);
    const at = spots.find((p) => fits(p) && offFace(...p)) ?? (inFront ? spots.find(fits) : undefined);
    return at ? { x: at[0], y: at[1] } : null;
  };
  putChip(bodyLabel, beside(bodyLabel, label, earthDrawn), label, taken);
  putChip(sunLabel, es ? beside(sunLabel, sunSize, sunDrawn) : null, sunSize, taken);

  // Earth & Sun: the plane's ring, the pole mark and the pole-to-Earth line, drawn where the
  // Moon doesn't hide them and outside Earth's and the Sun's discs. The ring stays inside the band (which ends
  // short of an open site panel) and 16 px clear of the sky clock column while it stands top left.
  const turn = moon.quaternion;
  const sel = pins.sites.find((s) => s.id === pins.selected);
  const polar = Boolean(sel) && Math.abs(sel.lat) >= POLAR_LAT;
  const poleSign = polar && sel.lat > 0 ? 1 : -1; // the south pole, unless the site is by the north one
  const outside = (body, p) => !body || Math.hypot(p.x - body.x, p.y - body.y) > body.r;
  const outsideBodies = (p) => outside(earthDrawn, p) && outside(sunDrawn, p);
  const plane = es ? linePath(256, box, (t, out) =>
    out.set(earthAt() * Math.cos(2 * Math.PI * t), 0, earthAt() * Math.sin(2 * Math.PI * t)).applyQuaternion(turn),
  (p) => outsideBodies(p) && p.x >= ringMin && p.x <= bandBox.right) : null;
  planePath.setAttribute('d', plane ? plane.d : '');
  const along = (list, at) => (t, out) => {
    const n = list.length / 3 - 1, k = Math.min(n, Math.round(t * n)) * 3;
    return out.set(list[k], list[k + 1], list[k + 2]).multiplyScalar(at).applyQuaternion(turn);
  };
  const steps = (list) => list.length / 3 - 1;
  sunPath.setAttribute('d', es && track?.sun.length > 3 ? linePath(steps(track.sun), box, along(track.sun, ES_SUN_AT), (p) => outsideBodies(p)).d : '');
  loopPath.setAttribute('d', es && track?.earth.length > 3 ? linePath(steps(track.earth), box, along(track.earth, ES_EARTH_AT), (p) => outside(sunDrawn, p)).d : '');
  polePath.setAttribute('d', es ? linePath(8, box, (t, out) => out.set(0, poleSign * (1.03 + (POLE_END - 1.03) * t), 0).applyQuaternion(turn)).d : '');
  const line = es && polar && earthDrawn ? contactLine(box, outsideBodies, poleSign) : null;
  contactPath.setAttribute('d', line ? line.d : '');
  contactPath.classList.toggle('off', !contact?.earthVisible);

  // The plane's label by the ring's left end, above it (or below it), not on phones; never over
  // the Moon, the lines or anything else.
  let planeSpot = null;
  if (es && !phone.matches && plane?.left) {
    const { w, h } = measure(planeLabel, planeSize);
    const end = plane.left;
    const at = [[end.x, end.y - h - 4], [end.x, end.y + 4]].find(([x, y]) => clear(x, y, w, h));
    if (at) planeSpot = { x: at[0], y: at[1] };
  }
  putChip(planeLabel, planeSpot, planeSize, taken);
}

// An SVG path through n + 1 points along a line in world space (at(t, out), t from 0 to 1), kept
// where the Moon doesn't hide them and keep(screen point) holds, joined into runs. Also the
// shown points and the one furthest left on screen.
const lineA = new THREE.Vector3(), lineB = new THREE.Vector3(), lineP = new THREE.Vector3();
function linePath(n, box, at, keep = () => true) {
  let d = '', run = false, left = null;
  const pts = [];
  for (let k = 0; k <= n; k++) {
    at(k / n, lineP);
    const p = onScreen(lineP, box);
    const shown = p.depth > 0 && !behindMoon(lineP) && keep(p);
    if (shown) {
      d += `${run ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
      pts.push(p);
      if (!left || p.x < left.x) left = p;
    }
    run = shown;
  }
  return { d, pts, left };
}

// The line from the pole mark's tip to Earth's centre, stopping at Earth's edge. null until the
// forecast's visibility for this site and instant is in.
function contactLine(box, keep, poleSign) {
  if (!contact || contact.site !== pins.selected || contact.instant !== sun.instant) return null;
  lineA.set(0, poleSign * POLE_END, 0).applyQuaternion(moon.quaternion);
  lineB.copy(sun.subEarth).multiplyScalar(earthAt()).applyQuaternion(moon.quaternion);
  return linePath(160, box, (t, out) => out.lerpVectors(lineA, lineB, t), keep);
}

const travelGlobe = createTravelGlobe({ moon, camera, canvas, moonVector });
const compareGlobe = createCompareGlobe({ moon, camera, canvas, moonVector, underFront });
document.addEventListener('tanaw:compare-pick', event => {
  // Explicit navigation also recentres the current site after a manual globe rotation.
  if (mode !== 'close') setMode('close');
  flyTo(moonVector(event.detail.lat, event.detail.lon), camera.position.length());
  redraw = true;
});
document.addEventListener('tanaw:compare', event => {
  pins.key = ''; redraw = true;
  if (pinList.matches(':popover-open')) pinList.hidePopover();
  if (event.detail.active && mode !== 'close') setMode('close');
});
document.addEventListener('tanaw:travel', () => { redraw = true; });
// Arrival: the Moon is first drawn only once the host has sent the band, so its first frame is
// already framed (never the whole window), and from ARRIVE_FROM times further out, gliding in
// to its framed pose over ARRIVE_MS (eased); then the interface fades in (style.css). With
// reduced motion it simply appears.
const ARRIVE_FROM = 1.3, ARRIVE_MS = 1000;
let moonAwaitingFirstFrame = false, revealed = false;
renderer.setAnimationLoop((now) => {
  frameNo++;
  if (!revealed && !band && now < 4000) return; // nothing shows before the band is known (4 s at most)
  if (moonAwaitingFirstFrame && !reduceMotion.matches) {
    const d = camera.position.length();
    camera.position.multiplyScalar(ARRIVE_FROM);
    flyPose(camera.quaternion.clone(), d);
    flight.ms = ARRIVE_MS;
    flight.t0 = now;
  }
  if (covered && !redraw && !framing && !flight) return; // a glide behind the site view still draws
  redraw = false;
  stepFrame(now);
  stepFlight(now);
  controls.rotateSpeed = grabSpeed();
  controls.update();
  camera.updateMatrixWorld();
  placeRing();
  grid.visible = gridOn && !siteVisible && !covered && !descent;
  placeBodies();
  starSky.update(camera, moon.quaternion, renderer.getPixelRatio(), siteVisible || covered || !!descent);
  renderer.render(scene, camera);
  if (moonAwaitingFirstFrame) {
    moonAwaitingFirstFrame = false;
    revealed = true;
    const stage = canvas.closest('.stage');
    stage.dataset.arrival = 'revealing';
    status.textContent = '';
    // One entrance only. Later panel/date changes keep their existing presentation.
    setTimeout(() => { delete stage.dataset.arrival; }, 650);
  }
  placePins();
  travelGlobe.render({ hidden: covered || siteVisible || mode !== 'close', band: band || { left: 0, top: 0, right: innerWidth, bottom: innerHeight } });
  compareGlobe.render({ hidden: covered || siteVisible || mode !== 'close', band: band || { left: 0, top: 0, right: innerWidth, bottom: innerHeight } });
  if (announce && descent) {
    document.dispatchEvent(new CustomEvent('tanaw:dive', { detail: { site: descent.site, ringFill: DIVE_FILL, north: northOnScreen() } }));
  }
  announce = false;
});

loadMoon()
  .then(() => {
    moonAwaitingFirstFrame = true; redraw = true;
    // Compile the globe's other shaders (the site's 5 km ring among them) while the page is
    // idle, so the first site picked doesn't wait for them.
    const warm = () => renderer.compileAsync(scene, camera).catch(() => {});
    if (window.requestIdleCallback) requestIdleCallback(warm, { timeout: 4000 }); else setTimeout(warm, 2000);
  })
  .catch(() => { status.textContent = "Couldn't load the Moon images. Reload to try again."; });
