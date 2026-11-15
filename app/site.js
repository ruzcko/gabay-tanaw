// Site view: a round disc of detailed terrain around the selected site, on coarser ground that
// runs to the horizon (far-ground.js) under a black sky with the Sun and Earth, lit by the forecast's Sun
// and Earth at the host's current instant (the lit hour, or the autoplay hour), slowly turning. The host (forecast.js) owns the view: tanaw:select
// says which site and whether to show it, tanaw:sky gives the lighting, and tanaw:spot the
// selected nearby spot, where the pin stands. Nothing here computes a sky position. Scene units are km: +X east, +Y up, +Z south (north is -Z).
import * as THREE from 'three';
import { buildTerrainGrid } from './observer/terrain-grid.js';
import { direction } from './observer/math.js';
import { buildFarGround } from './far-ground.js';
import { createEarth, createSun, loadEarthMap } from './bodies.js';
import { LAYER_GLSL, LAYER_KINDS, layerGlsl as slotGlsl, layerSlotUniforms, setLayerSlots, loadLayer, noLayer } from './map-layers.js';

const DISC_KM = 9, FADE_KM = 1, RING_KM = 5, EXAG = 1.5;
// The way in from the globe: the globe dives until its own 5 km ring is as large on screen as
// this view's ring seen from straight overhead (tanaw:dive, globe.js). This view fades in there
// (FADE_IN) with the ground flat, then the heights rise and the camera tilts down together
// (LIFT_MS). The way out runs it backwards (DEPART_MS) and fades out (FADE_OUT) over the globe
// at the same pose.
const FADE_IN = 400, FADE_SWAP = 200, FADE_OUT = 300, LIFT_MS = 1400, DEPART_MS = 700, FRAME_MS = 400;
const rad = Math.PI / 180;
const HALF_FOV = 20 * rad; // half the field of view across the band's narrower side
const PITCH = 40 * rad, PITCH_MIN = 12 * rad, PITCH_MAX = 80 * rad, PITCH_TOP = 90 * rad;
const FROM_DIST = 1.5, ZOOM_MIN = 0.5, ZOOM_MAX = 1.6, MARGIN = 0.92;
// Zooming out on past ZOOM_MAX by EXIT_ZOOM more, in one gesture (no pause over EXIT_GAP ms),
// asks the host for the whole Moon, like "Whole Moon" (tanaw:wholemoon, forecast.js).
const EXIT_ZOOM = 1.25, EXIT_GAP = 500;
const PIN_FROM = 0.8; // the pin, the spots and the "5 km" label fade in as the heights pass 80%
const SPIN = (2 * Math.PI) / 70, IDLE_MS = 4000; // one turn every 70 s, after 4 s without input
// The Sun sits a degree or two up at the pole, so flat ground gets only a few percent of full
// light: a strong light with tone mapping stands in for a camera exposed for the scene.
// FILL_I: a faint neutral fill from above, so ground in shadow reads as dark grey ground, not
// black space. It is decorative, not a lighting result.
const SUN_I = 26, EARTH_I = 1.2, FILL_I = 0.15, SUN_LOW = 6 * Math.PI / 180;
const PIN_KM = 1.6; // the pin's height for framing the disc
const PIN_PX = 56, PIN_DOT_PX = 12, PIN_STALK_PX = 2, PIN_RING_PX = 2; // the pin's size on screen at any distance
const MASK_FADE = 24; // px: the terrain fades out over this inside the free band's edges (style.css)
// Nearby spots: 44 px buttons on the ground (placeSpots); a tap within PICK_KM of one picks it
// too; the pin (hit within PIN_HIT px) eases between spots over PIN_MS. A view that opens on a
// spot off the site starts closer, so the spots fill about CLOSE_FILL of the band; "Nearby
// spots" eases to that framing over CLOSE_MS.
const SPOT_HIT = 44, SPOT_ZOOM_MIN = 0.3, PICK_KM = 0.25, PIN_HIT = 22, PIN_MS = 300, CLOSE_FILL = 0.6, CLOSE_MS = 600;
const TAP_PX = 6;
let spot = null;
let spots = null;
let pinAnim = null; // { from, to, t0 }

const canvas = document.getElementById('site');
const scaleLabel = document.getElementById('site-scale');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const colour = (name) => new THREE.Color(token(name));
const clamp = THREE.MathUtils.clamp;

// shown: the canvas is in (or fading in) and rendering. wanted: the site the view shows or is
// heading to. seq: bumped by every enter and leave, so a stale timer or load does nothing.
let shown = false;
let wanted = null;
let seq = 0;

// The canvas clears to transparent: the dimmed globe shows round the disc (style.css).
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false; // the lights only move with the date: redraw shadows then
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
// Shader errors are checked during development only: the check makes the browser finish
// compiling each shader before the frame can continue.
renderer.debug.checkShaderErrors = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);

// Sunlight is warm white, a physical constant rather than a design colour.
const sun = new THREE.DirectionalLight(new THREE.Color().setRGB(1, 0.957, 0.902, THREE.SRGBColorSpace), 0);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
const reach = DISC_KM + 1;
Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 120 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
// Earthshine: a faint blue light from Earth when it is in view.
const earthLight = new THREE.DirectionalLight(colour('--earth'), 0);
const fill = new THREE.HemisphereLight(0xffffff, 0x000000, FILL_I);
scene.add(sun, sun.target, earthLight, earthLight.target, fill);

// Terrain: the disc, the 5 km ring and the edge fade are drawn by horizontal distance from the
// site, after tone mapping, so the ring keeps its token colour and they hold while the ground is
// flat. The edge fades to transparent (colour and alpha together: the canvas is premultiplied).
// lift scales the mesh's heights (0 flat, 1 at EXAG) in the vertex shader, for the terrain and
// its shadows alike. ringAlpha: the ring's strength, 0 while the host's "5 km ring" is off.
const lift = { value: 1 }, ringAlpha = { value: 0.7 };
function liftHeights(shader) {
  shader.uniforms.lift = lift;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vFlat;\nuniform float lift;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlat = position.xz;\ntransformed.y *= lift;');
}
const ringColour = colour('--text').getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
// Map layers (tanaw:layers' map, forecast.js): the same value images as the globe, coloured
// here by token. The disc reads its site's own image (data/layers/sites/<id>.png, on the
// terrain tile's grid: R slope band, G sunlight %, B shadow; 255 no data); the far ground samples
// the globe's slots (map-layers.js) at its vertices' latitude and longitude. Drawn after the
// lighting at 80%, half-lit even in shadow, so they read on ground the Sun doesn't reach.
const srgbColour = (name) => { const c = colour(name).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace); return new THREE.Vector3(c.r, c.g, c.b); };
const layerShared = {
  layerKind: { value: 0 },
  layerBands: { value: ['--layer-0', '--layer-1', '--layer-2', '--layer-3'].map(srgbColour) },
  layerSunLow: { value: srgbColour('--glass-solid') },
  layerSunHigh: { value: srgbColour('--sun') },
  layerShadow: { value: srgbColour('--layer-shadow') },
  shadeOn: { value: 0 },
};
const layerGlsl = `
  uniform vec3 layerBands[4]; uniform vec3 layerSunLow; uniform vec3 layerSunHigh; uniform vec3 layerShadow; uniform float shadeOn;
  // Permanent shadow over either fill as an outline: where the flag (f, 0 or 1) changes from one
  // pixel to the next, --layer-shadow at full strength.
  vec3 withShade(vec3 rgb, float f) { return mix(rgb, layerShadow, clamp(fwidth(f), 0.0, 1.0) * shadeOn); }
  // value: 0-255 from the layer's channel; range: the largest real value (3, 100 or 1).
  vec3 withLayer(vec3 rgb, float raw) {
    float v = floor(raw + 0.5);
    float a = raw > (layerKind < 1.5 ? 3.5 : layerKind < 2.5 ? 100.5 : 1.01) || layerKind < 0.5 ? 0.0 : 0.8;
    vec3 lc = layerShadow;
    if (layerKind < 1.5) lc = v < 0.5 ? layerBands[0] : v < 1.5 ? layerBands[1] : v < 2.5 ? layerBands[2] : layerBands[3];
    else if (layerKind < 2.5) lc = mix(layerSunLow, layerSunHigh, clamp(v / 100.0, 0.0, 1.0));
    else a *= step(0.5, raw);
    float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
    return mix(rgb, lc * (0.55 + 0.45 * clamp(lum * 1.6, 0.0, 1.0)), a);
  }`;
const nearLayer = { value: noLayer };
const farSlots = { ...layerSlotUniforms(), ...layerSlotUniforms('shade'), layerKind: layerShared.layerKind }; // one layerKind for both
const TILE_KM = 256 * 0.078125; // the terrain tiles' width, which the site images match

// Transparent so its faded edge blends into the far ground under it (premultiplied, as faded).
const material = new THREE.MeshStandardMaterial({ color: colour('--regolith'), roughness: 1, metalness: 0, transparent: true, premultipliedAlpha: true });
material.onBeforeCompile = (shader) => {
  liftHeights(shader);
  shader.uniforms.ringColour = { value: new THREE.Vector3(ringColour.r, ringColour.g, ringColour.b) };
  shader.uniforms.ringAlpha = ringAlpha;
  Object.assign(shader.uniforms, layerShared, { layerMap: nearLayer });
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec2 vFlat;\nuniform vec3 ringColour;\nuniform float ringAlpha;\nuniform sampler2D layerMap;\nuniform float layerKind;${layerGlsl}`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
      float d = length(vFlat);
      if (d > ${DISC_KM.toFixed(2)}) discard;
      vec4 layerTexel = texture2D(layerMap, vFlat / ${TILE_KM.toFixed(4)} + 0.5) * 255.0;
      gl_FragColor.rgb = withLayer(gl_FragColor.rgb, layerKind < 1.5 ? layerTexel.r : layerTexel.g);
      gl_FragColor.rgb = withShade(gl_FragColor.rgb, layerTexel.b > 1.01 ? 0.0 : step(0.5, layerTexel.b));
      float ring = 1.0 - smoothstep(0.0, max(0.05, fwidth(d)), abs(d - ${RING_KM.toFixed(2)}));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, ringColour, ring * ringAlpha);
      gl_FragColor *= 1.0 - smoothstep(${(DISC_KM - FADE_KM).toFixed(2)}, ${DISC_KM.toFixed(2)}, d);`);
};
const terrain = new THREE.Mesh(new THREE.BufferGeometry(), material);
terrain.castShadow = terrain.receiveShadow = true;
terrain.customDepthMaterial = new THREE.MeshDepthMaterial();
terrain.customDepthMaterial.onBeforeCompile = liftHeights;
scene.add(terrain);

// Far ground (far-ground.js): from just inside the disc's faded edge out past the horizon, on
// the sphere, so the ground curves away with the Moon. Its relief lifts with the disc's (lift);
// the curve stays. Drawn just behind the disc where they overlap, and no shadows: the shadow map
// covers the disc only, so the far ground is lit by its slope alone.
const farMaterial = new THREE.MeshStandardMaterial({ color: colour('--regolith'), roughness: 1, metalness: 0,
  polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 });
farMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.lift = lift;
  Object.assign(shader.uniforms, layerShared, farSlots);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float curve;\nattribute vec2 latLon;\nvarying vec2 vLatLon;\nuniform float lift;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.y = transformed.y * lift + curve;\nvLatLon = latLon;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nvarying vec2 vLatLon;${LAYER_GLSL}${slotGlsl('shade')}${layerGlsl}`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
      gl_FragColor.rgb = withLayer(gl_FragColor.rgb, layerRaw(vLatLon.x, vLatLon.y));
      float shadeValue = shadeRaw(vLatLon.x, vLatLon.y);
      gl_FragColor.rgb = withShade(gl_FragColor.rgb, shadeValue > shadeTop() ? 0.0 : step(0.5, shadeValue));`);
};
const farGround = new THREE.Mesh(new THREE.BufferGeometry(), farMaterial);
farGround.visible = false;
farGround.frustumCulled = false; // its bounds ignore the curve
scene.add(farGround);
const farGrounds = new Map(); // site id → Promise of the far ground's arrays (null if it failed)
function loadFar(site) {
  if (!farGrounds.has(site.id)) {
    const far = buildFarGround(site, site.surfaceElevationM, EXAG).catch((err) => {
      console.warn(`No far ground for ${site.id}:`, err);
      farGrounds.delete(site.id); // try again next time
      return null;
    });
    farGrounds.set(site.id, far);
  }
  return farGrounds.get(site.id);
}
function swapFar(far) {
  farGround.geometry.dispose();
  farGround.geometry = new THREE.BufferGeometry();
  farGround.visible = Boolean(far);
  canvas.classList.toggle('far', Boolean(far)); // the globe behind fades out (style.css)
  if (!far) return;
  // Normals from the ground as drawn (relief on the curve), then the relief alone in position.
  const drawn = far.position.slice();
  for (let i = 0; i < far.curve.length; i++) drawn[i * 3 + 1] += far.curve[i];
  const g = farGround.geometry;
  g.setAttribute('position', new THREE.BufferAttribute(drawn, 3));
  g.setIndex(new THREE.BufferAttribute(far.index, 1));
  g.computeVertexNormals();
  g.setAttribute('position', new THREE.BufferAttribute(far.position, 3));
  g.setAttribute('curve', new THREE.BufferAttribute(far.curve, 1));
  g.setAttribute('latLon', new THREE.BufferAttribute(far.latLon, 2));
}

// The site's own layer image for the disc: values on the tile's grid, row 0 north (so not
// flipped), nearest, no mipmaps (it is seen close).
const siteLayers = new Map(); // url → Promise of the texture (null if missing)
function siteLayer(url) {
  if (!siteLayers.has(url)) {
    siteLayers.set(url, new THREE.TextureLoader().loadAsync(url).then((t) => {
      t.colorSpace = THREE.NoColorSpace;
      t.flipY = false;
      t.magFilter = t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      return t;
    }, () => null));
  }
  return siteLayers.get(url);
}
let layerAsk = 0;
function applyLayer() {
  const map = layers.map || '', shade = Boolean(layers.shadow), site = tile?.id, ask = ++layerAsk;
  if ((!map && !shade) || !site) { layerShared.layerKind.value = 0; layerShared.shadeOn.value = 0; return; }
  Promise.all([map ? loadLayer(map).catch(() => null) : null, shade ? loadLayer('shadow').catch(() => null) : null,
    siteLayer(`data/layers/sites/${site}.png`)]).then(([far, farShade, near]) => {
    if (ask !== layerAsk) return;
    setLayerSlots(farSlots, map, far);
    setLayerSlots(farSlots, 'shadow', farShade, 'shade');
    nearLayer.value = near || noLayer;
    layerShared.layerKind.value = map ? LAYER_KINDS[map] : 0;
    layerShared.shadeOn.value = shade ? 1 : 0;
  });
}

// The Sun and Earth in the sky, in their directions from the site (tanaw:sky), far beyond the
// ground so it hides them below the skyline. Drawn larger than life so they read on a phone
// (SUN_DEG, EARTH_DEG: the radii on screen; really about 0.27 and 0.95 degrees). The Earth is lit
// on its Sun side. While the forecast says one is out of view from the site, it is drawn faint.
const SKY_KM = 1500, SUN_DEG = 0.75, EARTH_DEG = 1.5, HIDDEN_A = 0.35;
// They are the shared bodies (bodies.js): Earth's Blue Marble map with its real phase, and the
// textured Sun with its glow.
const sunBody = createSun({ radius: 1 }), sunDisc = sunBody.object;
const earth = createEarth({ radius: 1 }), earthBall = earth.mesh;
let earthAsked = false;
sunDisc.visible = earthBall.visible = false;
scene.add(sunDisc, earthBall);
const skyV = new THREE.Vector3();
function placeSky() {
  const on = Boolean(sky && tile && sky.site === tile.id);
  sunDisc.visible = earthBall.visible = on;
  if (!on) return;
  if (!earthAsked) { earthAsked = true; loadEarthMap().then((map) => earth.setMap(map), () => {}); }
  const put = (mesh, az, el, deg) => {
    skyV.fromArray(direction(az, el));
    mesh.position.copy(camera.position).addScaledVector(skyV, SKY_KM);
    mesh.scale.setScalar(SKY_KM * Math.tan(deg * rad));
  };
  put(sunDisc, sky.sunAz, sky.sunEl, SUN_DEG);
  sunDisc.quaternion.copy(camera.quaternion);
  sunBody.setOpacity(sky.sunVisible ? 1 : HIDDEN_A);
  put(earthBall, sky.earthAz, sky.earthEl, EARTH_DEG);
  earth.setSun(skyV.fromArray(sky.sunDirectionLocal ?? direction(sky.sunAz, sky.sunEl)));
  earth.setOpacity(sky.earthVisible ? 1 : HIDDEN_A);
  earthBall.updateMatrixWorld();
  earth.update(camera);
}

// Site pin: a thin stalk with a --pin red head in a --sel ring, so it reads over any layer
// (Slope's steepest band is red too). The ring is a larger sphere's back faces, so it outlines the
// head from any side. Unit shapes, sized every frame (sizePin) so the pin keeps the same size on
// screen at any distance. Transparent so it can fade in with the heights (setLift).
const pin = new THREE.Group();
const stalk = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8).translate(0, 0.5, 0),
  new THREE.MeshBasicMaterial({ color: colour('--text'), toneMapped: false, transparent: true }));
const dot = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12),
  new THREE.MeshBasicMaterial({ color: colour('--pin'), toneMapped: false, transparent: true }));
const dotRing = new THREE.Mesh(dot.geometry,
  new THREE.MeshBasicMaterial({ color: colour('--sel'), toneMapped: false, transparent: true, side: THREE.BackSide }));
pin.add(stalk, dotRing, dot);
pin.renderOrder = 2;
scene.add(pin);

// Nearby spots on the ground: one 44 px button per spot over the canvas, its dot filled from
// dark (0% of the year in sunlight) to --sun (100%), slashed where too steep to land, with the
// host's spoken label. While the spots stand closer than 44 px on screen they are drawn but not
// tapped one by one: "Nearby spots" under them eases in to them. Arrow keys move the selection
// (north up, east right); only the selected spot is in the tab order.
const spotLayer = document.createElement('div');
spotLayer.className = 'spot-marks';
spotLayer.setAttribute('role', 'group');
spotLayer.hidden = true;
const spotGo = document.createElement('button');
spotGo.type = 'button';
spotGo.className = 'btn spot-go';
spotGo.textContent = 'Nearby spots';
// "Nearby spots": ease to the spots' framing, north up and looking down from PITCH_MAX so the
// rows run straight across and aren't squashed, then zoom in further (placeSpots) until they
// are at least SPOT_HIT apart on screen, or SPOT_ZOOM_MIN. The turntable then holds until the
// user turns or zooms, so the spots stay still and the arrow keys match the screen.
spotGo.addEventListener('click', () => {
  const north = yaw - 2 * Math.PI * Math.round(yaw / (2 * Math.PI));
  setHorizon(false, false);
  closeAnim = { from: close, to: 1, p0: pitch, p1: PITCH_MAX, y0: yaw, y1: yaw - north, t0: performance.now() };
  spotZoom = spotHold = true;
  lastInput = performance.now();
});

// "Horizon" (in the view's row, under the band): glides down to the lowest tilt, facing Earth
// while it is in view from the site, else the Sun, else north, so the skyline and the sky fill
// the top of the band; pressed again, back up to the default tilt. The turntable holds while it
// is on; a turn or zoom by the user takes over and unpresses it.
const horizonBtn = document.getElementById('show-horizon');
let horizonOn = false;
function setHorizon(on, glide = true) {
  horizonOn = on;
  horizonBtn.setAttribute('aria-pressed', String(on));
  spotHold = on;
  if (!glide) return;
  let y1 = yaw;
  if (on) {
    const az = sky && tile && sky.site === tile.id ? (sky.earthVisible ? sky.earthAz : sky.sunVisible ? sky.sunAz : 0) : 0;
    // The camera looks along (-sin yaw, -cos yaw) on the ground, which faces azimuth az at yaw = -az.
    const to = -az * rad;
    y1 = yaw + Math.atan2(Math.sin(to - yaw), Math.cos(to - yaw)); // the short way round
  }
  closeAnim = { from: close, to: close, p0: pitch, p1: on ? PITCH_MIN : PITCH, y0: yaw, y1, t0: performance.now() };
  lastInput = performance.now();
}
horizonBtn.addEventListener('click', () => setHorizon(!horizonOn));
const takeOver = () => { spotHold = false; if (horizonOn) setHorizon(false, false); };
spotLayer.append(spotGo);
canvas.after(spotLayer);
let spotAlpha = 0, liftK = 1, closeAnim = null, spotZoom = false, spotHold = false; // closeAnim: { from, to, p0, p1, y0?, y1?, t0 }
spotLayer.addEventListener('keydown', (e) => {
  const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
  if (!step || !spots || !spot) return;
  e.preventDefault();
  const to = spotAt(clamp(spot.i + step[0], -2, 2), clamp(spot.j + step[1], -2, 2));
  if (!to) return;
  lastInput = performance.now(); // the turntable waits, so the spots hold still while chosen
  pick(to);
  spotAt(to.i, to.j)?.el.focus();
});

// The host's display options (tanaw:layers, forecast.js): the 5 km ring with its label, and the
// spot dots. The pin always shows; the camera and the selection stay as they are.
const layers = { ring: true, spots: true, map: '', shadow: false };
document.addEventListener('tanaw:layers', (e) => {
  const was = `${layers.map}|${layers.shadow}`;
  Object.assign(layers, e.detail);
  ringAlpha.value = layers.ring ? 0.7 : 0;
  if (`${layers.map}|${layers.shadow}` !== was) applyLayer();
});

// Tiles: data/terrain/<file>, built into a mesh with the observer's grid helper. A tile that
// doesn't load or doesn't match its site leaves that site on the globe.
const tiles = new Map(); // site id → Promise of the built grid
function loadTile(site, entry) {
  if (!tiles.has(site.id)) {
    const url = entry.url ?? `data/terrain/${entry.file}`; // catalogue tiles (non-polar sites) carry their own
    const grid = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => buildTerrainGrid(
        { width: entry.width, height: entry.height, spacingM: entry.spacingM, elevationsM: new Float32Array(buf), metadata: entry.metadata },
        {
          referenceFrame: site.referenceFrame,
          elevationDatum: site.elevationDatum,
          latitudeDeg: site.lat,
          longitudeEastDeg: site.lon > 180 ? site.lon - 360 : site.lon,
          surfaceElevationM: site.surfaceElevationM,
        },
        EXAG,
      ));
    grid.catch(() => tiles.delete(site.id)); // try again next time
    tiles.set(site.id, grid);
  }
  return tiles.get(site.id);
}

// The tile in the scene: its heights (km) for the ring label, and sample points for framing.
let tile = null; // { id, width, height, spacingKm, positions, samples, targetY }
function swapTile(id, entry, grid) {
  const positions = grid.positions.map((v) => v / 1000);
  const { width, height } = entry;
  const near = (i) => Math.hypot(positions[i * 3], positions[i * 3 + 2]) <= DISC_KM;
  // Only triangles that reach into the disc, so hills outside it cast no shadows.
  const kept = [];
  for (let t = 0; t < grid.indices.length; t += 3) {
    const a = grid.indices[t], b = grid.indices[t + 1], c = grid.indices[t + 2];
    if (near(a) || near(b) || near(c)) kept.push(a, b, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(grid.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(kept), 1));
  terrain.geometry.dispose();
  terrain.geometry = geometry;

  const samples = [];
  let low = Infinity, high = -Infinity;
  for (let row = 0; row < height; row += 4) for (let col = 0; col < width; col += 4) {
    const i = row * width + col;
    if (!near(i)) continue;
    const y = positions[i * 3 + 1];
    samples.push([positions[i * 3], y, positions[i * 3 + 2]]);
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  high = Math.max(high, PIN_KM);
  tile = { id, width, height, spacingKm: entry.spacingM / 1000, positions, samples, targetY: (low + high) / 2,
    groundM: grid.groundElevationM };
  renderer.shadowMap.needsUpdate = true;
  spots = null;
  pinAnim = null;
  pin.position.set(0, 0, 0);
  applySpot(true);
  reframe(true);
}

function heightAt(x, z) {
  const col = clamp(Math.round(x / tile.spacingKm + (tile.width - 1) / 2), 0, tile.width - 1);
  const row = clamp(Math.round(z / tile.spacingKm + (tile.height - 1) / 2), 0, tile.height - 1);
  return tile.positions[(row * tile.width + col) * 3 + 1];
}

// Lighting from the host's current hour (tanaw:sky), only for the site in the scene.
let sky = null;
function applySky() {
  if (!sky || !tile || sky.site !== tile.id) {
    sun.intensity = earthLight.intensity = 0;
    return;
  }
  sun.position.fromArray(sky.sunDirectionLocal ?? direction(sky.sunAz, sky.sunEl)).multiplyScalar(60);
  // Exposed for a low Sun, as at the poles: higher than SUN_LOW, flat ground is kept as bright as
  // under a Sun SUN_LOW up (sites away from the poles), rather than burning out.
  const high = Math.min(1, Math.sin(SUN_LOW) / Math.max(Math.sin(sky.sunEl * rad), 1e-3));
  sun.intensity = sky.sunVisible ? SUN_I * high : 0;
  earthLight.position.fromArray(direction(sky.earthAz, sky.earthEl)).multiplyScalar(60);
  earthLight.intensity = sky.earthVisible ? EARTH_I : 0;
  renderer.shadowMap.needsUpdate = true;
}
document.addEventListener('tanaw:sky', (e) => {
  sky = e.detail;
  applySky();
});

// Framing, as on the globe: 40 degrees across the narrower side of the free band
// (tanaw:frame), the view shifted so the target sits mid-band, and the default distance set so
// the disc fills the band with a small margin at the default pitch. A new band glides in.
let band = null;
let view = { fov: 40, x: 0, y: 0, dist: 30, near: 30 };
let framing = null;

function bandInCanvas() {
  const { clientWidth: w, clientHeight: h } = canvas;
  if (!band) return { top: 0, bottom: h, left: 0, right: w };
  const { left: x0, top: y0 } = canvas.getBoundingClientRect();
  const top = clamp(band.top - y0, 0, h), left = clamp(band.left - x0, 0, w);
  return {
    top,
    bottom: clamp(band.bottom - y0, top + 1, Math.max(h, top + 1)),
    left,
    right: clamp(band.right - x0, left + 1, Math.max(w, left + 1)),
  };
}

// The distance at which every sample (of the disc, or the spots) fits inside tx and ty (tangents
// across the band's half width and half height) at the default pitch, from any side, looking
// at height ty0 over the site.
function fitDistance(tx, ty, samples = tile?.samples, ty0 = tile?.targetY) {
  if (!tile) return 30;
  const sp = Math.sin(PITCH), cp = Math.cos(PITCH);
  let most = 1;
  for (let k = 0; k < 8; k++) {
    const yaw = (k / 8) * 2 * Math.PI, sy = Math.sin(yaw), cy = Math.cos(yaw);
    const fits = (d) => {
      const cx = sy * cp * d, cyy = ty0 + sp * d, cz = cy * cp * d;
      for (const [x, y, z] of samples) {
        const vx = x - cx, vy = y - cyy, vz = z - cz;
        const depth = -(vx * sy * cp + vy * sp + vz * cy * cp);
        if (depth <= 0.1) return false;
        if (Math.abs(vx * cy - vz * sy) > tx * depth) return false;
        if (Math.abs(-vx * sy * sp + vy * cp - vz * cy * sp) > ty * depth) return false;
      }
      return true;
    };
    let lo = most, hi = 400;
    if (fits(lo)) continue;
    for (let n = 0; n < 24; n++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    most = hi;
  }
  return most;
}

function frameTarget() {
  const { clientWidth: w, clientHeight: h } = canvas;
  const { top, bottom, left, right } = bandInCanvas();
  const fov = 2 * Math.atan(Math.tan(HALF_FOV) * h / Math.min(right - left, bottom - top));
  const t = Math.tan(fov / 2);
  const tx = t * (right - left) / h * MARGIN, ty = t * (bottom - top) / h * MARGIN;
  const dist = fitDistance(tx, ty);
  return {
    fov: fov / rad,
    x: w / 2 - (left + right) / 2,
    y: h / 2 - (top + bottom) / 2,
    dist,
    // near: the distance while a spot off the site is selected
    near: spots ? fitDistance(tx * CLOSE_FILL, ty * CLOSE_FILL, spots.samples, spots.y) : dist,
  };
}

function applyView() {
  const { clientWidth: w, clientHeight: h } = canvas;
  camera.fov = view.fov;
  camera.setViewOffset(w, h, view.x, view.y, w, h); // also sets the aspect and the projection
}

function reframe(now) {
  const to = frameTarget();
  if (now || !shown || reduceMotion.matches) {
    framing = null;
    view = to;
    applyView();
    return;
  }
  framing = { from: { ...view }, to, t0: performance.now() };
}

function stepFrame(now) {
  if (!framing) return;
  const t = Math.min(1, (now - framing.t0) / FRAME_MS);
  const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2; // ease in and out
  const { from, to } = framing;
  view = Object.fromEntries(Object.keys(to).map((k) => [k, from[k] + (to[k] - from[k]) * e]));
  applyView();
  if (t === 1) framing = null;
}

// The terrain shows only inside the free band, so text and controls always sit on black: a CSS
// mask (style.css) from the band's edges in canvas px, with a soft edge inside them.
function maskBand() {
  const { top, bottom, left, right } = bandInCanvas();
  Object.entries({ t: top, b: bottom, l: left, r: right })
    .forEach(([k, v]) => canvas.style.setProperty(`--band-${k}`, `${Math.round(v)}px`));
}

function resize() {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  reframe(true);
  maskBand();
}
window.addEventListener('resize', resize);
resize();
document.addEventListener('tanaw:frame', (e) => {
  const { top, bottom, left, right } = e.detail;
  band = { top, bottom, left, right };
  maskBand();
  const sized = camera.view && camera.view.fullWidth === canvas.clientWidth && camera.view.fullHeight === canvas.clientHeight;
  reframe(!sized);
});

// The globe's pose at the end of its dive (tanaw:dive, globe.js): the site, its 5 km ring's
// radius as a fraction of half the band's narrower side, and the screen angle of lunar north
// there (clockwise from up). Both views take their field of view from the same band, so this
// view matches it from straight overhead at RING_KM / (ringFill × tan HALF_FOV), with yaw = north
// (north, -Z, then points up the screen turned by yaw). landing: enter() waiting for the dive.
let dive = null; // { site, ringFill, north }
let landing = null; // { site, done }
document.addEventListener('tanaw:dive', (e) => {
  dive = e.detail;
  if (landing && landing.site === dive.site) landing.done();
});

// The overhead pose that matches the globe's dive, for the tile in the scene.
function topPose() {
  if (dive && dive.site === tile.id) return { yaw: dive.north, dist: RING_KM / (dive.ringFill * Math.tan(HALF_FOV)) };
  return { yaw, dist: view.dist * FROM_DIST }; // no dive to match
}

// Camera: the lift from overhead, then a slow turntable. A drag turns (yaw by x, pitch by y),
// the wheel or a pinch zooms; the turntable pauses during input and for 4 s after.
// close: 0 at the default framing, 1 at the spots' (view.near, looking at the spots' height),
// chosen when the view opens. arrival: the lift's camera part, from overhead at dist to the
// default view, from t0 (the end of the fade in). departure: the way back to the overhead pose,
// from the pose at t0.
let yaw = -0.6, pitch = PITCH, zoom = 1, close = 0;
let arrival = null; // { t0, dist }
let departure = null; // { t0, from: { p, d, y, yaw }, to: { yaw, dist } }
let lastInput = -Infinity;
const pointers = new Map();
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // in and out

function pose(now) {
  const base = view.dist + (view.near - view.dist) * close;
  if (departure) {
    const { t0, from, to } = departure, e = ease(Math.min(1, (now - t0) / DEPART_MS));
    yaw = from.yaw + (to.yaw - from.yaw) * e;
    return { p: from.p + (PITCH_TOP - from.p) * e, d: from.d + (to.dist - from.d) * e, y: from.y * (1 - e), base };
  }
  let p = pitch, d = base * zoom;
  if (arrival) {
    const t = clamp((now - arrival.t0) / LIFT_MS, 0, 1);
    const e = 1 - (1 - t) ** 3; // ease out
    p = PITCH_TOP + (pitch - PITCH_TOP) * e;
    d = arrival.dist + (base * zoom - arrival.dist) * e;
    if (t === 1) arrival = null;
  }
  const y = lift.value * (tile.targetY + ((spots ? spots.y : tile.targetY) - tile.targetY) * close);
  return { p, d, y, base };
}

// Input during the lift takes the camera over from wherever it has got to; the heights go on
// rising.
function settle() {
  if (!arrival) return;
  const { p, d, base } = pose(performance.now());
  pitch = clamp(p, PITCH_MIN, PITCH_MAX);
  zoom = clamp(d / base, ZOOM_MIN, ZOOM_MAX);
  arrival = null;
}

function input() {
  lastInput = performance.now();
  settle();
}

// over: how far past ZOOM_MAX the current zoom-out gesture has asked to go (overAt: when).
let over = 1, overAt = -Infinity;
function zoomBy(factor) {
  takeOver(); // the user takes over from "Nearby spots" or "Horizon"
  input();
  const now = performance.now();
  if (factor > 1 && zoom * factor > ZOOM_MAX) {
    if (now - overAt > EXIT_GAP) over = 1;
    over *= zoom * factor / ZOOM_MAX;
    overAt = now;
    if (over >= EXIT_ZOOM) {
      over = 1;
      document.dispatchEvent(new CustomEvent('tanaw:wholemoon'));
    }
  } else if (factor < 1) over = 1;
  zoom = clamp(zoom * factor, ZOOM_MIN, ZOOM_MAX);
}

// The heights' factor (0 flat, 1 at EXAG): the pin, the spots and the "5 km" label fade in over
// its last 20%, and the shadows follow it. rise: an ease from one factor to another over ms
// from t0 (ease out on the way in, in and out on the way out).
let rise = null; // { from, to, t0, ms, out }
function setLift(k) {
  lift.value = k;
  const a = clamp((k - PIN_FROM) / (1 - PIN_FROM), 0, 1);
  stalk.material.opacity = dot.material.opacity = dotRing.material.opacity = a;
  spotAlpha = a;
  pin.visible = a > 0;
  liftK = Math.max(k, 1e-3);
  renderer.shadowMap.needsUpdate = true;
}

function stepLift(now) {
  if (!rise || now < rise.t0) return;
  const t = Math.min(1, (now - rise.t0) / rise.ms);
  setLift(rise.from + (rise.to - rise.from) * (rise.out ? 1 - (1 - t) ** 3 : ease(t)));
  if (t === 1) rise = null;
}

// press: the one pointer down, until a second one joins (a pinch): whether it has moved (a
// drag, not a tap) and whether it grabbed the pin. Input stops once the view is on its way out.
let press = null;
canvas.addEventListener('pointerdown', (e) => {
  if (departure) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  input();
  if (pointers.size === 1) press = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, pin: onPin(e) };
  else if (press) {
    if (press.pin) pinTo(spotAt(spot.i, spot.j), false); // a pinch drops the pin back
    press = null;
  }
});
canvas.addEventListener('pointermove', (e) => {
  const at = pointers.get(e.pointerId);
  if (!at || departure) return;
  input();
  if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_PX) press.moved = true;
  if (press && press.pin) {
    if (press.moved) {
      const hit = ground(e);
      if (hit) {
        pinAnim = null;
        pin.position.copy(hit);
      }
    }
  } else if (pointers.size === 1) {
    if (press && press.moved) takeOver(); // a turn, not a tap, takes over from "Nearby spots" or "Horizon"
    yaw -= (e.clientX - at.x) * 0.006;
    pitch = clamp(pitch + (e.clientY - at.y) * 0.004, PITCH_MIN, PITCH_MAX);
  } else if (pointers.size === 2) {
    const other = [...pointers].find(([id]) => id !== e.pointerId)[1];
    const before = Math.hypot(at.x - other.x, at.y - other.y);
    const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
    if (before > 0 && after > 0) zoomBy(before / after);
  }
  at.x = e.clientX;
  at.y = e.clientY;
});
const release = (e) => {
  pointers.delete(e.pointerId);
  lastInput = performance.now();
  if (!press || press.id !== e.pointerId || departure) return;
  const { pin: held, moved } = press;
  press = null;
  if (e.type === 'pointercancel') {
    if (held) pinTo(spotAt(spot.i, spot.j), false);
    return;
  }
  if (held && moved) {
    // The pin dropped: it snaps to the nearest spot.
    const s = nearest(pin.position, Infinity);
    pinTo(s, false);
    pick(s);
  } else if (!moved) {
    // A tap on the ground near a spot picks it.
    const hit = ground(e);
    const s = hit && nearest(hit, PICK_KM);
    if (s) pick(s);
  }
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (!departure) zoomBy(Math.exp(e.deltaY * 0.001));
}, { passive: false });

// The "5 km" label sits under the ring at its point nearest the camera, only while the site
// view is fully in (labelled) and the heights have nearly risen: not while the globe turns to
// the site, the view fades or dips between sites, or after it has left.
const anchor = new THREE.Vector3();
let labelled = false;
function placeLabel() {
  if (!labelled || !layers.ring || lift.value < PIN_FROM) {
    scaleLabel.hidden = true;
    return;
  }
  const x = Math.sin(yaw) * RING_KM, z = Math.cos(yaw) * RING_KM;
  anchor.set(x, heightAt(x, z) * lift.value, z).project(camera);
  const box = canvas.getBoundingClientRect(), b = bandInCanvas();
  const px = (anchor.x + 1) / 2 * box.width, py = (1 - anchor.y) / 2 * box.height;
  // Inside the band's unfaded part, so the label never sits over text.
  const inView = anchor.z < 1 && px >= b.left + MASK_FADE + 24 && px <= b.right - MASK_FADE - 24 &&
    py >= b.top + MASK_FADE && py + 30 <= b.bottom - MASK_FADE;
  scaleLabel.hidden = !inView;
  if (inView) scaleLabel.style.transform = `translate(${(box.left + px).toFixed(1)}px, ${(box.top + py + 6).toFixed(1)}px) translateX(-50%)`;
}

let last = 0;
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  stepFrame(now);
  stepPin(now);
  stepLift(now);
  stepClose(now);
  const still = arrival || departure || spotHold; // the turntable waits for the lift, stops on the way out and holds for "Nearby spots" and "Horizon"
  if (!reduceMotion.matches && !pointers.size && now - lastInput > IDLE_MS && !still) yaw += SPIN * dt;
  const { p, d, y } = pose(now);
  const cp = Math.cos(p), sp = Math.sin(p);
  camera.position.set(Math.sin(yaw) * cp * d, y + sp * d, Math.cos(yaw) * cp * d);
  // Screen up, which stays defined straight overhead (the same as +Y up at any lower pitch).
  camera.up.set(-Math.sin(yaw) * sp, cp, -Math.cos(yaw) * sp);
  camera.lookAt(0, y, 0);
  sizePin();
  placeSky();
  renderer.render(scene, camera);
  placeLabel();
  placeSpots();
}

// Showing and hiding. The canvas fades in over the globe, which dims behind it (dim, style.css),
// and once faded in is marked full. tanaw:siteview tells the globe (globe.js): covering, the view
// is fully in, so the globe glides out to the whole Moon and then stops drawing; visible, the
// view is in or still fading, so the globe stays behind it until the view has gone.
const later = (ms) => new Promise((done) => setTimeout(done, ms));

function fade(on, ms) {
  const [a, b] = reduceMotion.matches ? [0, 0] : [ms, FRAME_MS];
  canvas.style.transitionDuration = `${a}ms, ${b}ms, ${b}ms, ${b}ms, ${b}ms`; // opacity, then the mask's band
  canvas.classList.toggle('on', on);
}

let visible = false;
function cover(on, seen = true) {
  if (canvas.classList.contains('full') === on && visible === seen) return;
  canvas.classList.toggle('full', on);
  visible = seen;
  document.dispatchEvent(new CustomEvent('tanaw:siteview', { detail: { covering: on, visible: seen } }));
}

// Warm-up: once the page is idle, compile the site view's shaders (terrain, pin, spots, and the
// shadow pass's depth shader, via one hidden frame with a placeholder triangle), so the first
// site opened doesn't wait for them.
async function warmUp() {
  if (shown) return;
  await renderer.compileAsync(scene, camera);
  if (shown || terrain.geometry.attributes.position) return;
  const empty = terrain.geometry;
  const placeholder = new THREE.BufferGeometry();
  placeholder.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
  placeholder.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  terrain.geometry = placeholder;
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  terrain.geometry = empty;
  placeholder.dispose();
}
addEventListener('load', () => {
  if (window.requestIdleCallback) requestIdleCallback(warmUp, { timeout: 3000 });
  else setTimeout(warmUp, 1500);
}, { once: true });

function show() {
  const my = seq;
  if (!shown) {
    last = performance.now();
    renderer.setAnimationLoop(tick);
  }
  shown = true;
  departure = null;
  pitch = PITCH;
  zoom = 1;
  over = 1;
  close = spot && spot.site === tile.id && (spot.i || spot.j) ? 1 : 0;
  closeAnim = null;
  setHorizon(false, false);
  if (reduceMotion.matches) {
    arrival = rise = null;
    setLift(1);
  } else {
    // Overhead with the ground flat while the canvas fades in, then the lift.
    const t0 = performance.now() + FADE_IN, top = topPose();
    yaw = top.yaw;
    arrival = { t0, dist: top.dist };
    rise = { from: 0, to: 1, t0, ms: LIFT_MS, out: true };
    setLift(0);
  }
  cover(canvas.classList.contains('full'));
  canvas.classList.add('dim');
  fade(true, FADE_IN);
  later(reduceMotion.matches ? 0 : FADE_IN).then(() => {
    if (my !== seq || !shown) return;
    cover(true);
    labelled = true;
  });
}

// The way out: when the globe waits at its dive pose for this site, back to the overhead pose
// that matches it, turning the short way to its north, with the heights falling and the globe
// brightening (DEPART_MS); then the canvas fades out over the globe.
function depart(top) {
  const now = performance.now(), { p, d, y } = pose(now), turn = top.yaw - yaw;
  departure = { t0: now, from: { p, d, y, yaw },
    to: { yaw: yaw + turn - 2 * Math.PI * Math.round(turn / (2 * Math.PI)), dist: top.dist } };
  arrival = null;
  rise = { from: lift.value, to: 0, t0: now, ms: DEPART_MS, out: false };
}

function leave() {
  const my = ++seq;
  wanted = null;
  landing = null;
  if (!shown) {
    cover(false, false);
    return;
  }
  labelled = false;
  scaleLabel.hidden = true;
  canvas.classList.remove('dim');
  const out = () => {
    if (my !== seq) return;
    shown = false;
    spotLayer.hidden = true;
    cover(false);
    fade(false, FADE_OUT);
    later(reduceMotion.matches ? 0 : FADE_OUT).then(() => {
      if (my !== seq) return;
      renderer.setAnimationLoop(null);
      cover(false, false);
    });
  };
  if (!reduceMotion.matches && dive && dive.site === tile.id) {
    depart(topPose());
    later(DEPART_MS).then(out);
  } else out();
}

function enter(site, entry) {
  const my = ++seq;
  wanted = site.id;
  landing = null;
  const motion = !reduceMotion.matches;
  let wait = null;
  if (shown) {
    fade(false, FADE_SWAP); // dip between two sites, down to the dimmed globe
    labelled = false;
    scaleLabel.hidden = true;
    if (motion) wait = later(FADE_SWAP);
  } else if (motion) {
    wait = new Promise((done) => { landing = { site: site.id, done }; }); // the globe's dive
  }
  Promise.all([loadTile(site, entry), wait, loadFar(site)]).then(([grid, , far]) => {
    if (my !== seq) return;
    swapTile(site.id, entry, grid);
    swapFar(far);
    applyLayer();
    applySky();
    show();
  }, (err) => {
    if (my !== seq) return;
    console.warn(`No site view for ${site.id}:`, err);
    leave();
    document.dispatchEvent(new CustomEvent('tanaw:view', { detail: { view: 'globe', site: site.id } }));
  });
}

document.addEventListener('tanaw:select', (e) => {
  const { site, sites, view: mode, tile: entry } = e.detail;
  if (mode !== 'site' || !entry) {
    if (wanted || (shown && !departure)) leave(); // once on its way out, it carries on
    return;
  }
  if (wanted === site) return;
  enter(sites.find((s) => s.id === site), entry);
});

document.addEventListener('tanaw:preview-site', e => {
  if (!e.detail.failed && (wanted || (shown && !departure))) leave();
});

// Nearby spots (forecast.js owns the selection): the spots as dots on the ground at their
// published heights (× EXAG over the site's ground, like the mesh) and the pin on the selected
// one. Picking a spot moves only the pin; the camera stays as the user left it (the framing
// is chosen when the view opens, show()). spot: the host's latest tanaw:spot;
// spots: the dots in the scene, for tile.id ({ site, points, list, samples, y }) (declared
// at the top).

function buildSpots() {
  const km = spot.spacingM / 1000;
  const list = spot.points.map(({ i, j, groundM }) => ({
    i, j, at: new THREE.Vector3(i * km, (groundM - tile.groundM) * EXAG / 1000, -j * km),
  }));
  const ys = list.map((s) => s.at.y);
  spots = { site: tile.id, key: spotKey(spot), points: spot.points, list, samples: list.map((s) => s.at.toArray()),
    y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  spotLayer.setAttribute('aria-label', `Nearby spots, ${spot.spacingM} m apart, north up`);
  spotLayer.replaceChildren(spotGo, ...list.map((s, n) => {
    const p = spot.points[n], b = document.createElement('button');
    b.type = 'button';
    b.className = `spot${p.steep ? ' steep' : ''}${!s.i && !s.j ? ' site' : ''}`;
    b.style.setProperty('--pct', String(p.sunPct / 100));
    b.setAttribute('aria-label', p.label);
    b.addEventListener('click', () => pick(s));
    s.el = b;
    return b;
  }));
}

// Each frame: the spots' buttons at their places on the lifted ground, while the spots show.
const spotV = new THREE.Vector3();
function placeSpots() {
  const on = Boolean(spots) && layers.spots && shown && spotAlpha > 0;
  spotLayer.hidden = !on;
  if (!on) return;
  spotLayer.style.opacity = String(spotAlpha);
  const box = canvas.getBoundingClientRect();
  const xy = (s) => {
    spotV.set(s.at.x, s.at.y * liftK, s.at.z).project(camera);
    return { x: box.left + (spotV.x + 1) / 2 * box.width, y: box.top + (1 - spotV.y) / 2 * box.height, z: spotV.z };
  };
  const at = spots.list.map(xy), o = at[spots.list.indexOf(spotAt(0, 0))];
  // Like the terrain, the spots show only inside the free band, whole 44 px squares, so they
  // never sit over the bar, the panel or the buttons; one outside stays a keyboard stop.
  const fb = band || box, r = SPOT_HIT / 2;
  const seen = at.map((p) => p.z <= 1 && p.x >= fb.left + r && p.x <= fb.right - r && p.y >= fb.top + r && p.y <= fb.bottom - r);
  const vis = at.filter((_, n) => seen[n]);
  // One by one only while no two 44 px squares overlap: every pair at least SPOT_HIT apart
  // across or up and down.
  let each = true;
  for (let a = 0; a < vis.length && each; a++) for (let b = a + 1; b < vis.length; b++) {
    if (Math.max(Math.abs(vis[a].x - vis[b].x), Math.abs(vis[a].y - vis[b].y)) < SPOT_HIT) { each = false; break; }
  }
  spotLayer.classList.toggle('dense', !each);
  if (spotZoom && !closeAnim) {
    if (!each && zoom > SPOT_ZOOM_MIN) zoom = Math.max(SPOT_ZOOM_MIN, zoom * 0.985);
    else spotZoom = false;
  }
  let low = -Infinity, high = Infinity;
  spots.list.forEach((s, n) => {
    s.el.hidden = at[n].z > 1;
    s.el.classList.toggle('out', !seen[n]);
    s.el.style.transform = `translate(${at[n].x.toFixed(1)}px, ${at[n].y.toFixed(1)}px)`;
    if (seen[n]) { low = Math.max(low, at[n].y); high = Math.min(high, at[n].y); }
  });
  spotGo.hidden = each;
  if (each) return;
  // Under the spots, or under the "5 km" chip where it would sit on it (above the spots only if
  // that leaves the band, since the pin stands above them).
  let goY = Math.min(low + 16, fb.bottom - SPOT_HIT - 8);
  if (!scaleLabel.hidden) {
    const l = scaleLabel.getBoundingClientRect(), w = spotGo.offsetWidth / 2 + 8;
    if (Math.abs(l.left + l.width / 2 - o.x) < l.width / 2 + w && goY < l.bottom + 8 && goY + SPOT_HIT > l.top - 8) {
      goY = l.bottom + 8 + SPOT_HIT <= fb.bottom - 8 ? l.bottom + 8 : Math.max(fb.top + 8, high - 16 - SPOT_HIT);
    }
  }
  spotGo.style.transform = `translate(${o.x.toFixed(1)}px, ${goY.toFixed(1)}px)`;
}

function stepClose(now) {
  if (!closeAnim) return;
  const t = Math.min(1, (now - closeAnim.t0) / (reduceMotion.matches ? 1 : CLOSE_MS));
  close = closeAnim.from + (closeAnim.to - closeAnim.from) * ease(t);
  pitch = closeAnim.p0 + (closeAnim.p1 - closeAnim.p0) * ease(t);
  if (closeAnim.y1 !== undefined) yaw = closeAnim.y0 + (closeAnim.y1 - closeAnim.y0) * ease(t);
  if (t === 1) closeAnim = null;
}

// The grid's identity: a new site or grid rebuilds the buttons; a new selection doesn't.
const spotKey = (sp) => `${sp.site}:${sp.spacingM}:${sp.points.map((p) => `${p.i},${p.j},${p.groundM}`).join(';')}`;

function spotAt(i, j) {
  return spots?.list.find((s) => s.i === i && s.j === j) || null;
}

function nearest(at, within) {
  let best = null, most = within;
  for (const s of spots?.list || []) {
    const d = Math.hypot(s.at.x - at.x, s.at.z - at.z);
    if (d <= most) {
      best = s;
      most = d;
    }
  }
  return best;
}

function pick(s) {
  document.dispatchEvent(new CustomEvent('tanaw:spotpick', { detail: { site: tile.id, i: s.i, j: s.j } }));
}

// The pin's size on screen: km per screen px at the pin's distance, from the vertical fov
// across the canvas height (the view offset keeps the full height).
let pinKm = PIN_KM; // the stalk's current height in km
function sizePin() {
  const km = 2 * camera.position.distanceTo(pin.position) * Math.tan(camera.fov * rad / 2) / canvas.clientHeight;
  pinKm = PIN_PX * km;
  stalk.scale.set(PIN_STALK_PX / 2 * km, pinKm, PIN_STALK_PX / 2 * km);
  dot.position.y = dotRing.position.y = pinKm;
  dot.scale.setScalar(PIN_DOT_PX / 2 * km);
  dotRing.scale.setScalar((PIN_DOT_PX / 2 + PIN_RING_PX) * km);
}

// The pin eases to a spot (the site's own when s is null), or jumps.
function pinTo(s, jump) {
  const to = s ? s.at : new THREE.Vector3();
  if (jump || reduceMotion.matches) {
    pinAnim = null;
    pin.position.copy(to);
    return;
  }
  if (pinAnim ? pinAnim.to.equals(to) : pin.position.equals(to)) return;
  pinAnim = { from: pin.position.clone(), to: to.clone(), t0: performance.now() };
}

function stepPin(now) {
  if (!pinAnim) return;
  const t = Math.min(1, (now - pinAnim.t0) / PIN_MS);
  pin.position.lerpVectors(pinAnim.from, pinAnim.to, ease(t));
  if (t === 1) pinAnim = null;
}

// The host's spot, for the tile in the scene: the dots (rebuilt with a new grid) and the pin.
// jump: a new tile, so the pin doesn't glide.
function applySpot(jump) {
  if (!tile || !spot || spot.site !== tile.id) return;
  if (!spot.points) {
    spots = null;
    spotLayer.hidden = true;
  } else if (!spots || spots.site !== tile.id || spots.key !== spotKey(spot)) {
    buildSpots();
    if (!jump) reframe(true); // the close framing needs the spots
  }
  pinTo(spotAt(spot.i, spot.j), jump);
  for (const s of spots?.list || []) {
    const on = s.i === spot.i && s.j === spot.j;
    s.el.setAttribute('aria-pressed', String(on));
    s.el.tabIndex = on ? 0 : -1;
  }
}
document.addEventListener('tanaw:spot', (e) => {
  spot = e.detail;
  applySpot(false);
});

// Pointer to canvas coordinates, and to normalised device coordinates for the raycaster.
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function toNdc(e) {
  const box = canvas.getBoundingClientRect();
  return ndc.set((e.clientX - box.left) / box.width * 2 - 1, -((e.clientY - box.top) / box.height) * 2 + 1);
}

// Where the pointer meets the ground, or null.
function ground(e) {
  raycaster.setFromCamera(toNdc(e), camera);
  const hit = raycaster.intersectObject(terrain, false)[0];
  return hit && Math.hypot(hit.point.x, hit.point.z) <= DISC_KM ? hit.point : null;
}

// Whether the pointer is within PIN_HIT px of the pin's stalk or dot, on screen.
const pinBase = new THREE.Vector3(), pinTop = new THREE.Vector3();
function onPin(e) {
  if (!spots || !tile) return false;
  const box = canvas.getBoundingClientRect();
  const px = (v) => [(v.x + 1) / 2 * box.width + box.left, (1 - v.y) / 2 * box.height + box.top];
  pinBase.copy(pin.position).project(camera);
  pinTop.copy(pin.position).setY(pin.position.y + pinKm).project(camera);
  if (pinBase.z > 1 || pinTop.z > 1) return false;
  const [ax, ay] = px(pinBase), [bx, by] = px(pinTop);
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? clamp(((e.clientX - ax) * dx + (e.clientY - ay) * dy) / len, 0, 1) : 0;
  return Math.hypot(e.clientX - (ax + t * dx), e.clientY - (ay + t * dy)) <= PIN_HIT;
}
