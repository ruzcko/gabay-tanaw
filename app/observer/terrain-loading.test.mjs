import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TERRAIN_MODEL} from '../computation/dist/quick/terrain.js';
import {alignCoarseDisplayTerrain} from './display-terrain.js';
import {buildTerrainGrid} from './terrain-grid.js';
import {createLocalTerrainProvider} from './local-providers.js';

test('polar display loads stay small while nearby relief and scientific ground are preserved', async t=>{
  const previousFetch=globalThis.fetch,previousSelf=globalThis.self;
  let reply,paths=[],bytes=0;
  globalThis.self={postMessage:message=>reply(message)};
  globalThis.fetch=async url=>{const data=await readFile(new URL(url));paths.push(url);bytes+=data.length;return new Response(data);};
  const site={latitudeDeg:-89.4398,longitudeEastDeg:-137.17,referenceFrame:'MOON_ME_DE421',
    elevationDatum:'sphere-1737400m',terrainModel:TERRAIN_MODEL};
  const baseUrl=new URL('../assets/observer/terrain',import.meta.url).href;
  const request=async data=>{
    paths=[];bytes=0;
    const message=await new Promise(resolve=>{reply=resolve;self.onmessage({data:{id:1,baseUrl,site,...data}});});
    assert.equal(message.error,undefined);
    return {tile:message.result,paths:[...paths],bytes};
  };
  try {
    await import('./local-terrain-worker.js?loading-baseline');
    const baseline=await request({level:0});
    const original=await request({level:1});
    site.surfaceElevationM=original.tile.elevationsM[(original.tile.elevationsM.length-1)/2];
    // A new worker gives the optimized path an empty decoded cache.
    await import('./local-terrain-worker.js?loading-optimized');
    const preview=await request({level:0,coarse:true});
    assert.ok(preview.bytes<baseline.bytes*.1,'Preview downloads less than 10% of the old first pass');
    assert.ok(preview.paths.every(path=>path.includes('/polar240/')),'Preview fetches no 20 m tiles');
    assert.equal(preview.tile.metadata.detailAvailable,false);
    assert.equal(preview.tile.metadata.sourceResolutionM,240);
    assert.equal(buildTerrainGrid(alignCoarseDisplayTerrain(preview.tile,site),site).coverage,1);
    const detail=await request({level:1,detailed:true});
    assert.ok(preview.bytes+detail.bytes<baseline.bytes*.2,'Both display passes fit below 20% of the old first pass');
    assert.equal(detail.tile.metadata.sourceResolutionM,20);
    assert.equal(detail.tile.metadata.detailAvailable,true);
    assert.equal(buildTerrainGrid(detail.tile,site).coverage,1);
    for(let row=0;row<detail.tile.width;row++)for(let col=0;col<detail.tile.width;col++) {
      if(Math.max(Math.abs(detail.tile.axisM[row]),Math.abs(detail.tile.axisM[col]))<=2560) {
        const i=row*detail.tile.width+col;
        assert.equal(detail.tile.elevationsM[i],original.tile.elevationsM[i],'Near-site heights retain the exact original samples');
      }
    }
    const ground=await request({sampleOnly:true,coarse:true,detailed:true});
    assert.equal(ground.tile.elevationsM[0],site.surfaceElevationM,'Preview cannot change ground sampling');
    t.diagnostic(JSON.stringify({oldFirstPassBytes:baseline.bytes,previewBytes:preview.bytes,
      refinementBytes:detail.bytes,previewRequests:preview.paths.length,refinementRequests:detail.paths.length}));
  } finally {globalThis.fetch=previousFetch;globalThis.self=previousSelf;}
});

test('local provider forwards display preview and refinement flags to its worker',async()=>{
  const previous=globalThis.Worker,requests=[];
  globalThis.Worker=class {
    postMessage(message){requests.push(message);queueMicrotask(()=>this.onmessage({data:{id:message.id,result:{}}}));}
    terminate(){}
  };
  const provider=createLocalTerrainProvider();
  try {
    await provider.loadTile({site:{},signal:new AbortController().signal,level:0,coarse:true,detailed:false});
    assert.equal(requests[0].coarse,true);assert.equal(requests[0].detailed,false);
  } finally {provider.dispose();globalThis.Worker=previous;}
});
