import { TERRAIN_MODEL } from '../computation/dist/quick/terrain.js';
import { alignCoarseDisplayTerrain } from './display-terrain.js';

/** Display detail loads after the first mesh, independently of forecast accuracy/date. */
export function createProgressiveTerrainProvider({ local, saved, catalog }) {
  return { async loadTile(request) {
    const { site, signal, level } = request;
    signal.throwIfAborted();
    if (level && !site.id?.startsWith('custom-')) {
      for (const provider of [saved, catalog]) {
        try {
          const tile = await provider.loadTile({ ...request, alignDisplay: true });
          signal.throwIfAborted();
          tile.metadata.sourceResolutionM ??= 240;
          return tile;
        } catch (error) {
          signal.throwIfAborted();
          if (error.code !== 'NO_SAVED_TERRAIN') throw error;
        }
      }
    }
    const tile = await local.loadTile({ ...request, detailed: !!level, coarse: !level,
      site: { ...site, terrainModel: TERRAIN_MODEL } });
    signal.throwIfAborted();
    return alignCoarseDisplayTerrain(tile, site, !!level && tile.metadata.detailAvailable);
  } };
}
