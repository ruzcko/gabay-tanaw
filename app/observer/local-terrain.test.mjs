import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './fixture.js';
import {buildTerrainGrid} from './terrain-grid.js';
import {Terrain,TERRAIN_MODEL} from '../computation/dist/quick/terrain.js';
import {alignCoarseDisplayTerrain} from './display-terrain.js';

test('local polar tiles, shared ground, boundary transition and cache work together', async()=>{
  const previousFetch=globalThis.fetch,previousSelf=globalThis.self;
  let resolveReply,requests=0;
  globalThis.self={postMessage:message=>resolveReply(message)};
  globalThis.fetch=async url=>{requests++;return new Response(await readFile(new URL(url)));};
  try{
    await import('./local-terrain-worker.js');
    const baseUrl=new URL('../assets/observer/terrain',import.meta.url).href;
    const request=data=>new Promise(resolve=>{resolveReply=resolve;self.onmessage({data:{id:1,baseUrl,...data}});});
    for(const latitudeDeg of [-90,-89.5,-87.6,-87.5]){
      const site={...fixture().site,latitudeDeg,longitudeEastDeg:0,referenceFrame:'LOLA-ME',elevationDatum:'sphere-1737400m'};
      const ground=await request({site,sampleOnly:true});assert.equal(ground.error,undefined);
      site.surfaceElevationM=ground.result.elevationsM[0];
      assert.ok(Number.isFinite(site.surfaceElevationM));
      const count=requests;await request({site,sampleOnly:true});assert.equal(requests,count,'ground tile reused');
      const mesh=await request({site,level:1});assert.equal(mesh.error,undefined);
      const grid=buildTerrainGrid(mesh.result,site);assert.equal(grid.coverage,1);
      assert.equal(grid.groundElevationM,site.surfaceElevationM);
      assert.ok(grid.positions.every(Number.isFinite));
    }
    const science=new Terrain(async url=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length);});
    for(const latitudeDeg of [-87.6,.67416]) {
      const longitudeEastDeg=23.47314;
      await science.prepare(latitudeDeg,longitudeEastDeg);
      const p=latitudeDeg*Math.PI/180,l=longitudeEastDeg*Math.PI/180;
      const site={...fixture().site,latitudeDeg,longitudeEastDeg,referenceFrame:'MOON_ME_DE421',
        elevationDatum:'sphere-1737400m',terrainModel:TERRAIN_MODEL,
        surfaceElevationM:science.sample(Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p))};
      const mesh=await request({site,level:0});assert.equal(mesh.error,undefined);
      const grid=buildTerrainGrid(mesh.result,site);
      assert.ok(Math.abs(grid.groundElevationM-site.surfaceElevationM)<.001,'Estimate mesh uses science ground, including the polar boundary');
    }
    // Independent expected heights from Python horizon.height_at on the checksum-pinned source.
    for (const [latitudeDeg,longitudeEastDeg,expected] of [
      [-64.860842,66.222911,-159.46534987879153],[-70,0,1903.6247404758303],
      [-60.4,0,-1511.0796635289448],[-87.4,130,-131.9779350783718]]) {
      const site={...fixture().site,latitudeDeg,longitudeEastDeg,referenceFrame:'MOON_ME_DE421',
        elevationDatum:'sphere-1737400m',terrainModel:TERRAIN_MODEL};
      const ground=await request({site,sampleOnly:true,detailed:true});assert.equal(ground.error,undefined);
      assert.ok(Math.abs(ground.result.elevationsM[0]-expected)<.001,'Detailed source matches independent sampler');
      const coarse=await request({site,level:0});site.surfaceElevationM=coarse.result.elevationsM[(coarse.result.elevationsM.length-1)/2];
      const mesh=await request({site,level:1,detailed:true});assert.equal(mesh.error,undefined);
      assert.equal(mesh.result.metadata.sourceResolutionM,240);
      assert.equal(mesh.result.metadata.detailAvailable,true);
      const aligned=alignCoarseDisplayTerrain(mesh.result,site,true);
      assert.equal(buildTerrainGrid(aligned,site).coverage,1);
      assert.notEqual(mesh.result.elevationsM[(mesh.result.elevationsM.length-1)/2],site.surfaceElevationM,'Refinement reads new elevations rather than subdividing the coarse mesh');
    }
  }finally{globalThis.fetch=previousFetch;globalThis.self=previousSelf;}
});
