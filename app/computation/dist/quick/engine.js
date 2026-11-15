import { parseUtc, requireCondition, sameLongitude, throwIfAborted } from '../core.js';
import { Coefficients, sha256 } from './coefficients.js';

import { QuickEphemeris } from './ephemeris.js';
import { buildQuickForecast, quickGeometry } from './forecast.js';

import { Terrain, TERRAIN_MODEL, traceHorizon, traceForecastHorizon, forecastHorizonBins, validatePoint, horizonKey } from './terrain.js';

import { quickSnapshot } from './snapshot.js';

const sceneKey=(s               )=>JSON.stringify([s.id,s.name,s.lat,s.lon,s.startUtc,s.endUtc]);

/** One instance per worker. Reuses decoded coefficients, tiles and a bounded point cache. */
export class QuickEngine {
           coefficients             ;
           terrain        ;
          prepared                                                                                       ;
          scene                                                                                                          ;
          horizons=new Map                     ();
          forecasts=new Map                                              ();
          forecastHorizons=new Map                                          ();
          sampled                                                ;
          visibilityBounds=new Map                                                                                                       ();
  constructor(read           ) {this.coefficients=new Coefficients(read);this.terrain=new Terrain(read);}
  /** Load and validate source data only. Hosts await this before starting another operation. */
  async warmup(selection                                  ,options                      ={}) {
    const data=await this.forecastInput(selection,options.signal);
    return {totalMs:performance.now()-data.clock,terrainLoadMs:data.terrainLoadMs,ephemerisLoadMs:data.ephemerisLoadMs};
  }
          async forecastInput(selection                                  ,signal             ) {
    const clock=performance.now(),lon=validatePoint(selection.lat,selection.lon),input={...selection,lon};
    const start=parseUtc(input.startUtc),end=parseUtc(input.endUtc,true);
    requireCondition(start%86400000===0&&end%86400000===0&&end>start&&end-start<=366*86400000,
      'INVALID_INPUT','Choose UTC midnight bounds, one to 366 days');
    throwIfAborted(signal);
    let terrainLoadMs=0,ephemerisLoadMs=0;
    await Promise.all([
      (async()=>{const a=performance.now();await this.coefficients.prepare(start,end,signal);ephemerisLoadMs=performance.now()-a;})(),
      (async()=>{const a=performance.now();await this.terrain.prepare(input.lat,lon,signal);terrainLoadMs=performance.now()-a;})()
    ]);
    throwIfAborted(signal);
    const p=input.lat/(180/Math.PI),l=lon/(180/Math.PI),ground=this.terrain.sample(Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p));
    return {clock,input,start,end,ground,terrainLoadMs,ephemerisLoadMs};
  }
          forecastSamples(data                                                  ) {
    const {input,start,end,ground}=data,key=JSON.stringify([input.lat,input.lon,start,end]),clock=performance.now();
    if(this.sampled?.key===key&&this.sampled.ground===ground)return {values:this.sampled.values,ephemerisMs:0};
    const ephemeris=new QuickEphemeris(this.coefficients,input.lat,input.lon,ground),count=(end-start)/600000+1,
      values=new Float64Array(count*8),sample=new Float64Array(8);
    for(let i=0;i<count;i++){ephemeris.sample(start+i*600000,sample);values.set(sample,i*8);}
    this.sampled={key,ground,values};return {values,ephemerisMs:performance.now()-clock};
  }
  /** A negative terrain horizon is permitted. This lower bound proves only always-down cases. */
  async visibilityBound(selection                                  ,options                      ={}) {
    const data=await this.forecastInput(selection,options.signal),
      key=JSON.stringify([data.input.lat,data.input.lon,data.start,data.end,data.ground]),cached=this.visibilityBounds.get(key);
    if(cached){this.visibilityBounds.delete(key);this.visibilityBounds.set(key,cached);return {...cached,totalMs:performance.now()-data.clock};}
    const {values}=this.forecastSamples(data),
      radius=1737400,target=radius+this.terrain.minimumElevation-1e-6,eye=radius+data.ground+2,angle=150000/radius,
      horizonLowerBoundDeg=Math.atan((target*Math.cos(angle)-eye)/(target*Math.sin(angle)))*180/Math.PI-1e-8;
    requireCondition(Number.isFinite(horizonLowerBoundDeg),'INVALID_RESPONSE','Invalid terrain visibility bound');
    let sunAlwaysDown=true,earthAlwaysDown=true;
    for(let i=0;i<values.length;i+=8){sunAlwaysDown&&=values[i+1]<=horizonLowerBoundDeg;earthAlwaysDown&&=values[i+5]<=horizonLowerBoundDeg;}
    throwIfAborted(options.signal);
    const result={sunAlwaysDown,earthAlwaysDown,horizonLowerBoundDeg,quality:'estimate'         };
    this.visibilityBounds.set(key,result);
    while(this.visibilityBounds.size>64)this.visibilityBounds.delete(this.visibilityBounds.keys().next().value );
    return {...result,totalMs:performance.now()-data.clock};
  }
  /** Forecast only: trace every bearing used by the unchanged ten-minute forecast, not a full display horizon. */
  async forecast(selection                                  ,options                      ={}) {
    const data=await this.forecastInput(selection,options.signal),{clock,input,start,end,ground,terrainLoadMs,ephemerisLoadMs}=data,
      key=JSON.stringify([input.id,input.name,input.lat,input.lon,start,end,ground]),cachedProduct=this.forecasts.get(key);
    if(cachedProduct){
      this.forecasts.delete(key);this.forecasts.set(key,cachedProduct);throwIfAborted(options.signal);
      return {...structuredClone(cachedProduct),timings:{totalMs:performance.now()-clock,terrainLoadMs,ephemerisLoadMs,
        ephemerisMs:0,horizonMs:0,forecastMs:0,horizonRays:0,fullHorizonRays:1440,samplesPerBody:0,forecastCacheHit:true}};
    }
    const {values,ephemerisMs}=this.forecastSamples(data),count=values.length/8,b=performance.now(),bins=forecastHorizonBins(values),
      hkey=horizonKey(input.lat,input.lon),cached=this.horizons.get(hkey);
    let horizon                ,horizonRays=0;
    if(cached)horizon=cached;
    else {
      let rays=this.forecastHorizons.get(hkey);
      if(!rays||rays.ground!==ground)rays={ground,mask:new Float64Array(1440).fill(NaN)};
      const missing=bins.filter(i=>!Number.isFinite(rays.mask[i]));horizonRays=missing.length;
      if(missing.length){
        const traced=await traceForecastHorizon(this.terrain,input.lat,input.lon,missing,options.signal);
        for(const i of missing)rays.mask[i]=traced.calculation.elevations[i];
      }
      this.forecastHorizons.delete(hkey);this.forecastHorizons.set(hkey,rays);
      while(this.forecastHorizons.size>64)this.forecastHorizons.delete(this.forecastHorizons.keys().next().value );
      // Hash just this request's bins, independent of cache history.
      const mask=new Float64Array(1440).fill(NaN);for(const i of bins)mask[i]=rays.mask[i];
      horizon={surfaceElevation:ground,model:TERRAIN_MODEL,calculation:{step:.25,elevations:mask},azimuthBins:bins,sha256:await sha256(mask.buffer)};
    }
    throwIfAborted(options.signal);
    const horizonMs=performance.now()-b,c=performance.now();
    const sources=Array.from(this.coefficients.hashes,([year,hash])=>({file:`${year}.bin.gz`,sha256:hash,
      header:'Tanaw lossless JPL DE440 SPK and DE440 lunar binary PCK coefficients; USNO drift / naif0012 UTC; ME421-aligned orientation'}));
    const product=buildQuickForecast(input,start,end,values,horizon,sources);
    this.forecasts.set(key,structuredClone(product));
    while(this.forecasts.size>32)this.forecasts.delete(this.forecasts.keys().next().value );
    return {...product,timings:{totalMs:performance.now()-clock,terrainLoadMs,ephemerisLoadMs,ephemerisMs,horizonMs,
      forecastMs:performance.now()-c,horizonRays,fullHorizonRays:1440,samplesPerBody:count,forecastCacheHit:false}};
  }
  /** Exact scene only: reuse the loaded ephemeris/horizon without copying a full forecast. */
  async snapshot(selection               ) {
    if(this.scene?.key!==sceneKey(selection)) return (await this.run(selection)).snapshot;
    const scene=this.scene,instant=parseUtc(selection.instantUtc??selection.startUtc);
    requireCondition(instant>=scene.start&&instant<scene.end,'INVALID_INPUT','Selected instant is outside the estimate window');
    return quickSnapshot(scene.input,instant,scene.ephemeris,scene.horizon);
  }
  async run(selection               ,options             ={}) {
    const clock=performance.now(),lon=validatePoint(selection.lat,selection.lon),input={...selection,lon};
    const start=parseUtc(input.startUtc),end=parseUtc(input.endUtc,true),signal=options.signal;
    const instant=input.instantUtc===undefined?start:parseUtc(input.instantUtc);
    requireCondition(instant>=start&&instant<end,'INVALID_INPUT','Selected instant is outside the estimate window');
    requireCondition(start%86400000===0&&end%86400000===0&&end>start&&end-start<=366*86400000,
      'INVALID_INPUT','Choose UTC midnight bounds, one to 366 days');
    throwIfAborted(signal);
    const key=horizonKey(input.lat,lon),cached=options.horizon??this.horizons.get(key);
    if(cached)requireCondition(cached.model===TERRAIN_MODEL&&cached.lat===input.lat&&sameLongitude(cached.lon,lon)&&
      cached.referenceFrame==='MOON_ME_DE421'&&cached.datum==='sphere-1737400m'&&cached.rangeKm===150&&
      Number.isFinite(cached.surfaceElevation)&&Math.abs(cached.surfaceElevation)<20000&&
      cached.observerHeight===2&&cached.calculation.step===.25&&cached.calculation.elevations.length===1440&&
      cached.calculation.elevations.every(Number.isFinite),'INVALID_INPUT','Cached horizon belongs to another model or point');
    let terrainLoadMs=0,horizonMs=0,ephemerisLoadMs=0;
    const terrainBytes=this.terrain.bytesLoaded,coefficientBytes=this.coefficients.bytesLoaded;
    let horizon=cached;
    await Promise.all([
      (async()=>{const a=performance.now();await this.coefficients.prepare(start,end,signal);ephemerisLoadMs=performance.now()-a;})(),
      (async()=>{if(horizon)return;const a=performance.now(),loadBefore=this.terrain.loadTimeMs;
        await this.terrain.prepare(input.lat,lon,signal,true);
        horizon=await traceHorizon(this.terrain,input.lat,lon,signal);
        terrainLoadMs=this.terrain.loadTimeMs-loadBefore;horizonMs=performance.now()-a-terrainLoadMs;})()
    ]);
    throwIfAborted(signal);this.horizons.delete(key);this.horizons.set(key,structuredClone(horizon ));
    while(this.horizons.size>8)this.horizons.delete(this.horizons.keys().next().value );
    const ephemeris=new QuickEphemeris(this.coefficients,input.lat,lon,horizon .surfaceElevation),a=performance.now();
    this.scene={key:sceneKey(selection),input,start,end,ephemeris,horizon:horizon };
    const productKey=JSON.stringify([input.id,input.name,input.lat,lon,start,end,horizon .sha256]);
    if (!options.retainSamples && this.prepared?.key===productKey) return {
      ...structuredClone(this.prepared.product),snapshot:quickSnapshot(input,instant,ephemeris,horizon ),horizon:horizon ,
      timings:{totalMs:performance.now()-clock,terrainLoadMs,horizonMs,ephemerisLoadMs,ephemerisMs:0,forecastMs:0,
        horizonCacheHit:Boolean(cached),samplesPerBody:0,terrainBytes:this.terrain.bytesLoaded-terrainBytes,
        coefficientBytes:this.coefficients.bytesLoaded-coefficientBytes}};
    const count=(end-start)/600000+1,values=new Float64Array(count*8),sample=new Float64Array(8);
    // Hourly sub-points, end included, so playback interpolates through the final hour.
    const points=new Float64Array(((end-start)/3600000+1)*4);
    for(let i=0;i<count;i++){
      ephemeris.sample(start+i*600000,sample);values.set(sample,i*8);
      if(i%6===0)ephemeris.subPoints(start+i*600000,points,i/6*4);
    }
    const ephemerisMs=performance.now()-a,b=performance.now();
    const sources=Array.from(this.coefficients.hashes,([year,hash])=>({file:`${year}.bin.gz`,sha256:hash,
      header:'Tanaw lossless JPL DE440 SPK and DE440 lunar binary PCK coefficients; USNO drift / naif0012 UTC; ME421-aligned orientation'}));
    const product={...buildQuickForecast(input,start,end,values,horizon ,sources),geometry:quickGeometry(start,points)},forecastMs=performance.now()-b;
    this.prepared={key:productKey,product:structuredClone(product)};
    return {...product,snapshot:quickSnapshot(input,instant,ephemeris,horizon ),horizon:horizon ,timings:{totalMs:performance.now()-clock,terrainLoadMs,horizonMs,ephemerisLoadMs,
      ephemerisMs,forecastMs,horizonCacheHit:Boolean(cached),samplesPerBody:count,
      terrainBytes:this.terrain.bytesLoaded-terrainBytes,coefficientBytes:this.coefficients.bytesLoaded-coefficientBytes},
      ...(options.retainSamples?{samples:values}: {})};
  }
}
