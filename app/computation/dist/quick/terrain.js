import { normalizeLongitude, requireCondition, throwIfAborted } from '../core.js';
import { gunzip, loadBytes, sha256 } from './coefficients.js';

import { decodeTerrainDelta } from './terrain-codec.js';

const R=1737400,DEG=180/Math.PI,POLAR_Z=Math.sin(-87.5/DEG);
const GLOBAL_HASH='45a2b32d56e81ed30db07fead8abc842b249b6511219d9ca2c53f81bc2dc5d62';
const POLAR_HASH='dc16bba853b22fa29e26dc26b411acc180de70478578b2c75c8e6f253f56a9d9';
const BOUNDS_HASH='5c854b9add42b210f06792cde2067582e720d07f1b9f49b40c5ed1b4d255ac4d';

export const TERRAIN_MODEL='LOLA16-polar20-ray150km-az0.25-v1';

/** Scientific adapter of the pinned shipped grids; no display blending or exaggeration. */
export class Terrain {
          global                              = new Array(18*36);
          polar                             = new Array(15*15);
          maxElevation=-Infinity;
          minElevation=Infinity;
  /** Loaded pixels bound the prepared footprint only when all its tiles were loaded. */
  get maximumElevation(){return this.demand?Infinity:this.maxElevation;}
  get minimumElevation(){return this.demand?-Infinity:this.minElevation;}
          polarFiles                                                   ={};
          bounds            ;
          demand=false;
          pending=new Set        ();
  bytesLoaded=0;
  loadTimeMs=0;
           read          ;         base    ;
  constructor(read            = loadBytes, base = new URL('../../../assets/observer/terrain/',import.meta.url)) {
    this.read=read;this.base=base;
  }
  async prepare(lat        , lon        , signal              , demand=false) {
    const started=performance.now();throwIfAborted(signal);
    this.demand=demand;this.pending.clear();
    const decode=async(path       )=>JSON.parse(new TextDecoder().decode(await this.read(new URL(path,this.base),signal)));
    const [g,p]=await Promise.all([decode('manifest.json'),decode('polar20-delta-v1/manifest.json')]);
    requireCondition(g.sourceSha256===GLOBAL_HASH && g.referenceFrame==='LOLA-ME' && g.radiusM===R &&
      g.elevationDatum==='sphere-1737400m' && p.sourceSha256===POLAR_HASH && p.product==='LDEM_875S_20M' &&
      p.frame==='MEAN EARTH/POLAR AXIS OF DE421' && p.spacingM===20 && p.radiusM===R && p.width===7584 &&
      p.tileSize===512 && p.scaleM===.5 && p.encoding==='row-delta16-byteplanes-gzip-v1' && p.decodedEncoding==='int16-le',
      'INCOMPATIBLE_FRAME','Terrain manifest is not the reviewed LOLA product');
    this.polarFiles=p.files;
    const angle=150000/R,latitude=lat/DEG,lon0=normalizeLongitude(lon+180);
    const minLat=Math.max(-90,lat-angle*DEG),maxLat=Math.min(90,lat+angle*DEG);
    const halfLon=Math.max(Math.abs(minLat),Math.abs(maxLat))>=90 ? 180 : Math.asin(Math.sin(angle)/Math.cos(latitude))*DEG;
    const jobs          =[];
    const r0=Math.max(0,Math.floor(((90-maxLat)*16-1.5)/160));
    const r1=Math.min(17,Math.floor(((90-minLat)*16+.5)/160));
    const columns=new Set        ();
    for(let c=Math.floor((lon0-halfLon-.1)/10);c<=Math.floor((lon0+halfLon+.1)/10);c++)columns.add((c%36+36)%36);
    for(let row=r0;row<=r1;row++)for(const col of columns)if(!this.global[row*36+col])jobs.push({kind:'global',row,col});
    if(minLat<=-87.5&&demand&&!this.bounds) {
      const raw=await this.read(new URL('polar20-bounds-v1.bin',this.base),signal);
      requireCondition(raw.byteLength===120*120*2&&await sha256(raw)===BOUNDS_HASH,
        'INVALID_RESPONSE','Terrain height bounds checksum mismatch');
      throwIfAborted(signal);this.bounds=new Int16Array(raw);this.bytesLoaded+=raw.byteLength;
    }
    if(minLat<=-87.5&&!demand) {
      // Conservative stereographic bounds, padded for scale distortion and bilinear neighbours.
      const rho=2*R*Math.tan(Math.PI/4+latitude/2),x=rho*Math.sin(lon/DEG),y=rho*Math.cos(lon/DEG),extent=153100;
      const c0=Math.max(0,Math.floor((3791.5+(x-extent)/20)/512)),c1=Math.min(14,Math.floor((3791.5+(x+extent)/20)/512));
      const pr0=Math.max(0,Math.floor((3791.5-(y+extent)/20)/512)),pr1=Math.min(14,Math.floor((3791.5-(y-extent)/20)/512));
      const polarExtent=2*R*Math.tan(Math.PI/4-87.5/DEG/2)+40;
      const gap=(a       ,b       )=>a<=0&&b>=0?0:Math.min(Math.abs(a),Math.abs(b));
      for(let row=pr0;row<=pr1;row++)for(let col=c0;col<=c1;col++) {
        // Skip only tiles wholly outside the chosen polar product footprint, with two-pixel padding.
        const dx=gap((col*512-3791.5)*20,((col+1)*512-3791.5)*20);
        const dy=gap((row*512-3791.5)*20,((row+1)*512-3791.5)*20);
        if(Math.hypot(dx,dy)<=polarExtent&&!this.polar[row*15+col])jobs.push({kind:'polar',row,col});
      }
    }
    await this.loadTiles(jobs,signal);this.loadTimeMs+=performance.now()-started;
  }
          async loadTiles(jobs          ,signal             ) {
    let next=0;
    await Promise.all(Array.from({length:Math.min(8,jobs.length)},async()=>{
      for(;;){const i=next++;if(i>=jobs.length)return;throwIfAborted(signal);
        const j=jobs[i],isPolar=j.kind==='polar';
        const name=`${j.row}-${j.col}.bin.gz`,entry=isPolar?this.polarFiles?.[name]:undefined;
        if(isPolar)requireCondition(Number.isInteger(entry?.bytes)&&entry .bytes>0&&typeof entry .decodedSha256==='string'&&
          /^[a-f0-9]{64}$/.test(entry .decodedSha256),'INVALID_RESPONSE','Invalid encoded terrain metadata');
        const packed=await this.read(new URL(`${isPolar?'polar20-delta-v1':'16'}/${name}`,this.base),signal);
        if(isPolar)requireCondition(packed.byteLength===entry .bytes,'INVALID_RESPONSE','Encoded terrain size mismatch');
        let raw=await gunzip(packed);throwIfAborted(signal);
        if(isPolar) {
          raw=decodeTerrainDelta(raw);
          requireCondition(await sha256(raw)===entry .decodedSha256,'INVALID_RESPONSE','Decoded terrain checksum mismatch');
          throwIfAborted(signal);
        }
        requireCondition(raw.byteLength===(isPolar?512*512:160*160)*2,'INVALID_RESPONSE','Invalid terrain tile');
        this.bytesLoaded+=packed.byteLength;
        const values=isPolar?new Int16Array(raw):new Uint16Array(raw);
        let max=-Infinity,min=Infinity;
        for(let k=0;k<values.length;k++){const value=values[k];if(value>max)max=value;if(value<min)min=value;}
        this.maxElevation=Math.max(this.maxElevation,max*.5-(isPolar?0:10000));
        this.minElevation=Math.min(this.minElevation,min*.5-(isPolar?0:10000));
        if(isPolar)this.polar[j.row*15+j.col]=values              ;else this.global[j.row*36+j.col]=values               ;
      }
    }));
  }
  /** Bound all four bilinear neighbours, never just the containing block. */
  upperBound(x       ,y       ,z       )        {
    if(!this.demand||!this.bounds||z>POLAR_Z)return Infinity;
    const scale=2*R/(1-z)/20,c=Math.floor(3791.5+y*scale),r=Math.floor(3791.5-x*scale);
    if(r<0||c<0||r>=7583||c>=7583)return Infinity;
    const r0=Math.floor(r/64)*120,r1=Math.floor((r+1)/64)*120,c0=Math.floor(c/64),c1=Math.floor((c+1)/64);
    // One metre of slack keeps the bound conservative under floating-point interpolation.
    return Math.max(this.bounds[r0+c0],this.bounds[r0+c1],this.bounds[r1+c0],this.bounds[r1+c1])*.5+1;
  }
  /** Queue missing exact tiles; the tracer pauses this ray until they arrive. */
  requireSample(x       ,y       ,z       )         {
    if(!this.demand||z>POLAR_Z)return true;
    const scale=2*R/(1-z)/20,c=Math.floor(3791.5+y*scale),r=Math.floor(3791.5-x*scale);
    if(r<0||c<0||r>=7583||c>=7583)return true;
    let ready=true;
    for(let row=Math.floor(r/512);row<=Math.floor((r+1)/512);row++)
      for(let col=Math.floor(c/512);col<=Math.floor((c+1)/512);col++) {
        const key=row*15+col;
        if(!this.polar[key]){this.pending.add(key);ready=false;}
      }
    return ready;
  }
  async loadPending(signal             ) {
    const started=performance.now(),keys=[...this.pending];this.pending.clear();
    await this.loadTiles(keys.map(key=>({kind:'polar',row:Math.floor(key/15),col:key%15})),signal);
    this.loadTimeMs+=performance.now()-started;
  }
          globalPixel(row       ,col       )        {
    row=Math.max(0,Math.min(2879,row));col=(col%5760+5760)%5760;
    const tile=this.global[Math.floor(row/160)*36+Math.floor(col/160)];
    if(!tile)throw new Error('Required global terrain tile is missing');
    return tile[(row%160)*160+col%160]*.5-10000;
  }
          polarPixel(row       ,col       )        {
    const tile=this.polar[Math.floor(row/512)*15+Math.floor(col/512)];
    if(!tile)throw new Error('Required polar terrain tile is missing');
    return tile[(row%512)*512+col%512]*.5;
  }
  sample(x       ,y       ,z       )        {
    if(z<=POLAR_Z) {
      const scale=2*R/(1-z)/20,px=3791.5+y*scale,py=3791.5-x*scale;
      const c=Math.floor(px),r=Math.floor(py),fc=px-c,fr=py-r;
      if(r>=0&&c>=0&&r<7583&&c<7583) {
        const localRow=r%512,localCol=c%512;
        if(localRow<511&&localCol<511) {
          const tile=this.polar[Math.floor(r/512)*15+Math.floor(c/512)],i=localRow*512+localCol;
          if(!tile)throw new Error('Required polar terrain tile is missing');
          // Same interpolation and arithmetic order; avoid four repeated tile lookups.
          return (tile[i]*.5*(1-fc)+tile[i+1]*.5*fc)*(1-fr)+
            (tile[i+512]*.5*(1-fc)+tile[i+513]*.5*fc)*fr;
        }
        return (this.polarPixel(r,c)*(1-fc)+this.polarPixel(r,c+1)*fc)*(1-fr)+
          (this.polarPixel(r+1,c)*(1-fc)+this.polarPixel(r+1,c+1)*fc)*fr;
      }
    }
    const px=(Math.atan2(y,x)*DEG+180)*16-.5,py=Math.max(0,Math.min(2879,(90-Math.asin(Math.max(-1,Math.min(1,z)))*DEG)*16-.5));
    const c=Math.floor(px),r=Math.floor(py),fc=px-c,fr=py-r;
    const localRow=r%160,localCol=c%160;
    if(r>=0&&r<2879&&c>=0&&c<5759&&localRow<159&&localCol<159) {
      const tile=this.global[Math.floor(r/160)*36+Math.floor(c/160)],i=localRow*160+localCol;
      if(!tile)throw new Error('Required global terrain tile is missing');
      return ((tile[i]*.5-10000)*(1-fc)+(tile[i+1]*.5-10000)*fc)*(1-fr)+
        ((tile[i+160]*.5-10000)*(1-fc)+(tile[i+161]*.5-10000)*fc)*fr;
    }
    return (this.globalPixel(r,c)*(1-fc)+this.globalPixel(r,c+1)*fc)*(1-fr)+
      (this.globalPixel(r+1,c)*(1-fc)+this.globalPixel(r+1,c+1)*fc)*fr;
  }
}

export function validatePoint(lat       ,lon       ) {
  requireCondition(Number.isFinite(lat)&&Math.abs(lat)<90,'UNSUPPORTED','Use a latitude strictly between the poles');
  return normalizeLongitude(lon);
}
export function horizonKey(lat       ,lon       ) { return `${TERRAIN_MODEL}:${lat}:${normalizeLongitude(lon)}:2`; }

async function traceRays(terrain           ,lat       ,lon       ,bins                   ,signal             ) {
  lon=validatePoint(lat,lon);throwIfAborted(signal);
  const p=lat/DEG,l=lon/DEG,sp=Math.sin(p),cp=Math.cos(p),sl=Math.sin(l),cl=Math.cos(l);
  const ux=cp*cl,uy=cp*sl,uz=sp;
  if(terrain.requireSample&&!terrain.requireSample(ux,uy,uz))await terrain.loadPending (signal);
  const ground=terrain.sample(ux,uy,uz),eye=R+ground+2;
  // Loaded pixels bound complete preparations only. Demand loading returns Infinity.
  const ceiling=terrain.maximumElevation,maxTarget=ceiling!==undefined&&Number.isFinite(ceiling)?R+ceiling+1e-6:Infinity;
  // At most one pixel of the fine grid per step; global rays retain Python's 60 m spacing.
  const step=lat-150000/R*DEG<=-87.5?20:60,n=150000/step;
  const sin=new Float64Array(n),cos=new Float64Array(n),upper=new Float64Array(n).fill(Infinity),mask=new Float64Array(1440).fill(NaN);
  const selected=bins?[...new Set(bins)].sort((a,b)=>a-b):Array.from({length:1440},(_,i)=>i);
  requireCondition(selected.length>0&&selected.every(a=>Number.isInteger(a)&&a>=0&&a<1440),'INVALID_INPUT','Invalid horizon azimuth bins');
  for(let i=0;i<n;i++){sin[i]=Math.sin((i+1)*step/R);cos[i]=Math.cos((i+1)*step/R);}
  // A micron plus a slope margin covers floating-point interpolation/roundoff.
  for(let i=0;i<n-1;i++)if(Number.isFinite(maxTarget)&&eye*cos[i+1]<=maxTarget)
    upper[i]=(maxTarget*cos[i+1]-eye)/(maxTarget*sin[i+1])+1e-10;
  const progress=new Uint32Array(mask.length),bestSlopes=new Float64Array(mask.length).fill(-Infinity);
  let waiting        ;
  do {
    waiting=false;
    for(const a of selected) {
      throwIfAborted(signal);
      if(progress[a]===n)continue;
      const ca=Math.cos(a*.25/DEG),sa=Math.sin(a*.25/DEG);
      const dx=-sl*sa-sp*cl*ca,dy=cl*sa-sp*sl*ca,dz=cp*ca;
      let best=bestSlopes[a],i=progress[a];
      for(;i<n;i++) {
        const s=sin[i],c=cos[i],x=ux*c+dx*s,y=uy*c+dy*s,z=uz*c+dz*s;
        const bound=terrain.upperBound?.(x,y,z)??Infinity;
        // An upper bound below the current maximum cannot change any horizon value.
        if(Number.isFinite(bound)) {
          const top=R+bound;
          if((top*c-eye)/(top*s)<best)continue;
        }
        if(terrain.requireSample&&!terrain.requireSample(x,y,z)){waiting=true;break;}
        const h=terrain.sample(x,y,z),target=R+h;
        const slope=(target*c-eye)/(target*s);if(slope>best)best=slope;
        if(upper[i]<best){i=n;break;}
      }
      progress[a]=i;bestSlopes[a]=best;
      if(i===n)mask[a]=Math.atan(best)*DEG;
    }
    if(waiting)await terrain.loadPending (signal);
  } while(waiting);
  requireCondition(Number.isFinite(ground)&&selected.every(a=>Number.isFinite(mask[a])&&Math.abs(mask[a])<=90),
    'INVALID_RESPONSE','Invalid terrain horizon');
  return {lat,lon,ground,step,mask,selected,sha256:await sha256(mask.buffer)};
}
export async function traceHorizon(terrain           ,lat       ,lon       ,signal             )                       {
  const r=await traceRays(terrain,lat,lon,undefined,signal),{ground,step,mask}=r;
  return {lat:r.lat,lon:r.lon,referenceFrame:'MOON_ME_DE421',datum:'sphere-1737400m',surfaceElevation:ground,observerHeight:2,
    step:1,terrain:'LOLA 16 px/deg + south-polar 20 m',model:TERRAIN_MODEL,rangeKm:150,rayStepM:step,
    elevations:Array.from({length:360},(_,i)=>Math.round(mask[i*4]*100)/100),calculation:{step:.25,elevations:mask},
    sha256:r.sha256};
}
/** Exact same rays as the full horizon; absent bearings cannot be queried or displayed. */
export async function traceForecastHorizon(terrain           ,lat       ,lon       ,bins                  ,signal             )                          {
  const r=await traceRays(terrain,lat,lon,bins,signal);
  return {surfaceElevation:r.ground,model:TERRAIN_MODEL,sha256:r.sha256,
    calculation:{step:.25,elevations:r.mask},azimuthBins:r.selected};
}
/** Both interpolation neighbours, including the wrap at north, for every sampled body. */
export function forecastHorizonBins(values             )          {
  requireCondition(values.length>0&&values.length%8===0,'INVALID_INPUT','Invalid ephemeris sample layout');
  const bins=new Set        ();
  for(let offset=0;offset<values.length;offset+=4){const az=values[offset];
    requireCondition(Number.isFinite(az),'INVALID_RESPONSE','Invalid azimuth');
    const i=Math.floor(((az%360+360)%360)*4);bins.add(i);bins.add((i+1)%1440);
  }
  return [...bins].sort((a,b)=>a-b);
}
export function maskAt(mask             ,az       ) {
  const x=((az%360+360)%360)*4,i=Math.floor(x),f=x-i;
  requireCondition(Number.isFinite(mask[i])&&Number.isFinite(mask[(i+1)%1440]),'INVALID_RESPONSE','Horizon bearing was not computed');
  return mask[i]+(mask[(i+1)%1440]-mask[i])*f;
}
