import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three/three.module.js';
import { createGlobeOrbit } from './globe-orbit.js';

test('free globe rotation crosses either pole and completes a full revolution', () => {
  const orbit = createGlobeOrbit(), camera = new THREE.PerspectiveCamera();
  orbit.focus([0,0,1]); orbit.turn(0,100); orbit.apply(camera,4);
  assert.ok(camera.position.z < 0, 'Camera must pass the north pole');
  orbit.turn(0,80); orbit.apply(camera,4);
  assert.ok(Math.abs(camera.position.z+4)<1e-12);
  orbit.turn(0,180); orbit.apply(camera,4);
  assert.ok(camera.position.distanceTo(new THREE.Vector3(0,0,4))<1e-12);
  for (const pole of [[0,1,0],[0,-1,0]]) {
    orbit.focus(pole); orbit.turn(19,31); orbit.apply(camera,4);
    assert.ok(camera.position.toArray().every(Number.isFinite));
    assert.ok(Math.abs(camera.quaternion.length()-1)<1e-12);
  }
});
