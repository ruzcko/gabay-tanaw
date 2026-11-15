import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createTravelPlanner,createTravelSource} from '../src/travel.ts';
import type {LandingSource,LandingForecast,CandidateProgress} from '../src/travel.ts';

const flat={slopeDeg:2,baselineM:100,resolutionM:20,source:'synthetic test only'},point={lat:20,lon:35},date='2027-01-01T00:00:00Z';
test('discovery validates rejection proofs and strict published unknowns never use quick rejection',async()=>{
  let checks=0,forecasts=0;
  const base=source({precheck:async(_p,_a,_b,c)=>{checks++;return {kind:'always-below-terrain-bound',body:'earth',maximumVisibleHours:0,
    minimumOutageHours:c.durationDays*24,horizonLowerBoundDeg:-5,quality:'estimate'};},forecast:async()=>{forecasts++;return null;}});
  const options={southTarget:0,elsewhereTarget:1,maxElsewhereSamples:1};
  const r=await createTravelPlanner(base).discover(date,{durationDays:1/1440},options);
  assert.equal(forecasts,0);assert.equal(r.visibilityRejected.earth,1);assert.equal(r.samples[0].result,null);assert.ok(r.samples[0].rejection);
  checks=0;const strict=await createTravelPlanner(base,{sourcePolicy:'published-only'}).discover(date,{},options);
  assert.equal(checks,0);assert.equal(strict.samples[0].status,'unknown');
  await assert.rejects(()=>createTravelPlanner({...base,precheck:async()=>({kind:'always-below-terrain-bound',body:'earth',maximumVisibleHours:0,
    minimumOutageHours:Infinity,horizonLowerBoundDeg:-5,quality:'estimate'})}).discover(date,{},options),/Invalid candidate rejection/);
});

test('real source rejects only proven darkness, preserves Python priority, and reclassifies cached filters',async()=>{
  const read=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
  const s=createTravelSource({read}),p={lat:20,lon:250},start='2027-02-26T01:47:00Z',durationDays=1/1440,
    planner=createTravelPlanner(s),relaxed={durationDays,terrainEnabled:false,sunlightEnabled:false,earthEnabled:false};
  const pass=await planner.evaluate(p,start,relaxed);assert.equal(pass.status,'pass');
  const fail=await planner.evaluate(p,start,{...relaxed,earthEnabled:true,minEarthFraction:1});assert.equal(fail.status,'fail');
  const criteria=fail.criteria,end=new Date(Date.parse(start)+durationDays*86400000).toISOString();
  const proof=await s.precheck!(p,start,end,criteria);assert.equal(proof?.body,'earth');assert.equal(proof?.minimumOutageHours,durationDays*24);
  assert.equal(fail.earth?.hours,0);
  assert.equal(await s.precheck!(p,start,end,pass.criteria),null);
  const sites=JSON.parse(await readFile(new URL('../../data/sites.json',import.meta.url),'utf8'));
  assert.equal(await s.precheck!(sites[0],start,end,criteria),null);
  const injected=createTravelSource({read,accurate:async()=>null});assert.equal(await injected.precheck!(p,start,end,criteria),null);
});
function source(extra:Partial<LandingSource>={}):LandingSource {
  return {terrain:async()=>({...flat}),forecast:async(p,a,b,q)=>{
    const days:LandingForecast['days']=[];
    for(let t=Date.parse(a);t<Date.parse(b);t+=86400000)days.push({date:new Date(t).toISOString().slice(0,10),sunHours:24,earthHours:24,
      sunrise:[],sunset:[],earthrise:[],earthset:[],sunUpAt0:true,earthUpAt0:true,nextSunEvent:null,nextEarthEvent:null});
    return {...p,window:{start:a,end:b},quality:q,days,science:{referenceFrame:'MOON_ME_DE421',elevationDatum:'sphere-1737400m',visibility:'center'}};
  },...extra};
}

test('published-preferred policy explicitly labels fallback; strict policy preserves unknown',async()=>{
  const calls:string[]=[],base=source(),fallback=source({forecast:async(p,a,b,q,s)=>{calls.push(q);return q==='accurate'?null:base.forecast(p,a,b,q,s);}});
  const r=await createTravelPlanner(fallback).evaluate(point,date);
  assert.equal(r.status,'pass');assert.deepEqual(calls,['accurate','estimate']);assert.equal(r.sourcePolicy,'prefer-published');
  assert.equal(r.segments[0].requestedQuality,'accurate');assert.equal(r.segments[0].quality,'estimate');
  assert.equal(r.segments[0].reason,'published-unavailable');assert.ok(r.guidance.some(x=>x.includes('labelled quick estimate')));
  calls.length=0;const strict=await createTravelPlanner(fallback,{sourcePolicy:'published-only'}).evaluate(point,date);
  assert.equal(strict.status,'unknown');assert.deepEqual(calls,['accurate']);
  calls.length=0;await createTravelPlanner(fallback).windows(point,date,{}, {stepHours:168});assert.deepEqual(calls,['accurate','estimate']);
});

test('published forecasts are preferred; invalid products and source failures never trigger fallback',async()=>{
  const calls:string[]=[],base=source();
  const p=createTravelPlanner(source({forecast:async(...args)=>{calls.push(args[3]);return base.forecast(...args);}}));
  const r=await p.evaluate(point,date);assert.deepEqual(calls,['accurate']);assert.equal(r.segments[0].reason,'published');
  for(const bad of [async()=>{throw Error('network');},async()=>({...await base.forecast(point,date,'2027-01-08T00:00:00Z','accurate'),quality:'estimate'} as LandingForecast)]) {
    calls.length=0;await assert.rejects(()=>createTravelPlanner(source({forecast:async(...args)=>{calls.push(args[3]);return bad();}})).evaluate(point,date));
    assert.deepEqual(calls,['accurate']);
  }
});

test('discovery meets quotas with reproducible noncatalog whole-sphere random points and progress',async()=>{
  const progress:CandidateProgress[]=[],p=createTravelPlanner(source());
  const r=await p.discover(date,{}, {onProgress:x=>progress.push(x)}),repeat=await p.discover(date);
  assert.equal(r.stopReason,'targets-met');assert.deepEqual(r.found,{south:3,elsewhere:12});assert.deepEqual(r.shortfall,{south:0,elsewhere:0});
  assert.equal(r.samples.length,15);assert.deepEqual(r.samples.map(s=>s.point),repeat.samples.map(s=>s.point));
  assert.equal(new Set(r.samples.map(s=>JSON.stringify(s.point))).size,15);
  assert.ok(r.candidates.south.every(x=>x.point.lat>-90&&x.point.lat<-80));
  assert.ok(r.candidates.elsewhere.every(x=>x.point.lat>-80&&x.point.lat<90));
  assert.ok(r.candidates.elsewhere.some(x=>x.point.lon>90&&x.point.lon<270));
  assert.ok(progress.length>16);assert.deepEqual(progress[0].attempted,{south:0,elsewhere:0});assert.deepEqual(progress.at(-1)?.found,r.found);
  assert.equal(new Set(r.candidates.elsewhere.map(x=>Math.floor(x.point.lon/30))).size,12);
  assert.ok(progress.some(x=>x.current?.stage==='forecast'));
});

test('default terrain gate avoids all forecast work for unknown or steep screens and reports shortfalls',async()=>{
  let forecasts=0;const p=createTravelPlanner(source({terrain:async p=>({...flat,slopeDeg:p.lat<-80?20:null}),forecast:async()=>{forecasts++;throw Error('must not forecast');}}));
  const r=await p.discover(date,{}, {maxSouthSamples:4,maxElsewhereSamples:9});
  assert.equal(forecasts,0);assert.equal(r.stopReason,'sample-budget');assert.deepEqual(r.shortfall,{south:3,elsewhere:12});
  assert.deepEqual(r.terrainSkipped,{fail:4,unknown:9});assert.ok(r.samples.every(s=>s.result===null));
  assert.ok(r.guidance.some(x=>x.includes('20 m')));
});

test('south seeds count only after evaluation, consume budget and never duplicate a pass',async()=>{
  const seed={id:'test-south',lat:-89,lon:2},p=createTravelPlanner(source());
  const r=await p.discover(date,{}, {southSeeds:[seed],southTarget:1,elsewhereTarget:0});
  assert.equal(r.samples[0].sampling,'seed');assert.equal(r.candidates.south[0].point.id,seed.id);assert.equal(r.attempted.south,1);
  const failed=await createTravelPlanner(source({terrain:async()=>({...flat,slopeDeg:20})})).discover(date,{},
    {southSeeds:[seed],southTarget:1,elsewhereTarget:0,maxSouthSamples:1});
  assert.equal(failed.found.south,0);assert.equal(failed.shortfall.south,1);
  await assert.rejects(()=>p.discover(date,{}, {southSeeds:[seed,seed]}));
  await assert.rejects(()=>p.discover(date,{}, {southSeeds:[point]}));
});

test('disabled terrain stays unknown on visibility-only passes; enabled visibility failures never fill quotas',async()=>{
  const base=source(),p=createTravelPlanner(source({terrain:async()=>({...flat,slopeDeg:null})}));
  const r=await p.discover(date,{terrainEnabled:false});assert.equal(r.found.elsewhere,12);
  assert.ok(r.candidates.elsewhere.every(x=>x.checks.terrain==='unknown'&&!x.criteria.terrainEnabled));
  const dark=createTravelPlanner(source({forecast:async(...args)=>{const f=(await base.forecast(...args))!;f.days.forEach(d=>{d.sunUpAt0=false;d.sunHours=0;});return f;}}));
  const failed=await dark.discover(date,{}, {maxSouthSamples:2,maxElsewhereSamples:3});
  assert.deepEqual(failed.found,{south:0,elsewhere:0});assert.equal(failed.samples.length,5);
  assert.ok(failed.samples.every(s=>s.result?.checks.sunlight==='fail'));assert.equal(failed.criteria.minSunFraction,1);
});

test('candidate budgets, time limit and cancellation bound work',async()=>{
  const p=createTravelPlanner(source());
  for(const options of [{southTarget:-1},{maxElsewhereSamples:513},{seed:NaN},{maxElapsedMs:0}])await assert.rejects(()=>p.discover(date,{},options));
  const none=await p.discover(date,{}, {southTarget:0,elsewhereTarget:0});assert.equal(none.samples.length,0);
  const timed=await p.discover(date,{}, {maxElapsedMs:1,onProgress:()=>{const start=performance.now();while(performance.now()-start<3){}}});
  assert.equal(timed.stopReason,'time-budget');assert.equal(timed.samples.length,0);
  const controller=new AbortController();let seen=0;
  await assert.rejects(()=>p.discover(date,{}, {signal:controller.signal,onProgress:x=>{seen=x.attempted.south+x.attempted.elsewhere;if(seen)controller.abort();}}));
  assert.equal(seen,1);
});

test('real custom in-year point gets estimate provenance and cannot resolve global slope',async()=>{
  const reads=new Map<string,number>();
  const read=async(url:URL)=>{reads.set(url.pathname,(reads.get(url.pathname)??0)+1);const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
  const planner=createTravelPlanner(createTravelSource({read})),r=await planner.evaluate(point,date,{durationDays:1});
  assert.equal(r.segments[0].quality,'estimate');assert.equal(r.segments[0].reason,'published-unavailable');assert.ok(r.sunlight);
  assert.equal(r.checks.terrain,'unknown');assert.notEqual(r.status,'pass');
  await planner.discover(date,{}, {southTarget:0,maxElsewhereSamples:3});
  assert.equal([...reads].find(([path])=>path.endsWith('/landing-terrain.json'))?.[1],1);
});

test('streamed passes arrive before subsequent work and cursor pages never repeat earlier coordinates',async()=>{
  const order:string[]=[],base=source(),p=createTravelPlanner(source({forecast:async(...args)=>{order.push('forecast');return base.forecast(...args);}}));
  const emitted:any[]=[],first=await p.discover(date,{}, {onCandidate:e=>{order.push('candidate');emitted.push(e);e.result.status='fail';}});
  assert.deepEqual(order.slice(0,4),['forecast','candidate','forecast','candidate']);
  assert.equal(emitted.length,15);assert.ok(first.samples.every(s=>s.result?.status==='pass'));
  assert.ok(first.samples.slice(0,4).every(s=>s.group==='elsewhere'));
  const previous=first.samples.map(s=>s.point),keys=new Set(previous.map(p=>`${p.lat}:${p.lon}`));
  const next=await p.discover(date,{}, {cursor:first.cursor,exclude:previous});
  assert.equal(next.samples.length,15);assert.ok(next.samples.every(s=>!keys.has(`${s.point.lat}:${s.point.lon}`)));
  assert.equal(next.cursor.elsewhereOffset,24);assert.equal(next.cursor.southOffset,6);
  const retry=await p.discover(date,{}, {exclude:previous});
  assert.ok(retry.samples.every(s=>!keys.has(`${s.point.lat}:${s.point.lon}`)));assert.equal(retry.excluded.elsewhere,12);
  assert.ok(first.samples.every(s=>s.timings.totalMs>=s.timings.terrainMs&&s.timings.forecastMs>=0));
});

test('failing seeds cannot starve random south samples and excluded seeds are never evaluated',async()=>{
  const seeds=Array.from({length:32},(_,i)=>({id:`seed-${i}`,lat:-85,lon:i})),base=source();
  const p=createTravelPlanner(source({forecast:async(...args)=>{const f=(await base.forecast(...args))!;if(args[0].id)f.days.forEach(d=>d.sunUpAt0=false);return f;}}));
  const result=await p.discover(date,{}, {southSeeds:seeds,elsewhereTarget:0,maxSouthSamples:6});
  assert.equal(result.found.south,3);assert.equal(result.samples.filter(s=>s.sampling==='seed').length,3);
  const excluded=await p.discover(date,{}, {southSeeds:seeds,exclude:seeds,elsewhereTarget:0});
  assert.equal(excluded.found.south,3);assert.ok(excluded.samples.every(s=>s.sampling==='random'));
});

test('continuation validates seed/partition and preserves explicit fine-cap searches',async()=>{
  const p=createTravelPlanner(source()),first=await p.discover(date,{}, {southLatitudeLimit:-87.5});
  assert.ok(first.candidates.south.every(r=>r.point.lat<-87.5));
  for(const bad of [{cursor:{...first.cursor,seed:-1}},{cursor:first.cursor,seed:42},
    {cursor:first.cursor,southLatitudeLimit:-80},{cursor:{...first.cursor,elsewhereOffset:-1}},
    {exclude:[{lat:90,lon:0}]},{southLatitudeLimit:-90}])await assert.rejects(()=>p.discover(date,{},bad));
});

test('nearby exploration evaluates fresh points, alternates global strata and binds anchors to the cursor',async()=>{
  const anchor={id:'known',lat:-85,lon:359.99},p=createTravelPlanner(source());
  const result=await p.discover(date,{}, {southAnchors:[anchor],anchorRadiusKm:10,exclude:[anchor],elsewhereTarget:0,southTarget:3});
  assert.deepEqual(result.samples.map(s=>s.sampling),['nearby','random','nearby']);
  for(const sample of result.samples.filter(s=>s.sampling==='nearby')) {
    const rad=Math.PI/180,a=anchor.lat*rad,b=sample.point.lat*rad,dl=(sample.point.lon-anchor.lon)*rad;
    const distance=Math.acos(Math.max(-1,Math.min(1,Math.sin(a)*Math.sin(b)+Math.cos(a)*Math.cos(b)*Math.cos(dl))))*1737.4;
    assert.ok(distance>0&&distance<=10);assert.equal(sample.result?.status,'pass');assert.equal(sample.point.id,undefined);
  }
  await assert.rejects(()=>p.discover(date,{}, {cursor:result.cursor}));
  const next=await p.discover(date,{}, {cursor:result.cursor,southAnchors:[anchor],exclude:result.samples.map(s=>s.point)});
  assert.equal(next.found.south,3);
  await assert.rejects(()=>p.discover(date,{}, {southAnchors:[point]}));
  const broad=await p.discover(date,{}, {southAnchors:[anchor],elsewhereTarget:0,southTarget:24});
  assert.equal(new Set(broad.samples.filter(s=>s.sampling==='random').map(s=>Math.floor(s.point.lon/30))).size,12);
});

test('stratification and non-repeating continuation work for arbitrary uint32 seeds',async()=>{
  for(const seed of [0,7,42,0xffffffff]) {
    const p=createTravelPlanner(source()),first=await p.discover(date,{}, {seed}),next=await p.discover(date,{}, {cursor:first.cursor});
    const keys=new Set(first.samples.map(s=>JSON.stringify(s.point)));
    assert.equal(first.found.elsewhere,12);assert.equal(new Set(first.candidates.elsewhere.map(r=>Math.floor(r.point.lon/30))).size,12);
    assert.ok(next.samples.every(s=>!keys.has(JSON.stringify(s.point))));
  }
});
