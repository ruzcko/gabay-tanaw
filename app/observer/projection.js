import * as THREE from '../vendor/three/three.module.js';

// Zoom is a diagonal field of view. Zooming out stops when the view is 90° tall or 150° wide,
// whichever comes first, so wide and tall screens both avoid extreme rectilinear stretching.
export const observerZoom = { min: 10, initial: 60, maxVerticalDeg: 90, maxHorizontalDeg: 150 };
export function observerVerticalFov(diagonalDeg, aspect) {
  return 2 * Math.atan(Math.tan(diagonalDeg * Math.PI / 360) / Math.hypot(aspect, 1)) * 180 / Math.PI;
}
export function observerMaxDiagonal(aspect) {
  const halfHeight = Math.min(Math.tan(observerZoom.maxVerticalDeg * Math.PI / 360), Math.tan(observerZoom.maxHorizontalDeg * Math.PI / 360) / aspect);
  return 2 * Math.atan(halfHeight * Math.hypot(aspect, 1)) * 180 / Math.PI;
}

// Round display discs retain the host's direction and do not tilt into edge ovals.
export function faceSkyDisc(mesh, camera, angularDiameterDeg) {
  mesh.quaternion.copy(camera.quaternion);
  const depth = mesh.position.clone().sub(camera.position).applyQuaternion(camera.quaternion.clone().invert()).z;
  mesh.scale.setScalar(Math.max(0, -depth) * Math.tan(THREE.MathUtils.degToRad(angularDiameterDeg / 2)));
}
