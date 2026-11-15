/** Offline full-catalog comparison. Reads published data; writes only this module's report. */
import {readFile,writeFile} from 'node:fs/promises';
import {cpus,totalmem} from 'node:os';
import {QuickEngine} from '../src/quick/engine.ts';
import {MODEL} from '../src/quick/coefficients.ts';
import {validateForecastMonth} from '../src/forecast.ts';
import {iso} from '../src/quick/forecast.ts';

const app=new URL('../../',import.meta.url);
export const readLocal=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
const json=async(path:string)=>JSON.parse(await readFile(new URL(path,app),'utf8'));
const stats=(xs:number[])=>({count:xs.length,mean:xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null,
  median:xs.length?[...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)]:null,max:xs.length?Math.max(...xs):null});

// Pair same-kind events only within one day; unmatched events are reported, never silently discarded.
function compareEvents(estimate:any,reference:any,kind:string) {
  const a=estimate.days.flatMap((d:any)=>d[kind]).map(Date.parse),b=reference.days.flatMap((d:any)=>d[kind]).map(Date.parse);
  const used=new Set<number>(),errors:number[]=[];
  for(const t of a){let closest=-1,gap=86400000;
    for(let j=0;j<b.length;j++)if(!used.has(j)&&Math.abs(t-b[j])<gap){closest=j;gap=Math.abs(t-b[j]);}
    if(closest>=0){used.add(closest);errors.push(gap/60_000);}
  }
  return {...stats(errors),unmatchedEstimate:a.length-used.size,unmatchedReference:b.length-used.size};
}

const engine=new QuickEngine(readLocal),sites=await json('data/sites.json'),rows=[];
const started=performance.now(),start=Date.parse('2026-12-01T00:00:00Z'),end=Date.parse('2027-12-01T00:00:00Z');
for(const site of sites) {
  const reference=await json(`data/forecast/${site.id}.json`);
  const result=await engine.run({...site,startUtc:iso(start),endUtc:iso(end)},{retainSamples:true});
  const sun:number[]=[],earth:number[]=[],angles:Record<string,number[]>={sunAz:[],sunEl:[],earthAz:[],earthEl:[]};
  for(let i=0;i<reference.days.length;i++) {
    if(reference.days[i].date!==result.index.days[i].date)throw new Error('Daily coverage mismatch');
    sun.push(Math.abs(reference.days[i].sunHours-result.index.days[i].sunHours));
    earth.push(Math.abs(reference.days[i].earthHours-result.index.days[i].earthHours));
  }
  for(const label of reference.months) {
    const month=await json(`data/forecast/${site.id}/${label}.json`),estimated=result.monthly[label];
    validateForecastMonth(estimated,month.start,iso(Date.parse(month.start)+month.sunAz.length*3600000));
    const first=(Date.parse(month.start)-start)/600000;
    for(const [field,offset] of Object.entries({sunAz:0,sunEl:1,earthAz:4,earthEl:5}))for(let i=0;i<month[field].length;i++) {
      let delta=Math.abs(result.samples![(first+i*6)*8+offset]-month[field][i]);
      if(field.endsWith('Az'))delta=Math.min(delta,360-delta);angles[field].push(delta);
    }
  }
  const row={id:site.id,name:site.name,groundM:result.horizon.surfaceElevation,
    publishedGroundM:reference.science.surfaceElevationM,sunHoursPerDay:stats(sun),earthHoursPerDay:stats(earth),
    eventsMinutes:Object.fromEntries(['sunrise','sunset','earthrise','earthset'].map(k=>[k,compareEvents(result.index,reference,k)])),
    anglesDegrees:Object.fromEntries(Object.entries(angles).map(([k,v])=>[k,stats(v)])),timings:result.timings};
  rows.push(row);console.log(site.id,JSON.stringify({sun:row.sunHoursPerDay,earth:row.earthHoursPerDay,ms:result.timings.totalMs}));
}
const report={model:MODEL,baseline:'published app/data/forecast at f6d7fac',window:{start:iso(start),end:iso(end)},
  cadenceMinutes:10,samplesPerBody:52561,sites:rows.length,referenceMeaning:'Published Python Horizons/terrain forecasts, not independent ground truth',
  angleComparison:'Unrounded estimate versus saved hourly 0.01-degree values; azimuth differences wrapped',
  eventMatching:'Same kind, unique nearest match within 24 hours; unmatched counts retained',
  hardware:{cpu:cpus()[0].model,logicalCpus:cpus().length,memoryGiB:totalmem()/2**30,node:process.version},
  elapsedMs:performance.now()-started,peakRssBytes:process.resourceUsage().maxRSS*1024,rows};
await writeFile(new URL('../quick-validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(`Validated ${rows.length} sites in ${(report.elapsedMs/1000).toFixed(2)} s`);
