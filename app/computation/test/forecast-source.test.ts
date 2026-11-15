import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateProduct, productSnapshot, productMoonDirections, meaningfulChanges } from '../src/forecast-product.ts';
const { createForecastSource } = await import(new URL('../../forecast-source.js', import.meta.url).href);
const read = async(path:string) => JSON.parse(await readFile(new URL(`../../data/${path}`,import.meta.url),'utf8'));
const site = (await read('sites.json')).find((s:any)=>s.id==='apollo-11');
const selection={id:site.id,lat:site.lat,lon:site.lon,startUtc:'2026-12-01T00:00:00Z',endUtc:'2026-12-08T00:00:00Z'};
const published={index:await read('forecast/apollo-11.json'),horizon:await read('horizons/apollo-11.json'),
  monthly:{'2026-12':await read('forecast/apollo-11/2026-12.json')},quality:'accurate'};
// Timing/race fixture only: reuse published shape, explicitly mark the injected estimate.
function estimate() {const p=structuredClone(published);p.quality='estimate';p.index.quality='estimate';p.index.model='test-estimate';
  (p.monthly['2026-12'] as any).quality='estimate';return p;}
function deferred(){let resolve!:(v:any)=>void;return {promise:new Promise(r=>resolve=r),resolve:(v:any)=>resolve(v)};}
const turn=()=>new Promise(r=>setTimeout(r,0));

test('republished geometry revalidates the HTTP cache and then reuses the parsed file',async()=>{
  let requests=0;
  const source=createForecastSource({fetcher:async(_url:any,options:any)=>{
    requests++;
    const value=options.cache==='no-cache'?{revision:'updated-geometry'}:{revision:'old-cached-month'};
    return {ok:true,text:async()=>JSON.stringify(value)};
  }});
  const first=await source.published('sun/2027-03.json');
  assert.equal(first.revision,'updated-geometry');
  first.revision='caller mutation';
  assert.equal((await source.published('sun/2027-03.json')).revision,'updated-geometry');
  assert.equal(requests,1,'scrubbing retains the in-memory monthly cache');
  source.dispose();
});

test('host emits estimate then one coherent accurate product, and never mutates published data',async()=>{
  const original=JSON.stringify(published),accurate=deferred(),events:any[]=[];
  const source=createForecastSource({quick:async()=>estimate(),accurate:()=>accurate.promise});
  const work=source.load(selection,(value:any)=>events.push(value));await turn();
  assert.deepEqual(events.map(e=>e.quality),['estimate']);
  accurate.resolve(published);await work;
  assert.deepEqual(events.map(e=>e.quality),['estimate','accurate']);
  events[1].data.index.days[0].sunHours=999;
  assert.equal(JSON.stringify(published),original);
  source.dispose();
});
test('A then B rejects late A results even when both injected sources ignore abort',async()=>{
  const a=deferred(),b=deferred(),events:any[]=[];
  const source=createForecastSource({quick:()=>new Promise(r=>setTimeout(()=>r(estimate()),5)),accurate:(s:any)=>s.endUtc===selection.endUtc?a.promise:b.promise});
  const first=source.load(selection,(e:any)=>events.push(e));
  const second=source.load({...selection,endUtc:'2026-12-09T00:00:00Z'},(e:any)=>events.push(e));
  b.resolve(published);await second;a.resolve(published);await first;
  assert.equal(events.length,1);assert.equal(events[0].selection.endUtc,'2026-12-09T00:00:00Z');source.dispose();
});
test('unavailable accurate source keeps a labelled estimate and playback reuses it',async()=>{
  let calls=0;const events:any[]=[];
  const source=createForecastSource({quick:async()=>{calls++;return estimate();},accurate:async()=>null});
  await source.load(selection,(e:any)=>events.push(e));
  assert.equal(events.at(-1).reason,'unavailable');
  await source.load(selection,()=>{});assert.equal(calls,1);source.dispose();
});
test('an early accurate result cannot be overwritten by a late estimate',async()=>{
  const slow=deferred(),events:any[]=[];
  const source=createForecastSource({quick:()=>slow.promise,accurate:async()=>published});
  const work=source.load(selection,(e:any)=>events.push(e));await turn();slow.resolve(estimate());await work;
  assert.deepEqual(events.map(e=>e.quality),['accurate']);source.dispose();
});
test('incomplete or wrong-quality accurate products fail closed; exact-hour snapshot uses stored flags',async()=>{
  const broken=structuredClone(published);broken.monthly['2026-12'].sunVisible.pop();
  assert.throws(()=>validateProduct(broken,selection,'accurate'));
  assert.throws(()=>validateProduct(estimate(),selection,'accurate'));
  const snapshot=productSnapshot(published,selection.startUtc);
  assert.equal(snapshot.bodies.sun.centerVisible,Boolean(published.monthly['2026-12'].sunVisible[0]));
  assert.equal(productSnapshot(published,'2026-12-01T00:10:00Z').interpolated,true);
  const source=createForecastSource({quick:async()=>estimate(),accurate:async()=>broken});
  const events:any[]=[];await source.load(selection,(e:any)=>events.push(e));
  assert.equal(events.at(-1).quality,'estimate');assert.equal(events.at(-1).reason,'unavailable');source.dispose();
});


test('geometric playback rejects missing coverage and invalid directions',()=>{
  const p:any=structuredClone(published);
  p.geometry={start:selection.startUtc,stepMinutes:60,subsolarLat:[0],subsolarLon:[0],subEarthLat:[0],subEarthLon:[0]};
  assert.throws(()=>validateProduct(p,selection,'accurate'),/coverage/);
  p.geometry.subsolarLat[0]=91;
  assert.throws(()=>validateProduct(p,selection,'accurate'),/directions/);
});

test('replacement feedback uses strict half-hour and ten-minute thresholds',()=>{
  const p=structuredClone(published),a=estimate(),d=p.index.days[0];
  d.sunHours=a.index.days[0].sunHours+.5;
  d.sunrise=['2026-12-01T02:10:00Z'];a.index.days[0].sunrise=['2026-12-01T02:00:00Z'];
  assert.deepEqual(meaningfulChanges(a,p),[]);
  d.sunrise=['2026-12-01T02:10:01Z'];assert.deepEqual(meaningfulChanges(a,p),[d.date]);
});


test('minute interpolation wraps directions and follows published events rather than rounded terrain',()=>{
  const p:any=structuredClone(published),m=p.monthly['2026-12'];
  m.sunAz[0]=359;m.sunAz[1]=1;m.sunEl[0]=m.sunEl[1]=10;
  p.index.days[0].sunUpAt0=false;p.index.days[0].sunrise=['2026-12-01T00:20:00Z'];p.index.days[0].sunset=['2026-12-01T00:40:00Z'];
  const before=productSnapshot(p,'2026-12-01T00:19:00Z'),at=productSnapshot(p,'2026-12-01T00:20:00Z'),middle=productSnapshot(p,'2026-12-01T00:30:00Z'),after=productSnapshot(p,'2026-12-01T00:41:00Z');
  assert.equal(before.bodies.sun.centerVisible,false);assert.equal(at.bodies.sun.centerVisible,false);
  assert.equal(middle.bodies.sun.centerVisible,true);assert.equal(after.bodies.sun.centerVisible,false);
  assert.ok(Math.min(middle.bodies.sun.azimuthDeg,360-middle.bodies.sun.azimuthDeg)<1e-6);
  assert.equal(middle.interpolated,true);assert.equal(middle.instantUtc,'2026-12-01T00:30:00.000Z');
  assert.throws(()=>productSnapshot(p,'2026-12-01T00:30:01Z'));
});
test('minute interpolation reads next-month endpoints and never extrapolates beyond coverage',async()=>{
  const p:any=structuredClone(published);
  p.monthly['2027-01']=await read('forecast/apollo-11/2027-01.json');
  p.geometryMonthly={'2026-12':await read('sun/2026-12.json'),'2027-01':await read('sun/2027-01.json')};
  const utc='2026-12-31T23:59:00Z';assert.equal(productSnapshot(p,utc).interpolated,true);
  for(const vector of Object.values(productMoonDirections(p,utc)) as number[][]) assert.ok(Math.abs(Math.hypot(...vector)-1)<1e-10);
  delete p.monthly['2027-01'];assert.throws(()=>productSnapshot(p,utc),/endpoint/);
  p.monthly['2027-11']=await read('forecast/apollo-11/2027-11.json');
  assert.throws(()=>productSnapshot(p,'2027-11-30T23:59:00Z'),/coverage end/);
});
test('minute selections retain accurate priority',async()=>{
  const source=createForecastSource({quick:async()=>estimate(),accurate:async()=>published});
  const accepted=await source.load({...selection,instantUtc:'2026-12-01T13:37:00Z'},()=>{});
  assert.equal(accepted.quality,'accurate');assert.equal(productSnapshot(accepted.data,accepted.selection.instantUtc).interpolated,true);source.dispose();
});

test('accurate selected instant wins even when the preloaded range extends beyond saved coverage',async()=>{
  let received:any;
  const source=createForecastSource({accurate:async(s:any)=>{received=s;return published;},quick:async()=>{throw new Error('fixture');}});
  const result=await source.load({...selection,instantUtc:'2026-12-02T13:37:00Z',startUtc:'2026-11-30T00:00:00Z'},()=>{});
  assert.equal(received.startUtc,'2026-12-01T00:00:00Z');assert.equal(result.quality,'accurate');source.dispose();
});
