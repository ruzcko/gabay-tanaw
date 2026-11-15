import * as THREE from '../vendor/three/three.module.js';
import { travelPointKey as key } from './model.js';

// Display geometry only: each feature is already classified by the science worker.
export function createTravelGlobe({ moon, camera, canvas, moonVector }) {
  const group = new THREE.Group(); moon.add(group);
  const markers = document.createElement('div'); markers.className = 'travel-markers'; markers.hidden = true;
  canvas.after(markers);
  let state = { open: false, features: [], markers: [], layer: 'combined' }, pins = [];
  const world = new THREE.Vector3(), eye = new THREE.Vector3(), normal = new THREE.Vector3();
  const colour = name => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim());
  function clear() { for (const child of [...group.children]) { group.remove(child); child.geometry.dispose(); child.material.dispose(); } }
  function binGeometry(feature) {
    // Unwrapped longitudes are intentional, so a bin crossing ±180° stays on the sphere.
    const ring = feature.geometry.coordinates[0], west = ring[0][0], east = ring[1][0], south = ring[0][1], north = ring[2][1];
    const positions = [], indices = [], n = 5;
    for (let y = 0; y <= n; y++) for (let x = 0; x <= n; x++) positions.push(...moonVector(south + (north - south) * y / n, west + (east - west) * x / n).multiplyScalar(1.003).toArray());
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = y * (n + 1) + x, b = a + n + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); return geometry;
  }
  function update(detail) {
    state = detail; markers.hidden = !state.open; group.visible = state.open;
    clear(); markers.replaceChildren(); pins = [];
    if (!state.open) return;
    for (const feature of state.features) {
      const r = feature.properties, layer = state.layer;
      const show = layer === 'combined' ? r.status === 'pass' : layer === 'unknown' ? r.status === 'unknown' : r.checks[layer] === 'pass';
      if (!show) continue;
      const geometry = binGeometry(feature), color = colour(layer === 'sunlight' ? '--sun' : layer === 'earth' ? '--earth' : '--text');
      if (layer === 'unknown') {
        // Wire edges distinguish unresolved bins without implying a visibility match.
        const edges = new THREE.EdgesGeometry(geometry, 5); geometry.dispose();
        group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity: .4, depthWrite: false })));
      } else group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .22, side: THREE.DoubleSide, depthWrite: false })));
    }
    const unique = new Map(state.markers.map(p => [key(p.point), p]));
    for (const [id, p] of unique) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'travel-marker'; b.dataset.status = p.status;
      b.setAttribute('aria-label', `${p.point.name || 'Sampled location'} · ${p.status === 'pass' ? 'matches enabled Travel criteria' : 'unresolved Travel criteria'}`);
      b.setAttribute('aria-pressed', String(id === state.selected));
      const label = document.createElement('span'); label.textContent = p.point.name || `${p.point.lat.toFixed(2)}°, ${p.point.lon.toFixed(2)}°`; b.append(label);
      b.addEventListener('click', () => document.dispatchEvent(new CustomEvent('tanaw:travel-pick', { detail: { key: id } })));
      markers.append(b); pins.push({ button: b, at: moonVector(p.point.lat, p.point.lon), selected: id === state.selected });
    }
  }
  document.addEventListener('tanaw:travel', event => update(event.detail));
  return {
    render({ hidden, band }) {
      const visible = state.open && !hidden; markers.hidden = !visible; group.visible = visible;
      if (!visible) return;
      const box = canvas.getBoundingClientRect(), occupied = [];
      // Selected destination wins if nearby candidates cannot have distinct 44px targets.
      for (const pin of [...pins].sort((a, b) => Number(b.selected) - Number(a.selected))) {
        world.copy(pin.at).applyMatrix4(moon.matrixWorld); normal.copy(pin.at).transformDirection(moon.matrixWorld); eye.copy(camera.position).sub(world);
        const front = normal.dot(eye) > 0; world.project(camera);
        const x = (world.x + 1) * box.width / 2, y = (1 - world.y) * box.height / 2;
        const fits = front && world.z < 1 && x + box.left > band.left + 22 && x + box.left < band.right - 22 && y + box.top > band.top + 22 && y + box.top < band.bottom - 22;
        const free = fits && !occupied.some(p => Math.hypot(x - p.x, y - p.y) < 44);
        pin.button.hidden = !free;
        if (free) { pin.button.style.transform = `translate(${x - 22}px, ${y - 22}px)`; occupied.push({ x, y }); }
      }
    }
  };
}
