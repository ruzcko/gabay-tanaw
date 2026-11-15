import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {QuickEngine} from '../src/quick/engine.ts';
import {Terrain,forecastHorizonBins,traceForecastHorizon,traceHorizon,maskAt} from '../src/quick/terrain.ts';
import {buildQuickForecast} from '../src/quick/forecast.ts';
import {referenceSample} from './fixtures/terrain-sampler-reference.ts';

const read=async(url:URL)=>{const b=await readFile(url);return b.buffer.slice(b.byteOffset,b.byteOffset+b.length) as ArrayBuffer;};
test('source-data warmup does not compute forecasts or change later results across locations and dates',async()=>{
  const warm=new QuickEngine(read),cold=new QuickEngine(read),input={lat:-89,lon:0,startUtc:'2027-02-26T00:00:00Z',endUtc:'2027-03-06T00:00:00Z'};
  await assert.rejects(()=>warm.warmup(input,{signal:AbortSignal.abort()}));
  await assert.rejects(()=>warm.warmup({...input,startUtc:'2027-02-26T01:00:00Z'}));
  await warm.warmup(input);
  assert.equal(warm['forecasts'].size,0);assert.equal(warm['forecastHorizons'].size,0);assert.equal(warm['sampled'],undefined);
  for(const selection of [input,{lat:20,lon:250,startUtc:'2028-02-27T00:00:00Z',endUtc:'2028-03-03T00:00:00Z'}]) {
    const actual=await warm.forecast(selection),expected=await cold.forecast(selection);
    assert.deepEqual(actual.index,expected.index);assert.deepEqual(actual.monthly,expected.monthly);
  }
});
test('forecast cache is isolated and date changes reuse exact rays without stale products',async()=>{
  const engine=new QuickEngine(read),input={lat:20,lon:250,startUtc:'2027-02-26T00:00:00Z',endUtc:'2027-03-06T00:00:00Z'};
  const first=await engine.forecast(input),expected=structuredClone(first.index);
  first.index.days.length=0;
  const warm=await engine.forecast(input);assert.deepEqual(warm.index,expected);assert.equal(warm.timings.forecastCacheHit,true);
  await assert.rejects(()=>engine.forecast(input,{signal:AbortSignal.abort()}));
  const changed={...input,startUtc:'2027-02-27T00:00:00Z',endUtc:'2027-03-07T00:00:00Z'},
    reused=await engine.forecast(changed),cold=await new QuickEngine(read).forecast(changed);
  assert.deepEqual(reused.index,cold.index);assert.deepEqual(reused.monthly,cold.monthly);
  assert.ok(reused.timings.horizonRays<cold.timings.horizonRays);
  const bound=await engine.visibilityBound(input);assert.ok(bound.horizonLowerBoundDeg<0);
  const originalSample=engine['forecastSamples'];engine['forecastSamples']=()=>{throw Error('must reuse bound');};
  assert.deepEqual({...await engine.visibilityBound(input),totalMs:0},{...bound,totalMs:0});engine['forecastSamples']=originalSample;
  if(bound.earthAlwaysDown)assert.ok(expected.days.every(d=>d.earthHours===0));
  assert.equal(bound.earthAlwaysDown,true);
});
test('demand horizon uses both interpolation neighbours including north seam and fails closed on missing rays',async()=>{
  const values=new Float64Array([359.999,0,0,0,0,0,0,0,90.01,0,0,0,180,0,0,0]);
  assert.deepEqual(forecastHorizonBins(values),[0,1,360,361,720,721,1439]);
  let samples=0;const terrain={sample:()=>{samples++;return 0;}},bins=forecastHorizonBins(values);
  const sparse=await traceForecastHorizon(terrain,0,0,bins);
  assert.equal(samples,1+bins.length*2500);assert.equal(sparse.azimuthBins?.length,7);
  const full=await traceHorizon({sample:()=>0},0,0);
  for(const bin of bins)assert.equal(sparse.calculation.elevations[bin],full.calculation.elevations[bin]);
  assert.equal(maskAt(sparse.calculation.elevations,359.999),maskAt(full.calculation.elevations,359.999));
  assert.throws(()=>maskAt(sparse.calculation.elevations,45),/not computed/);
  const missing=new Float64Array(145*8);for(let i=0;i<145;i++){missing[i*8]=45;missing[i*8+4]=45;}
  assert.throws(()=>buildQuickForecast({lat:0,lon:0},0,86400000,missing,sparse,[]),/not computed/);
  for(const bad of [[],[-1],[1440],[1.5],[NaN]])await assert.rejects(()=>traceForecastHorizon(terrain,0,0,bad));
});

test('forecast-only days, event instants and monthly values exactly match full horizons over representative sites and dates',async()=>{
  const full=new QuickEngine(read),fast=new QuickEngine(read);
  full.terrain.sample=(x,y,z)=>referenceSample(full.terrain,x,y,z);
  Object.defineProperty(full.terrain,'maximumElevation',{get:()=>Infinity});
  full.terrain.upperBound=()=>Infinity; // Keep the legacy reference free of both pruning paths.
  const cases=[
    {lat:20,lon:250,startUtc:'2027-02-26T00:00:00Z',endUtc:'2027-03-06T00:00:00Z'},
    {lat:-85.76557440076725,lon:358.3175527668766,startUtc:'2027-02-26T00:00:00Z',endUtc:'2027-03-06T00:00:00Z'},
    {lat:-89.4398,lon:222.83,startUtc:'2027-01-01T00:00:00Z',endUtc:'2027-01-08T00:00:00Z'},
    {lat:-87.49,lon:180,startUtc:'2028-02-27T00:00:00Z',endUtc:'2028-03-03T00:00:00Z'},
    {lat:89.9,lon:359.999,startUtc:'2028-01-01T00:00:00Z',endUtc:'2028-01-03T00:00:00Z'},
    {lat:0,lon:0,startUtc:'1969-01-01T00:00:00Z',endUtc:'1969-01-02T00:00:00Z'},
    {lat:0,lon:180,startUtc:'2100-12-31T00:00:00Z',endUtc:'2101-01-01T00:00:00Z'},
  ];
  for(const input of cases) {
    const original=await full.run(input),optimized=await fast.forecast(input);
    assert.deepEqual(optimized.index.days,original.index.days,JSON.stringify(input));
    assert.deepEqual(optimized.monthly,original.monthly);
    const strip=(index:any)=>{const copy=structuredClone(index);delete copy.science.horizonSha256;delete copy.science.horizonCoverage;return copy;};
    assert.deepEqual(strip(optimized.index),strip(original.index));
    assert.equal(optimized.index.science.horizonCoverage?.['kind'],'requested-azimuth-bins');
    assert.ok(optimized.timings.horizonRays<1440);assert.ok(optimized.timings.horizonRays>0);
    const bins=(optimized.index.science.horizonCoverage as {bins:number[]}).bins;
    const sparse=await traceForecastHorizon(fast.terrain,input.lat,input.lon,bins);
    for(const bin of bins)assert.equal(sparse.calculation.elevations[bin],original.horizon.calculation.elevations[bin]);
    if(input.lat===20||input.lat===-89.4398) {
      const pruned=await traceHorizon(fast.terrain,input.lat,input.lon);
      assert.equal(pruned.sha256,original.horizon.sha256,'All 1440 pruned rays equal the original unpruned horizon');
    }
  }
});

test('exact terrain ceiling skips only rays beyond a provably lower upper envelope',async()=>{
  let samples=0;
  const optimized=await traceHorizon({sample:()=>{samples++;return 0;},maximumElevation:0},0,0);
  const reference=await traceHorizon({sample:()=>0},0,0);
  assert.deepEqual(optimized.calculation.elevations,reference.calculation.elevations);
  assert.equal(optimized.sha256,reference.sha256);assert.ok(samples<1440*2500/20);
  // Below-sea-level observer and an elevated plateau test both sides of the envelope maximum.
  for(const height of [-5000,5000]) {
    const a=await traceHorizon({sample:()=>height,maximumElevation:height},20,360);
    const b=await traceHorizon({sample:()=>height},20,0);
    assert.equal(a.sha256,b.sha256);
  }
});

test('forecast-only rejects cancellation and invalid bounds; a full cached horizon stays valid for display',async()=>{
  const engine=new QuickEngine(read),input={lat:0,lon:10,startUtc:'2027-01-01T00:00:00Z',endUtc:'2027-01-02T00:00:00Z'};
  await assert.rejects(()=>engine.forecast(input,{signal:AbortSignal.abort()}));
  await assert.rejects(()=>engine.forecast({...input,startUtc:'2027-01-01T01:00:00Z'}));
  await assert.rejects(()=>engine.forecast({...input,endUtc:'2026-01-01T00:00:00Z'}));
  const fast=await engine.forecast(input),full=await engine.run(input),cached=await engine.forecast(input);
  assert.ok(full.horizon.calculation.elevations.every(Number.isFinite));
  assert.deepEqual(fast.index.days,full.index.days);assert.deepEqual(cached.index.days,full.index.days);
  assert.equal(cached.timings.horizonRays,0);assert.equal(cached.timings.forecastCacheHit,true);
  assert.deepEqual(cached.index,fast.index);
});


test('partial terrain loads cannot bound unseen pixels; eager Travel preparation restores exact bounds',async()=>{
  const input={lat:-89.44,lon:222.83,startUtc:'2027-02-26T00:00:00Z',endUtc:'2027-03-06T00:00:00Z'};
  const terrain=new Terrain(read);
  await terrain.prepare(input.lat,input.lon,undefined,true);
  assert.equal(terrain.maximumElevation,Infinity);assert.equal(terrain.minimumElevation,-Infinity);
  const bins=[0,1,360,361,720,721,1439];
  const partial=await traceForecastHorizon(terrain,input.lat,input.lon,bins);
  assert.equal(terrain.maximumElevation,Infinity);assert.equal(terrain.minimumElevation,-Infinity);
  await terrain.prepare(input.lat,input.lon);
  assert.ok(Number.isFinite(terrain.maximumElevation));assert.ok(Number.isFinite(terrain.minimumElevation));
  const eager=await traceForecastHorizon(terrain,input.lat,input.lon,bins);
  assert.equal(partial.sha256,eager.sha256);
  await assert.rejects(()=>traceForecastHorizon(terrain,input.lat,input.lon,bins,AbortSignal.abort()),{code:'ABORTED'});
  // Observer's sparse tile cache must not weaken Travel's always-down proof or forecasts.
  const reused=new QuickEngine(read),fresh=new QuickEngine(read);
  await reused.run(input);
  const stripTiming=({totalMs,...bound}:Awaited<ReturnType<QuickEngine['visibilityBound']>>)=>bound;
  assert.deepEqual(stripTiming(await reused.visibilityBound(input)),stripTiming(await fresh.visibilityBound(input)));
  const actual=await reused.forecast(input),expected=await fresh.forecast(input);
  assert.deepEqual(actual.index.days,expected.index.days);assert.deepEqual(actual.monthly,expected.monthly);
});
