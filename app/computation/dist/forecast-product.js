/** Validated forecast adaptation; minute interpolation stays in the computation layer. */
import { parseUtc, requireCondition, normalizeLongitude } from './core.js';
import { readForecastHour, validateForecastMonth } from './forecast.js';
import { publishedGeometry, validateGeometricTrack } from './published-geometry.js';

const day=86400000;
const equalLongitude=(a       ,b       )=>Math.abs(normalizeLongitude(a-b+180)-180)<1e-7;

export function validateProduct(value    , selection                 , quality                      ) {
  const f=value?.index,s=f?.science,h=value?.horizon;
  const start=parseUtc(selection.startUtc),end=parseUtc(selection.endUtc,true);
  requireCondition(start%day===0&&end%day===0&&end>start&&end-start<=366*day,'INVALID_INPUT','Select one to 366 complete UTC days');
  requireCondition(f&&s&&h&&typeof f.id==='string'&&(!selection.id||f.id===selection.id)&&
    Math.abs(f.lat-selection.lat)<1e-7&&equalLongitude(f.lon,selection.lon)&&
    h.lat===f.lat&&equalLongitude(h.lon,f.lon),'INVALID_RESPONSE','Forecast belongs to another point');
  requireCondition(s.referenceFrame==='MOON_ME_DE421'&&s.elevationDatum==='sphere-1737400m'&&
    s.observerHeightM===2&&s.visibility==='center'&&[1,10].includes(s.stepMinutes)&&s.horizonStepDeg===.25&&
    Number.isFinite(s.surfaceElevationM)&&h.surfaceElevation===s.surfaceElevationM&&h.observerHeight===2&&
    h.step===1&&h.elevations?.length===360&&h.elevations.every((x       )=>Number.isFinite(x)&&Math.abs(x)<=90),
    'INVALID_RESPONSE','Incompatible forecast science or terrain');
  requireCondition(quality==='estimate'?f.quality==='estimate'&&typeof f.model==='string':
    f.quality!=='estimate'&&value.quality!=='estimate','INVALID_RESPONSE','Estimate cannot replace accurate data');
  requireCondition(/^[a-f0-9]{64}$/.test(s.horizonSha256)&&Array.isArray(s.sources)&&s.sources.length>0&&
    s.sources.every((v    )=>v&&typeof v.file==='string'&&/^[a-f0-9]{64}$/.test(v.sha256)&&typeof v.header==='string'&&v.header.length>0),
    'INVALID_RESPONSE','Missing forecast provenance');
  if(value.appearance)validateProductAppearance(value.appearance,value,value.appearance.instantUtc);
  const a=parseUtc(f.window?.start),b=parseUtc(f.window?.end,true);
  requireCondition(a%day===0&&b%day===0&&a<=start&&b>=end&&b-a<=366*day&&
    Array.isArray(f.days)&&f.days.length===(b-a)/day,'INVALID_RESPONSE','Incomplete forecast days');
  for(let i=0;i<f.days.length;i++) {
    const d=f.days[i],t=a+i*day;
    requireCondition(d.date===new Date(t).toISOString().slice(0,10)&&
      ['sunHours','earthHours'].every(k=>Number.isFinite(d[k])&&d[k]>=0&&d[k]<=24)&&
      ['sunUpAt0','earthUpAt0'].every(k=>typeof d[k]==='boolean'),'INVALID_RESPONSE','Invalid daily hours or state');
    for(const k of ['sunrise','sunset','earthrise','earthset']) {
      requireCondition(Array.isArray(d[k]),'INVALID_RESPONSE','Missing events');
      let previous=-Infinity;
      for(const v of d[k]){const at=parseUtc(v);requireCondition(at>=t&&at<t+day&&at>previous,'INVALID_RESPONSE','Invalid event order');previous=at;}
    }
    for(const k of ['nextSunEvent','nextEarthEvent']) {
      const e=d[k];requireCondition(e===null||e&&(e.kind==='rise'||e.kind==='set')&&parseUtc(e.at)>t&&parseUtc(e.at)<b,
        'INVALID_RESPONSE','Invalid next event');
    }
  }
  for(let t=start;t<end;) {
    const date=new Date(t),label=date.toISOString().slice(0,7),monthStart=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1);
    const next=Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,1),left=Math.max(monthStart,a),right=Math.min(next,b);
    requireCondition(f.months.includes(label)&&value.monthly?.[label],'INVALID_RESPONSE','Missing selected forecast month');
    validateForecastMonth(value.monthly[label],new Date(left).toISOString().replace('.000Z','Z'),new Date(right).toISOString());
    requireCondition(quality==='estimate'?value.monthly[label].quality==='estimate':value.monthly[label].quality!=='estimate',
      'INVALID_RESPONSE','Mixed forecast quality');
    t=next;
  }
  const geometry = value.geometry ? [value.geometry] : value.geometryMonthly ? Object.values(value.geometryMonthly) : [];
  for (const track of geometry         ) {
    const t=parseUtc(track?.start),count=track?.subsolarLat?.length;
    requireCondition(track.stepMinutes===60&&t%3600000===0&&Number.isInteger(count)&&count>0&&count<=366*24+1&&
      ['subsolarLat','subsolarLon','subEarthLat','subEarthLon'].every(k=>Array.isArray(track[k])&&track[k].length===count&&
        track[k].every((v       )=>Number.isFinite(v)&&(k.endsWith('Lat')?Math.abs(v)<=90:v>=0&&v<360))),
      'INVALID_RESPONSE','Invalid geometric playback directions');
    if(track.geometric)validateGeometricTrack(track.geometric,count);
  }
  if (geometry.length) for(let t=start;t<end;t+=3600000) {
    const track=value.geometry??value.geometryMonthly[new Date(t).toISOString().slice(0,7)];
    requireCondition(track&&t>=parseUtc(track.start)&&t<parseUtc(track.start)+track.subsolarLat.length*3600000,
      'INVALID_RESPONSE','Incomplete geometric playback coverage');
  }
  return value;
}

export function productSnapshot(product    ,instantUtc       ) {
  if (product.index.quality==='estimate' && product.snapshot?.instantUtc===new Date(parseUtc(instantUtc)).toISOString()) return structuredClone(product.snapshot);
  const {index:f}=product,s=f.science,m=product.monthly[instantUtc.slice(0,7)];
  requireCondition(m,'UNSUPPORTED','This forecast month has not loaded');
  const sample=productSample(product,instantUtc),unsupported={status:'unsupported',reason:'This forecast has no geometric orientation input'};
  const result    ={site:{id:f.id,name:f.name,latitudeDeg:f.lat,longitudeEastDeg:f.lon,
    referenceFrame:s.referenceFrame,elevationDatum:s.elevationDatum,surfaceElevationM:s.surfaceElevationM,observerHeightM:s.observerHeightM},
    instantUtc:new Date(parseUtc(instantUtc)).toISOString(),directionKind:'apparent',interpolated:sample.interpolated,
    bodies:{sun:sample.sun,earth:sample.earth},quality:f.quality??product.quality??'accurate',
    provenance:{source:f.ephemeris,model:f.model??product.model??'Published Python forecast',warnings:[...(s.limits??[]), ...(sample.interpolated?['Sky positions interpolated between saved hourly observations; visibility follows published rise/set events.']:[])],
      forecast:{window:f.window,science:s}},capabilities:{geometricSunlightLocal:unsupported,moonRelativeSun:unsupported,
      moonRelativeEarth:unsupported,earthBodyToLocal:unsupported,earthIlluminationBody:unsupported,starCatalogToLocal:unsupported,eclipses:'unsupported'}};
  const exactAppearance=product.appearance&&parseUtc(product.appearance.instantUtc)===parseUtc(instantUtc);
  if(result.quality==='accurate'&&!exactAppearance&&product.geometryMonthly?.[instantUtc.slice(0,7)]?.geometric) {
    const g=publishedGeometry(product,instantUtc);
    result.lighting=g.lighting;result.overview=g.overview;
    result.provenance.geometric=g.provenance;
    result.provenance.warnings.push('Geometric lighting uses pinned DE440 states; intermediate minutes use cubic Hermite interpolation. Earth texture orientation and eclipses remain unsupported.');
    if(g.sky) {
      result.sky=g.sky;result.provenance.sky=g.skyProvenance;
      result.provenance.warnings.push(g.skyProvenance .model);
      result.capabilities.starCatalogToLocal={status:'available',value:{fromFrame:'ICRS-J1991.25',toFrame:'LOCAL_EUN_RENDER',
        matrix:g.skyMatrix,instantUtc:result.instantUtc,model:g.skyProvenance .model}};
    }
    const direction=(components         ,frame       ,from       ,toward       )=>({status:'available',
      value:{components,frame,from,toward,correction:'geometric',instantUtc:result.instantUtc}});
    result.capabilities.geometricSunlightLocal=direction(g.lighting.sunDirectionLocal,'LOCAL_EUN_RENDER','site','sun');
    result.capabilities.moonRelativeSun=direction(g.sunMoon,'MOON_ME_DE421','moon','sun');
    result.capabilities.moonRelativeEarth=direction(g.earthMoon,'MOON_ME_DE421','moon','earth');
  }
  // Optional service geometry is for one exact instant; never reuse it during playback.
  if(exactAppearance) {
    // The observer's optional geometric fields are its own checked contract; do not
    // retain the static provider's unsupported-capability declarations beside them.
    delete result.capabilities;
    for(const key of ['lighting','sky','overview','earthAppearance']) if(product.appearance[key])result[key]=structuredClone(product.appearance[key]);
  }
  return result;
}

/** Validate optional geometry separately; it can only enrich this exact point and hour. */
export function validateProductAppearance(value    ,product    ,instantUtc       ) {
  const s=product.index.science,site=value?.site;
  requireCondition(site&&Math.abs(site.latitudeDeg-product.index.lat)<1e-7&&equalLongitude(site.longitudeEastDeg,product.index.lon)&&
    site.referenceFrame===s.referenceFrame&&site.elevationDatum===s.elevationDatum&&site.surfaceElevationM===s.surfaceElevationM&&
    site.observerHeightM===s.observerHeightM&&parseUtc(value.instantUtc)===parseUtc(instantUtc),'INVALID_RESPONSE','Appearance belongs to another point or hour');
  const unit=(v    ,n       )=>Array.isArray(v)&&v.length===n&&v.every(Number.isFinite)&&Math.abs(Math.hypot(...v)-1)<1e-6;
  requireCondition(unit(value.lighting?.sunDirectionLocal,3)&&value.sky?.catalogFrame==='ICRS-J1991.25'&&unit(value.sky?.catalogToLocal,4)&&
    value.overview?.axisConvention==='x0-yNorth-zWest'&&value.overview.moonRadiusM===1737400&&unit(value.overview.moonToLocal,4)&&
    ['siteDirectionMoon','sunDirectionMoon','earthDirectionMoon'].every(k=>unit(value.overview[k],3)),
    'INVALID_RESPONSE','Invalid geometric orientation');
  if(value.earthAppearance)requireCondition(value.earthAppearance.bodyFrame==='earth-fixed-x0-yNorth-zWest'&&
    unit(value.earthAppearance.bodyToLocal,4)&&unit(value.earthAppearance.sunDirectionBody,3),'INVALID_RESPONSE','Invalid Earth orientation');
  return value;
}

export function meaningfulChanges(previous    ,next    ) {
  if(!previous||previous.index.id!==next.index.id)return [];
  const old=new Map(previous.index.days.map((d    )=>[d.date,d])),changed         =[];
  for(const d of next.index.days) {
    const before    =old.get(d.date);if(!before)continue;
    const hours=['sunHours','earthHours'].some(k=>Math.abs(d[k]-before[k])>.5);
    const events=['sunrise','sunset','earthrise','earthset'].some(k=>d[k].length!==before[k].length||
      d[k].some((t       ,i       )=>Math.abs(Date.parse(t)-Date.parse(before[k][i]))>600000));
    if(hours||events)changed.push(d.date);
  }
  return changed;
}

/** Unit-direction interpolation avoids angle-wrap discontinuities. */
function mixDirection(a         ,b         ,fraction       ) {
  const v=a.map((x,i)=>x+(b[i]-x)*fraction),length=Math.hypot(...v);
  requireCondition(length>1e-10,'UNSUPPORTED','Cannot interpolate opposing directions');
  return v.map(x=>x/length);
}
function brackets(instantUtc       ) {
  const t=parseUtc(instantUtc);
  requireCondition(t%60000===0,'UNSUPPORTED','Select a whole UTC minute');
  const left=Math.floor(t/3600000)*3600000;
  return {left:new Date(left).toISOString(),right:new Date(left+3600000).toISOString(),fraction:(t-left)/3600000};
}
/** Saved flags at exact hours; published event states between hours, never rounded terrain angles. */
export function productSample(product    ,instantUtc       ) {
  const {left,right,fraction}=brackets(instantUtc);
  const read=(utc       )=>{const m=product.monthly[utc.slice(0,7)];requireCondition(m,'UNSUPPORTED','Missing interpolation endpoint');return readForecastHour(m,utc);};
  const a=read(left);
  if(!fraction)return {...a,interpolated:false};
  requireCondition(parseUtc(right)<parseUtc(product.index.window.end,true),'UNSUPPORTED','No saved interpolation endpoint at coverage end');
  const b=read(right),day=product.index.days.find((d    )=>d.date===instantUtc.slice(0,10));
  requireCondition(day,'UNSUPPORTED','Missing visibility events');
  const body=(name              )=>{
    const x=a[name],y=b[name],r=Math.PI/180;
    const vector=(v         )=>[Math.cos(v.elevationDeg*r)*Math.sin(v.azimuthDeg*r),Math.cos(v.elevationDeg*r)*Math.cos(v.azimuthDeg*r),Math.sin(v.elevationDeg*r)];
    const v=mixDirection(vector(x),vector(y),fraction),t=parseUtc(instantUtc);
    let visible=day[`${name}UpAt0`];
    const events=[...day[`${name}rise`].map((at       )=>({at:parseUtc(at),up:true})),...day[`${name}set`].map((at       )=>({at:parseUtc(at),up:false}))].sort((x,y)=>x.at-y.at||Number(y.up)-Number(x.up));
    for(const event of events) {if(event.at>t)break;visible=event.at===t?false:event.up;}
    return {azimuthDeg:normalizeLongitude(Math.atan2(v[0],v[1])/r),elevationDeg:Math.atan2(v[2],Math.hypot(v[0],v[1]))/r,
      rangeKm:x.rangeKm+(y.rangeKm-x.rangeKm)*fraction,angularDiameterDeg:x.angularDiameterDeg+(y.angularDiameterDeg-x.angularDiameterDeg)*fraction,centerVisible:visible};
  };
  return {instantUtc,sun:body('sun'),earth:body('earth'),interpolated:true};
}
/** Moon display directions use the same bracketing instants as apparent sky positions. */
export function productMoonDirections(product    ,instantUtc       ) {
  // An estimate without its hourly track has directions for its one snapshot instant only.
  if (product.index.quality==='estimate'&&!product.geometry) {
    requireCondition(product.snapshot?.instantUtc===new Date(parseUtc(instantUtc)).toISOString(),
      'INVALID_RESPONSE','Estimate scene belongs to another instant');
    return {sun:product.snapshot.overview.sunDirectionMoon,earth:product.snapshot.overview.earthDirectionMoon};
  }
  const {left,right,fraction}=brackets(instantUtc);
  const at=(utc       )=>{
    const track=product.geometry??product.geometryMonthly?.[utc.slice(0,7)];
    requireCondition(track,'UNSUPPORTED','Moon directions are unavailable');
    const i=(parseUtc(utc)-parseUtc(track.start))/3600000;
    requireCondition(Number.isInteger(i)&&i>=0&&i<track.subsolarLat.length,'UNSUPPORTED','Moon directions are outside the saved hours');
    const direction=(lat       ,lon       )=>{const p=lat*Math.PI/180,l=lon*Math.PI/180;return [Math.cos(p)*Math.cos(l),Math.sin(p),-Math.cos(p)*Math.sin(l)];};
    return {sun:direction(track.subsolarLat[i],track.subsolarLon[i]),earth:direction(track.subEarthLat[i],track.subEarthLon[i])};
  };
  const a=at(left);if(!fraction)return a;const b=at(right);
  return {sun:mixDirection(a.sun,b.sun,fraction),earth:mixDirection(a.earth,b.earth,fraction)};
}
