/** Experimental adapter only. Not imported by the shipped engine or any view. */
import {gunzip,loadBytes,sha256} from '../src/quick/coefficients.ts';
import type {LoadBytes} from '../src/quick/coefficients.ts';
import {requireCondition} from '../src/core.ts';
import type {QuickHorizon} from '../src/quick/terrain.ts';

const R=1737400,D=180/Math.PI;
type Grid={id:string;width:number;height:number;left:number;top:number;spacingM:number;scale:number;
  dtype:string;sourceSha256:string;tiles:Record<string,{bytes:number;sha256:string}>;
  loaded?:(Int16Array|Float32Array|undefined)[]};
const xy=(lat:number,lon:number)=>{const rho=2*R*Math.tan(Math.PI/4+lat/D/2);return [rho*Math.sin(lon/D),rho*Math.cos(lon/D)];};

export class ExperimentalPolar {
  private manifest:any;
  private coarse!:Grid;
  private fine:Grid[]=[];
  bytesLoaded=0;requests=0;
  readonly base:URL;readonly withFine:boolean;readonly read:LoadBytes;
  constructor(base:URL,withFine:boolean,read:LoadBytes=loadBytes){this.base=base;this.withFine=withFine;this.read=read;}
  async prepare(lat:number,lon:number){
    requireCondition(lat>-90&&lat<=-80&&Number.isFinite(lon),'UNSUPPORTED','Experimental coverage is 80 S to the south pole, excluding the exact pole');
    if(!this.manifest){const b=await this.read(new URL('manifest.json',this.base));this.bytesLoaded+=b.byteLength;this.requests++;
      this.manifest=JSON.parse(new TextDecoder().decode(b));}
    const m=this.manifest;
    requireCondition(m.format==='Tanaw-polar-experiment-v1'&&m.frame==='MOON_ME_DE421'&&m.datum==='sphere-1737400m'&&m.radiusM===R&&m.tileSize===256,
      'INVALID_RESPONSE','Invalid experimental terrain manifest');
    this.coarse=m.grids.find((g:Grid)=>g.id==='lola240');
    requireCondition(this.coarse?.sourceSha256==='d031efe2611b17dfbf3c158f5e15dc04cd5719349dcbf6384bb21fd97697c490'&&
      this.coarse.width===3812&&this.coarse.height===3812&&this.coarse.spacingM===240&&this.coarse.scale===.5&&
      this.coarse.dtype==='<i2'&&this.coarse.left===-457440&&this.coarse.top===457440,
      'INVALID_RESPONSE','Unreviewed 240 m source');
    const [x,y]=xy(lat,lon);
    // Match Python fine_maps_near: bounding-box gap <23 km, nearest centre first, filename tie break.
    this.fine=this.withFine?m.grids.filter((g:Grid)=>g.id!=='lola240'&&Math.hypot(
      Math.max(g.left-x,0,x-(g.left+g.width*g.spacingM)),Math.max(g.top-g.height*g.spacingM-y,0,y-g.top))<23000)
      .sort((a:Grid,b:Grid)=>Math.hypot(a.left+a.width*a.spacingM/2-x,a.top-a.height*a.spacingM/2-y)-
        Math.hypot(b.left+b.width*b.spacingM/2-x,b.top-b.height*b.spacingM/2-y)||(a.id<b.id?-1:a.id>b.id?1:0)):[];
    // Maximum stereographic scale over the ray disc gives a conservative rectangle, with neighbour padding.
    const extent=150000/Math.cos(((90+lat)/D+150000/R)/2)**2+480;
    const jobs:{g:Grid;r:number;c:number}[]=[];
    for(const g of [this.coarse,...this.fine]){
      g.loaded??=new Array(Math.ceil(g.height/256)*Math.ceil(g.width/256));
      const r0=Math.max(0,Math.floor(((g.top-y-extent)/g.spacingM-.5)/256));
      const r1=Math.min(Math.ceil(g.height/256)-1,Math.floor(((g.top-y+extent)/g.spacingM+.5)/256));
      const c0=Math.max(0,Math.floor(((x-extent-g.left)/g.spacingM-.5)/256));
      const c1=Math.min(Math.ceil(g.width/256)-1,Math.floor(((x+extent-g.left)/g.spacingM+.5)/256));
      for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)if(!g.loaded[r*Math.ceil(g.width/256)+c])jobs.push({g,r,c});
    }
    let next=0;await Promise.all(Array.from({length:Math.min(8,jobs.length)},async()=>{
      for(;;){const j=jobs[next++];if(!j)return;const {g,r,c}=j,key=`${g.id}/${r}-${c}`,meta=g.tiles[`${r}-${c}`];
        const b=await this.read(new URL(key+'.bin.gz',this.base));this.bytesLoaded+=b.byteLength;this.requests++;
        const raw=await gunzip(b);requireCondition(meta&&b.byteLength===meta.bytes&&await sha256(raw)===meta.sha256&&
          raw.byteLength===256*256*(g.dtype==='<i2'?2:4),'INVALID_RESPONSE','Corrupt experimental tile');
        g.loaded![r*Math.ceil(g.width/256)+c]=g.dtype==='<i2'?new Int16Array(raw):new Float32Array(raw);}
    }));
  }
  private pixel(g:Grid,r:number,c:number){const tile=g.loaded?.[Math.floor(r/256)*Math.ceil(g.width/256)+Math.floor(c/256)];
    if(!tile)throw Error('Required experimental tile missing');return tile[(r%256)*256+c%256]*g.scale;}
  private interpolate(g:Grid,row:number,col:number){
    const r=Math.max(0,Math.min(g.height-2,Math.floor(row))),c=Math.max(0,Math.min(g.width-2,Math.floor(col))),fr=row-r,fc=col-c;
    return (this.pixel(g,r,c)*(1-fc)+this.pixel(g,r,c+1)*fc)*(1-fr)+
      (this.pixel(g,r+1,c)*(1-fc)+this.pixel(g,r+1,c+1)*fc)*fr;
  }
  sample(x:number,y:number,z:number){
    const scale=2*R/(1-z),px=y*scale,py=x*scale;
    for(const g of this.fine){const row=(g.top-py)/g.spacingM-.5,col=(px-g.left)/g.spacingM-.5;
      if(row>=0&&row<=g.height-1&&col>=0&&col<=g.width-1){const v=this.interpolate(g,row,col);if(Number.isFinite(v))return v;}}
    const g=this.coarse,row=(g.top-py)/g.spacingM-.5,col=(px-g.left)/g.spacingM-.5;
    if(row<0||row>g.height-1||col<0||col>g.width-1)throw Error('Ray leaves experimental coverage');
    return this.interpolate(g,row,col);
  }
  get hasFine(){return this.fine.length>0;}
  get selectedFine(){return this.fine.map(g=>g.id);}
}

/** Same spherical ray formula, with Python's exact two-zone radial grid. */
export async function experimentalHorizon(terrain:ExperimentalPolar,lat:number,lon:number):Promise<QuickHorizon>{
  const p=lat/D,l=lon/D,sp=Math.sin(p),cp=Math.cos(p),sl=Math.sin(l),cl=Math.cos(l);
  const ux=cp*cl,uy=cp*sl,uz=sp,ground=terrain.sample(ux,uy,uz),eye=R+ground+2;
  const distances:number[]=[];
  if(terrain.hasFine){for(let s=5;s<23000;s+=5)distances.push(s);for(let s=23000;s<150030;s+=60)distances.push(s);}
  else for(let s=60;s<150030;s+=60)distances.push(s);
  const sin=Float64Array.from(distances,s=>Math.sin(s/R)),cos=Float64Array.from(distances,s=>Math.cos(s/R)),mask=new Float64Array(1440);
  for(let a=0;a<1440;a++){const ca=Math.cos(a*.25/D),sa=Math.sin(a*.25/D),dx=-sl*sa-sp*cl*ca,dy=cl*sa-sp*sl*ca,dz=cp*ca;let best=-Infinity;
    for(let i=0;i<sin.length;i++){const s=sin[i],c=cos[i],target=R+terrain.sample(ux*c+dx*s,uy*c+dy*s,uz*c+dz*s);
      best=Math.max(best,(target*c-eye)/(target*s));}mask[a]=Math.atan(best)*D;}
  requireCondition(Number.isFinite(ground)&&mask.every(Number.isFinite),'INVALID_RESPONSE','Nonfinite experimental horizon');
  return {lat,lon:((lon%360)+360)%360,referenceFrame:'MOON_ME_DE421',datum:'sphere-1737400m',surfaceElevation:ground,observerHeight:2,
    step:1,terrain:terrain.hasFine?'Experimental lossless PGDA5m + LOLA240m':'Experimental lossless LOLA240m',
    model:'Tanaw-polar-experiment-v1',rangeKm:150,rayStepM:terrain.hasFine?5:60,
    elevations:Array.from({length:360},(_,i)=>Math.round(mask[i*4]*100)/100),calculation:{step:.25,elevations:mask},sha256:await sha256(mask.buffer)};
}
