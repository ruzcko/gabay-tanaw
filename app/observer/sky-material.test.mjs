import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { createStars } from './sky-material.js';
import { moonSkyRotation } from '../moon-sky.js';

test('Moon sky cancels the selected site basis and retains catalog orientation', () => {
  const model = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.2, .3, .8));
  const inertial = new THREE.Quaternion().setFromEuler(new THREE.Euler(.7, -.4, 1.1));
  for (const euler of [new THREE.Euler(0, 0, 0), new THREE.Euler(1.5, -2.1, .6)]) {
    const local = new THREE.Quaternion().setFromEuler(euler);
    const sky = { catalogFrame: 'ICRS-J1991.25', catalogToLocal: local.clone().multiply(inertial).toArray() };
    const actual = moonSkyRotation(sky, { moonToLocal: local.toArray() }, model);
    assert.ok(actual.angleTo(model.clone().multiply(inertial)) < 1e-7);
  }
  assert.equal(moonSkyRotation(null, null, model), null);
  assert.equal(moonSkyRotation({ catalogFrame: 'unknown' }, {}, model), null);
});

test('shared catalog preserves celestial axes and varied brightness', () => {
  const stars = createStars({ stars: [[1, 0, 0, 0], [2, 90, 0, 3], [3, 0, 90, 4]] });
  const p = stars.geometry.attributes.position, b = stars.geometry.attributes.brightness;
  assert.ok(new THREE.Vector3().fromBufferAttribute(p, 0).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6);
  assert.ok(new THREE.Vector3().fromBufferAttribute(p, 1).distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-6);
  assert.ok(new THREE.Vector3().fromBufferAttribute(p, 2).distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-6);
  assert.ok(b.getX(0) > b.getX(1) && b.getX(1) > b.getX(2));
  assert.equal(stars.material.depthWrite, false);
  stars.geometry.dispose(); stars.material.dispose();
});
