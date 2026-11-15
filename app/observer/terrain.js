import * as THREE from '../vendor/three/three.module.js';
import {addRegolithDetail} from './display-materials.js';

/** Owns one active patch and at most four CPU tile entries; provider owns no GPU objects. */
export function createTerrainLayer({ scene, provider, invalidate, onStatus, onError }) {
  const group = new THREE.Group(); scene.add(group);
  const cache = new Map();
  let generation = 0, abort, worker, workerReject, disposed = false, activeKey, map;
  const cancel = () => { abort?.abort(); worker?.terminate(); worker = null; workerReject?.(new DOMException('Obsolete terrain', 'AbortError')); workerReject = null; };
  function clear() { for (const mesh of [...group.children]) { group.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); } }
  function process(tile, site, exaggeration) {
    return new Promise((resolve, reject) => {
      workerReject = reject;
      worker = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
      const finish = () => { worker?.terminate(); worker = null; workerReject = null; };
      worker.onmessage = ({ data }) => { finish(); data.error ? reject(new Error(data.error)) : resolve(data.result); };
      worker.onerror = event => { finish(); reject(new Error(event.message)); };
      worker.postMessage({ tile, site, exaggeration });
    });
  }
  return {
    group,
    async update(site, exaggeration = 1) {
      const key = JSON.stringify([site, exaggeration]);
      if (disposed || key === activeKey) return;
      activeKey = key; cancel(); clear(); const current = ++generation; abort = new AbortController();
      const signal = abort.signal, start = performance.now();
      onStatus({ state: 'loading' }); invalidate();
      try {
        for (const level of [0, 1]) {
          const tileKey = JSON.stringify([site, level]);
          let tile = cache.get(tileKey);
          if (!tile) {
            tile = await provider.loadTile({ site: structuredClone(site), level, signal });
            if (disposed || current !== generation) return;
            if (!tile?.metadata?.source || !tile.metadata.license) throw new Error('Terrain attribution and licence are required');
            // Bound inputs before structured-cloning them into the worker/cache.
            if (!tile.elevationsM || tile.elevationsM.length > 513 * 513) throw new Error('Terrain tile exceeds sample budget');
            cache.set(tileKey, tile); while (cache.size > 4) cache.delete(cache.keys().next().value);
          }
          const data = await process(tile, site, exaggeration);
          if (disposed || current !== generation) return;
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3)); geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3)); geometry.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2)); geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
          const mesh = new THREE.Mesh(geometry, addRegolithDetail(new THREE.MeshStandardMaterial({ color: map && tile.uv ? 0xffffff : 0x777570, map: tile.uv ? map : null, roughness: 1 })));
          mesh.userData.hasGlobalUv = !!tile.uv;
          mesh.castShadow = true; mesh.receiveShadow = true;
          clear(); group.add(mesh);
          onStatus({ state: level ? 'ready' : 'refining', detailAvailable: tile.metadata.detailAvailable, coverage: data.coverage, resolutionM: Math.max(data.resolutionM,tile.metadata.sourceResolutionM || 0), meshSpacingM:data.resolutionM, loadMs: performance.now()-start, source: tile.metadata.source, cpuCacheEntries: cache.size });
          invalidate();
        }
      } catch (error) { if (disposed || current !== generation || signal.aborted) return; activeKey = null; onError(error); onStatus({ state: 'error', message: error.message }); }
    },
    pause() { ++generation; cancel(); activeKey = null; },
    setMap(value) { if(map===value)return;map=value;for(const mesh of group.children)if(mesh.userData.hasGlobalUv){mesh.material.map=value;mesh.material.color.set(value?0xffffff:0x777570);mesh.material.needsUpdate=true;} },
    dispose() { disposed = true; ++generation; cancel(); clear(); cache.clear(); scene.remove(group); }
  };
}
