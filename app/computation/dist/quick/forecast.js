

import { maskAt } from './terrain.js';
import { MODEL } from './coefficients.js';

export const iso=(ms       )=>new Date(Math.floor(ms/1000)*1000).toISOString().replace('.000Z','Z');
export const round=(value       ,places       )=>Math.round(value*10**places)/10**places;

/** Port of the interval sweep, with Tanaw's strict >0 rule and zero-clearance tangencies. */
export function upIntervals(clearance             ,start       ,step=600000)        {
  const spans       =[];let open=clearance[0]>0?start:null;
  for(let i=1;i<clearance.length;i++) {
    const a=clearance[i-1],b=clearance[i];if((a>0)===(b>0))continue;
    const crossing=start+(i-1)*step+step*a/(a-b);
    if(b>0)open=crossing;else{spans.push([open ,crossing]);open=null;}
  }
  if(open!==null)spans.push([open,start+(clearance.length-1)*step]);
  return spans;
}
function eventList(spans       ,start       ,end       ) {
  const events                                  =[];
  for(const [a,b]of spans){if(a>start)events.push({time:a,kind:'rise'});if(b<end)events.push({time:b,kind:'set'});}
  // Python orders coincident rise before set. Do not erase point tangencies.
  return events.sort((a,b)=>a.time-b.time||(a.kind==='rise'?-1:1));
}
function hours(spans       ,a       ,b       ) {
  let sum=0;for(const [s,e]of spans)sum+=Math.max(0,Math.min(e,b)-Math.max(s,a));return round(sum/3600000,2);
}

export function buildQuickForecast(input                                                ,start       ,end       ,
  values             ,horizon                ,sources                                            ) {
  const count=(end-start)/600000+1,sunClear=new Float64Array(count),earthClear=new Float64Array(count);
  for(let i=0;i<count;i++) {
    sunClear[i]=values[i*8+1]-maskAt(horizon.calculation.elevations,values[i*8]);
    earthClear[i]=values[i*8+5]-maskAt(horizon.calculation.elevations,values[i*8+4]);
  }
  const sun=upIntervals(sunClear,start),earth=upIntervals(earthClear,start);
  const se=eventList(sun,start,end),ee=eventList(earth,start,end),days      =[];
  const next=(events          ,t       )           =>{const e=events.find(e=>e.time>t);return e?{kind:e.kind,at:iso(e.time)}:null;};
  for(let t=start;t<end;t+=86400000) {
    const within=(v       )=>v>=t&&v<t+86400000&&v<end,k=(t-start)/600000;
    days.push({date:iso(t).slice(0,10),sunHours:hours(sun,t,t+86400000),earthHours:hours(earth,t,t+86400000),
      sunrise:sun.filter(s=>s[0]>start&&within(s[0])).map(s=>iso(s[0])),sunset:sun.filter(s=>within(s[1])).map(s=>iso(s[1])),
      earthrise:earth.filter(s=>s[0]>start&&within(s[0])).map(s=>iso(s[0])),earthset:earth.filter(s=>within(s[1])).map(s=>iso(s[1])),
      sunUpAt0:sunClear[k]>0,earthUpAt0:earthClear[k]>0,nextSunEvent:next(se,t),nextEarthEvent:next(ee,t)});
  }
  const monthly                          ={};
  for(let t=start;t<end;t+=3600000) {
    const label=iso(t).slice(0,7),i=(t-start)/600000,b=i*8;
    const m=monthly[label]??= {start:iso(t),stepMinutes:60,quality:'estimate',model:MODEL,
      sunAz:[],sunEl:[],earthAz:[],earthEl:[],sunRangeKm:[],earthRangeKm:[],
      sunAngularDiameterDeg:[],earthAngularDiameterDeg:[],sunVisible:[],earthVisible:[]};
    m.sunAz.push(round(values[b],2));m.sunEl.push(round(values[b+1],2));m.sunRangeKm.push(round(values[b+2],0));
    m.sunAngularDiameterDeg.push(round(values[b+3],4));m.sunVisible.push(Number(sunClear[i]>0));
    m.earthAz.push(round(values[b+4],2));m.earthEl.push(round(values[b+5],2));m.earthRangeKm.push(round(values[b+6],0));
    m.earthAngularDiameterDeg.push(round(values[b+7],4));m.earthVisible.push(Number(earthClear[i]>0));
  }
  const index           ={id:input.id??'custom',name:input.name??'Selected point',lat:input.lat,lon:input.lon,
    horizon:'lola',ephemeris:'JPL DE440; apparent airless body centres; ten-minute sampling',quality:'estimate',model:MODEL,
    science:{visibility:'center',referenceFrame:'MOON_ME_DE421',orientation:'MOON_ME_DE440_ME421',
      elevationDatum:'sphere-1737400m',surfaceElevationM:horizon.surfaceElevation,observerHeightM:2,stepMinutes:10,
      horizonStepDeg:.25,horizonSha256:horizon.sha256,sources,terrainModel:horizon.model,rangeKm:150,
      ...(horizon.azimuthBins?{horizonCoverage:{kind:'requested-azimuth-bins',bins:horizon.azimuthBins,
        hashEncoding:'1440 Float64 ray elevations; uncomputed bearings are NaN; not a full display horizon'}}:{}),
      corrections:'converged light-time, relativistic aberration, Sun/Earth monopole deflection; airless',
      limits:['Coarse global terrain; 20 m south-polar terrain differs from published site DEMs',
        'Known leap seconds only (naif0012); UTC-label durations',
        'No eclipses, resolved-disc occultations, link budget or smaller-body deflection']},
    window:{start:iso(start),end:iso(end)},sunUpAtStart:sunClear[0]>0,earthUpAtStart:earthClear[0]>0,
    months:Object.keys(monthly),days};
  return {index,monthly};
}

/** Hourly Moon-frame sub-points from `start`, rounded like app/data/sun/<month>.json. */
export function quickGeometry(start       ,points             )               {
  const track              ={start:iso(start),stepMinutes:60,subsolarLat:[],subsolarLon:[],subEarthLat:[],subEarthLon:[],quality:'estimate'};
  for(let i=0;i<points.length;i+=4) {
    track.subsolarLat.push(round(points[i],4));track.subsolarLon.push(round(points[i+1],4)%360);
    track.subEarthLat.push(round(points[i+2],4));track.subEarthLon.push(round(points[i+3],4)%360);
  }
  return track;
}
