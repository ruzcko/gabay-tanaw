import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLandingPlanner,landingCriteria,landingGrid,globalLandingGrid,sixMonthsAfter,visibilitySpans,visibilityMetrics} from '../src/landing.ts';
import {randomLandingSamples} from '../scripts/landing-samples.ts';
import type {LandingForecast,LandingSource} from '../src/landing.ts';
import {nearestLunarFeature} from '../src/catalog.ts';
import {createLandingSource,screenTerrain} from '../src/landing-source.ts';
import {Terrain} from '../src/quick/terrain.ts';
import {createTravelPlanner,createTravelSource,TRAVEL_DEFAULTS} from '../src/travel.ts';

const DAY=86400000,point={lat:-89,lon:30},flat={slopeDeg:3,baselineM:100,resolutionM:20,source:'test fixture'};
function fixture(start:string,end:string,quality='accurate'):LandingForecast {
  const a=Date.parse(start),b=Date.parse(end),days=[];
  for(let t=a;t<b;t+=DAY)days.push({date:new Date(t).toISOString().slice(0,10),sunHours:24,earthHours:24,
    sunrise:[],sunset:[],earthrise:[],earthset:[],sunUpAt0:true,earthUpAt0:true,nextSunEvent:null,nextEarthEvent:null});
  return {...point,window:{start,end},quality,days,science:{referenceFrame:'MOON_ME_DE421',elevationDatum:'sphere-1737400m',visibility:'center'}};
}
const provider=(extra:Partial<LandingSource>={}):LandingSource=>({terrain:async()=>flat,
  forecast:async(p,a,b,q)=>({...fixture(a,b,q),lat:p.lat,lon:p.lon}),...extra});
test('catalogue references measure from the feature to the destination, across longitude wrap',()=>{
  const catalog=[{lat:0,lon:359,name:'Reference'}, {lat:40,lon:30,name:'Farther'}];
  const east=nearestLunarFeature({lat:0,lon:1},catalog)!;
  assert.equal(east.name,'Reference');assert.equal(east.direction,'E');
  assert.ok(Math.abs(east.distanceKm-1737.4*Math.PI/90)<1e-8);
  assert.equal(nearestLunarFeature({lat:0,lon:357},catalog)?.direction,'W');
  assert.equal(nearestLunarFeature({lat:1,lon:359},catalog)?.direction,'N');
  assert.equal(nearestLunarFeature({lat:0,lon:-1},catalog)?.direction,null);
  assert.equal(nearestLunarFeature({lat:0,lon:179},catalog.slice(0,1))?.direction,null);
  assert.equal(nearestLunarFeature({lat:NaN,lon:1},catalog),null);
  assert.equal(nearestLunarFeature(point,[]),null);
});
test('card daily hours use exact stay intervals, preserving partial UTC days and mixed sources',async()=>{
  const planner=createLandingPlanner(provider({forecast:async(p,a,b,q)=>{
    const f={...fixture(a,b,q),...p};
    for(const d of f.days) d.sunset=[d.date+'T18:00:00Z'];
    return f;
  }}));
  const result=await planner.evaluate(point,'2026-11-30T12:00:00Z',{durationDays:1,terrainEnabled:false,minSunFraction:0,maxDarkHours:24});
  assert.deepEqual(result.days.map(d=>[d.durationHours,d.sunHours,d.earthHours,d.quality]),[[12,6,12,'estimate'],[12,12,12,'accurate']]);
  assert.equal(result.days.reduce((sum,d)=>sum+d.sunHours!,0),result.sunlight?.hours);
  assert.equal(result.days.reduce((sum,d)=>sum+d.earthHours!,0),result.earth?.hours);
  const missing=await createLandingPlanner(provider({forecast:async(p,a,b,q)=>q==='accurate'?null:{...fixture(a,b,q),...p}}),{sourcePolicy:'published-only'})
    .evaluate(point,'2026-11-30T12:00:00Z',{durationDays:1,terrainEnabled:false,sunlightEnabled:false,earthEnabled:false});
  assert.equal(missing.status,'pass');assert.equal(missing.sunlight,null);
  assert.deepEqual(missing.days.map(d=>[d.sunHours,d.quality]),[[12,'estimate'],[null,'unknown']]);
  const dark=await createLandingPlanner(provider({forecast:async(p,a,b,q)=>{
    const f={...fixture(a,b,q),...p};for(const d of f.days)d.sunUpAt0=false;return f;
  }})).evaluate(point,'2027-01-01T00:00:00Z',{durationDays:1});
  assert.equal(dark.days[0].sunHours,0);assert.equal(dark.days[0].quality,'accurate');
});
test('landing criteria reject invalid values; six months clamp calendar month ends',()=>{
  for(const c of [{durationDays:0},{durationDays:31},{maxSlopeDeg:NaN},{minSunFraction:1.1},{maxDarkHours:-1},{earthEnabled:1 as any}])assert.throws(()=>landingCriteria(c));
  assert.equal(sixMonthsAfter('2027-08-31T06:00:00Z'),'2028-02-29T06:00:00.000Z');
  assert.equal(sixMonthsAfter('2026-08-31T06:00:00Z'),'2027-02-28T06:00:00.000Z');
});
test('events preserve sub-day coverage and blackout lengths, not rounded daily hours',()=>{
  const f=fixture('2027-01-01T00:00:00Z','2027-01-03T00:00:00Z');
  f.days[0].sunset=['2027-01-01T20:00:00Z'];f.days[1].sunUpAt0=false;f.days[1].sunrise=['2027-01-02T04:00:00Z'];
  const a=Date.parse('2027-01-01T12:00:00Z'),b=a+DAY,m=visibilityMetrics(visibilitySpans(f,'sun',a,b),a,b);
  assert.equal(m.hours,16);assert.equal(m.longestOutageHours,8);assert.equal(m.fraction,2/3);
  f.days[1].sunrise=['2027-01-01T04:00:00Z'];assert.throws(()=>visibilitySpans(f,'sun',a,b));
});
test('Python wins inside the year and seams split explicitly without fallback',async()=>{
  const calls:any[]=[],planner=createLandingPlanner(provider({forecast:async(p,a,b,q)=>{calls.push([a,b,q]);return {...fixture(a,b,q),...p};}}));
  const result=await planner.evaluate(point,'2026-11-29T12:00:00Z',{durationDays:3.5});
  assert.equal(result.status,'pass');assert.deepEqual(calls.map(x=>x[2]),['estimate','accurate']);
  assert.equal(result.sunlight?.hours,84);assert.equal(result.segments.length,2);
  calls.length=0;await planner.evaluate(point,'2027-11-30T00:00:00Z');assert.deepEqual(calls.map(x=>x[2]),['accurate','estimate']);
  const missing=await createLandingPlanner(provider({forecast:async()=>null})).evaluate(point,'2027-01-01T00:00:00Z');
  assert.equal(missing.status,'unknown');assert.equal(missing.sunlight,null);
});
test('strict slope threshold, unknown DEM, and toggle layers remain independent',async()=>{
  const steep=createLandingPlanner(provider({terrain:async()=>({...flat,slopeDeg:10})}));
  assert.equal((await steep.evaluate(point,'2027-01-01T00:00:00Z')).status,'fail');
  assert.equal((await steep.evaluate(point,'2027-01-01T00:00:00Z',{terrainEnabled:false})).status,'pass');
  const coarse=createLandingPlanner(provider({terrain:async()=>({...flat,resolutionM:240})}));
  const result=await coarse.regions(landingGrid({south:-89.1,north:-89,west:179,east:181},1,2),'2027-01-01T00:00:00Z');
  assert.equal(result.layers.combined.length,0);assert.equal(result.layers.sunlight.length,2);assert.equal(result.features[0].properties.checks.terrain,'unknown');
});
test('high average cannot conceal a long outage and thresholds accept fractional stays',async()=>{
  const planner=createLandingPlanner(provider({forecast:async(p,a,b,q)=>{const f=fixture(a,b,q);
    f.days[0].sunset=[a.slice(0,10)+'T20:00:00Z'];f.days[1].sunUpAt0=false;f.days[1].sunrise=[f.days[1].date+'T04:00:00Z'];return f;}}));
  const strict=await planner.evaluate(point,'2027-01-01T00:00:00Z',{durationDays:6.5,minSunFraction:.9,maxDarkHours:4});
  assert.equal(strict.checks.sunlight,'fail');assert.ok(strict.sunlight!.fraction>.9);
  const relaxed=await planner.evaluate(point,'2027-01-01T00:00:00Z',{durationDays:6.5,minSunFraction:.9,maxDarkHours:8});
  assert.equal(relaxed.status,'pass');assert.equal(relaxed.sunlight?.longestOutageHours,8);
});
test('six-month arrival search includes full stay after final arrival and stable ties',async()=>{
  const calls:any[]=[],planner=createLandingPlanner(provider({forecast:async(p,a,b,q)=>{calls.push({a,b,q});return {...fixture(a,b,q),...p};}}));
  const result=await planner.windows(point,'2027-01-31T12:00:00Z',{durationDays:7});
  assert.equal(result.searchEndUtc,'2027-07-31T12:00:00.000Z');assert.equal(result.candidates.length,181);
  assert.equal(result.best?.startUtc,'2027-01-31T12:00:00.000Z');assert.equal(calls.at(-1).b,'2027-08-08T00:00:00.000Z');
  await assert.rejects(()=>planner.windows(point,'2100-12-01T00:00:00Z'));
});
test('malformed, wrong-coordinate and mislabeled forecasts fail closed; abort is honored',async()=>{
  for(const mutate of [(f:LandingForecast)=>({...f,lat:2}), (f:LandingForecast)=>({...f,quality:'estimate'}), (f:LandingForecast)=>({...f,days:[]})]) {
    const planner=createLandingPlanner(provider({forecast:async(p,a,b)=>mutate(fixture(a,b))}));
    await assert.rejects(()=>planner.evaluate(point,'2027-01-01T00:00:00Z'));
  }
  const signal=AbortSignal.abort();await assert.rejects(()=>createLandingPlanner(provider()).evaluate(point,'2027-01-01T00:00:00Z',{},signal));
});
test('region payloads reject duplicate IDs, unclosed rings and impossible coordinates',async()=>{
  const planner=createLandingPlanner(provider()),cells=landingGrid({south:-89.1,north:-89,west:30,east:31},1,1);
  await assert.rejects(()=>planner.regions([cells[0],cells[0]],'2027-01-01T00:00:00Z'));
  cells[0].geometry.coordinates[0].pop();await assert.rejects(()=>planner.regions(cells,'2027-01-01T00:00:00Z'));
  assert.throws(()=>landingGrid({south:-91,north:-89,west:30,east:31}));
});
const read=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
test('global bins cover the full sphere with equal areas, including polar caps and the seam',()=>{
  const cells=globalLandingGrid();assert.equal(cells.length,288);assert.equal(new Set(cells.map(c=>c.id)).size,288);
  let total=0;
  for(const cell of cells){const ring=cell.geometry.coordinates[0],south=ring[0][1],north=ring[2][1],west=ring[0][0],east=ring[1][0];
    const area=(east-west)*Math.PI/180*(Math.sin(north*Math.PI/180)-Math.sin(south*Math.PI/180));
    assert.ok(Math.abs(area-4*Math.PI/288)<1e-14);total+=area;
    assert.ok(cell.point.lat>south&&cell.point.lat<north&&Math.abs(cell.point.lat)<90);
    assert.ok(cell.point.lon>=0&&cell.point.lon<360);
  }
  assert.ok(Math.abs(total-4*Math.PI)<1e-12);
  assert.equal(cells[0].geometry.coordinates[0][0][1],-90);assert.equal(cells.at(-1)!.geometry.coordinates[0][2][1],90);
  assert.equal(cells[0].geometry.coordinates[0][0][0],-180);assert.equal(cells.at(-1)!.geometry.coordinates[0][1][0],180);
  assert.throws(()=>globalLandingGrid(100,100));
});
test('random test sites are reproducible and occupy every equal-area stratum',()=>{
  const points=randomLandingSamples();assert.equal(points.length,96);assert.deepEqual(points,randomLandingSamples());
  assert.notDeepEqual(points,randomLandingSamples(42));
  const strata=new Set(points.map(p=>`${Math.floor((Math.sin(p.lat*Math.PI/180)+1)*4)}:${Math.floor(p.lon/30)}`));
  assert.equal(strata.size,96);assert.ok(points.some(p=>p.lat>60));assert.ok(points.some(p=>p.lat<-60));
  assert.throws(()=>randomLandingSamples(NaN));
});
test('real published NASA terrain and Python forecast run through both queries',async()=>{
  const source=createLandingSource({read}),planner=createLandingPlanner(source),p={id:'connecting-ridge',lat:-89.48728,lon:222.62082};
  const sites=JSON.parse(await readFile(new URL('../../data/sites.json',import.meta.url),'utf8'));
  Object.assign(p,sites.find((s:any)=>s.id===p.id));
  const result=await planner.evaluate(p,'2027-01-01T00:00:00Z');
  assert.equal(result.segments[0].quality,'accurate');assert.ok(result.sunlight!.hours>=0&&result.sunlight!.hours<=168);
  const windows=await planner.windows(p,'2027-01-01T00:00:00Z');assert.equal(windows.results.length,181);
  const python=await source.terrain(p),typescript=await screenTerrain(new Terrain(read),p);
  assert.ok(Math.abs(python.slopeDeg!-typescript.slopeDeg!)<1e-7,'Python and TS terrain screens agree');
});
test('Travel entry point composes the published source and default criteria',async()=>{
  assert.equal(TRAVEL_DEFAULTS.durationDays,7);
  const sites=JSON.parse(await readFile(new URL('../../data/sites.json',import.meta.url),'utf8'));
  const planner=createTravelPlanner(createTravelSource({read}));
  const result=await planner.evaluate(sites.find((s:any)=>s.id==='connecting-ridge'),'2027-01-10T00:00:00Z');
  assert.equal(result.status,'pass');assert.equal(result.segments[0].quality,'accurate');
});
