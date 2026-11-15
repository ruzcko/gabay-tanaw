import * as THREE from '../vendor/three/three.module.js';
import { createGlobeOrbit } from './globe-orbit.js';
import { createGlobeCompass } from './globe-compass.js';
import { createNavigatorBodies } from './navigator-bodies.js';

/** Display/navigation only. Body directions and all observations arrive in the snapshot. */
export function createLocationGlobe(container, onSelect = () => {}) {
  const figure = document.createElement('figure'); figure.className = 'location-globe'; figure.id = 'moon-navigator'; figure.hidden = true;
  const map = document.createElement('div'); map.className = 'location-map';
  const marker = document.createElement('span'); marker.className = 'location-marker'; marker.setAttribute('aria-hidden', 'true');
  const selection = document.createElement('span'); selection.className = 'location-selection'; selection.hidden = true; selection.setAttribute('aria-hidden', 'true');
  const ripple = document.createElement('span'); ripple.className = 'location-ripple'; selection.append(ripple);
  const caption = document.createElement('figcaption');
  const status = document.createElement('span'); status.className = 'location-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true'); status.textContent = 'Current site';
  const coordinates = document.createElement('span'); coordinates.className = 'location-coordinates';
  const hoverLabel = document.createElement('span'); hoverLabel.textContent = 'Hover location'; hoverLabel.hidden = true;
  caption.append(status, hoverLabel, coordinates); figure.append(map, caption); container.append(figure);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(200, 200, false);
  const canvas = renderer.domElement; canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Moon navigator. Drag or arrow keys to turn, scroll or plus and minus to zoom. Click a location or press Enter to select the center.');
  map.append(canvas, marker, selection);
  const compass = createGlobeCompass(map, direction => {
    focus({ N: [0, 1, 0], E: [0, 0, -1], S: [0, -1, 0], W: [0, 0, 1] }[direction]);
    hover(null); draw();
  });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, .1, 20);
  const geometry = new THREE.SphereGeometry(1, 48, 32), uv = geometry.attributes.uv, positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) uv.setXY(i, Math.atan2(-positions.getZ(i), positions.getX(i)) / (2 * Math.PI) + .5, Math.asin(THREE.MathUtils.clamp(positions.getY(i), -1, 1)) / Math.PI + .5);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const moon = new THREE.Mesh(geometry, material); scene.add(moon, new THREE.AmbientLight(0xffffff, .04));
  // Physical lunar axis in Moon-local coordinates; the sphere occludes the far pole.
  const poleGeometry = new THREE.CylinderGeometry(.018, .018, .2, 12);
  const poleMaterial = new THREE.MeshBasicMaterial({ color: getComputedStyle(container).getPropertyValue('--text').trim() || '#f2f4f8' });
  const poles = [1, -1].map(sign => {
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.y = sign * 1.08; pole.userData.latitudeDeg = sign * 90; scene.add(pole); return pole;
  });
  const light = new THREE.DirectionalLight(0xffffff, Math.PI); scene.add(light);
  const labels = {};
  const legend = document.createElement('div'); legend.className = 'navigator-legend';
  legend.title = 'Sun and Earth directions follow the selected UTC snapshot. Sizes and distances are not to scale. Earth rotation is illustrative when unavailable.';
  for (const name of ['earth', 'sun']) { const label = document.createElement('span'); label.className = `navigator-body ${name}`; label.hidden = true; legend.append(label); labels[name] = label; }
  const scaleNote = document.createElement('span'); scaleNote.className = 'navigator-scale'; scaleNote.textContent = 'Schematic · not to scale';
  caption.prepend(legend, scaleNote);
  let snapshot, pending, disposed = false, distance = 5.3, drag;
  const sameSite = (a, b) => a && b && Math.abs(a.latitudeDeg - b.latitudeDeg) < .000001 &&
    Math.abs(((a.longitudeEastDeg - b.longitudeEastDeg + 540) % 360) - 180) < .000001;
  const siteVector = site => {
    const a = site.latitudeDeg * Math.PI / 180, b = site.longitudeEastDeg * Math.PI / 180;
    return new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b));
  };
  const showCoordinates = site => { coordinates.textContent = `${Math.abs(site.latitudeDeg).toFixed(1)}° ${site.latitudeDeg < 0 ? 'S' : 'N'} · ${Math.abs(site.longitudeEastDeg).toFixed(1)}° ${site.longitudeEastDeg < 0 ? 'W' : 'E'}`; };
  function pulse(element) {
    element.getAnimations().forEach(animation => animation.cancel());
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) element.animate([
      { transform: 'scale(.6)', opacity: 1 }, { transform: 'scale(2.4)', opacity: 0 }
    ], { duration: 480, easing: 'cubic-bezier(.16, 1, .3, 1)' });
  }
  const orbit = createGlobeOrbit();
  let focusFrame = 0;
  function stopFocus() { cancelAnimationFrame(focusFrame); focusFrame = 0; }
  function focus(direction, animate = true) {
    stopFocus();
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { orbit.focus(direction); draw(); return; }
    const started = performance.now(); let previous = started;
    const step = now => {
      if (disposed) return;
      const done = now - started >= 500;
      orbit.focus(direction, done ? 1 : 1 - Math.exp(-(now - previous) / 80)); previous = now;
      draw(); focusFrame = done ? 0 : requestAnimationFrame(step);
    };
    focusFrame = requestAnimationFrame(step);
  }
  const ray = new THREE.Raycaster(), events = new AbortController();
  const texture = new THREE.TextureLoader().load(new URL('../assets/moon-color-4k.webp', import.meta.url).href, () => {
    if (disposed) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace; material.map = texture; material.needsUpdate = true; draw();
  });
  const earthTexture = new THREE.TextureLoader().load(new URL('../assets/observer/earth-blue-marble.png', import.meta.url).href, () => {
    if (disposed) { earthTexture.dispose(); return; }
    earthTexture.colorSpace = THREE.SRGBColorSpace; draw();
  });
  const navigatorBodies = createNavigatorBodies(earthTexture);
  scene.add(navigatorBodies.group);
  function draw() {
    if (!snapshot || disposed || figure.hidden) return;
    orbit.apply(camera, distance);
    compass.update(camera);
    light.visible = !!snapshot.overview;
    if (snapshot.overview) light.position.fromArray(snapshot.overview.sunDirectionMoon).multiplyScalar(10);
    const bodyPositions = navigatorBodies.update(snapshot, camera);
    renderer.render(scene, camera);
    function place(element, site) {
      const position = siteVector(site);
      element.hidden = position.dot(camera.position) <= 1;
      const point = position.project(camera); element.style.left = `${(point.x + 1) * 50}%`; element.style.top = `${(1 - point.y) * 50}%`;
    }
    place(marker, pending || snapshot.site);
    if (pending) place(selection, pending);
    for (const name of ['sun', 'earth']) {
      const label = labels[name]; label.hidden = !snapshot.overview;
      if (label.hidden) continue;
      const title = name === 'sun' ? 'Sun' : 'Earth', far = bodyPositions[name].far;
      label.textContent = `${title}${far ? ' · far' : ''}`;
      label.title = `${title} direction around Moon; ${far ? 'far' : 'near'} side. Schematic, not to scale.`;
    }
  }
  function locationAt(x, y) {
    ray.setFromCamera(new THREE.Vector2(x, y), camera); const hit = ray.intersectObjects([moon, ...poles], false)[0];
    if (!hit) return null;
    if (hit.object !== moon) return { latitudeDeg: hit.object.userData.latitudeDeg, longitudeEastDeg: 0 };
    const p = hit.point.normalize();
    return { latitudeDeg: Math.asin(THREE.MathUtils.clamp(p.y, -1, 1)) * 180 / Math.PI, longitudeEastDeg: Math.atan2(-p.z, p.x) * 180 / Math.PI };
  }
  function hover(event) {
    const r = canvas.getBoundingClientRect();
    const site = event && locationAt((event.clientX - r.left) / r.width * 2 - 1, 1 - (event.clientY - r.top) / r.height * 2);
    canvas.style.cursor = site ? 'pointer' : 'grab';
    hoverLabel.hidden = !site; status.hidden = !!site;
    if (site) showCoordinates(site);
    else if (snapshot) showCoordinates(pending || snapshot.site);
  }
  function pick(x, y) { const site = locationAt(x, y); if (site) onSelect(site); }
  canvas.addEventListener('pointerdown', event => { event.stopPropagation(); stopFocus(); canvas.focus(); canvas.setPointerCapture(event.pointerId); hover(null); canvas.style.cursor = 'grabbing'; drag = { x: event.clientX, y: event.clientY, moved: false }; }, { signal: events.signal });
  canvas.addEventListener('pointermove', event => {
    event.stopPropagation(); if (!drag) { hover(event); return; }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3 || drag.moved) { drag.moved = true; orbit.turn(-dx * .5, dy * .5); drag.x = event.clientX; drag.y = event.clientY; draw(); }
  }, { signal: events.signal });
  canvas.addEventListener('pointerup', event => { event.stopPropagation(); if (drag && !drag.moved) { const r = canvas.getBoundingClientRect(); pick((event.clientX - r.left) / r.width * 2 - 1, 1 - (event.clientY - r.top) / r.height * 2); } drag = null; hover(event); }, { signal: events.signal });
  canvas.addEventListener('pointercancel', () => { drag = null; hover(null); }, { signal: events.signal });
  canvas.addEventListener('pointerleave', () => { if (!drag) hover(null); }, { signal: events.signal });
  canvas.addEventListener('wheel', event => { event.stopPropagation(); event.preventDefault(); stopFocus(); distance = THREE.MathUtils.clamp(distance * Math.exp(Math.sign(event.deltaY) * .12), 2.5, 7); draw(); hover(event); }, { passive: false, signal: events.signal });
  canvas.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Enter', ' '].includes(event.key)) return;
    event.stopPropagation(); event.preventDefault(); stopFocus();
    if (event.key === 'Enter' || event.key === ' ') { pick(0, 0); return; }
    if (event.key === 'ArrowLeft') orbit.turn(-10, 0); if (event.key === 'ArrowRight') orbit.turn(10, 0);
    if (event.key === 'ArrowUp') orbit.turn(0, 10); if (event.key === 'ArrowDown') orbit.turn(0, -10);
    if (event.key === '+' || event.key === '=') distance /= 1.15; if (event.key === '-') distance *= 1.15;
    distance = THREE.MathUtils.clamp(distance, 2.5, 7); hover(null); draw();
  }, { signal: events.signal });
  return {
    beginSelection(site, force = false) {
      if (!site || (!force && !pending && sameSite(site, snapshot?.site))) return;
      const changed = !sameSite(site, pending);
      pending = { latitudeDeg: site.latitudeDeg, longitudeEastDeg: site.longitudeEastDeg };
      figure.dataset.selection = 'loading'; figure.setAttribute('aria-busy', 'true');
      status.textContent = 'Loading selected site…'; showCoordinates(pending);
      if (changed) focus(siteVector(pending).toArray());
      draw();
      if (changed || force) pulse(ripple);
    },
    failSelection(message = 'Site unavailable · Retry below') {
      if (!pending) return;
      figure.dataset.selection = 'error'; figure.setAttribute('aria-busy', 'false');
      status.textContent = message;
      ripple.getAnimations().forEach(animation => animation.cancel());
    },
    update(value) {
      const confirmed = !!pending;
      pending = undefined; selection.hidden = true;
      ripple.getAnimations().forEach(animation => animation.cancel());
      figure.dataset.selection = 'ready'; figure.setAttribute('aria-busy', 'false');
      status.textContent = confirmed ? 'Site selected' : 'Current site';
      const hadSnapshot = !!snapshot;
      const changed = !sameSite(snapshot?.site, value.site); snapshot = value;
      if (changed) {
        const a = value.site.latitudeDeg * Math.PI / 180, b = value.site.longitudeEastDeg * Math.PI / 180;
        if (!confirmed) focus([Math.cos(a) * Math.cos(b), Math.sin(a), -Math.cos(a) * Math.sin(b)], hadSnapshot);
      }
      if (changed || confirmed) {
        marker.getAnimations().forEach(animation => animation.cancel());
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) marker.animate([
          { boxShadow: '0 0 0 2px rgba(255,255,255,.9)' }, { boxShadow: '0 0 0 18px rgba(255,255,255,0)' }
        ], { duration: 650, easing: 'ease-out' });
      }
      hover(null); showCoordinates(value.site);
      draw();
    },
    setVisible(visible) { figure.hidden = !visible || !snapshot; draw(); },
    dispose() { disposed = true; stopFocus(); events.abort(); compass.dispose(); navigatorBodies.dispose(); earthTexture.dispose(); poleGeometry.dispose(); poleMaterial.dispose(); geometry.dispose(); material.dispose(); texture.dispose(); renderer.dispose(); renderer.forceContextLoss(); figure.remove(); }
  };
}
