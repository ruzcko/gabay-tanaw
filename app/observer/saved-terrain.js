/** Published display mesh only; never used to calculate forecast visibility. */
import { alignCoarseDisplayTerrain } from './display-terrain.js';
import { sameLongitude } from '../computation/dist/core.js';
export function createSavedTerrainProvider({ baseUrl = new URL('../data/terrain/', import.meta.url), fetcher = fetch } = {}) {
  let index;
  return {
    async loadTile({ site, signal, alignDisplay = false }) {
      if (!index) {
        const response = await fetcher(new URL('index.json', baseUrl), { signal });
        if (!response.ok) throw new Error('Saved terrain index unavailable');
        index = await response.json();
      }
      const entry = index.sites?.[site.id], m = entry?.metadata;
      if (!entry) throw Object.assign(new Error('No saved terrain mesh for this site; showing reference ground.'), { code: 'NO_SAVED_TERRAIN' });
      if (entry.file !== `${site.id}.bin` || entry.width !== 257 || entry.height !== 257 || entry.spacingM !== 78.125 ||
          m?.referenceFrame !== site.referenceFrame || m.elevationDatum !== site.elevationDatum || m.latitudeDeg !== site.latitudeDeg ||
          !sameLongitude(m.longitudeEastDeg, site.longitudeEastDeg) || m.projection !== 'local-orthographic-east-south' || m.radiusM !== 1737400)
        throw new Error('Saved terrain does not match the selected site.');
      const response = await fetcher(new URL(entry.file, baseUrl), { signal });
      if (!response.ok) throw new Error('Saved terrain unavailable; showing reference ground.');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== entry.width * entry.height * 4) throw new Error('Incomplete terrain mesh');
      const data = new DataView(buffer), elevationsM = new Float32Array(entry.width * entry.height);
      for (let i = 0; i < elevationsM.length; i++) elevationsM[i] = data.getFloat32(i * 4, true);
      if (alignDisplay) return alignCoarseDisplayTerrain({ ...entry, metadata: { ...m, longitudeEastDeg: site.longitudeEastDeg }, elevationsM }, site, true);
      const center = (elevationsM.length - 1) / 2;
      // make_terrain_tiles.py pins this one vertex to the catalog's 0.1 m rounded
      // ground. Restore the forecast's precise modeled ground for display only.
      // Reject anything outside that rounding bound; never move the observer.
      if (Math.abs(elevationsM[center] - site.surfaceElevationM) > .051) throw new Error('Terrain ground differs from the forecast model.');
      elevationsM[center] = site.surfaceElevationM;
      return { ...entry, metadata: { ...m, longitudeEastDeg: site.longitudeEastDeg }, elevationsM };
    }
  };
}
