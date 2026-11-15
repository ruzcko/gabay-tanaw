import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {QuickEngine} from '../src/quick/engine.ts';
import {createTravelPlanner,createTravelSource} from '../src/travel.ts';
import {screenTerrain} from '../src/landing-source.ts';
const read=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
const startUtc='2027-02-26T01:47:00Z',criteria={durationDays:7,terrainEnabled:false,
  minSunFraction:18.3/168,minEarthFraction:13.2/168,maxDarkHours:149.7,maxEarthOutageHours:154.8};
const sites=JSON.parse(await readFile(new URL('../../data/sites.json',import.meta.url),'utf8'));
const seed=Number(process.argv[2]??20261115),elsewhereTarget=Number(process.argv[3]??3),reports=[];
for(const mode of ['full','forecast','cached-source'] as const) {
  const engine=new QuickEngine(read),timings:any[]=[],source=createTravelSource({read,terrain:(p,s)=>screenTerrain(engine.terrain,p,s)});
  // Reproduce the prior full-ray path: do not use the new exact upper-envelope pruning.
  if(mode==='full')Object.defineProperty(engine.terrain,'maximumElevation',{get:()=>Infinity});
  const planner=createTravelPlanner(mode==='cached-source'?source:{...source,precheck:undefined,forecast:async(p,a,b,q,s)=>{
    if(q==='accurate')return source.forecast(p,a,b,q,s);
    const input={...p,startUtc:a,endUtc:b},r=mode==='full'?await engine.run(input,{signal:s}):await engine.forecast(input,{signal:s});
    timings.push({point:p,...r.timings});return r.index;
  }});
  const known=[];for(const p of sites)known.push(await planner.evaluate(p,startUtc,criteria));
  const anchors=known.filter(r=>r.status==='pass'&&r.point.lat<-80).map(r=>r.point),streamed:any[]=[];
  const result=await planner.discover(startUtc,criteria,{southTarget:2,elsewhereTarget,southAnchors:anchors,
    seed,exclude:sites,maxSouthSamples:48,maxElsewhereSamples:144,maxElapsedMs:120000,
    onCandidate:e=>streamed.push({group:e.group,point:e.result.point,elapsedMs:e.elapsedMs})});
  reports.push({mode,seed,startUtc,criteria,knownPasses:known.filter(r=>r.status==='pass').length,result,streamed,timings});
  console.log(JSON.stringify({mode,found:result.found,attempted:result.attempted,elapsedMs:result.elapsedMs,
    firstCandidateMs:streamed[0]?.elapsedMs,rays:timings.reduce((n,t)=>n+(t.horizonRays??1440),0)}));
  if(mode==='cached-source') {
    const warm=await planner.discover(startUtc,criteria,{southTarget:2,elsewhereTarget,southAnchors:anchors,
      seed,exclude:sites,maxSouthSamples:48,maxElsewhereSamples:144,maxElapsedMs:120000});
    assert.deepEqual(warm.candidates,result.candidates);
    console.log(JSON.stringify({mode:'warm-repeat',elapsedMs:warm.elapsedMs,rejected:warm.visibilityRejected}));
  }
}
const normalized=(r:any)=>Object.values(r.result.candidates).flatMap((rows:any)=>rows.map((x:any)=>{
  const copy=structuredClone(x);for(const segment of copy.segments){delete segment.provenance?.horizonSha256;delete segment.provenance?.horizonCoverage;}return copy;
}));
assert.deepEqual(reports[0].result.found,{south:2,elsewhere:elsewhereTarget});
assert.deepEqual(normalized(reports[1]),normalized(reports[0]),'Full and demand-traced candidates must be identical except horizon coverage provenance');
assert.deepEqual(normalized(reports[2]),normalized(reports[0]),'Safe prechecks and cached products must preserve candidate results');
const output=new URL('../../../out/travel-quick-performance/',import.meta.url);await mkdir(output,{recursive:true});
await writeFile(new URL(`seed-${seed}-2-${elsewhereTarget}.json`,output),JSON.stringify({reports,speedup:reports[0].result.elapsedMs/reports[1].result.elapsedMs},null,2)+'\n');
console.log('PASS exact candidate identity, metrics, checks, guidance and source policy parity');
