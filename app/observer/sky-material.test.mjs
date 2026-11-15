import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { createMilkyWay, createStars } from './sky-material.js';
import { moonSkyRotation } from '../moon-sky.js';

test('NASA celestial map aligns RA and north with the catalog, including both seam edges', () => {
  const sky = createMilkyWay(null), positions = sky.geometry.attributes.position, uv = sky.geometry.attributes.uv;
  const at = (u, v) => {
    for (let i = 0; i < uv.count; i++) if (Math.abs(uv.getX(i)-u)<1e-6 && Math.abs(uv.getY(i)-v)<1e-6)
      return new THREE.Vector3().fromBufferAttribute(positions, i);
    assert.fail(`Missing map coordinate ${u}, ${v}`);
  };
  const near = (actual, expected) => assert.ok(actual.distanceTo(new THREE.Vector3(...expected)) < 1e-6);
  near(at(.5,.5), [1,0,0]); // NASA image centre = RA 0, declination 0.
  near(at(.25,.5), [0,1,0]); // RA increases left, not mirrored.
  near(at(.75,.5), [0,-1,0]);
  near(at(0,.5), [-1,0,0]); near(at(1,.5), [-1,0,0]);
  const top = new THREE.Vector3().fromBufferAttribute(positions, 0);
  near(top,[0,0,1]);
  assert.equal(sky.material.depthWrite, false); // Far background cannot hide terrain/bodies.
  sky.geometry.dispose(); sky.material.dispose();
});

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
