import * as THREE from '../vendor/three/three.module.js';

// Display-only projection of the comparison's exact coordinates. Hidden-hemisphere
// locations get labelled limb indicators, never apparent surface positions.
export function createCompareGlobe({ moon, camera, canvas, moonVector, underFront }) {
  const layer = document.createElement('div'); layer.className = 'compare-markers'; layer.hidden = true;
  layer.setAttribute('aria-label', 'Compared locations on the Moon'); canvas.after(layer);
  const links = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  links.classList.add('compare-marker-links'); links.setAttribute('aria-hidden', 'true');
  let active = false, pins = [], selected = '';
  const world = new THREE.Vector3(), normal = new THREE.Vector3(), eye = new THREE.Vector3(), centre = new THREE.Vector3();
  document.addEventListener('tanaw:select', event => { selected = event.detail.site; });
  document.addEventListener('tanaw:compare', event => {
    active = event.detail.active;
    layer.hidden = !active;
    if (!active) return;
    layer.replaceChildren(links); links.replaceChildren(); pins = [];
    for (const point of event.detail.points) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'compare-marker';
      button.dataset.site = point.id; button.dataset.slot = point.slot;
      const badge = document.createElement('b'); badge.textContent = point.slot;
      const label = document.createElement('span'); label.textContent = point.name;
      button.append(badge, label);
      button.addEventListener('click', () => document.dispatchEvent(new CustomEvent('tanaw:compare-pick', { detail: point })));
      const line = document.createElementNS(links.namespaceURI, 'line'); links.append(line);
      layer.append(button); pins.push({ point, button, label, line, at: moonVector(point.lat, point.lon) });
    }
  });
  return { render({ hidden, band }) {
    layer.hidden = !active || hidden;
    if (layer.hidden) return;
    const box = canvas.getBoundingClientRect(), occupied = [];
    const obstacles = [...document.querySelectorAll('#bodies .edge:not([hidden]), #bodies .body-label:not([hidden]), #bodies .overhead:not([hidden])')]
      .map(el => el.getBoundingClientRect()).filter(rect => rect.width && rect.height);
    const overlaps = (a, b) => a.left < b.right + 4 && a.right > b.left - 4 && a.top < b.bottom + 4 && a.bottom > b.top - 4;
    centre.set(0, 0, 0).applyMatrix4(moon.matrixWorld).project(camera);
    const cx = box.left + (centre.x + 1) * box.width / 2, cy = box.top + (1 - centre.y) * box.height / 2;
    const scale = box.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    const radius = scale / Math.sqrt(Math.max(camera.position.lengthSq() - 1, 1e-6));
    for (const { point, button, label, line, at } of pins) {
      world.copy(at).applyMatrix4(moon.matrixWorld); normal.copy(at).transformDirection(moon.matrixWorld); eye.copy(camera.position).sub(world);
      const far = normal.dot(eye) <= 0;
      world.project(camera);
      let x = box.left + (world.x + 1) * box.width / 2, y = box.top + (1 - world.y) * box.height / 2;
      if (far) {
        const dx = x - cx, dy = y - cy, length = Math.hypot(dx, dy);
        x = cx + (length > 1 ? dx / length : 1) * radius;
        y = cy + (length > 1 ? dy / length : 0) * radius;
      }
      const clamp = (value, min, max) => Math.max(min, Math.min(Math.max(min, max), value));
      const offsets = [[0, 0]];
      for (const distance of [44, 88, 132]) for (let i = 0; i < 8; i++) {
        const angle = i * Math.PI / 4;
        offsets.push([Math.cos(angle) * distance, Math.sin(angle) * distance]);
      }
      const positions = offsets.map(([dx, dy]) => {
        const px = clamp(x + dx, band.left + 22, band.right - 22), py = clamp(y + dy, band.top + (far ? 42 : 22), band.bottom - 22);
        return { x: px, y: py, left: px - 22, right: px + 22, top: py - (far ? 42 : 22), bottom: py + 22 };
      });
      const placed = positions.find(p => !underFront(p.x, p.y, 22) && [...obstacles, ...occupied].every(other => !overlaps(p, other))) || positions[0];
      occupied.push(placed);
      button.dataset.farSide = String(far);
      button.setAttribute('aria-label', `Site ${point.slot}: ${point.name}${far ? ' · Far side of the Moon' : ''}`);
      button.setAttribute('aria-pressed', String(point.id === selected));
      label.textContent = `${point.name}${far ? ' · Far side' : ''}`;
      button.style.transform = `translate(${placed.x - 22}px, ${placed.y - 22}px)`;
      line.setAttribute('x1', x); line.setAttribute('y1', y); line.setAttribute('x2', placed.x); line.setAttribute('y2', placed.y);
      line.style.display = Math.hypot(placed.x - x, placed.y - y) > 3 ? '' : 'none';
    }
  } };
}
