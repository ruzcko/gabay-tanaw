import test from 'node:test';
import assert from 'node:assert/strict';
import { alignCoarseDisplayTerrain } from './display-terrain.js';
import { buildTerrainGrid } from './terrain-grid.js';
import { fixture } from './fixture.js';

test('accurate scenes retain coarse relief without moving the scientific observer', () => {
  const site = { ...fixture().site, referenceFrame: 'MOON_ME_DE421', elevationDatum: 'sphere-1737400m', surfaceElevationM: -1926.567 };
  const tile = { width: 3, height: 3, spacingM: 1000,
    elevationsM: new Float32Array([-1800,-1810,-1800,-1805,-1815,-1805,-1800,-1810,-1800]),
    metadata: { referenceFrame: site.referenceFrame, elevationDatum: site.elevationDatum,
      latitudeDeg: site.latitudeDeg, longitudeEastDeg: site.longitudeEastDeg,
      projection: 'local-orthographic-east-south', radiusM: 1737400, noData: null, source: 'Pinned coarse LOLA display grid' } };
  const before = structuredClone({site,tile});
  const display = alignCoarseDisplayTerrain(tile, site), grid = buildTerrainGrid(display, site);
  assert.equal(grid.coverage, 1); assert.ok(grid.positions.every(Number.isFinite));
  assert.ok(Math.abs(grid.groundElevationM-site.surfaceElevationM)<.001);
  assert.ok(Math.abs(display.elevationsM[0]-display.elevationsM[4]-15)<.001,'Preserves local relief');
  assert.match(display.metadata.source,/coarse display anchored/);
  assert.deepEqual({site,tile},before,'No mutation of scientific site or source heights');
  assert.throws(()=>alignCoarseDisplayTerrain(tile,{...site,latitudeDeg:site.latitudeDeg+1}),/does not match/);
});
