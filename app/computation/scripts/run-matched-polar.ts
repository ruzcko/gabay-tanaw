/** Offline experiment. Explicit scratch directory; no production data writes. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ExperimentalPolar,experimentalHorizon} from './experimental-polar.ts';
import {QuickEngine} from '../src/quick/engine.ts';
import {Coefficients} from '../src/quick/coefficients.ts';
import {QuickEphemeris} from '../src/quick/ephemeris.ts';
import {buildQuickForecast} from '../src/quick/forecast.ts';
const {values:o}=parseArgs({options:{out:{type:'string'},'native-baseline':{type:'string'},checks:{type:'boolean',default:false}}});
if(!o.out)throw Error('Use --out DIRECTORY [--native-baseline previous-random-quick.json]');
const dir=pathToFileURL(resolve(o.out)+'/'),read=async(u:URL)=>{const b=await readFile(u);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
const refs=JSON.parse(await readFile(new URL('reference.json',dir),'utf8'));
const baseline=o['native-baseline']?JSON.parse(await readFile(o['native-baseline'],'utf8')):[];
const c=new Coefficients(read),engine=new QuickEngine(read),start=Date.parse('2026-12-01T00:00:00Z'),end=Date.parse('2027-12-01T00:00:00Z');
await c.prepare(start,end);await mkdir(new URL('samples/',dir),{recursive:true});const rows=[];
if(!o.checks)for(const ref of refs){const p=ref.point,row:any={point:p};
  const old=baseline.find((s:any)=>s.id===p.id);
  if(old&&(old.lat!==p.lat||old.lon!==p.lon||old.days.length!==365))throw Error(`Mismatched native baseline: ${p.id}`);
  if(old)row.native=old;
  else {const r=await engine.run({...p,startUtc:new Date(start).toISOString(),endUtc:new Date(end).toISOString()});row.native={groundM:r.horizon.surfaceElevation,days:r.index.days,timings:r.timings};}
  for(const mode of ['coarse','fine']){
    // Fresh terrain instances measure point-cold bytes, while OS file cache may be warm.
    const terrain=new ExperimentalPolar(new URL('tiles/',dir),mode==='fine',read),a=performance.now();
    await terrain.prepare(p.lat,p.lon);const b=performance.now(),h=await experimentalHorizon(terrain,p.lat,p.lon),t=performance.now();
    const ephem=new QuickEphemeris(c,p.lat,p.lon,h.surfaceElevation),v=new Float64Array(52561*8),sample=new Float64Array(8);
    for(let i=0;i<52561;i++){ephem.sample(start+i*600000,sample);v.set(sample,i*8);}
    const product=buildQuickForecast(p,start,end,v,h,[]);
    row[mode]={groundM:h.surfaceElevation,mask:Array.from(h.calculation.elevations),days:product.index.days,
      timings:{loadMs:b-a,horizonMs:t-b,annualMs:performance.now()-t,bytes:terrain.bytesLoaded,requests:terrain.requests,fineMaps:terrain.selectedFine}};
    if(mode==='fine'){
      // Independent Python builder receives samples at its own exact reference height.
      const referenceEphem=new QuickEphemeris(c,p.lat,p.lon,ref.fine.groundM);
      for(let i=0;i<52561;i++){referenceEphem.sample(start+i*600000,sample);v.set(sample,i*8);}
      await writeFile(new URL(`samples/${p.id}.bin`,dir),Buffer.from(v.buffer));
    }
  }
  rows.push(row);console.log(p.id,JSON.stringify({coarse:row.coarse.timings,fine:row.fine.timings}));
}
if(!o.checks)await writeFile(new URL('runs.json',dir),JSON.stringify(rows));

// Ground-height continuity at the old source seam and each fine raster's pixel-centre footprint.
const manifest=JSON.parse(await readFile(new URL('tiles/manifest.json',dir),'utf8')),probes:any[]=[];
const inverse=(x:number,y:number)=>({lat:(2*Math.atan(Math.hypot(x,y)/(2*1737400))-Math.PI/2)*180/Math.PI,lon:(Math.atan2(x,y)*180/Math.PI+360)%360});
for(let lon=0;lon<360;lon+=30)probes.push({id:`old-seam-${lon}`,a:{lat:-87.5-180/Math.PI/1737400,lon},b:{lat:-87.5+180/Math.PI/1737400,lon}});
for(const g of manifest.grids.filter((g:any)=>g.id!=='lola240')){
  const midX=g.left+g.width*2.5,midY=g.top-g.height*2.5;
  for(const [label,x,y,dx,dy] of [['left',g.left+2.5,midY,1,0],['right',g.left+(g.width-.5)*5,midY,1,0],
    ['top',midX,g.top-2.5,0,1],['bottom',midX,g.top-(g.height-.5)*5,0,1]] as [string,number,number,number,number][])
    probes.push({id:`${g.id}-${label}`,a:inverse(x-dx,y-dy),b:inverse(x+dx,y+dy)});
}
for(const mode of ['coarse','fine']){
  const t=new ExperimentalPolar(new URL('tiles/',dir),mode==='fine',read);
  for(const probe of probes){probe[mode]={};for(const key of ['a','b']){const p=probe[key];await t.prepare(p.lat,p.lon);
    const a=p.lat*Math.PI/180,l=p.lon*Math.PI/180;probe[mode][key]=t.sample(Math.cos(a)*Math.cos(l),Math.cos(a)*Math.sin(l),Math.sin(a));}}
}
await writeFile(new URL('seams.json',dir),JSON.stringify(probes,null,2)+'\n');

const catalog=JSON.parse(await readFile(new URL('../../data/sites.json',import.meta.url),'utf8'));
const nativeEngine=new QuickEngine(async u=>{if(u.pathname.endsWith('/data/sites.json'))throw Error('Tiled control');return read(u);});
const illumination=[];
for(const id of ['connecting-ridge','connecting-ridge-extension','shackleton-rim']){
  const p=catalog.find((s:any)=>s.id===id),row:any={point:p};
  const native=await nativeEngine.run({...p,startUtc:'2026-12-01T00:00:00Z',endUtc:'2026-12-02T00:00:00Z'});
  row.native=Array.from(native.horizon.calculation.elevations);
  for(const mode of ['coarse','fine']){const t=new ExperimentalPolar(new URL('tiles/',dir),mode==='fine',read);await t.prepare(p.lat,p.lon);
    row[mode]=Array.from((await experimentalHorizon(t,p.lat,p.lon)).calculation.elevations);}
  illumination.push(row);
}
await writeFile(new URL('illumination-horizons.json',dir),JSON.stringify(illumination));
