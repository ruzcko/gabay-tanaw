import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTerrainGrid } from './terrain-grid.js';
import { syntheticTerrainProvider } from './terrain-fixture.js';
import { fixture } from './fixture.js';
import { polarPixel, terrainAxis } from './terrain-sampling.js';
import { createTerrainLayer } from './terrain.js';
import * as THREE from '../vendor/three/three.module.js';
const site = fixture().site;
const tile = () => syntheticTerrainProvider.loadTile({ site, level: 0, signal: new AbortController().signal });

test('failed detailed refinement keeps the already displayed coarse mesh',async()=>{
  const original=globalThis.Worker;
  globalThis.Worker=class {
    postMessage({tile,site,exaggeration}){queueMicrotask(()=>this.onmessage({data:{result:buildTerrainGrid(tile,site,exaggeration)}}));}
    terminate(){}
  };
  const statuses=[],errors=[];
  const layer=createTerrainLayer({scene:new THREE.Scene(),invalidate(){},onStatus:s=>statuses.push(s),onError:e=>errors.push(e),
    provider:{loadTile:request=>request.level?Promise.reject(new Error('Detail download failed')):tile()}});
  try {
    await layer.update(site);
    assert.deepEqual(statuses.map(s=>s.state),['loading','refining','error']);
    assert.equal(errors[0].message,'Detail download failed');
    assert.equal(layer.group.children.length,1);
    assert.ok(layer.group.children[0].geometry.attributes.position.count>0);
  } finally {layer.dispose();globalThis.Worker=original;}
});
test('terrain center matches supplied ground and normals face up', async () => {
  const t = await tile(), result = buildTerrainGrid(t, site);
  const center = ((t.height-1)/2*t.width+(t.width-1)/2)*3;
  assert.ok(Math.abs(result.positions[center+1]) < 1e-6);
  assert.ok(result.normals[center+1] > 0.9);
  assert.equal(result.coverage, 1);
});
test('curvature is preserved and missing values produce holes', async () => {
  const t = await tile(); t.elevationsM.fill(0);
  const flat = buildTerrainGrid(t, site);
  assert.ok(flat.positions[1] < -1);
  t.elevationsM[0] = NaN;
  const missing = buildTerrainGrid(t, site);
  assert.ok(missing.indices.length < flat.indices.length); assert.ok(missing.coverage < 1);
});
test('rejects wrong datum, wrong ground and excessive tile sizes', async () => {
  const t = await tile();
  assert.throws(() => buildTerrainGrid(t, { ...site, elevationDatum: 'other' }), /datum/);
  assert.throws(() => buildTerrainGrid(t, { ...site, surfaceElevationM: 50 }), /recompute/);
  assert.throws(() => buildTerrainGrid({ ...t, width: 1000 }, site), /dimensions/);
});
test('terrain longitude accepts only wrap equivalence and arithmetic roundoff', async () => {
  const t = await tile();
  const requested = { ...site, longitudeEastDeg: 72.10000000000002 };
  for (const longitudeEastDeg of [72.1, -287.9, 432.1]) {
    t.metadata.longitudeEastDeg = longitudeEastDeg;
    assert.equal(buildTerrainGrid(t, requested).coverage, 1);
  }
  t.metadata.longitudeEastDeg = 72.100001;
  assert.throws(() => buildTerrainGrid(t, requested), /resampled/);
  t.metadata.longitudeEastDeg = 72.1;
  assert.throws(() => buildTerrainGrid(t, { ...requested, latitudeDeg: site.latitudeDeg + .000001 }), /resampled/);
});
test('polar projection respects pixel registration and east-positive longitude', () => {
  assert.deepEqual(polarPixel(-90,0),[3791.5,3791.5]);
  const north=polarPixel(-89,0),east=polarPixel(-89,90);
  assert.ok(north[1]<3791.5);assert.equal(north[0],3791.5);
  assert.ok(east[0]>3791.5);assert.equal(east[1],3791.5);
});
test('concentrated grid preserves 20 m near spacing and 65 km horizon without seams', async () => {
  const axisM=terrainAxis(1,true), width=axisM.length;
  assert.equal(width,257);assert.equal(axisM[129],20);assert.equal(axisM[192],1280);
  assert.equal(axisM[0],-32768);assert.equal(axisM[256],32768);
  const t=await tile();Object.assign(t,{width,height:width,axisM,spacingM:20,elevationsM:new Float32Array(width*width)});
  const result=buildTerrainGrid(t,site);
  assert.equal(result.indices.length,256*256*6);assert.equal(result.coverage,1);
  assert.equal(result.positions[(128*width+129)*3],20);
  t.axisM[128]=1;assert.throws(()=>buildTerrainGrid(t,site),/axis/);
});
