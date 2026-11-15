/** Static Python products when requested; explicit estimates use the existing quick engine. */
import { parseUtc, requireCondition, throwIfAborted } from './core.js';
import { PUBLISHED_WINDOW } from './landing.js';
import { QuickEngine } from './quick/engine.js';
import { Terrain } from './quick/terrain.js';

import { loadBytes, sha256 } from './quick/coefficients.js';

/** Centre slope across a 100 m baseline; coarse global pixels cannot establish flatness. */
export async function screenTerrain(terrain        ,point             ,signal             )                        {
  const p=point.lat*Math.PI/180,l=point.lon*Math.PI/180,R=1737400;
  // Entire footprint must lie inside the 20 m product, not the transition edge.
  if(point.lat+50/R*180/Math.PI>-87.5)return {slopeDeg:null,baselineM:100,resolutionM:1900,source:'LOLA LDEM16; insufficient resolution for a 100 m footprint'};
  await terrain.prepare(point.lat,point.lon,signal);throwIfAborted(signal);
  const up=[Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p)],
    east=[-Math.sin(l),Math.cos(l),0],north=[-Math.sin(p)*Math.cos(l),-Math.sin(p)*Math.sin(l),Math.cos(p)];
  const sample=(axis         ,sign       )=>{const angle=sign*50/R,v=up.map((x,i)=>x*Math.cos(angle)+axis[i]*Math.sin(angle));return terrain.sample(v[0],v[1],v[2]);};
  const gx=(sample(east,1)-sample(east,-1))/100,gy=(sample(north,1)-sample(north,-1))/100;
  return {slopeDeg:Math.atan(Math.hypot(gx,gy))*180/Math.PI,baselineM:100,resolutionM:20,source:'NASA LOLA LDEM_875S_20M; central-difference slope'};
}

export function createLandingSource(options
                                                                        ={})               {
  const read=options.read??loadBytes,base=options.baseUrl??new URL('../../data/',import.meta.url),quick=new QuickEngine(read);
  const catalogs=new Map            ();
  const published=new Map                        ();
  const json=async(path       ,signal             )=>{
    throwIfAborted(signal);if(catalogs.has(path))return catalogs.get(path);
    const value=JSON.parse(new TextDecoder().decode(await read(new URL(path,base),signal)));throwIfAborted(signal);
    if(path==='sites.json'||path==='landing-terrain.json')catalogs.set(path,value);
    return value;
  };
  return {
    async warmup(startUtc,endUtc,signal) {
      const a=parseUtc(startUtc),b=parseUtc(endUtc,true);
      requireCondition(b>a,'INVALID_INPUT','Choose an end after the start');
      // Discovery always includes the south cap. Decode its shared tiles while dates/filters are edited.
      await quick.warmup({lat:-89,lon:0,startUtc:new Date(Math.floor(a/86400000)*86400000).toISOString(),
        endUtc:new Date(Math.ceil(b/86400000)*86400000).toISOString()},{signal});
    },
    async precheck(point,startUtc,endUtc,criteria,signal) {
      throwIfAborted(signal);
      const a=parseUtc(startUtc),b=a+criteria.durationDays*86400000;
      requireCondition(Math.abs(parseUtc(endUtc,true)-b)<1,'INVALID_INPUT','Precheck interval must match the stay');
      if(a<Date.parse(PUBLISHED_WINDOW.end)&&b>Date.parse(PUBLISHED_WINDOW.start)) {
        // Never let quick geometry reject a point whose published/prepared product has priority.
        if(options.accurate)return null;
        const sites=await json('sites.json',signal);
        if(sites.some((s             )=>(!point.id||s.id===point.id)&&Math.abs(s.lat-point.lat)<1e-7&&Math.abs(((s.lon-point.lon+540)%360)-180)<1e-7))return null;
      }
      const hours=criteria.durationDays*24,needsSun=criteria.sunlightEnabled&&(criteria.minSunFraction>0||criteria.maxDarkHours<hours),
        needsEarth=criteria.earthEnabled&&(criteria.minEarthFraction>0||criteria.maxEarthOutageHours<hours);
      if(!needsSun&&!needsEarth)return null;
      const bound=await quick.visibilityBound({...point,startUtc:new Date(Math.floor(a/86400000)*86400000).toISOString(),
        endUtc:new Date(Math.ceil(b/86400000)*86400000).toISOString()},{signal});
      const body=needsSun&&bound.sunAlwaysDown?'sunlight':needsEarth&&bound.earthAlwaysDown?'earth':null;
      return body?{kind:'always-below-terrain-bound',body,maximumVisibleHours:0,minimumOutageHours:hours,
        horizonLowerBoundDeg:bound.horizonLowerBoundDeg,quality:'estimate'}:null;
    },
    terrain:options.terrain??(async(point,signal)=>{
      const data=await json('landing-terrain.json',signal);
      requireCondition(data.version===1&&data.referenceFrame==='MOON_ME_DE421'&&Array.isArray(data.rows),'INVALID_RESPONSE','Invalid terrain catalog');
      const saved=data.rows.find((s    )=>(!point.id||s.id===point.id)&&Math.abs(s.lat-point.lat)<1e-7&&Math.abs(((s.lon-point.lon+540)%360)-180)<1e-7);
      return saved?{...saved}:screenTerrain(quick.terrain,point,signal);
    }),
    async forecast(point,startUtc,endUtc,quality,signal) {
      if(quality==='estimate')return (await quick.forecast({...point,startUtc,endUtc},{signal})).index;
      const sites=await json('sites.json',signal);
      const site=sites.find((s             )=>(!point.id||s.id===point.id)&&Math.abs(s.lat-point.lat)<1e-7&&Math.abs(((s.lon-point.lon+540)%360)-180)<1e-7);
      if(!site)return options.accurate?options.accurate(point,startUtc,endUtc,quality,signal):null;
      requireCondition(typeof site.id==='string'&&/^[a-zA-Z0-9_-]+$/.test(site.id),'INVALID_RESPONSE','Invalid saved site identifier');
      const cached=published.get(site.id);if(cached){throwIfAborted(signal);published.delete(site.id);published.set(site.id,cached);return structuredClone(cached);}
      const [index,rawHorizon]=await Promise.all([json(`forecast/${site.id}.json`,signal),read(new URL(`horizons/${site.id}.json`,base),signal)]);
      const text=new TextDecoder().decode(rawHorizon).replaceAll('\r\n','\n'),h=JSON.parse(text),s=index.science;
      requireCondition(s&&s.horizonSha256===await sha256(new TextEncoder().encode(text).buffer)&&h.lat===site.lat&&h.lon===site.lon&&
        h.observerHeight===2&&h.surfaceElevation===s.surfaceElevationM&&s.observerHeightM===2&&s.horizonStepDeg===.25&&[1,10].includes(s.stepMinutes)&&
        Array.isArray(s.sources)&&s.sources.length>0&&s.sources.every((x    )=>/^[a-f0-9]{64}$/.test(x.sha256)&&typeof x.header==='string'),
        'INVALID_RESPONSE','Invalid Python forecast provenance');
      throwIfAborted(signal);published.set(site.id,structuredClone(index));
      while(published.size>64)published.delete(published.keys().next().value );
      return index                   ;
    }
  };
}
