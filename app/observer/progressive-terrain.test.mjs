import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSavedTerrainProvider} from './saved-terrain.js';
import {createProgressiveTerrainProvider} from './progressive-terrain.js';
import {buildTerrainGrid} from './terrain-grid.js';
import {TERRAIN_MODEL} from '../computation/dist/quick/terrain.js';

const fetcher=async url=>new Response(await readFile(url));
test('generated detail manifests match every shipped payload and contain no orphan files',async()=>{
  for(const [directory,indexName] of [['polar240','manifest.json'],['catalog','index.json']]){
    const base=new URL(`../assets/observer/terrain/${directory}/`,import.meta.url);
    const index=JSON.parse(await readFile(new URL(indexName,base)));
    const entries=index.files?Object.entries(index.files):Object.values(index.sites).map(s=>[s.file,s]);
    assert.deepEqual((await readdir(base)).sort(),[indexName,...entries.map(([name])=>name)].sort());
    for(const [name,entry] of entries){
      const bytes=await readFile(new URL(name,base));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256,name);
      assert.equal(bytes.length,entry.bytes??entry.width*entry.height*4,name);
    }
  }
});
test('all catalog sites refine independently of forecast quality and longitude wrap',async()=>{
  const sites=JSON.parse(await readFile(new URL('../data/sites.json',import.meta.url)));
  const provider=createProgressiveTerrainProvider({
    local:{loadTile(){throw new Error('Unexpected coarse fallback');}},
    saved:createSavedTerrainProvider({baseUrl:new URL('../data/terrain/',import.meta.url),fetcher}),
    catalog:createSavedTerrainProvider({baseUrl:new URL('../assets/observer/terrain/catalog/',import.meta.url),fetcher})
  });
  for(const s of sites) {
    const site={id:s.id,latitudeDeg:s.lat,longitudeEastDeg:(s.lon+360)%360,
      referenceFrame:s.referenceFrame,elevationDatum:s.elevationDatum,surfaceElevationM:500,
      terrainModel:TERRAIN_MODEL};
    const before=structuredClone(site);
    const tile=await provider.loadTile({site,level:1,signal:new AbortController().signal});
    assert.equal(tile.metadata.detailAvailable,true,s.id);
    assert.equal(buildTerrainGrid(tile,site).coverage,1,s.id);
    assert.deepEqual(site,before,'Display alignment never moves the scientific observer');
  }
});

test('coarse stage avoids detailed downloads; aborts and damaged detail never silently fall back',async()=>{
  const site={id:'test',latitudeDeg:0,longitudeEastDeg:0,referenceFrame:'MOON_ME_DE421',elevationDatum:'sphere-1737400m',surfaceElevationM:10};
  let calls=0;
  const local={async loadTile(request){assert.equal(request.coarse,true);assert.equal(request.detailed,false);return {width:3,height:3,elevationsM:new Float32Array(9),metadata:{...site,source:'Coarse'}};}};
  const saved={async loadTile(){calls++;throw new Error('Damaged detail');}};
  const provider=createProgressiveTerrainProvider({local,saved,catalog:saved});
  const controller=new AbortController();
  const first=await provider.loadTile({site,level:0,signal:controller.signal});
  assert.equal(calls,0);assert.equal(first.metadata.detailAvailable,false);
  await assert.rejects(provider.loadTile({site,level:1,signal:controller.signal}),/Damaged detail/);
  assert.equal(calls,1);
  controller.abort();
  await assert.rejects(provider.loadTile({site,level:1,signal:controller.signal}),{name:'AbortError'});
  assert.equal(calls,1,'Aborted selections start no detailed requests');
});
