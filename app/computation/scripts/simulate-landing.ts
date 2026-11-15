import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createLandingPlanner,landingGrid} from '../src/landing.ts';
import {createLandingSource} from '../src/landing-source.ts';
const read=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
const planner=createLandingPlanner(createLandingSource({read}));
const sites=JSON.parse(await readFile(new URL('../../data/sites.json',import.meta.url),'utf8'));
const summary=(r:any)=>({id:r.point.id,name:r.point.name,lat:r.point.lat,lon:r.point.lon,startUtc:r.startUtc,endUtc:r.endUtc,
  status:r.status,checks:r.checks,slopeDeg:r.terrain.slopeDeg,sunlight:r.sunlight,earth:r.earth,
  sources:r.segments.map((s:any)=>({quality:s.quality,available:s.available})),guidance:r.guidance});
const report:any={defaults:{durationDays:7,maxSlopeDeg:10,minSunFraction:1,minEarthFraction:1,maxDarkHours:0,maxEarthOutageHours:0},
  model:'NASA LOLA terrain; published Python events inside December 2026–November 2027; DE440 quick estimates outside',catalog:[],searches:[],quick:[]};
for(const p of sites){report.catalog.push(summary(await planner.evaluate(p,'2027-01-01T00:00:00Z')));
  const w=await planner.windows(p,'2027-01-01T00:00:00Z');report.searches.push({id:p.id,name:p.name,arrivals:w.results.length,
    passing:w.candidates.length,best:w.best?summary(w.best):null,unknown:w.results.filter(r=>r.status==='unknown').length});}
const apollo=sites.find((s:any)=>s.id==='apollo-11');
for(const start of ['1969-07-20T20:17:40Z','2027-11-29T00:00:00Z','2028-01-01T00:00:00Z'])
  report.quick.push(summary(await planner.evaluate(apollo,start)));
const grid=landingGrid({south:-89.5,north:-89.47,west:222.5,east:222.65},2,2);
const regions=await planner.regions(grid,'2028-01-01T00:00:00Z');
report.grid={date:'2028-01-01',count:regions.features.length,layers:regions.layers,results:regions.features.map(f=>summary(f.properties))};
const spot=sites.find((s:any)=>s.id==='connecting-ridge');
report.relaxed=summary(await planner.evaluate(spot,'2027-01-01T00:00:00Z',{
  minSunFraction:.75,minEarthFraction:1/3,maxDarkHours:24,maxEarthOutageHours:48}));
const out=new URL('../../../out/landing-review/',import.meta.url);await mkdir(out,{recursive:true});
await writeFile(new URL('simulations.json',out),JSON.stringify(report,null,2)+'\n');
await writeFile(new URL('regions.geojson',out),JSON.stringify(regions,null,2)+'\n');
console.log(JSON.stringify({catalog:report.catalog.length,passingOnJan1:report.catalog.filter((r:any)=>r.status==='pass').length,
  searches:report.searches.length,sitesWithWindows:report.searches.filter((r:any)=>r.passing).length,
  quick:report.quick.map((r:any)=>({start:r.startUtc,status:r.status,sources:r.sources})),grid:report.grid.layers},null,2));
