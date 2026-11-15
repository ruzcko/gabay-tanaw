import * as THREE from '../vendor/three/three.module.js';

/** Camera-space orbit with no latitude clamp or pole singularity. Display geometry only. */
export function createGlobeOrbit() {
  const rotation = new THREE.Quaternion();
  const axisX = new THREE.Vector3(1, 0, 0), axisY = new THREE.Vector3(0, 1, 0);
  return {
    focus(direction, fraction = 1) {
      const eye = new THREE.Vector3(...direction).normalize();
      const up = Math.abs(eye.y) > .9999 ? new THREE.Vector3(0, 0, -1) : axisY;
      const target = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(eye, new THREE.Vector3(), up));
      rotation.slerp(target, fraction);
    },
    turn(horizontalDeg, verticalDeg) {
      rotation.multiply(new THREE.Quaternion().setFromAxisAngle(axisY, horizontalDeg * Math.PI / 180));
      rotation.multiply(new THREE.Quaternion().setFromAxisAngle(axisX, -verticalDeg * Math.PI / 180)).normalize();
    },
    apply(camera, distance) {
      camera.quaternion.copy(rotation);
      camera.position.set(0, 0, distance).applyQuaternion(rotation);
      camera.updateMatrixWorld();
    },
    get quaternion() { return rotation.toArray(); }
  };
}
