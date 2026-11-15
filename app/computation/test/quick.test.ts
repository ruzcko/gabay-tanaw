import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Coefficients,decodePack,utcToEt,ttMinusUtc,gunzip,sha256} from '../src/quick/coefficients.ts';
import {QUICK_RANGE,ESTIMATE_UNAVAILABLE} from '../src/quick/coverage.ts';
import {QuickEphemeris} from '../src/quick/ephemeris.ts';
import {QuickEngine} from '../src/quick/engine.ts';
import {upIntervals,buildQuickForecast} from '../src/quick/forecast.ts';
import {Terrain,maskAt,traceHorizon} from '../src/quick/terrain.ts';
import {validateForecastMonth} from '../src/forecast.ts';
import {validateProduct,productSnapshot,productMoonDirections} from '../src/forecast-product.ts';
import {Quaternion,Vector3} from '../../vendor/three/three.module.js';

const read=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
const coefficients=new Coefficients(read);
const fixture=JSON.parse(await readFile(new URL('../fixtures/quick-reference.json',import.meta.url),'utf8'));

test('quick geometry and libration match independent CSPICE across the manifest range',async()=>{
  // Different correction implementations: compare geometry and frame independently of visibility/DEM.
  let maxAngle=0,maxRange=0,maxRotation=0;
  for(const row of fixture.rows) {
    const ms=Date.parse(row.utc);await coefficients.prepare(ms===QUICK_RANGE.end?ms-86400000:ms,ms);
    assert.ok(Math.abs(utcToEt(ms)-row.et)<.00001,'UTC to TDB');
    const ephemeris=new QuickEphemeris(coefficients,row.lat,row.lon,row.groundM),out=new Float64Array(8);
    ephemeris.sample(ms,out);
    const geometry=ephemeris.geometry(ms);
    for(const key of ['sunMoon','earthMoon','sunLocal'] as const)
      geometry[key].forEach((value,i)=>assert.ok(Math.abs(value-row.geometry[key][i])<1e-10,`${key} matches CSPICE`));
    for(let i=0;i<9;i++)maxRotation=Math.max(maxRotation,Math.abs(ephemeris.orientation[i]-row.rotation[i]));
    for(let i=0;i<2;i++) {
      const delta=Math.abs(out[i*4]-row.bodies[i].az);
      maxAngle=Math.max(maxAngle,Math.min(delta,360-delta),Math.abs(out[i*4+1]-row.bodies[i].el));
      maxRange=Math.max(maxRange,Math.abs(out[i*4+2]-row.bodies[i].rangeKm));
    }
  }
  assert.ok(maxRotation<1e-9,`rotation matrix error ${maxRotation}`);
  assert.ok(maxAngle<.0001,`az/el error ${maxAngle} degrees`);
  assert.ok(maxRange<.0001,`range error ${maxRange} km`);
  console.log('Independent quick reference maxima',{maxAngleDeg:maxAngle,maxRangeKm:maxRange,maxRotation});
});

test('shipped packs exactly match the manifest, including every size and decoded checksum',async()=>{
  const base=new URL('../../assets/computation/quick/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
  const years=Array.from({length:QUICK_RANGE.lastYear-QUICK_RANGE.firstYear+1},(_,i)=>String(QUICK_RANGE.firstYear+i));
  assert.deepEqual(Object.keys(manifest.years),years);
  assert.deepEqual((await readdir(base)).sort(),[...years.map(y=>`${y}.bin.gz`),'manifest.json'].sort());
  for(const year of years){
    const packed=await read(new URL(`${year}.bin.gz`,base)),raw=await gunzip(packed),info=manifest.years[year];
    assert.equal(packed.byteLength,info.bytes);assert.equal(raw.byteLength,info.decodedBytes);
    assert.equal(await sha256(raw),info.sha256);decodePack(raw);
  }
});

test('first and last supported dates produce estimates, with only requested packs loaded',async()=>{
  const paths:string[]=[],engine=new QuickEngine(async url=>{paths.push(url.pathname);return read(url);});
  for(const start of [QUICK_RANGE.start,QUICK_RANGE.end-86400000]) {
    paths.length=0;
    const result=await engine.run({lat:.67416,lon:23.47314,startUtc:new Date(start).toISOString(),
      endUtc:new Date(start+86400000).toISOString()},{retainSamples:true});
    assert.equal(result.index.quality,'estimate');assert.equal(result.index.days.length,1);
    validateProduct(result,{lat:.67416,lon:23.47314,startUtc:new Date(start).toISOString(),endUtc:new Date(start+86400000).toISOString()},'estimate');
    const snapshot=productSnapshot(result,new Date(start).toISOString());
    assert.equal(snapshot.instantUtc,new Date(start).toISOString());
    assert.equal(snapshot.quality,'estimate');
    assert.equal(snapshot.bodies.sun.azimuthDeg,result.samples![0]);
    assert.equal(snapshot.bodies.earth.elevationDeg,result.samples![5]);
    assert.equal(snapshot.bodies.sun.centerVisible,result.index.days[0].sunUpAt0);
    assert.equal(snapshot.bodies.earth.centerVisible,result.index.days[0].earthUpAt0);
    // The hourly track (Horizons sub-point convention) is within 0.01° of the snapshot's geometric vector.
    const [a,b]=[productMoonDirections(result,snapshot.instantUtc).sun,snapshot.overview.sunDirectionMoon];
    assert.ok(Math.atan2(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]),a[0]*b[0]+a[1]*b[1]+a[2]*b[2])*180/Math.PI<.01);
    const up=new Vector3(...snapshot.overview.siteDirectionMoon).applyQuaternion(new Quaternion(...snapshot.overview.moonToLocal));
    assert.ok(up.distanceTo(new Vector3(0,1,0))<1e-12,'Moon frame rotates into the local radial up axis');
    assert.equal(result.index.days[0].date,new Date(start).toISOString().slice(0,10));
    assert.ok(result.samples!.every(Number.isFinite));assert.equal(result.timings.samplesPerBody,145);
    assert.deepEqual(paths.filter(p=>p.includes('/computation/quick/')&&p.endsWith('.bin.gz')).map(p=>p.split('/').at(-1)),[`${new Date(start).getUTCFullYear()}.bin.gz`]);
    assert.equal(result.monthly[result.index.months[0]].sunAz.length,24);
    validateForecastMonth(result.monthly[result.index.months[0]],new Date(start).toISOString().replace('.000Z','Z'),new Date(start+86400000).toISOString().replace('.000Z','Z'));
  }
});

test('a selected scene hour uses the same day product and never displays its exclusive endpoint',async()=>{
  const engine=new QuickEngine(read),start=QUICK_RANGE.end-86400000;
  const input={lat:.67416,lon:23.47314,startUtc:new Date(start).toISOString(),endUtc:new Date(QUICK_RANGE.end).toISOString()};
  const instantUtc=new Date(QUICK_RANGE.end-3600000).toISOString();
  const result=await engine.run({...input,instantUtc},{retainSamples:true});
  assert.equal(result.snapshot.instantUtc,instantUtc);
  assert.equal(result.snapshot.bodies.sun.azimuthDeg,result.samples![23*6*8]);
  assert.equal(result.snapshot.bodies.earth.elevationDeg,result.samples![23*6*8+5]);
  await assert.rejects(engine.run({...input,instantUtc:input.endUtc}),{message:ESTIMATE_UNAVAILABLE});
});

test('outside years and windows crossing coverage fail with the inline unavailable message',async()=>{
  const engine=new QuickEngine(async()=>{throw new Error('Unsupported dates must not fetch assets');});
  for(const start of [Date.UTC(QUICK_RANGE.firstYear-1,6,1),QUICK_RANGE.end,QUICK_RANGE.end-86400000]) {
    await assert.rejects(engine.run({lat:0,lon:0,startUtc:new Date(start).toISOString(),
      endUtc:new Date(start+2*86400000).toISOString()}),{message:ESTIMATE_UNAVAILABLE});
  }
  const packs=new Coefficients(read);
  await assert.rejects(packs.prepare(QUICK_RANGE.end,QUICK_RANGE.end),{message:ESTIMATE_UNAVAILABLE});
  await packs.prepare(QUICK_RANGE.end-86400000,QUICK_RANGE.end);
  const ephemeris=new QuickEphemeris(packs,0,0,0),out=new Float64Array(8);
  ephemeris.sample(QUICK_RANGE.end,out);
  assert.throws(()=>ephemeris.sample(QUICK_RANGE.end+1,out),{message:ESTIMATE_UNAVAILABLE});
});

test('warm coefficient caches revalidate manifest metadata and do not authorize failed endpoints',async()=>{
  const base=new URL('../../assets/computation/quick/',import.meta.url);
  const original=JSON.parse(await readFile(new URL('manifest.json',base),'utf8'));
  let manifest=structuredClone(original),loads=0;
  const packs=new Coefficients(async url=>{
    if(url.pathname.endsWith('/manifest.json'))return new TextEncoder().encode(JSON.stringify(manifest)).buffer;
    loads++;return read(url);
  });
  const start=QUICK_RANGE.end-86400000,year=String(QUICK_RANGE.lastYear);
  await packs.prepare(start,QUICK_RANGE.end);
  await packs.prepare(start,QUICK_RANGE.end);assert.equal(loads,1,'Unchanged validated packs stay cached');
  for(const field of ['sha256','bytes','decodedBytes']) {
    manifest=structuredClone(original);
    manifest.years[year][field]=field==='sha256'?'0'.repeat(64):manifest.years[year][field]+8;
    await assert.rejects(packs.prepare(start,QUICK_RANGE.end),/Coefficient (checksum|size) mismatch/);
    assert.throws(()=>packs.packAt(QUICK_RANGE.end),{message:ESTIMATE_UNAVAILABLE});
  }
  manifest=structuredClone(original);
  await packs.prepare(start,QUICK_RANGE.end);
  assert.ok(packs.packAt(QUICK_RANGE.end));
  // An endpoint authorization from a prior request must not survive a manifest failure.
  manifest.years[year].sha256='invalid';
  await assert.rejects(packs.prepare(start,QUICK_RANGE.end),/Invalid coefficient metadata/);
  assert.throws(()=>packs.packAt(QUICK_RANGE.end),{message:ESTIMATE_UNAVAILABLE});
});

test('the complete final year agrees with the terminal day on a warm engine',async()=>{
  const engine=new QuickEngine(read),end=QUICK_RANGE.end,start=Date.UTC(QUICK_RANGE.lastYear,0,1);
  const site={lat:.67416,lon:23.47314},iso=(ms:number)=>new Date(ms).toISOString();
  const day=await engine.run({...site,startUtc:iso(end-86400000),endUtc:iso(end)},{retainSamples:true});
  const year=await engine.run({...site,startUtc:iso(start),endUtc:iso(end)},{retainSamples:true});
  const days=(end-start)/86400000;
  assert.equal(year.index.days.length,days);
  assert.equal(year.timings.samplesPerBody,days*144+1);
  assert.equal(year.timings.coefficientBytes,0,'The final year pack is reused');
  assert.equal(year.timings.horizonCacheHit,true);
  assert.equal(year.index.months.length,12);
  assert.equal(year.monthly[`${QUICK_RANGE.lastYear}-02`].sunAz.length,
    new Date(Date.UTC(QUICK_RANGE.lastYear,2,0)).getUTCDate()*24,'Gregorian century leap rule');
  assert.deepEqual(year.index.days.at(-1),day.index.days[0]);
  assert.deepEqual(year.samples!.slice(-145*8),day.samples,'Terminal-day geometry is independent of window length/cache');
  assert.deepEqual([...engine.coefficients.packs.keys()],[QUICK_RANGE.lastYear]);
});

test('terrain ray tracer blocks a ridge above the horizontal; interpolation is cyclic',async()=>{
  // An explicit raised ring fixture tests curvature/eye-height/ray geometry, not just array shape.
  const terrain={sample:(x:number,y:number,z:number)=>Math.hypot(y,z)>.0003&&Math.hypot(y,z)<.0006?100:0};
  const h=await traceHorizon(terrain,0,0);
  assert.equal(h.calculation.elevations.length,1440);assert.equal(h.surfaceElevation,0);
  assert.ok(h.calculation.elevations.every(e=>e>5));
  assert.ok(1-maskAt(h.calculation.elevations,15)<0,'a body at elevation 1 degree is blocked');
  assert.equal(maskAt(h.calculation.elevations,-.125),maskAt(h.calculation.elevations,359.875));
});

test('month-seam events use the full ten-minute grid and next events cross the seam',async()=>{
  const start=Date.parse('2026-12-31T00:00:00Z'),end=Date.parse('2027-01-02T00:00:00Z');
  const h=await traceHorizon({sample:()=>0},0,0),values=new Float64Array(289*8),mask=h.calculation.elevations;
  // Clearances cross at exactly Jan 1 midnight, even though the saved month is half-open.
  for(let i=0;i<289;i++)for(const b of [0,4]){
    values[i*8+b]=90;values[i*8+b+1]=mask[360]+(i-144)/144;values[i*8+b+2]=400000;values[i*8+b+3]=1;
  }
  const p=buildQuickForecast({lat:0,lon:0},start,end,values,h,[]);
  assert.deepEqual(p.index.days[0].nextSunEvent,{kind:'rise',at:'2027-01-01T00:00:00Z'});
  assert.deepEqual(p.index.days[1].sunrise,['2027-01-01T00:00:00Z']);
  assert.equal(p.index.days[1].sunUpAt0,false);assert.equal(p.index.days[1].sunHours,24);
  assert.equal(p.monthly['2026-12'].sunAz.length,24);assert.equal(p.monthly['2027-01'].sunVisible[0],0);
  validateForecastMonth(p.monthly['2027-01'],'2027-01-01T00:00:00Z','2027-01-02T00:00:00Z');
  assert.deepEqual(upIntervals(new Float64Array([1,0,1]),0,600000),[[0,600000],[600000,1200000]]);
});

test('real terrain and leap-day forecast outside the publication window retain estimate provenance',async()=>{
  const engine=new QuickEngine(read),input={lat:.67416,lon:23.47314,startUtc:'2028-02-28T00:00:00Z',endUtc:'2028-03-02T00:00:00Z'};
  const a=await engine.run(input),b=await engine.run(input);
  assert.equal(a.index.quality,'estimate');assert.equal(a.index.days[1].date,'2028-02-29');
  assert.equal(a.timings.samplesPerBody,433);assert.equal(b.timings.horizonCacheHit,true);
  assert.deepEqual(a.index,b.index);assert.deepEqual(a.monthly,b.monthly);
  assert.ok(a.horizon.calculation.elevations.some(e=>e>0));
  assert.equal(a.index.science.observerHeightM,2);assert.equal(a.index.science.referenceFrame,'MOON_ME_DE421');
  a.horizon.surfaceElevation=NaN;
  await assert.rejects(engine.run(input,{horizon:a.horizon}),/Cached horizon/);
  const c=await engine.run(input);assert.deepEqual(c.index,b.index,'caller mutation cannot poison the point cache');
});

test('missing terrain, invalid coordinates and damaged packs fail closed',async()=>{
  const engine=new QuickEngine(read);
  await assert.rejects(engine.run({lat:90,lon:0,startUtc:'2027-01-01T00:00:00Z',endUtc:'2027-01-02T00:00:00Z'}));
  await assert.rejects(engine.run({lat:0,lon:0,startUtc:`${QUICK_RANGE.firstYear-1}-01-01T00:00:00Z`,endUtc:`${QUICK_RANGE.firstYear-1}-01-02T00:00:00Z`}));
  assert.throws(()=>decodePack(new Float64Array([1,5]).buffer));
  assert.throws(()=>new Terrain().sample(1,0,0),/missing/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(engine.run({lat:0,lon:0,startUtc:'2027-01-01T00:00:00Z',endUtc:'2027-01-02T00:00:00Z'},{signal:controller.signal}));
});

test('preloaded range reuses forecasts while recomputing geometric lighting for the scrubbed minute',async()=>{
  const engine=new QuickEngine(read),input={lat:.67416,lon:23.47314,startUtc:'2028-02-01T00:00:00Z',endUtc:'2028-03-02T00:00:00Z'};
  const a=await engine.run({...input,instantUtc:'2028-02-01T14:37:00Z'});
  const b=await engine.run({...input,instantUtc:'2028-02-20T14:37:00Z'});
  assert.equal(b.timings.samplesPerBody,0);assert.deepEqual(a.monthly,b.monthly);
  assert.notDeepEqual(a.snapshot.lighting.sunDirectionLocal,b.snapshot.lighting.sunDirectionLocal);
  const fresh=await new QuickEngine(read).run({...input,instantUtc:'2028-02-20T14:37:00Z'});
  assert.deepEqual(b.snapshot,fresh.snapshot);
});

test('custom-point estimates keep current geometric lighting on cached playback across both hemispheres',async()=>{
  const engine=new QuickEngine(read);
  for(const [lat,lon] of [[20.1911,30.7723],[-88.123,45.456],[61.234,179.9999],[-23.456,240.123]]) {
    const input={lat,lon,startUtc:'2028-03-01T00:00:00Z',endUtc:'2028-04-01T00:00:00Z'};
    let previous:number[]|undefined;
    for(const day of ['01','15','31']) {
      const instantUtc=`2028-03-${day}T13:37:00Z`,p=await engine.run({...input,instantUtc});
      const s=productSnapshot(p,instantUtc),ray=s.lighting.sunDirectionLocal;
      assert.equal(s.quality,'estimate');assert.equal(s.instantUtc,instantUtc.replace('Z','.000Z'));
      assert.ok(Math.abs(Math.hypot(...ray)-1)<1e-12);
      if(previous){assert.equal(p.timings.samplesPerBody,0);assert.notDeepEqual(ray,previous);}
      const expected=new QuickEphemeris(engine.coefficients,lat,lon,p.horizon.surfaceElevation).geometry(Date.parse(instantUtc));
      ray.forEach((v:number,i:number)=>assert.ok(Math.abs(v-expected.sunLocal[i])<1e-12));previous=ray;
    }
  }
});


test('scene-only playback matches exact computation, reuses assets, and rejects out-of-window times',async()=>{
  let reads=0;
  const engine=new QuickEngine(async url=>{reads++;return read(url);});
  const input={lat:.67416,lon:23.47314,startUtc:'2028-02-01T00:00:00Z',endUtc:'2028-02-02T00:00:00Z'};
  await engine.run(input); const loaded=reads;
  const selection={...input,instantUtc:'2028-02-01T14:37:00Z'};
  const scene=await engine.snapshot(selection);
  assert.equal(reads,loaded,'No forecast or coefficient reload per playback frame');
  assert.deepEqual(scene,(await new QuickEngine(read).run(selection)).snapshot);
  await assert.rejects(engine.snapshot({...input,instantUtc:input.endUtc}),/outside the estimate window/);
  const changed=await engine.snapshot({...selection,lat:-3.0128,lon:336.5781});
  assert.equal(changed.site.latitudeDeg,-3.0128,'Never reuse another site\'s horizon or scene');
});

test('western custom locations reuse horizons across playback and worker restarts',async()=>{
  const engine=new QuickEngine(read);
  const input={lat:-35.79212,lon:-51.689497,startUtc:'2027-02-13T00:00:00Z',endUtc:'2027-02-14T00:00:00Z'};
  const loaded=await engine.run({...input,id:'custom-location'});
  const selection={...input,instantUtc:'2027-02-13T12:01:00Z'};
  const frame=await engine.snapshot(selection);
  const restarted=await new QuickEngine(read).run(selection,{horizon:loaded.horizon});
  assert.deepEqual(frame,restarted.snapshot);
  assert.equal(restarted.timings.horizonCacheHit,true);
  await assert.rejects(engine.run({...selection,lon:input.lon+.001},{horizon:loaded.horizon}),/Cached horizon/);
});

test('pre-leap UTC drift at Apollo 11 landing and the leap UTC boundary',()=>{
  // MJD 40422 + 73060/86400; USNO 1968 February segment, TT = TAI + 32.184.
  assert.ok(Math.abs(ttMinusUtc(Date.parse('1969-07-20T20:17:40Z')) - 39.7585938) < 1e-10);
  assert.equal(ttMinusUtc(Date.parse('1972-01-01T00:00:00Z')),42.184);
  assert.ok(Math.abs(ttMinusUtc(Date.parse('1961-01-01T00:00:00Z'))-33.606818)<1e-10);
});

test('Apollo landing days have early Sun and high Earth above the terrain',async()=>{
  const engine=new QuickEngine(read);
  for(const [lat,lon,instantUtc] of [
    [.67416,23.47314,'1969-07-20T20:17:40Z'],
    [-3.0128,336.5781,'1969-11-19T06:54:35Z'],
  ] as const){
    const startUtc=instantUtc.slice(0,10)+'T00:00:00Z';
    const result=await engine.run({lat,lon,startUtc,endUtc:new Date(Date.parse(startUtc)+86400000).toISOString()});
    const ephemeris=new QuickEphemeris(engine.coefficients,lat,lon,result.horizon.surfaceElevation!);
    const values=new Float64Array(8);ephemeris.sample(Date.parse(instantUtc),values);
    assert.equal(result.index.quality,'estimate');
    assert.ok(values[1]>3 && values[1]<15,'Early-morning sunlight');
    assert.ok(values[5]>50,'Earth high in the sky');
    for(const i of [0,4])assert.ok(values[i+1]>maskAt(result.horizon.calculation!.elevations,values[i]));
    console.log('Landing geometry',{instantUtc,sunElevation:values[1],earthElevation:values[5],
      sunHorizon:maskAt(result.horizon.calculation!.elevations,values[0]),earthHorizon:maskAt(result.horizon.calculation!.elevations,values[4])});
  }
  await assert.rejects(engine.run({lat:0,lon:0,startUtc:new Date(QUICK_RANGE.start-86400000).toISOString(),
    endUtc:new Date(QUICK_RANGE.start).toISOString()}),{message:ESTIMATE_UNAVAILABLE});
});

test('quick horizon cache accepts equivalent longitudes across signed rounding boundaries',async()=>{
  // 179.9999 and -180.0001 normalize one floating-point unit apart on the first pass.
  const engine=new QuickEngine(read),selection={lat:-30,lon:179.9999,startUtc:'2027-01-01T00:00:00Z',endUtc:'2027-01-02T00:00:00Z'};
  const first=await engine.run(selection),wrapped=await engine.run({...selection,lon:-180.0001});
  assert.equal(wrapped.timings.horizonCacheHit,true);
  assert.deepEqual(wrapped.index.days,first.index.days);assert.deepEqual(wrapped.monthly,first.monthly);
  const mismatched=structuredClone(first.horizon);mismatched.lon+=.000001;
  await assert.rejects(engine.run(selection,{horizon:mismatched}),/Cached horizon/);
});
