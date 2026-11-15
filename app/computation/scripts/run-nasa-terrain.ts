/** Isolated annual forecast comparison using NASA terrain profiles; no UI imports. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Coefficients} from '../src/quick/coefficients.ts';
import {QuickEphemeris} from '../src/quick/ephemeris.ts';
import {buildQuickForecast} from '../src/quick/forecast.ts';
const dir=pathToFileURL(resolve(process.argv[2]??'science/cache/nasa-terrain')+'/');
const refs=JSON.parse(await readFile(new URL('horizons.json',dir),'utf8'));
const read=async(u:URL)=>{const b=await readFile(u);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
const c=new Coefficients(read),start=Date.parse('2026-12-01T00:00:00Z'),end=Date.parse('2027-12-01T00:00:00Z');
await c.prepare(start,end);await mkdir(new URL('samples/',dir),{recursive:true});
const rows=[];
for(const ref of refs){
  const p=ref.point,row:any={point:p};
  for(const [mode,h] of Object.entries({...ref.variants,reference:ref.reference}) as [string,any][]){
    const t=performance.now(),e=new QuickEphemeris(c,p.lat,p.lon,h.groundM),v=new Float64Array(52561*8),s=new Float64Array(8);
    for(let i=0;i<52561;i++){e.sample(start+i*600000,s);v.set(s,i*8);}
    const hq:any={lat:p.lat,lon:p.lon,referenceFrame:'MOON_ME_DE421',datum:'sphere-1737400m',surfaceElevation:h.groundM,
      observerHeight:2,step:1,terrain:'Isolated NASA map comparison',model:'Tanaw-NASA-terrain-experiment-v1',rangeKm:150,rayStepM:5,
      elevations:h.mask.filter((_:number,i:number)=>i%4===0),calculation:{step:.25,elevations:Float64Array.from(h.mask)},sha256:'a'.repeat(64)};
    const product=buildQuickForecast(p,start,end,v,hq,[]);
    row[mode]={days:product.index.days,timings:{annualMs:performance.now()-t}};
    if(mode!=='reference')await writeFile(new URL(`samples/${p.id}-${mode}.bin`,dir),Buffer.from(v.buffer));
  }
  rows.push(row);console.log(p.id);
}
await writeFile(new URL('runs.json',dir),JSON.stringify(rows));
