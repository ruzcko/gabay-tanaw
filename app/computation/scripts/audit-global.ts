/** Full-year random global audit; no production writes. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {QuickEngine} from '../src/quick/engine.ts';
import {QuickEphemeris} from '../src/quick/ephemeris.ts';
import {validateProduct} from '../src/forecast-product.ts';
import {sameLongitude} from '../src/core.ts';
const {values:o}=parseArgs({options:{out:{type:'string'}}});if(!o.out)throw Error('Use --out scratch-directory');
const dir=pathToFileURL(resolve(o.out)+'/');await mkdir(new URL('samples/',dir),{recursive:true});
const read=async(u:URL)=>{const b=await readFile(u);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
const refs=JSON.parse(await readFile(new URL('reference.json',dir),'utf8')),engine=new QuickEngine(read),rows=[];
const start=Date.parse('2026-12-01T00:00:00Z'),end=Date.parse('2027-12-01T00:00:00Z');
const instants=[];
for(let m=0;m<12;m++)for(const day of [1,15])instants.push(Date.UTC(2026,11+m,day,12));
instants.push(Date.parse('2026-12-31T23:50:00Z'),Date.parse('2027-01-01T00:00:00Z'));
for(const ref of refs){
  const p=ref.point,input={...p,startUtc:new Date(start).toISOString(),endUtc:new Date(end).toISOString()};
  const r=await engine.run(input,{retainSamples:true});
  validateProduct(r,input,'estimate');
  assert.equal(r.index.days.length,365);assert.equal(r.timings.samplesPerBody,52561);
  const centralFarSide=p.lon>140&&p.lon<220&&Math.abs(p.lat)<50;
  if(centralFarSide)assert.ok(r.index.days.every(d=>d.earthHours===0),'Central far-side site must not see Earth');
  const checkSamples=instants.map(ms=>({utc:new Date(ms).toISOString(),values:Array.from(r.samples!.slice((ms-start)/600000*8,(ms-start)/600000*8+8))}));
  let longitudeWrapEqual;
  if(p.group==='longitude-seam'){
    const wrapped=await engine.run({...input,lon:p.lon-360});
    assert.ok(sameLongitude(wrapped.index.lon,r.index.lon));
    assert.deepEqual({...wrapped.index,lon:r.index.lon},r.index);assert.deepEqual(wrapped.monthly,r.monthly);longitudeWrapEqual=true;
  }
  const ephem=new QuickEphemeris(engine.coefficients,p.lat,p.lon,ref.groundM),v=new Float64Array(52561*8),sample=new Float64Array(8);
  for(let i=0;i<52561;i++){ephem.sample(start+i*600000,sample);v.set(sample,i*8);}
  await writeFile(new URL(`samples/${p.id}.bin`,dir),Buffer.from(v.buffer));
  rows.push({point:p,groundM:r.horizon.surfaceElevation,mask:Array.from(r.horizon.calculation.elevations),days:r.index.days,checkSamples,longitudeWrapEqual,centralFarSide});
  await writeFile(new URL('progress.txt',dir),`Quick annual ${rows.length}/${refs.length}: ${p.id}\n`);
}
await writeFile(new URL('runs.json',dir),JSON.stringify(rows));
