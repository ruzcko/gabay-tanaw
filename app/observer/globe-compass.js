import * as THREE from '../vendor/three/three.module.js';

// Screen directions of lunar north at the center of the globe; no geographic calculation.
export function compassAngle(camera) {
  const north = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion.clone().invert());
  return Math.hypot(north.x, north.y) < 1e-8 ? Math.PI / 2 : Math.atan2(north.y, north.x);
}

export function createGlobeCompass(container, onOrient) {
  const compass = document.createElement('div'); compass.className = 'globe-compass';
  compass.setAttribute('role', onOrient ? 'group' : 'img'); compass.setAttribute('aria-label', 'Lunar compass: north, east, south and west');
  compass.title = 'Lunar north at the center of the view. At a pole, north is undefined.';
  const points = ['N', 'E', 'S', 'W'].map(text => {
    const point = document.createElement(onOrient ? 'button' : 'span');
    if (onOrient) {
      const names = { N: 'north pole', E: 'eastern hemisphere', S: 'south pole', W: 'western hemisphere' };
      point.type = 'button'; point.title = `Click to center the ${names[text]}`;
      point.setAttribute('aria-label', `Center ${names[text]}`);
      const label = document.createElement('span'); label.textContent = text; point.append(label);
      point.addEventListener('click', event => { event.preventDefault(); onOrient(text); });
    } else point.textContent = text;
    compass.append(point); return point;
  });
  container.append(compass);
  return {
    update(camera) {
      compass.hidden = false;
      const angle = compassAngle(camera);
      const radius = onOrient ? 38 : 28;
      points.forEach((point, i) => {
        const a = angle - i * Math.PI / 2;
        point.style.left = `${50 + radius * Math.cos(a)}%`;
        point.style.top = `${50 - radius * Math.sin(a)}%`;
      });
    },
    hide() { compass.hidden = true; },
    dispose() { compass.remove(); }
  };
}
