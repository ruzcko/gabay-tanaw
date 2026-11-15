/** Node CPU/load breakdown for the same fixed-seed search used by the browser review. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {QuickEngine} from '../src/quick/engine.ts';
import {createTravelPlanner,createTravelSource} from '../src/travel.ts';
const rows:any[]=[],bounds:any[]=[],reads=new Map<string,{count:number;bytes:number;ms:number}>();
const read=async(url:URL)=>{
  const t=performance.now(),b=await readFile(url),kind=url.pathname.includes('/terrain/')?'terrain':url.pathname.includes('/quick/')?'coefficients':'published';
  const r=reads.get(kind)??{count:0,bytes:0,ms:0};r.count++;r.bytes+=b.length;r.ms+=performance.now()-t;reads.set(kind,r);
  return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;
};
const forecast=QuickEngine.prototype.forecast,bound=QuickEngine.prototype.visibilityBound;
QuickEngine.prototype.forecast=async function(...args){const r=await forecast.apply(this,args);rows.push({point:args[0],...r.timings});return r;};
QuickEngine.prototype.visibilityBound=async function(...args){const r=await bound.apply(this,args);bounds.push({point:args[0],...r});return r;};
const source=createTravelSource({read}),planner=createTravelPlanner(source),startUtc='2027-02-26T01:47:00Z',
  criteria={durationDays:7,terrainEnabled:false,minSunFraction:18.3/168,minEarthFraction:13.2/168,maxDarkHours:149.7,maxEarthOutageHours:154.8},
  sites=JSON.parse(await readFile(new URL('../../data/sites.json',import.meta.url),'utf8')),known=[];
let warmupMs=0;
if(process.argv.includes('--warmup')){const t=performance.now();await source.warmup!(startUtc,'2027-03-05T01:47:00Z');warmupMs=performance.now()-t;
  console.log('Preload only',JSON.stringify({warmupMs,reads:Object.fromEntries(reads)}));}
const begin=performance.now();for(const site of sites)known.push(await planner.evaluate(site,startUtc,criteria));
const knownMs=performance.now()-begin,southAnchors=known.filter(x=>x.status==='pass'&&x.point.lat<-80).map(x=>x.point);
const result=await planner.discover(startUtc,criteria,{southTarget:2,elsewhereTarget:3,southAnchors,seed:20261115,exclude:sites,
  maxSouthSamples:48,maxElsewhereSamples:144,maxElapsedMs:120000});
const totals=Object.fromEntries(['terrainLoadMs','ephemerisLoadMs','ephemerisMs','horizonMs','forecastMs','horizonRays'].map(k=>[k,rows.reduce((n,r)=>n+r[k],0)]));
const summary={warmupMs,knownMs,discoveryMs:result.elapsedMs,totalMs:performance.now()-begin,found:result.found,attempted:result.attempted,
  rejected:result.visibilityRejected,totals,boundMs:bounds.reduce((n,r)=>n+r.totalMs,0),reads:Object.fromEntries(reads)};
console.log(JSON.stringify(summary,null,2));
const folder=new URL('../../../out/travel-quick-performance/',import.meta.url);await mkdir(folder,{recursive:true});
await writeFile(new URL(`profile-${process.argv[2]??'latest'}.json`,folder),JSON.stringify({summary,rows,bounds,result},null,2));
