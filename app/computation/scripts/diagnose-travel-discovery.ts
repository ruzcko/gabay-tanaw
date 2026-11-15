import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createTravelPlanner,createTravelSource} from '../src/travel.ts';
import {QuickEngine} from '../src/quick/engine.ts';
const read=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
const label=process.argv[2]??'current';
const seed=Number(process.argv[3]??20261115);
const startUtc='2027-02-26T01:47:00Z',criteria={durationDays:7,terrainEnabled:label==='terrain',minSunFraction:label==='continuous'?1:18.3/168,minEarthFraction:label==='continuous'?1:13.2/168,maxDarkHours:label==='continuous'?0:149.7,maxEarthOutageHours:label==='continuous'?0:154.8};
const base=createTravelSource({read}),engine=new QuickEngine(read),timings:any[]=[];
const planner=createTravelPlanner({...base,forecast:async(p,a,b,q,s)=>{
  const start=performance.now();
  if(q==='estimate'){const r=await engine.run({...p,startUtc:a,endUtc:b},{signal:s});timings.push({point:p,...r.timings});return r.index;}
  const f=await base.forecast(p,a,b,q,s);timings.push({point:p,quality:q,available:!!f,totalMs:performance.now()-start});return f;
}});
const sites=JSON.parse(await readFile(new URL('../../data/sites.json',import.meta.url),'utf8')),known=[];
const clock=performance.now();
for(const p of sites)known.push(await planner.evaluate(p,startUtc,criteria));
const knownMs=performance.now()-clock;
const summary=(r:any)=>({name:r.point.name??null,lat:r.point.lat,lon:r.point.lon,status:r.status,sunHours:r.sunlight?.hours,earthHours:r.earth?.hours,
  terrain:r.terrain,checks:r.checks,source:r.segments});
console.log(JSON.stringify({knownMs,knownPassing:known.filter(r=>r.status==='pass').map(summary)}));
const previous=label==='page2'?JSON.parse(await readFile(new URL('../../../out/travel-discovery-diagnosis/guided.json',import.meta.url),'utf8')):null;
const streamed:any[]=[],discovery=await planner.discover(startUtc,criteria,{exclude:[...sites,...(previous?.discovery.samples.map((s:any)=>s.point)??[])],cursor:previous?.discovery.cursor,
  seed,
  southAnchors:label==='current'?[]:known.filter(r=>r.status==='pass'&&r.point.lat<-80).map(r=>r.point),
  maxSouthSamples:48,maxElsewhereSamples:144,maxElapsedMs:['continuous','terrain'].includes(label)?20000:60000,
  onCandidate:e=>{streamed.push({group:e.group,elapsedMs:e.elapsedMs,...summary(e.result)});console.log(JSON.stringify({candidate:streamed.at(-1)}));}});
const output=new URL('../../../out/travel-discovery-diagnosis/',import.meta.url);await mkdir(output,{recursive:true});
await writeFile(new URL(`${label}.json`,output),JSON.stringify({startUtc,criteria,knownMs,known:known.map(summary),discovery,streamed,timings},null,2)+'\n');
console.log(JSON.stringify({found:discovery.found,attempted:discovery.attempted,elapsedMs:discovery.elapsedMs,stopReason:discovery.stopReason,
  randomPasses:[...discovery.candidates.south,...discovery.candidates.elsewhere].map(summary)}));
