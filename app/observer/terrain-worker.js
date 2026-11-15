import { buildTerrainGrid } from './terrain-grid.js';
self.onmessage = ({ data }) => {
  try {
    const result = buildTerrainGrid(data.tile, data.site, data.exaggeration);
    self.postMessage({ result }, [result.positions.buffer, result.normals.buffer, result.uv.buffer, result.indices.buffer]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
