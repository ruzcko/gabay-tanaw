// Earth and the Sun as every 3D view draws them (the globe, Earth & Sun, the site view and the
// Observer view), so they look the same everywhere. Display only: each view places them along
// its own published directions and gives Earth the Sun's direction, so its phase is real.
// The 2D charts keep their token dots.
//
//   loadEarthMap()                  Promise of the Blue Marble texture (loaded once, shared)
//   createEarth({ radius, fill })   { mesh, setMap(texture), ready, setSun(dir), setFill(k),
//                                     setOpacity(a), update(camera) }
//     dir: the Sun's direction in the mesh's own frame (its parent's, unless the mesh is turned);
//     fill: a faint night-side light towards the camera (0 to about 0.05), decorative, so a dark
//     Earth still reads as a sphere; update(camera) once a frame, before rendering. A thin
//     --earth glow just outside the day side's limb (the air lit by the Sun) keeps a thin
//     crescent readable at a small size.
//   createSun({ radius, glow })     { object, setOpacity(a) }: a textured disc that faces the
//     camera (turn it with the camera's quaternion), and its soft glow out to glow × radius;
//     setOpacity draws it fainter (a Sun out of view from the site).
import * as THREE from 'three';

const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

let earthMap = null;
export function loadEarthMap() {
  earthMap ??= new THREE.TextureLoader().loadAsync(new URL('./assets/observer/earth-blue-marble.png', import.meta.url).href).then((map) => {
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 8;
    return map;
  }, (err) => { earthMap = null; throw err; });
  return earthMap;
}

// Earth: the map lit by the Sun (its phase), oceans with a faint glint, a thin blue rim on the
// day side's limb, and the optional night-side fill. Until the map loads it is --earth.
const earthVertex = /* glsl */ `
  varying vec3 body;
  void main() { body = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const earthFragment = /* glsl */ `
  uniform sampler2D map; uniform float hasMap; uniform vec3 tint;
  uniform vec3 sun; uniform vec3 viewer; uniform float fill; uniform float opacity;
  varying vec3 body;
  void main() {
    vec3 n = normalize(body);
    vec2 uv = vec2(atan(-n.z, n.x) / 6.28318530718 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.14159265359 + 0.5);
    vec3 color = hasMap > 0.5 ? texture2D(map, uv).rgb : tint;
    float lit = max(dot(n, sun), 0.0), toView = max(dot(n, viewer), 0.0);
    float ocean = hasMap * smoothstep(0.015, 0.10, color.b - max(color.r, color.g * 0.85));
    vec3 halfway = (sun + viewer) / max(length(sun + viewer), 0.0001);
    float spec = pow(max(dot(n, halfway), 0.0), 65.0) * 0.15 * ocean * lit;
    float rim = pow(1.0 - toView, 5.0) * smoothstep(-0.08, 0.3, dot(n, sun));
    vec3 c = color * (lit + fill * (0.4 + 0.6 * toView)) + vec3(spec) + vec3(0.08, 0.22, 0.42) * rim * 0.55;
    gl_FragColor = vec4(c, opacity);
    #include <colorspace_fragment>
  }`;
// The glow: a shell GLOW × the radius, drawn from inside so it shows only round the disc. Each
// pixel is brightest where its line of sight passes the limb and fades to nothing at the
// shell's edge, and lit by the Sun at the point of the limb it passes.
const GLOW = 1.15;
const glowFragment = /* glsl */ `
  uniform vec3 tint; uniform vec3 sun; uniform vec3 eye; uniform float radius; uniform float opacity;
  varying vec3 body;
  void main() {
    vec3 d = normalize(body - eye), near = body - dot(body, d) * d;
    float b = length(near) / radius;
    float k = 1.0 - smoothstep(1.0, ${GLOW.toFixed(2)}, b);
    float day = smoothstep(-0.15, 0.45, dot(near / max(length(near), 1e-6), sun));
    gl_FragColor = vec4(tint * k * k * k * day * opacity, 1.0);
    #include <colorspace_fragment>
  }`;
export function createEarth({ radius = 1, fill = 0 } = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: null }, hasMap: { value: 0 }, tint: { value: new THREE.Color(token('--earth')) },
      sun: { value: new THREE.Vector3(1, 0, 0) }, viewer: { value: new THREE.Vector3(0, 0, 1) },
      fill: { value: fill }, opacity: { value: 1 },
    },
    vertexShader: earthVertex, fragmentShader: earthFragment, transparent: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), material);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(radius * GLOW, 64, 32), new THREE.ShaderMaterial({
    uniforms: {
      tint: material.uniforms.tint, sun: material.uniforms.sun, eye: { value: new THREE.Vector3(0, 0, 10) },
      radius: { value: radius }, opacity: material.uniforms.opacity,
    },
    vertexShader: earthVertex, fragmentShader: glowFragment,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  mesh.add(glow);
  const u = material.uniforms, at = new THREE.Vector3();
  return {
    mesh,
    get ready() { return u.hasMap.value > 0.5; },
    setMap(map) { u.map.value = map; u.hasMap.value = map ? 1 : 0; },
    setSun(dir) { u.sun.value.copy(dir).normalize(); },
    setFill(k) { u.fill.value = k; },
    setOpacity(a) { u.opacity.value = a; },
    update(camera) {
      mesh.worldToLocal(at.copy(camera.position));
      glow.material.uniforms.eye.value.copy(at);
      u.viewer.value.copy(at).normalize();
    },
  };
}

// The Sun: a photosphere disc (limb darkening, a restrained fine grain) in --sun, and one soft
// glow: --sun at 35% out to the disc's edge, fading to nothing at glow × its radius. No rays.
function sunMaterial(colour) {
  return new THREE.ShaderMaterial({
    uniforms: { tint: { value: colour.clone() } },
    vertexShader: earthVertex,
    fragmentShader: /* glsl */ `
      uniform vec3 tint; varying vec3 body;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        float mu = sqrt(max(0.0, 1.0 - dot(body.xy, body.xy)));
        vec3 p = vec3(body.xy, mu);
        float footprint = max(length(dFdx(p)), length(dFdy(p))) * 180.0;
        float grain = (hash(floor(p * 180.0)) - 0.5) * 0.055 * (1.0 - smoothstep(0.35, 1.0, footprint));
        gl_FragColor = vec4(tint * (0.40 + 0.60 * mu + grain), 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true, // drawn after its glow
  });
}
const glowTextures = new Map(); // glow → texture
function glowTexture(glow) {
  if (!glowTextures.has(glow)) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d'), grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
    grad.addColorStop(1 / glow, 'rgba(255, 255, 255, 0.35)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    glowTextures.set(glow, new THREE.CanvasTexture(c));
  }
  return glowTextures.get(glow);
}
export function createSun({ radius = 1, glow = 2.5 } = {}) {
  const colour = new THREE.Color(token('--sun'));
  const object = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CircleGeometry(1, 64), sunMaterial(colour));
  face.scale.setScalar(radius);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2 * glow * radius, 2 * glow * radius), new THREE.MeshBasicMaterial({
    color: colour, map: glowTexture(glow), transparent: true, depthWrite: false,
  }));
  halo.renderOrder = -1; // under the disc
  object.add(halo, face);
  return {
    object,
    // Fainter: the glow by opacity, the disc by dimming its colour (the same on a black sky).
    setOpacity(a) {
      halo.material.opacity = a;
      face.material.uniforms.tint.value.copy(colour).multiplyScalar(a);
    },
  };
}
