import * as THREE from './vendor/three/three.module.js';
import { createStars } from './observer/sky-material.js';
import { localAssetProvider } from './observer/local-providers.js';

/** Display-only composition of the supplied local sky and Moon model rotations. */
export function moonSkyRotation(sky, overview, modelRotation) {
  if (sky?.catalogFrame !== 'ICRS-J1991.25' || !overview?.moonToLocal) return null;
  return modelRotation.clone().multiply(new THREE.Quaternion().fromArray(overview.moonToLocal).invert())
    .multiply(new THREE.Quaternion().fromArray(sky.catalogToLocal));
}

export function createMoonSky(scene, invalidate) {
  let stars, loading, enabled = false, snapshot = null;
  const controller = new AbortController();
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      const assets = await localAssetProvider.getAssets({ signal: controller.signal });
      if (controller.signal.aborted) return;
      stars = createStars(assets.catalog); stars.scale.setScalar(40); stars.renderOrder = -1;
      scene.add(stars); invalidate();
    })().catch(error => { loading = null; throw error; });
    return loading;
  }
  return {
    async setEnabled(value) { enabled = value; invalidate(); if (value) await load(); },
    setSnapshot(value) { snapshot = value; invalidate(); },
    update(camera, modelRotation, pixelRatio, hidden) {
      const rotation = enabled && !hidden && moonSkyRotation(snapshot?.sky, snapshot?.overview, modelRotation);
      if (stars) {
        stars.visible = !!rotation;
        if (rotation) { stars.position.copy(camera.position); stars.quaternion.copy(rotation); }
        stars.material.uniforms.pixelRatio.value = pixelRatio;
      }
    },
    dispose() {
      controller.abort();
      if (stars) {
        scene.remove(stars); stars.geometry.dispose(); stars.material.dispose();
      }
    }
  };
}
