import * as THREE from './vendor/three/three.module.js';
import { createStars, createMilkyWay } from './observer/sky-material.js';
import { localAssetProvider } from './observer/local-providers.js';

/** Display-only composition of the supplied local sky and Moon model rotations. */
export function moonSkyRotation(sky, overview, modelRotation) {
  if (sky?.catalogFrame !== 'ICRS-J1991.25' || !overview?.moonToLocal) return null;
  return modelRotation.clone().multiply(new THREE.Quaternion().fromArray(overview.moonToLocal).invert())
    .multiply(new THREE.Quaternion().fromArray(sky.catalogToLocal));
}

export function createMoonSky(scene, invalidate) {
  let stars, milkyWay, loading, enabled = false, snapshot = null;
  const controller = new AbortController();
  async function load() {
    if (loading) return loading;
    loading = (async () => {
      const assets = await localAssetProvider.getAssets({ signal: controller.signal });
      const map = await new THREE.TextureLoader().loadAsync(assets.milkyWay.url);
      if (controller.signal.aborted) { map.dispose(); return; }
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = THREE.RepeatWrapping;
      stars = createStars(assets.catalog); stars.scale.setScalar(40); stars.renderOrder = -1;
      milkyWay = createMilkyWay(map); milkyWay.scale.setScalar(45);
      milkyWay.material.color.setScalar(.18);
      scene.add(stars, milkyWay); invalidate();
    })().catch(error => { loading = null; throw error; });
    return loading;
  }
  return {
    async setEnabled(value) { enabled = value; invalidate(); if (value) await load(); },
    setSnapshot(value) { snapshot = value; invalidate(); },
    update(camera, modelRotation, pixelRatio, hidden) {
      const rotation = enabled && !hidden && moonSkyRotation(snapshot?.sky, snapshot?.overview, modelRotation);
      for (const layer of [stars, milkyWay]) if (layer) {
        layer.visible = !!rotation;
        if (rotation) { layer.position.copy(camera.position); layer.quaternion.copy(rotation); }
      }
      if (stars) stars.material.uniforms.pixelRatio.value = pixelRatio;
    },
    dispose() {
      controller.abort();
      for (const layer of [stars, milkyWay]) if (layer) {
        scene.remove(layer); layer.material.map?.dispose(); layer.geometry.dispose(); layer.material.dispose();
      }
    }
  };
}
