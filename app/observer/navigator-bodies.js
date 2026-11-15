import * as THREE from '../vendor/three/three.module.js';
import { createSunMaterial, createEarthMaterial, updateBodyViewer } from './display-materials.js';

/** Moon-frame positions from the host snapshot; radii/distances are display scale only. */
export function createNavigatorBodies(earthMap) {
  const group = new THREE.Group(), bodies = {}, dots = {};
  for (const name of ['earth', 'sun']) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(.12, 32, 24), name === 'sun'
      ? createSunMaterial() : createEarthMaterial(earthMap));
    body.name = name; group.add(body); bodies[name] = body;
    const token = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() : '';
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.045, 16, 12), new THREE.MeshBasicMaterial({ color: token || (name === 'sun' ? '#ffc861' : '#8cc4ff') }));
    dot.name = `${name}-surface-point`; group.add(dot); dots[name] = dot;
  }
  return {
    group,
    update(snapshot, camera) {
      const data = snapshot.overview; group.visible = !!data;
      if (!data) return {};
      const positions = {};
      for (const name of ['earth', 'sun']) {
        const body = bodies[name];
        body.position.fromArray(data[`${name}DirectionMoon`]).multiplyScalar(name === 'sun' ? 1.7 : 1.4);
        dots[name].position.fromArray(data[`${name}DirectionMoon`]).multiplyScalar(1.015);
        dots[name].visible = new THREE.Vector3(...data[`${name}DirectionMoon`]).dot(camera.position) > 1;
        const p = body.position.clone().project(camera);
        positions[name] = { x: p.x, y: p.y, far: body.position.dot(camera.position) < 0 };
      }
      const earth = bodies.earth;
      if (snapshot.earthAppearance) {
        earth.quaternion.fromArray(data.moonToLocal).invert().multiply(new THREE.Quaternion().fromArray(snapshot.earthAppearance.bodyToLocal));
        earth.material.uniforms.sun.value.fromArray(snapshot.earthAppearance.sunDirectionBody);
      } else {
        earth.quaternion.identity();
        // Explicit schematic fallback when Earth orientation is unavailable.
        earth.material.uniforms.sun.value.fromArray(data.sunDirectionMoon);
      }
      updateBodyViewer(earth, camera);
      return positions;
    },
    dispose() { group.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); }); group.removeFromParent(); }
  };
}
