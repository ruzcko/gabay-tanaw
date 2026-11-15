/** Landing screening only: terrain and visibility do not certify spacecraft safety. */
import { parseUtc, requireCondition, throwIfAborted } from './core.ts';
import { validatePoint } from './quick/terrain.ts';
import type { Day } from './quick/forecast.ts';

const DAY=86400000, HOUR=3600000;
export const PUBLISHED_WINDOW={start:'2026-12-01T00:00:00Z',end:'2027-12-01T00:00:00Z'} as const;
export interface LandingPoint {id?:string;name?:string;lat:number;lon:number}
export interface LandingCriteria {
  durationDays:number; maxSlopeDeg:number; minSunFraction:number; minEarthFraction:number;
  maxDarkHours:number; maxEarthOutageHours:number;
  terrainEnabled:boolean; sunlightEnabled:boolean; earthEnabled:boolean;
}
export const LANDING_DEFAULTS:Readonly<LandingCriteria>=Object.freeze({durationDays:7,maxSlopeDeg:10,
  minSunFraction:1,minEarthFraction:1,maxDarkHours:0,maxEarthOutageHours:0,
  terrainEnabled:true,sunlightEnabled:true,earthEnabled:true});
export interface TerrainScreen {slopeDeg:number|null;baselineM:number;resolutionM:number;source:string}
export interface LandingForecast {
  lat:number;lon:number;window:{start:string;end:string};days:Day[];
  science:Record<string,unknown>;quality?:string;
}
export interface LandingSource {
  /** Optional source-data preload for discovery; await before any other source operation. */
  warmup?(startUtc:string,endUtc:string,signal?:AbortSignal):Promise<void>;
  forecast(point:LandingPoint,startUtc:string,endUtc:string,quality:'accurate'|'estimate',signal?:AbortSignal):Promise<LandingForecast|null>;
  terrain(point:LandingPoint,signal?:AbortSignal):Promise<TerrainScreen>;
  precheck?(point:LandingPoint,startUtc:string,endUtc:string,criteria:LandingCriteria,signal?:AbortSignal):Promise<CandidateRejection|null>;
}
export interface CandidateRejection {
  kind:'always-below-terrain-bound';body:'sunlight'|'earth';maximumVisibleHours:0;
  minimumOutageHours:number;horizonLowerBoundDeg:number;quality:'estimate';
}
export type TravelSourcePolicy='prefer-published'|'published-only';
export interface LandingPlannerOptions {sourcePolicy?:TravelSourcePolicy}
export interface CandidateSearchOptions {
  southTarget?:number;elsewhereTarget?:number;maxSouthSamples?:number;maxElsewhereSamples?:number;
  southSeeds?:LandingPoint[];
  southLatitudeLimit?:number;exclude?:LandingPoint[];cursor?:CandidateCursor;
  southAnchors?:LandingPoint[];anchorRadiusKm?:number;
  onCandidate?:(candidate:{group:'south'|'elsewhere';sampling:'seed'|'random'|'nearby';result:LandingEvaluation;elapsedMs:number})=>void;
  seed?:number;maxElapsedMs?:number;signal?:AbortSignal;
  onProgress?:(progress:CandidateProgress)=>void;
}
export interface CandidateProgress {
  attempted:{south:number;elsewhere:number};found:{south:number;elsewhere:number};
  target:{south:number;elsewhere:number};terrainSkipped:{fail:number;unknown:number};elapsedMs:number;
  excluded:{south:number;elsewhere:number};visibilityRejected:{sunlight:number;earth:number};
  current?:{group:'south'|'elsewhere';point:LandingPoint;stage:'terrain'|'visibility-bound'|'forecast'};
}
export interface CandidateCursor {version:1;seed:number;southLatitudeLimit:number;anchorKey:string;southOffset:number;elsewhereOffset:number}
export type LandingEvaluation=Awaited<ReturnType<ReturnType<typeof createLandingPlanner>['evaluate']>>;
function seededUnit(seed:number,index:number,salt:number) {
  let x=(seed^Math.imul(index+1,0x9e3779b9)^salt)>>>0;
  x=Math.imul(x^(x>>>16),0x21f0aaad);x=Math.imul(x^(x>>>15),0x735a2d97);return (((x^(x>>>15))>>>0)+.5)/4294967296;
}
/** Stratified random points: every block of 12 visits every longitude sector. */
function candidatePoint(seed:number,index:number,group:'south'|'elsewhere',southLatitudeLimit=-80):LandingPoint {
  const col=(index*5+seed%12)%12,row=(Math.floor(index/12)+index%12+seed%6)%6,
    u=(row+seededUnit(seed,index,group==='south'?17:31))/6,
    edge=Math.sin(southLatitudeLimit*Math.PI/180),lat=Math.asin(group==='south'?-1+u*(edge+1):edge+u*(1-edge))*180/Math.PI,
    lon=(col+seededUnit(seed,index,group==='south'?53:71))*30;
  return {lat,lon,name:`${group==='south'?'South-pole':'Lunar'} sample ${lat.toFixed(3)}°, ${lon.toFixed(3)}° E`};
}
function nearbyPoint(anchor:LandingPoint,seed:number,index:number,radiusKm:number,southLatitudeLimit:number):LandingPoint {
  const rad=Math.PI/180,p=anchor.lat*rad,l=anchor.lon*rad,
    limit=Math.min(radiusKm/1737.4,(southLatitudeLimit-anchor.lat)*rad*.9),
    distance=Math.acos(1-seededUnit(seed,index,111)*(1-Math.cos(limit))),az=seededUnit(seed,index,151)*Math.PI*2,
    lat=Math.asin(Math.sin(p)*Math.cos(distance)+Math.cos(p)*Math.sin(distance)*Math.cos(az))/rad,
    lon=((l+Math.atan2(Math.sin(az)*Math.sin(distance)*Math.cos(p),Math.cos(distance)-Math.sin(p)*Math.sin(lat*rad)))/rad+360)%360;
  return {lat,lon,name:`South-pole nearby sample ${lat.toFixed(3)}°, ${lon.toFixed(3)}° E`};
}
type Span=readonly[number,number];
type State='pass'|'fail'|'unknown';
export function landingCriteria(input:Partial<LandingCriteria>={}):LandingCriteria {
  const c={...LANDING_DEFAULTS,...input};
  for(const key of ['durationDays','maxSlopeDeg','minSunFraction','minEarthFraction','maxDarkHours','maxEarthOutageHours'] as const)
    requireCondition(Number.isFinite(c[key]),'INVALID_INPUT',`${key} must be finite`);
  requireCondition(c.durationDays>0&&c.durationDays<=30&&c.durationDays*DAY>=1000,'INVALID_INPUT','Stay must be between one second and 30 days');
  requireCondition(c.maxSlopeDeg>0&&c.maxSlopeDeg<=45,'INVALID_INPUT','Slope limit must be >0 and <=45 degrees');
  requireCondition([c.minSunFraction,c.minEarthFraction].every(x=>x>=0&&x<=1)&&c.maxDarkHours>=0&&c.maxEarthOutageHours>=0,
    'INVALID_INPUT','Coverage fractions must be 0–1 and outages nonnegative');
  for(const key of ['terrainEnabled','sunlightEnabled','earthEnabled'] as const)
    requireCondition(typeof c[key]==='boolean','INVALID_INPUT',`${key} must be boolean`);
  return c;
}
export function sixMonthsAfter(utc:string) {
  const d=new Date(parseUtc(utc)),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+6);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));
  return d.toISOString();
}
/** Reconstruct intervals from published events, never rounded daily totals or angles. */
export function visibilitySpans(f:LandingForecast,body:'sun'|'earth',start:number,end:number):Span[] {
  const a=parseUtc(f.window.start),b=parseUtc(f.window.end,true),spans:Span[]=[];
  requireCondition(a%DAY===0&&b%DAY===0&&a<=start&&b>=end&&Array.isArray(f.days)&&f.days.length===(b-a)/DAY,
    'INVALID_RESPONSE','Incomplete daily forecast coverage');
  for(let t=Math.floor(start/DAY)*DAY;t<end;t+=DAY) {
    const d=f.days[(t-a)/DAY];
    requireCondition(d?.date===new Date(t).toISOString().slice(0,10)&&typeof d[`${body}UpAt0`]==='boolean',
      'INVALID_RESPONSE','Invalid forecast day/state');
    const events:{at:number;up:boolean}[]=[];
    for(const [suffix,up] of [['rise',true],['set',false]] as const) {
      const list=d[`${body}${suffix}`];requireCondition(Array.isArray(list),'INVALID_RESPONSE','Missing visibility events');
      let previous=-Infinity;
      for(const utc of list){const at=parseUtc(utc);requireCondition(at>=t&&at<t+DAY&&at>previous,'INVALID_RESPONSE','Invalid visibility event');
        previous=at;events.push({at,up});}
    }
    events.sort((x,y)=>x.at-y.at||Number(y.up)-Number(x.up));
    let up=d[`${body}UpAt0`],cursor=t;
    for(const e of [...events,{at:t+DAY,up:false}]) {
      if(up){const left=Math.max(cursor,start),right=Math.min(e.at,end);if(right>left)spans.push([left,right]);}
      cursor=e.at;up=e.up;
    }
  }
  return mergeSpans(spans);
}
function mergeSpans(spans:Span[]):Span[] {
  const result:[number,number][]=[];
  for(const [a,b] of spans.sort((x,y)=>x[0]-y[0])) {
    const last=result.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else result.push([a,b]);
  }
  return result;
}
export function visibilityMetrics(spans:Span[],start:number,end:number) {
  let visible=0,gap=0,cursor=start;
  for(const [a,b] of spans){const left=Math.max(a,start),right=Math.min(b,end);if(right<=left)continue;
    gap=Math.max(gap,left-cursor);visible+=right-left;cursor=right;}
  gap=Math.max(gap,end-cursor);
  return {fraction:visible/(end-start),hours:visible/HOUR,longestOutageHours:gap/HOUR};
}
function terrainState(t:TerrainScreen,c:LandingCriteria):State {
  requireCondition(t&&Number.isFinite(t.baselineM)&&Number.isFinite(t.resolutionM)&&t.resolutionM>0&&typeof t.source==='string'&&
    (t.slopeDeg===null||Number.isFinite(t.slopeDeg)&&t.slopeDeg>=0&&t.slopeDeg<=90),'INVALID_RESPONSE','Invalid terrain screen');
  // Require at least five source pixels across the fixed NASA screening baseline.
  if(t.slopeDeg===null||t.baselineM!==100||t.resolutionM>20)return 'unknown';
  return t.slopeDeg<c.maxSlopeDeg?'pass':'fail';
}
export function createLandingPlanner(source:LandingSource,options:LandingPlannerOptions={}) {
  const sourcePolicy=options.sourcePolicy??'prefer-published';
  requireCondition(['prefer-published','published-only'].includes(sourcePolicy),'INVALID_INPUT','Invalid Travel source policy');
  async function prepare(point:LandingPoint,start:number,end:number,signal?:AbortSignal,screen?:TerrainScreen) {
    point={...point,lon:validatePoint(point.lat,point.lon)};
    parseUtc(new Date(end).toISOString(),true);throwIfAborted(signal);
    const terrain=screen??await source.terrain(point,signal),sun:Span[]=[],earth:Span[]=[];
    const segments:{startUtc:string;endUtc:string;quality:'accurate'|'estimate';requestedQuality:'accurate'|'estimate';
      reason:'published'|'outside-published-window'|'published-unavailable'|'unavailable';available:boolean;provenance:Record<string,unknown>|null}[]=[];
    const cuts=[start,Date.parse(PUBLISHED_WINDOW.start),Date.parse(PUBLISHED_WINDOW.end),end].filter(x=>x>=start&&x<=end);
    const bounds=[...new Set(cuts)].sort((a,b)=>a-b);
    for(let i=1;i<bounds.length;i++) {
      const a=bounds[i-1],b=bounds[i],requestedQuality=a>=Date.parse(PUBLISHED_WINDOW.start)&&a<Date.parse(PUBLISHED_WINDOW.end)?'accurate':'estimate';
      let quality:'accurate'|'estimate'=requestedQuality;
      const startUtc=new Date(Math.floor(a/DAY)*DAY).toISOString(),endUtc=new Date(Math.ceil(b/DAY)*DAY).toISOString();
      let f=await source.forecast(point,startUtc,endUtc,quality,signal);
      throwIfAborted(signal);
      // Only an explicit absence permits fallback. Invalid products and transport errors remain errors.
      if(!f&&quality==='accurate'&&sourcePolicy==='prefer-published') {
        quality='estimate';f=await source.forecast(point,startUtc,endUtc,quality,signal);
      }
      throwIfAborted(signal);
      if(f) {
        requireCondition(Math.abs(f.lat-point.lat)<1e-7&&Math.abs(((f.lon-point.lon+540)%360)-180)<1e-7&&
          f.science?.referenceFrame==='MOON_ME_DE421'&&f.science.elevationDatum==='sphere-1737400m'&&f.science.visibility==='center'&&
          (quality==='estimate'?f.quality==='estimate':f.quality!=='estimate'),'INVALID_RESPONSE','Wrong forecast point, frame or quality');
        sun.push(...visibilitySpans(f,'sun',a,b));earth.push(...visibilitySpans(f,'earth',a,b));
      }
      segments.push({startUtc:new Date(a).toISOString(),endUtc:new Date(b).toISOString(),quality,requestedQuality,
        reason:!f?'unavailable':requestedQuality==='estimate'?'outside-published-window':quality==='accurate'?'published':'published-unavailable',
        available:!!f,provenance:f?.science??null});
    }
    return {point,terrain,sun:mergeSpans(sun),earth:mergeSpans(earth),segments};
  }
  function assess(data:Awaited<ReturnType<typeof prepare>>,a:number,c:LandingCriteria) {
    const b=a+c.durationDays*DAY,segments=data.segments.filter(s=>Date.parse(s.startUtc)<b&&Date.parse(s.endUtc)>a);
    const available=segments.every(s=>s.available),sun=available?visibilityMetrics(data.sun,a,b):null,earth=available?visibilityMetrics(data.earth,a,b):null;
    const checks:{terrain:State;sunlight:State;earth:State}={terrain:terrainState(data.terrain,c),
      sunlight:sun?(sun.fraction>=c.minSunFraction&&sun.longestOutageHours<=c.maxDarkHours?'pass':'fail'):'unknown',
      earth:earth?(earth.fraction>=c.minEarthFraction&&earth.longestOutageHours<=c.maxEarthOutageHours?'pass':'fail'):'unknown'};
    const active=[...(c.terrainEnabled?[checks.terrain]:[]),...(c.sunlightEnabled?[checks.sunlight]:[]),...(c.earthEnabled?[checks.earth]:[])];
    const status:State=active.includes('fail')?'fail':active.includes('unknown')?'unknown':'pass';
    const guidance:string[]=[];
    if(checks.terrain==='unknown')guidance.push('Terrain cannot resolve the 100 m footprint. Obtain a DEM at 20 m or finer and inspect rocks, craters and local roughness.');
    if(checks.terrain==='fail')guidance.push('Slope exceeds your screen. Move to a flatter nearby footprint; changing the date cannot fix terrain.');
    if(checks.sunlight==='fail')guidance.push('Try a different arrival date or shorter stay; review the longest darkness interval against energy storage.');
    if(checks.earth==='fail')guidance.push('Try a different site or arrival date; Earth occultation may require a relay. Earth-centre visibility is not a radio link budget.');
    if(!available)guidance.push('Forecast coverage is unavailable under the selected source policy. Prepare this location or select the published-preferred estimate policy.');
    if(segments.some(s=>s.reason==='published-unavailable'))guidance.push('Published Python coverage is unavailable here; visibility uses a labelled quick estimate.');
    // The card preview consumes the same event intervals as the stay metrics. Clip UTC
    // days to the stay, retaining partial days and unknown coverage instead of zeroes.
    const days=[];
    for(let t=Math.floor(a/DAY)*DAY;t<b;t+=DAY) {
      const start=Math.max(t,a),end=Math.min(t+DAY,b);
      const parts=segments.filter(s=>Date.parse(s.startUtc)<end&&Date.parse(s.endUtc)>start);
      const known=parts.length>0&&parts.every(s=>s.available);
      const qualities=new Set(parts.map(s=>s.quality));
      days.push({date:new Date(t).toISOString().slice(0,10),startUtc:new Date(start).toISOString(),endUtc:new Date(end).toISOString(),
        durationHours:(end-start)/HOUR,sunHours:known?visibilityMetrics(data.sun,start,end).hours:null,
        earthHours:known?visibilityMetrics(data.earth,start,end).hours:null,
        quality:!known?'unknown':qualities.size>1?'mixed':parts[0].quality});
    }
    return {point:data.point,startUtc:new Date(a).toISOString(),endUtc:new Date(b).toISOString(),criteria:c,status,checks,sourcePolicy,
      terrain:data.terrain,sunlight:sun,earth,segments,days,guidance,
      limitation:'Regional screening only; no boulder, bearing-strength, descent, thermal, power or communications certification.'};
  }
  return {
    /** Seeded equal-area point sampling, stopping at quotas, budgets or a soft time limit. */
    async discover(startUtc:string,input:Partial<LandingCriteria>={},search:CandidateSearchOptions={}) {
      const c=landingCriteria(input),a=parseUtc(startUtc),end=a+c.durationDays*DAY;
      parseUtc(new Date(end).toISOString(),true);
      const target={south:search.southTarget??3,elsewhere:search.elsewhereTarget??12},
        budget={south:search.maxSouthSamples??24,elsewhere:search.maxElsewhereSamples??72},
        seed=search.seed??search.cursor?.seed??20261115,maxElapsedMs=search.maxElapsedMs??45000,
        southLatitudeLimit=search.southLatitudeLimit??search.cursor?.southLatitudeLimit??-80;
      requireCondition(Object.values(target).every(x=>Number.isInteger(x)&&x>=0&&x<=256)&&
        Object.values(budget).every(x=>Number.isInteger(x)&&x>=0&&x<=512)&&
        Number.isInteger(seed)&&seed>=0&&seed<=0xffffffff&&Number.isFinite(maxElapsedMs)&&maxElapsedMs>0&&maxElapsedMs<=300000,
        'INVALID_INPUT','Invalid candidate target, sample budget, seed or time limit');
      requireCondition(Number.isFinite(southLatitudeLimit)&&southLatitudeLimit>-90&&southLatitudeLimit<=-60,
        'INVALID_INPUT','South region limit must be above -90 and at most -60 degrees');
      const anchorRadiusKm=search.anchorRadiusKm??10;
      requireCondition(Array.isArray(search.southAnchors??[])&&(search.southAnchors?.length??0)<=32&&
        Number.isFinite(anchorRadiusKm)&&anchorRadiusKm>0&&anchorRadiusKm<=50,'INVALID_INPUT','Supply at most 32 south anchors and a radius up to 50 km');
      const southAnchors=(search.southAnchors??[]).map(p=>({...p,lon:validatePoint(p.lat,p.lon)}));
      requireCondition(southAnchors.every(p=>p.lat<southLatitudeLimit),'INVALID_INPUT','Anchors must lie inside the south region');
      const anchorKey=JSON.stringify([anchorRadiusKm,southAnchors.map(p=>[p.lat,p.lon])]);
      const cursor:CandidateCursor=search.cursor?{...search.cursor}:{version:1,seed,southLatitudeLimit,anchorKey,southOffset:0,elsewhereOffset:0};
      requireCondition(cursor.version===1&&cursor.seed===seed&&cursor.southLatitudeLimit===southLatitudeLimit&&cursor.anchorKey===anchorKey&&
        [cursor.southOffset,cursor.elsewhereOffset].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000000),
        'INVALID_INPUT','Invalid or incompatible discovery cursor');
      requireCondition(Array.isArray(search.exclude??[])&&(search.exclude?.length??0)<=10000,'INVALID_INPUT','Supply at most 10000 excluded points');
      const pointKey=(p:LandingPoint)=>{const lon=validatePoint(p.lat,p.lon);return `${Math.round(p.lat*1e7)}:${Math.round(lon*1e7)%3600000000}`;};
      const seen=new Set((search.exclude??[]).map(pointKey));
      requireCondition(Array.isArray(search.southSeeds??[])&&(search.southSeeds?.length??0)<=32,'INVALID_INPUT','Supply at most 32 south-pole seeds');
      const southSeeds=(search.southSeeds??[]).map(p=>({...p,lon:validatePoint(p.lat,p.lon)})),seedKeys=new Set<string>();
      for(const p of southSeeds) {
        const key=`${p.lat}:${p.lon}`;
        requireCondition(p.lat<southLatitudeLimit&&!seedKeys.has(key),'INVALID_INPUT','South seeds must be unique points inside the south region');
        seedKeys.add(key);
      }
      const clock=performance.now(),attempted={south:0,elsewhere:0},excluded={south:0,elsewhere:0},terrainSkipped={fail:0,unknown:0},visibilityRejected={sunlight:0,earth:0},
        candidates:{south:ReturnType<typeof assess>[];elsewhere:ReturnType<typeof assess>[]}={south:[],elsewhere:[]},
        samples:{group:'south'|'elsewhere';sampling:'seed'|'random'|'nearby';point:LandingPoint;status:State;terrain:TerrainScreen;result:ReturnType<typeof assess>|null;
          rejection?:CandidateRejection;timings:{terrainMs:number;forecastMs:number;totalMs:number}}[]=[];
      let timedOut=false,seedIndex=0,southTurns=0,current:CandidateProgress['current'];
      const progress=():CandidateProgress=>({attempted:{...attempted},found:{south:candidates.south.length,elsewhere:candidates.elsewhere.length},
        target:{...target},terrainSkipped:{...terrainSkipped},excluded:{...excluded},visibilityRejected:{...visibilityRejected},elapsedMs:performance.now()-clock,
        current:current?{...current,point:{...current.point}}:undefined});
      const available=(g:'south'|'elsewhere')=>candidates[g].length<target[g]&&attempted[g]<budget[g]&&excluded[g]<=10032;
      // Spend four turns elsewhere per south turn: fine polar horizons are substantially more expensive.
      search.onProgress?.(progress());
      while(available('south')||available('elsewhere')) {
        for(const group of ['elsewhere','elsewhere','elsewhere','elsewhere','south'] as const) {
          if(!available(group))continue;
          throwIfAborted(search.signal);
          if(performance.now()-clock>=maxElapsedMs){timedOut=true;break;}
          const seeded=group==='south'&&southTurns++%2===0?southSeeds[seedIndex++]:undefined;
          let sampling:'seed'|'random'|'nearby'=seeded?'seed':'random';
          let point:LandingPoint;
          if(seeded)point=seeded;
          else {
            const offset=group==='south'?'southOffset':'elsewhereOffset';
            const index=cursor[offset]++;
            if(group==='south'&&southAnchors.length&&index%2===0) {
              sampling='nearby';point=nearbyPoint(southAnchors[(index/2)%southAnchors.length],seed,index,anchorRadiusKm,southLatitudeLimit);
            } else point=candidatePoint(seed,group==='south'&&southAnchors.length?Math.floor(index/2):index,group,southLatitudeLimit);
          }
          const key=pointKey(point);if(seen.has(key)){excluded[group]++;continue;}seen.add(key);
          const pointClock=performance.now();current={group,point,stage:'terrain'};search.onProgress?.(progress());throwIfAborted(search.signal);
          const terrain=await source.terrain(point,search.signal),terrainCheck=terrainState(terrain,c);
          const terrainMs=performance.now()-pointClock;
          throwIfAborted(search.signal);attempted[group]++;
          // Coarse terrain can never become a pass by spending time tracing a visibility horizon.
          if(c.terrainEnabled&&terrainCheck!=='pass') {
            terrainSkipped[terrainCheck]++;samples.push({group,sampling,point,status:terrainCheck,terrain,result:null,
              timings:{terrainMs,forecastMs:0,totalMs:performance.now()-pointClock}});
          } else {
            if(source.precheck&&(sourcePolicy==='prefer-published'||end<=Date.parse(PUBLISHED_WINDOW.start)||a>=Date.parse(PUBLISHED_WINDOW.end))) {
              current={group,point,stage:'visibility-bound'};search.onProgress?.(progress());throwIfAborted(search.signal);
              const rejected=await source.precheck(point,startUtc,new Date(end).toISOString(),c,search.signal);throwIfAborted(search.signal);
              if(rejected) {
                requireCondition(rejected.kind==='always-below-terrain-bound'&&['sunlight','earth'].includes(rejected.body)&&
                  rejected.maximumVisibleHours===0&&Number.isFinite(rejected.minimumOutageHours)&&rejected.minimumOutageHours>=c.durationDays*24&&Number.isFinite(rejected.horizonLowerBoundDeg)&&Math.abs(rejected.horizonLowerBoundDeg)<90&&
                  rejected.quality==='estimate'&&(rejected.body==='sunlight'?c.sunlightEnabled&&(c.minSunFraction>0||c.maxDarkHours<c.durationDays*24):
                    c.earthEnabled&&(c.minEarthFraction>0||c.maxEarthOutageHours<c.durationDays*24)),
                  'INVALID_RESPONSE','Invalid candidate rejection proof');
                visibilityRejected[rejected.body]++;
                samples.push({group,sampling,point,status:'fail',terrain,result:null,rejection:rejected,
                  timings:{terrainMs,forecastMs:performance.now()-pointClock-terrainMs,totalMs:performance.now()-pointClock}});
                current=undefined;search.onProgress?.(progress());continue;
              }
            }
            current={group,point,stage:'forecast'};search.onProgress?.(progress());throwIfAborted(search.signal);
            const forecastClock=performance.now();
            const result=assess(await prepare(point,a,end,search.signal,terrain),a,c);
            samples.push({group,sampling,point,status:result.status,terrain,result,
              timings:{terrainMs,forecastMs:performance.now()-forecastClock,totalMs:performance.now()-pointClock}});
            if(result.status==='pass'){
              candidates[group].push(result);search.onCandidate?.({group,sampling,result:structuredClone(result),elapsedMs:performance.now()-clock});
            }
          }
          current=undefined;search.onProgress?.(progress());
        }
        if(timedOut)break;
      }
      throwIfAborted(search.signal);
      const shortfall={south:Math.max(0,target.south-candidates.south.length),elsewhere:Math.max(0,target.elsewhere-candidates.elsewhere.length)};
      return {startUtc:new Date(a).toISOString(),criteria:c,sourcePolicy,seed,southSeeds,southAnchors,anchorRadiusKm,budget,maxElapsedMs,...progress(),candidates,samples,shortfall,cursor,
        stopReason:!shortfall.south&&!shortfall.elsewhere?'targets-met':timedOut?'time-budget':'sample-budget',
        bounds:{south:{south:-90,north:southLatitudeLimit},elsewhere:{south:southLatitudeLimit,north:90}},
        guidance:shortfall.south||shortfall.elsewhere?[
          'The bounded sample did not find the requested number of passes. Filters were not relaxed; this does not prove no qualifying location exists.',
          ...(terrainSkipped.unknown?['Unresolved terrain was skipped before visibility computation. Global coarse terrain cannot satisfy the default slope filter. Supply a 20 m or finer DEM, or explicitly disable terrain to search visibility-only candidates.']:[])]:[],
        limitation:'Random point screening, not a whole-region survey. The time budget is checked between points; an in-flight point may exceed it. Run in a worker for responsive cancellation.'};
    },
    async evaluate(point:LandingPoint,startUtc:string,input:Partial<LandingCriteria>={},signal?:AbortSignal) {
      const c=landingCriteria(input),a=parseUtc(startUtc);return assess(await prepare(point,a,a+c.durationDays*DAY,signal),a,c);
    },
    async windows(point:LandingPoint,startUtc:string,input:Partial<LandingCriteria>={},options:{stepHours?:number;signal?:AbortSignal}={}) {
      const c=landingCriteria(input),a=parseUtc(startUtc),last=parseUtc(sixMonthsAfter(startUtc)),step=options.stepHours??24;
      requireCondition(Number.isFinite(step)&&step>=1&&step<=168,'INVALID_INPUT','Arrival cadence must be 1–168 hours');
      const data=await prepare(point,a,last+c.durationDays*DAY,options.signal),results:ReturnType<typeof assess>[]=[];
      for(let t=a;t<last;t+=step*HOUR){throwIfAborted(options.signal);results.push(assess(data,t,c));}
      const rank=(r:typeof results[number])=>Math.min(...[...(c.sunlightEnabled?[r.sunlight?.fraction??-1]:[]),...(c.earthEnabled?[r.earth?.fraction??-1]:[]),1]);
      const candidates=results.filter(r=>r.status==='pass').sort((x,y)=>rank(y)-rank(x)||x.startUtc.localeCompare(y.startUtc));
      return {searchStartUtc:startUtc,searchEndUtc:new Date(last).toISOString(),stepHours:step,best:candidates[0]??null,candidates,results,
        guidance:candidates.length?[]:['No sampled arrival meets all enabled criteria. Inspect failed and unresolved checks before adjusting constraints.'],
        limitation:'Arrival times are sampled at the stated cadence; this is not a trajectory or launch-window calculation.'};
    },
    async regions(cells:LandingCell[],startUtc:string,input:Partial<LandingCriteria>={},signal?:AbortSignal) {
      requireCondition(cells.length>0&&cells.length<=256,'LIMIT_EXCEEDED','Supply 1–256 cells per batch');
      const ids=new Set<string>();
      for(const cell of cells) {
        const ring=cell.geometry?.coordinates?.[0];
        requireCondition(typeof cell.id==='string'&&cell.id.length>0&&!ids.has(cell.id)&&cell.geometry?.type==='Polygon'&&
          cell.geometry.coordinates.length===1&&Array.isArray(ring)&&ring.length>=4&&
          ring.every(p=>p.length===2&&p.every(Number.isFinite)&&Math.abs(p[1])<=90)&&
          ring[0][0]===ring.at(-1)![0]&&ring[0][1]===ring.at(-1)![1], 'INVALID_INPUT','Invalid cell identity or closed lunar polygon');
        ids.add(cell.id);
      }
      const features=[];
      for(const cell of cells){throwIfAborted(signal);const result=await this.evaluate(cell.point,startUtc,input,signal);
        features.push({type:'Feature' as const,id:cell.id,geometry:cell.geometry,properties:{...result,sampling:'cell-centre only; polygon is a display bin, not a surveyed landing zone'}});}
      return {type:'FeatureCollection' as const,referenceFrame:'MOON_ME_DE421',features,layers:{terrain:features.filter(f=>f.properties.checks.terrain==='pass').map(f=>f.id),
        sunlight:features.filter(f=>f.properties.checks.sunlight==='pass').map(f=>f.id),earth:features.filter(f=>f.properties.checks.earth==='pass').map(f=>f.id),
        combined:features.filter(f=>f.properties.status==='pass').map(f=>f.id)}};
    }
  };
}
export interface LandingCell {id:string;point:LandingPoint;geometry:{type:'Polygon';coordinates:number[][][]}}
/** Equal-area bins cover the whole lunar sphere, including both polar caps.
 * Only polygon boundaries touch the poles; all scientific sample points stay off them.
 * Submit large grids to regions() in batches of at most 256 cells.
 */
export function globalLandingGrid(rows=12,columns=24):LandingCell[] {
  requireCondition(Number.isInteger(rows)&&Number.isInteger(columns)&&rows>=2&&columns>=4&&rows*columns<=4096,
    'INVALID_INPUT','Use 2+ latitude bands, 4+ longitude sectors and at most 4096 global cells');
  const cells:LandingCell[]=[];
  for(let r=0;r<rows;r++)for(let c=0;c<columns;c++) {
    const s=Math.asin(-1+2*r/rows)*180/Math.PI,n=Math.asin(-1+2*(r+1)/rows)*180/Math.PI,
      w=-180+360*c/columns,e=-180+360*(c+1)/columns;
    const id=`global-${r}-${c}`;
    cells.push({id,point:{id,name:`Global lunar cell ${r+1}/${c+1}`,lat:Math.asin(-1+2*(r+.5)/rows)*180/Math.PI,
      lon:((w+e)/2+360)%360},geometry:{type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}});
  }
  return cells;
}
/** Explicit geographic bins, east-positive longitude. Bounds may extend past 180 to cross the seam. */
export function landingGrid(bounds:{south:number;north:number;west:number;east:number},rows=3,columns=3):LandingCell[] {
  const {south,north,west,east}=bounds;
  requireCondition([south,north,west,east].every(Number.isFinite)&&south>-90&&north<90&&north>south&&east>west&&east-west<=360&&
    Number.isInteger(rows)&&Number.isInteger(columns)&&rows>0&&columns>0&&rows*columns<=256,'INVALID_INPUT','Invalid grid bounds or dimensions');
  const result:LandingCell[]=[];
  for(let r=0;r<rows;r++)for(let c=0;c<columns;c++) {
    const s=south+(north-south)*r/rows,n=south+(north-south)*(r+1)/rows,w=west+(east-west)*c/columns,e=west+(east-west)*(c+1)/columns;
    result.push({id:`${r}:${c}`,point:{lat:(s+n)/2,lon:((w+e)/2%360+360)%360},
      geometry:{type:'Polygon',coordinates:[[[w,s],[e,s],[e,n],[w,n],[w,s]]]}});
  }
  return result;
}
