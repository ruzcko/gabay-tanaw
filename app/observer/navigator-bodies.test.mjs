import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { createNavigatorBodies } from './navigator-bodies.js';
import { createGlobeOrbit } from './globe-orbit.js';

test('3D bodies, surface dots and Earth sunlight use the same changing snapshot', () => {
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 20); camera.position.z = 5.3; camera.updateMatrixWorld();
  const view = createNavigatorBodies(new THREE.Texture());
  const earth = view.group.getObjectByName('earth'), sun = view.group.getObjectByName('sun');
  const snapshot = { overview: { earthDirectionMoon: [0, 0, 1], sunDirectionMoon: [1, 0, 0], moonToLocal: [0, 0, 0, 1] }, earthAppearance: { bodyToLocal: [0, 0, 0, 1], sunDirectionBody: [1, 0, 0] } };
  view.update(snapshot, camera);
  assert.deepEqual(earth.position.toArray(), [0, 0, 1.4]); assert.deepEqual(sun.position.toArray(), [1.7, 0, 0]);
  assert.deepEqual(earth.material.uniforms.sun.value.toArray(), [1, 0, 0]);
  assert.equal(view.group.getObjectByName('earth-surface-point').visible, true);
  snapshot.overview.sunDirectionMoon = [0, 0, -1]; snapshot.earthAppearance.sunDirectionBody = [0, 0, -1];
  view.update(snapshot, camera);
  assert.deepEqual(sun.position.toArray(), [0, 0, -1.7]); assert.deepEqual(earth.material.uniforms.sun.value.toArray(), [0, 0, -1]);
  assert.equal(view.group.getObjectByName('sun-surface-point').visible, false);
  const position = earth.position.clone(), orientation = earth.quaternion.clone();
  camera.position.set(5.3, 0, 0); camera.lookAt(0, 0, 0); camera.updateMatrixWorld(); view.update(snapshot, camera);
  assert.deepEqual(earth.position.toArray(), position.toArray()); assert.deepEqual(earth.quaternion.toArray(), orientation.toArray());
  assert.equal(view.group.children.some(object => object.isLine), false);
  view.dispose();
});

test('orientation interpolation takes a partial step and ends at the requested pole', () => {
  const orbit = createGlobeOrbit(), camera = new THREE.PerspectiveCamera();
  orbit.focus([0, 0, 1]); orbit.focus([0, 1, 0], .5); orbit.apply(camera, 5);
  assert.ok(camera.position.y > 0 && camera.position.z > 0);
  orbit.focus([0, 1, 0]); orbit.apply(camera, 5);
  assert.ok(Math.abs(camera.position.y - 5) < 1e-10 && Math.abs(camera.position.z) < 1e-10);
});
