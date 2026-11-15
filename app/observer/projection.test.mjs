import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { observerVerticalFov, observerMaxDiagonal, faceSkyDisc } from './projection.js';

test('widest observer zoom stops at 90 degrees tall or 150 degrees wide', () => {
  for (const aspect of [390 / 844, 1, 1280 / 600, 4]) {
    const vertical = observerVerticalFov(observerMaxDiagonal(aspect), aspect);
    const horizontal = 2 * Math.atan(Math.tan(vertical * Math.PI / 360) * aspect) * 180 / Math.PI;
    assert.ok(vertical <= 90 + 1e-9 && horizontal <= 150 + 1e-9);
    assert.ok(Math.abs(vertical - 90) < 1e-9 || Math.abs(horizontal - 150) < 1e-9);
  }
});

test('sky discs stay circular at screen edges without moving their supplied direction', () => {
  for (const aspect of [.5, 2]) {
    const camera = new THREE.PerspectiveCamera(observerVerticalFov(observerMaxDiagonal(aspect), aspect), aspect, .1, 1e7);
    camera.position.set(2, 3, 4); camera.rotation.set(.3, .6, .1); camera.updateMatrixWorld();
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 64));
    for (const x of [0, .4, -.4]) {
      disc.position.set(x * 1e6, .1e6, -1e6).applyQuaternion(camera.quaternion).add(camera.position);
      const center = disc.position.clone(); faceSkyDisc(disc, camera, 4); disc.updateMatrixWorld();
      assert.deepEqual(disc.position.toArray(), center.toArray());
      const project = (x, y) => new THREE.Vector3(x, y, 0).applyMatrix4(disc.matrixWorld).project(camera);
      const width = project(1, 0).distanceTo(project(-1, 0)) * aspect;
      const height = project(0, 1).distanceTo(project(0, -1));
      assert.ok(Math.abs(width / height - 1) < 1e-10);
    }
    disc.geometry.dispose(); disc.material.dispose();
  }
});
