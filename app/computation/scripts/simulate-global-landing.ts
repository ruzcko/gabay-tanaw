import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createLandingPlanner,globalLandingGrid} from '../src/landing.ts';
import {createLandingSource} from '../src/landing-source.ts';
import {randomLandingSamples} from './landing-samples.ts';
const read=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
const planner=createLandingPlanner(createLandingSource({read})),seed=20261115;
const out=new URL('../../../out/landing-review/global/',import.meta.url);await mkdir(out,{recursive:true});
const random=randomLandingSamples(seed),grid=globalLandingGrid();
const polar=[-89.9,89.9].flatMap(lat=>[0,60,120,180,240,300].map(lon=>({id:`polar-${lat<0?'south':'north'}-${lon}`,name:'Synthetic polar stress sample',lat,lon})));
const catalog=JSON.parse(await readFile(new URL('../../data/sites.json',import.meta.url),'utf8'));
assert.ok([...random,...polar,...grid.map(c=>c.point)].every(p=>!catalog.some((s:any)=>Math.abs(s.lat-p.lat)<1e-7&&Math.abs(s.lon-p.lon)<1e-7)));
const summary=(r:any)=>({point:r.point,startUtc:r.startUtc,endUtc:r.endUtc,status:r.status,checks:r.checks,
  terrain:r.terrain,sunlight:r.sunlight,earth:r.earth,sources:r.segments.map((s:any)=>({quality:s.quality,available:s.available})),guidance:r.guidance});
const report:any={seed,description:'Synthetic non-catalog coordinates. Equal-area whole-Moon bins plus stratified random points and polar stress samples.',
  referenceFrame:'MOON_ME_DE421',defaults:{durationDays:7,maxSlopeDeg:10,minSunFraction:1,minEarthFraction:1,maxDarkHours:0,maxEarthOutageHours:0},
  grid:{rows:12,columns:24,cells:288,sampling:'One centre sample per bin; no whole-bin safety claim'},random:[],polar:[],arrivals:[],publishedCoverage:[]};
const features:any[]=[];
for(let i=0;i<grid.length;i+=48) {
  const result=await planner.regions(grid.slice(i,i+48),'2028-01-01T00:00:00Z');
  features.push(...result.features);console.log(`Global grid: ${features.length}/${grid.length}`);
}
await writeFile(new URL('regions.geojson',out),JSON.stringify({type:'FeatureCollection',referenceFrame:'MOON_ME_DE421',features},null,2)+'\n');
report.grid.results=features.map(f=>summary(f.properties));
for(const [i,p] of random.entries()) {
  for(const date of ['2028-01-01T00:00:00Z','2028-07-01T00:00:00Z'])report.random.push(summary(await planner.evaluate(p,date)));
  if((i+1)%12===0)console.log(`Random sites, two dates: ${i+1}/${random.length}`);
}
for(const p of polar)report.polar.push(summary(await planner.evaluate(p,'2028-01-01T00:00:00Z')));
// Twelve points, spread over all latitude bands and near/far-side longitudes.
for(const i of [0,11,12,23,24,35,48,59,72,83,84,95]) {
  const p=random[i],w=await planner.windows(p,'2028-01-01T00:00:00Z',{}, {stepHours:24});
  report.arrivals.push({point:p,searchEndUtc:w.searchEndUtc,passing:w.candidates.length,best:w.best?summary(w.best):null,
    results:w.results.map(summary)});
  const missing=await createLandingPlanner(createLandingSource({read}),{sourcePolicy:'published-only'}).evaluate(p,'2027-01-01T00:00:00Z');
  assert.equal(missing.status,'unknown');assert.equal(missing.sunlight,null);assert.equal(missing.segments[0].quality,'accurate');
  report.publishedCoverage.push(summary(missing));console.log(`Six-month searches: ${report.arrivals.length}/12`);
}
const all=[...report.grid.results,...report.random,...report.polar];
for(const r of all) {
  assert.ok(r.sources.every((s:any)=>s.quality==='estimate'&&s.available));
  for(const body of [r.sunlight,r.earth])assert.ok(body&&body.fraction>=0&&body.fraction<=1&&body.longestOutageHours>=0&&body.longestOutageHours<=168);
  if(r.terrain.slopeDeg===null)assert.notEqual(r.status,'pass');
}
assert.ok(all.some(r=>r.earth.fraction===0),'Far-side direct Earth visibility is absent');
assert.ok(all.some(r=>r.earth.fraction===1),'Near-side Earth visibility is continuous at some points');
const counts=(rows:any[])=>Object.fromEntries(['pass','fail','unknown'].map(status=>[status,rows.filter(r=>r.status===status).length]));
report.summary={globalCells:grid.length,randomSites:random.length,randomDateEvaluations:report.random.length,polarSites:polar.length,
  sixMonthSearches:report.arrivals.length,arrivalEvaluations:report.arrivals.reduce((n:number,r:any)=>n+r.results.length,0),
  gridStatus:counts(report.grid.results),randomStatus:counts(report.random),polarStatus:counts(report.polar),
  sunPassingCells:features.filter(f=>f.properties.checks.sunlight==='pass').length,
  earthPassingCells:features.filter(f=>f.properties.checks.earth==='pass').length,
  unresolvedTerrainEvaluations:all.filter(r=>r.checks.terrain==='unknown').length,missingPythonChecks:report.publishedCoverage.length};
await writeFile(new URL('simulations.json',out),JSON.stringify(report,null,2)+'\n');
await writeFile(new URL('test-points.json',out),JSON.stringify([...grid.map(c=>c.point),...random,...polar].map(p=>({...p,
  referenceFrame:'MOON_ME_DE421',elevationDatum:'sphere-1737400m',frameEvidence:'Synthetic coordinates sampled directly in MOON_ME_DE421; no mission association.'})),null,2)+'\n');
console.log(JSON.stringify(report.summary,null,2));
