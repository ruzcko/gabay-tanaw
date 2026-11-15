import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createComputationEngine, createLatestObserver, validateSite, parseUtc, validateWindow, validateModel,
  azElToEnu, enuToRenderer, localEnuBasis, observerAltitudeKm, ComputationError, toObserverViewSnapshot } from '../src/index.ts';
import { createHorizonsProvider, createSerialQueue, parseHorizons, buildHorizonsParameters } from '../src/horizons.ts';
import { createHttpEphemerisProvider } from '../src/http.ts';
import { createObservationHandler } from '../src/server.ts';
import type { HorizonsQuery, HorizonsResult } from '../src/horizons.ts';
import type { ObserverSnapshot } from '../src/contracts.ts';
import { QUICK_RANGE } from '../src/quick/coverage.ts';
const fixtureDir=new URL('../fixtures/',import.meta.url);
const fixture=JSON.parse(await readFile(new URL('near-side-10-observer.json',fixtureDir),'utf8')) as {query:HorizonsQuery;result:HorizonsResult};
const snapshot=JSON.parse(await readFile(new URL('near-side-snapshot.json',fixtureDir),'utf8')) as ObserverSnapshot;
const site=snapshot.site, instantUtc=snapshot.instantUtc;
const userAgent='TanawTest/0.1 (https://github.com/ruzcko/gabay-tanaw)';
const response=()=>new Response(fixture.result.provenance.rawResponse,{headers:{'content-type':'application/json'}});
const query=fixture.query;
const code=(wanted:string)=>(e:unknown)=>e instanceof ComputationError && e.code===wanted;

test('coordinate units, datum and exact-pole rejection',()=>{
  assert.equal(validateSite({...site,longitudeEastDeg:-361}).longitudeEastDeg,359);
  assert.equal(observerAltitudeKm(site),0.102);
  assert.throws(()=>validateSite({...site,referenceFrame:'IAU_MOON'}),code('INCOMPATIBLE_FRAME'));
  assert.throws(()=>validateSite({...site,elevationDatum:'mean-sea-level'}),code('INCOMPATIBLE_FRAME'));
  assert.throws(()=>validateSite({...site,latitudeDeg:90}),code('UNSUPPORTED'));
  assert.throws(()=>validateSite({...site,observerHeightM:-1}),code('INVALID_INPUT'));
  assert.throws(()=>validateSite({...site,longitudeEastDeg:NaN}),code('INVALID_INPUT'));
  const [e,n,u]=localEnuBasis({...site,latitudeDeg:35,longitudeEastDeg:123});
  const dot=(a:readonly number[],b:readonly number[])=>a.reduce((s,v,i)=>s+v*b[i],0);
  assert.ok(Math.abs(dot(e,n))<1e-14 && Math.abs(dot(n,u))<1e-14 && Math.abs(dot(e,e)-1)<1e-14);
  assert.deepEqual(azElToEnu(0,0),[0,1,0]);
  assert.deepEqual(enuToRenderer([0,1,0]),[0,0,-1]);
});
test('UTC validation, defaults, caps and model validation',()=>{
  for(const utc of ['2026-02-30T00:00:00Z','2026-01-01','2026-01-01T24:00:00Z','2016-12-31T23:59:60Z']) assert.throws(()=>parseUtc(utc));
  assert.throws(()=>parseUtc('1960-01-01T00:00:00Z'),code('UNSUPPORTED'));
  assert.equal(validateWindow(instantUtc).durationDays,7);
  assert.throws(()=>validateWindow(instantUtc,101),code('LIMIT_EXCEEDED'));
  assert.equal(validateWindow(instantUtc,101,120).durationDays,101);
  assert.throws(()=>validateModel({horizon:'reference',sunVisibility:'center',earthVisibility:'center',minimumEarthElevationDeg:91,eventToleranceSeconds:1}),code('INVALID_INPUT'));
});

test('generic windows never accept an endpoint that their observation APIs reject',()=>{
  const start=new Date(QUICK_RANGE.end-86400000).toISOString();
  assert.throws(()=>validateWindow(start,1),code('UNSUPPORTED'));
  const window=validateWindow(start,1-1/86400000);
  assert.equal(parseUtc(window.endUtc),QUICK_RANGE.end-1);
  assert.throws(()=>parseUtc(new Date(QUICK_RANGE.end).toISOString()),code('UNSUPPORTED'));
  assert.equal(parseUtc(new Date(QUICK_RANGE.end).toISOString(),true),QUICK_RANGE.end);
});
test('all captured direct-source fixtures round-trip by named headers',async()=>{
  const manifest=JSON.parse(await readFile(new URL('manifest.json',fixtureDir),'utf8'));
  for(const entry of manifest.cases) {
    const f=JSON.parse(await readFile(new URL(entry.file,fixtureDir),'utf8'));
    const record=f.result.provenance;
    const parsed=parseHorizons(record.rawResponse,f.query,record.parameters,record.retrievedAtUtc);
    assert.deepEqual(parsed,f.result);
    const raw=JSON.parse(record.rawResponse).result as string;
    const header=raw.split('$$SOE')[0].split('\n').find(l=>l.startsWith('Date_________JDUT,'));
    if(header) {
      const names=header.split(',').map(s=>s.trim()), row=raw.split('$$SOE')[1].trim().split('\n')[0].split(',').map(s=>s.trim());
      assert.equal(parsed.observerSamples[0].rangeKm,Number(row[names.indexOf('delta')]));
      assert.equal(parsed.observerSamples[0].angularDiameterDeg,Number(row[names.indexOf('Ang-diam')])/3600);
      assert.ok(Math.abs(parsed.observerSamples[0].azimuthDeg-Number(row[names.indexOf('Azimuth_(a-app)')]))<1e-10);
      assert.equal(parsed.observerSamples[0].elevationDeg,Number(row[names.indexOf('Elevation_(a-app)')]));
    }
  }
});
test('parser rejects corrupted scientific metadata and missing, duplicate, unordered samples',()=>{
  const p=fixture.result.provenance;
  const mutations=[
    (s:string)=>s.replace('Sun (10)','Earth (399)'),
    (s:string)=>s.replace('Moon (301)','Mars (499)'),
    (s:string)=>s.replace('1737.4, 1737.4, 1737.4','1738.0, 1738.0, 1738.0'),
    (s:string)=>s.replace('MEAN_ME (high precision)','IAU_MOON'),
    (s:string)=>s.replace('NO (AIRLESS)','YES (REFRACTED)'),
    (s:string)=>s.replace('Units: KM and KM/S','Units: AU and AU/D'),
    (s:string)=>s.replace('Azimuth_(a-app)','Unrecognized'),
    (s:string)=>s.replace('version":"1.2','version":"99.0'),
    (s:string)=>{const j=JSON.parse(s);const [before,rest]=j.result.split('$$SOE');const [table,after]=rest.split('$$EOE');const rows=table.trim().split('\n');j.result=before+'$$SOE\n'+rows.slice(1).join('\n')+'\n$$EOE'+after;return JSON.stringify(j);},
    (s:string)=>{const j=JSON.parse(s);const [before,rest]=j.result.split('$$SOE');const [table,after]=rest.split('$$EOE');const rows=table.trim().split('\n');j.result=before+'$$SOE\n'+[rows[0],rows[0]].join('\n')+'\n$$EOE'+after;return JSON.stringify(j);},
    (s:string)=>{const j=JSON.parse(s);const [before,rest]=j.result.split('$$SOE');const [table,after]=rest.split('$$EOE');j.result=before+'$$SOE\n'+table.trim().split('\n').reverse().join('\n')+'\n$$EOE'+after;return JSON.stringify(j);}
  ];
  for(const mutate of mutations) assert.throws(()=>parseHorizons(mutate(p.rawResponse),query,p.parameters,p.retrievedAtUtc),code('INVALID_RESPONSE'));
  assert.throws(()=>parseHorizons('{',query,p.parameters,p.retrievedAtUtc),code('INVALID_RESPONSE'));
});
test('cache includes altitude, correction kind and time; IDs do not alter science',()=>{
  const key=(q:HorizonsQuery)=>JSON.stringify(buildHorizonsParameters(q));
  assert.equal(key(query),key({...query,site:{...query.site,id:'other'}}));
  assert.notEqual(key(query),key({...query,site:{...query.site,observerHeightM:3}}));
  assert.notEqual(key(query),key({...query,kind:'geometric'}));
});
test('deduplication, independent cancellation and mutation-safe cache',async()=>{
  let count=0, release!:()=>void;
  const wait=new Promise<void>(r=>{release=r;});
  const provider=createHorizonsProvider({userAgent,fetch:async()=>{count++;await wait;return response();}});
  const controller=new AbortController();
  const cancelled=provider.query({...query,signal:controller.signal});
  const kept=provider.query(query); controller.abort();
  await assert.rejects(cancelled,code('ABORTED')); release();
  const result=await kept; result.observerSamples[0].rangeKm=0;
  assert.equal(count,1);
  assert.ok((await provider.query(query)).observerSamples[0].rangeKm>0);
  assert.equal(count,1);
});
test('abort all subscribers aborts transport and permits a new request',async()=>{
  let calls=0;
  const provider=createHorizonsProvider({userAgent,fetch:async(_url,init)=>{
    calls++; if(calls>1)return response();
    return new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
  }});
  const controller=new AbortController(), pending=provider.query({...query,signal:controller.signal});
  await new Promise(r=>setTimeout(r,5)); controller.abort();
  await assert.rejects(pending,code('ABORTED'));
  assert.equal((await provider.query(query)).observerSamples.length,2);
});
test('bounded retries and response limits',async()=>{
  let count=0;
  const provider=createHorizonsProvider({userAgent,retryBaseMs:0,fetch:async()=>++count<3?new Response('',{status:503}):response()});
  await provider.query(query);assert.equal(count,3);
  const bad=createHorizonsProvider({userAgent,maximumResponseBytes:10,fetch:async()=>response()});
  await assert.rejects(bad.query(query),code('LIMIT_EXCEEDED'));
  const invalid=createHorizonsProvider({userAgent,fetch:async()=>new Response('bad',{headers:{'content-type':'text/html'}})});
  await assert.rejects(invalid.query(query),code('INVALID_RESPONSE'));
  const timeout=createHorizonsProvider({userAgent,timeoutMs:5,retries:0,fetch:async(_url,init)=>new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))))});
  await assert.rejects(timeout.query(query),code('TIMEOUT'));
});
test('live adapter public observe API replays direct-source sample snapshot',async()=>{
  let calls=0;
  const provider=createHorizonsProvider({userAgent,fetch:async(url)=>{
    calls++;const target=new URL(String(url)).searchParams.get('COMMAND');
    const record=snapshot.provenance.records.find(r=>`'${r.parameters.COMMAND}'`===target)!;
    return new Response(record.rawResponse,{headers:{'content-type':'application/json'}});
  }});
  const result=await createComputationEngine({ephemerisProvider:provider}).observe({site,instantUtc});
  assert.deepEqual(result.bodies,snapshot.bodies);assert.equal(calls,2);
  assert.equal(result.capabilities.earthBodyToLocal.status,'unsupported');
  await provider.observe({site,instantUtc});assert.equal(calls,2);
});
test('latest observer rejects stale results even when provider ignores cancellation',async()=>{
  let release!:(v:ObserverSnapshot)=>void, count=0;
  const latest=createLatestObserver({observe:async()=>++count===1?new Promise(r=>{release=r;}):snapshot});
  const old=latest({site,instantUtc});const newest=await latest({site,instantUtc});
  assert.equal(newest,snapshot);release(snapshot);await assert.rejects(old,code('STALE'));
});
test('browser client to backend handler through normal public API',async()=>{
  const handler=createObservationHandler({observe:async()=>snapshot});
  const client=createHttpEphemerisProvider('https://tanaw.test/api/observation',async(url,init)=>handler(new Request(url,init)));
  const result=await createComputationEngine({ephemerisProvider:client}).observe({site,instantUtc});
  assert.deepEqual(result.bodies,snapshot.bodies);
  assert.equal((await handler(new Request('https://tanaw.test',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}))).status,400);
});
test('all seven source snapshots pass the existing renderer validator through explicit longitude bridge',async(t)=>{
  if (!existsSync(new URL('../../observer/math.js',import.meta.url))) {
    t.skip('Optional observer module is developed on its own branch'); return;
  }
  const { validateSnapshot: validateViewSnapshot } = await import('../../observer/math.js');
  for(const name of ['near-side','far-side-north','south-polar','north-wrap','limb-south','sun-horizon','earth-horizon']) {
    const value=JSON.parse(await readFile(new URL(`${name}-snapshot.json`,fixtureDir),'utf8'));
    const bridged=toObserverViewSnapshot(value);
    assert.deepEqual(validateViewSnapshot(bridged).bodies,value.bodies);
    assert.ok(bridged.site.longitudeEastDeg>=-180 && bridged.site.longitudeEastDeg<180);
  }
});
test('shared queue serializes independent provider instances',async()=>{
  let active=0,peak=0;
  const queue=createSerialQueue(),transport:typeof fetch=async()=>{
    active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return response();
  };
  const a=createHorizonsProvider({userAgent,queue,fetch:transport}),b=createHorizonsProvider({userAgent,queue,fetch:transport});
  await Promise.all([a.query(query),b.query(query)]);assert.equal(peak,1);
});
test('series defaults and limits are enforced before network work',async()=>{
  const provider=createHorizonsProvider({userAgent,fetch:async()=>{throw Error('must not fetch');}});
  await assert.rejects(provider.series({site,startUtc:instantUtc,target:10,durationDays:101}),code('LIMIT_EXCEEDED'));
  await assert.rejects(provider.series({site,startUtc:instantUtc,target:10,stepSeconds:1}),code('LIMIT_EXCEEDED'));
});
test('default seven-day series replays 169 validated source samples in six bounded requests',async()=>{
  const f=JSON.parse(await readFile(new URL('near-side-seven-day-series.json',fixtureDir),'utf8'));
  let calls=0;
  const provider=createHorizonsProvider({userAgent,fetch:async(url)=>{
    const params=new URL(String(url)).searchParams;
    const r=f.results.find((r:HorizonsResult)=>r.provenance.parameters.TLIST===params.get('TLIST'));
    assert.ok(r,'Exact scientific parameters must match a captured source request');calls++;
    return new Response(r.provenance.rawResponse,{headers:{'content-type':'application/json'}});
  }});
  const results=await provider.series(f.request),samples=results.flatMap(r=>r.observerSamples);
  assert.equal(calls,6);assert.equal(samples.length,169);
  assert.equal(samples[0].instantUtc,'2026-11-14T00:00:00.000Z');
  assert.equal(samples.at(-1)!.instantUtc,'2026-11-21T00:00:00.000Z');
  for(let i=1;i<samples.length;i++)assert.equal(Date.parse(samples[i].instantUtc)-Date.parse(samples[i-1].instantUtc),3600000);
  await provider.series(f.request);assert.equal(calls,6,'Warm cache requires no new source requests');
});
