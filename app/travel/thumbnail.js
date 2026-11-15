import * as THREE from '../vendor/three/three.module.js';

// Reuse the live Moon's mesh, textures and shader. A separate camera never moves the host.
let template, vector, renderer, camera, scene, mesh, worker, sequence = 0;
const pending = new Map(), lighting = new Map();
export function configureTravelThumbnails(moonMesh, moonVector) { template = moonMesh; vector = moonVector; }
function arrivalLighting(instantUtc) {
  if (!worker) {
    worker = new Worker(new URL('./thumbnail-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id); if (!entry) return;
      pending.delete(data.id); data.error ? entry.reject(new Error(data.error)) : entry.resolve(data);
    };
    worker.onerror = () => { for (const entry of pending.values()) entry.reject(new Error('Lighting unavailable')); pending.clear(); lighting.clear(); worker.terminate(); worker = null; };
  }
  if (!lighting.has(instantUtc)) {
    const id = ++sequence;
    lighting.set(instantUtc, new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, instantUtc }); }).catch(error => { lighting.delete(instantUtc); throw error; }));
    if (lighting.size > 180) lighting.delete(lighting.keys().next().value);
  }
  return lighting.get(instantUtc);
}
function draw(canvas, point, sun) {
  if (!template) throw new Error('Moon maps unavailable');
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(160, 160); renderer.setPixelRatio(1);
    scene = new THREE.Scene(); camera = new THREE.OrthographicCamera(-.035, .035, .035, -.035, .01, 5);
    mesh = new THREE.Mesh(template.geometry, template.material.clone()); scene.add(mesh);
  }
  // Map upgrades in the main globe are shared; no texture copies or synthetic imagery.
  for (const key of ['colorMap', 'normalMap', 'poleNormalMap']) mesh.material.uniforms[key].value = template.material.uniforms[key].value;
  mesh.material.uniforms.sunDir.value.fromArray(sun);
  mesh.material.uniforms.fill.value = .03;
  // Destination previews show the arrival-lit surface, independent of the host's map overlay.
  mesh.material.uniforms.layerKind.value = 0;
  mesh.material.uniforms.shadeKind.value = 0;
  const center = vector(point.lat, point.lon);
  const north = new THREE.Vector3(0, 1, 0).addScaledVector(center, -center.y).normalize();
  camera.up.copy(north); camera.position.copy(center).multiplyScalar(3); camera.lookAt(center);
  renderer.render(scene, camera);
  canvas.getContext('2d').drawImage(renderer.domElement, 0, 0);
}
const visible = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) { visible.unobserve(entry.target); entry.target.loadThumbnail?.(); }
}, { rootMargin: '80px' });
export function releaseTravelThumbnails(root) {
  root.querySelectorAll('.travel-thumbnail canvas').forEach(canvas => { visible.unobserve(canvas); delete canvas.loadThumbnail; });
}

/** Arrival-lit render of the actual model around this site's exact coordinates. */
export function surfaceThumbnail(result) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Loading site view');
  canvas.loadThumbnail = async () => {
    try {
      const light = await arrivalLighting(result.startUtc);
      if (!canvas.isConnected) return;
      draw(canvas, result.point, light.sun);
      const label = `${result.point.name || 'Selected location'} · rendered Moon surface at ${result.startUtc.slice(0, 16).replace('T', ' ')} UTC · ${light.quality} lighting`;
      canvas.setAttribute('aria-label', label); canvas.title = label; canvas.dataset.ready = 'true';
    } catch {
      canvas.setAttribute('aria-label', 'Site view unavailable'); canvas.title = 'Arrival lighting unavailable';
      const context = canvas.getContext('2d'); context.fillStyle = '#aaa'; context.font = '14px sans-serif'; context.textAlign = 'center'; context.fillText('No preview', 80, 85);
    }
  };
  visible.observe(canvas); return canvas;
}
window.addEventListener('pagehide', () => { visible.disconnect(); worker?.terminate(); renderer?.dispose(); mesh?.material.dispose(); pending.clear(); lighting.clear(); }, { once: true });
