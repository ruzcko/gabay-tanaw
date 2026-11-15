/** Pinned Python geometric states, separate from Horizons apparent observations. */
import { parseUtc, requireCondition } from './core.ts';
import { interpolateOrientation, localSky, quaternionMatrix, SKY_MODEL } from './sky-orientation.ts';

function validateSky(s:any,count:number) {
  requireCondition(s?.fromFrame==='J2000'&&s.toFrame==='MOON_ME_DE440_ME421'&&
    s.interpolation==='slerp'&&s.quaternionOrder==='xyzw'&&Array.isArray(s.rotations)&&s.rotations.length===count&&
    s.rotations.every((q:any)=>Array.isArray(q)&&q.length===4&&q.every(Number.isFinite)&&Math.abs(Math.hypot(...q)-1)<1e-10),
    'INVALID_RESPONSE','Invalid published sky rotations');
}

export function validateGeometricTrack(g:any,count:number) {
  requireCondition(g?.frame==='MOON_ME_DE440_ME421'&&g.origin==='MOON'&&g.correction==='NONE'&&
    g.units==='km,km/s'&&g.interpolation==='cubic-Hermite'&&
    g.model==='CSPICE DE440 / MOON_ME_DE440_ME421; geometric states v1'&&
    Array.isArray(g.kernels)&&g.kernels.length===5&&g.kernels.every((k:any)=>
      typeof k.file==='string'&&/^[a-f0-9]{64}$/.test(k.sha256))&&
    ['sun','earth'].every(b=>Array.isArray(g[b])&&g[b].length===count&&g[b].every((v:any)=>
      Array.isArray(v)&&v.length===6&&v.every(Number.isFinite)&&Math.hypot(...v.slice(0,3))>1737.4)),
    'INVALID_RESPONSE','Invalid published geometric states');
  if(g.sky!==undefined)validateSky(g.sky,count);
}

export function publishedGeometry(product:any,instantUtc:string) {
  const t=parseUtc(instantUtc),left=Math.floor(t/3600000)*3600000,f=(t-left)/3600000;
  const at=(ms:number)=>{
    const track=product.geometryMonthly?.[new Date(ms).toISOString().slice(0,7)],g=track?.geometric;
    requireCondition(g,'UNSUPPORTED','Published geometric endpoint is unavailable');
    const i=(ms-parseUtc(track.start))/3600000;
    requireCondition(Number.isInteger(i)&&i>=0&&i<g.sun.length,'UNSUPPORTED','Published geometric endpoint is outside coverage');
    return {g,i};
  };
  const a=at(left),b=f?at(left+3600000):a;
  requireCondition(JSON.stringify(a.g.kernels)===JSON.stringify(b.g.kernels)&&a.g.model===b.g.model&&
    a.g.frame===b.g.frame&&a.g.correction===b.g.correction,'INVALID_RESPONSE','Mixed geometric provenance');
  const position=(body:string)=>{
    const x=a.g[body][a.i],y=b.g[body][b.i];
    return x.slice(0,3).map((v:number,i:number)=>f?
      (2*f**3-3*f*f+1)*v+(f**3-2*f*f+f)*3600*x[i+3]+
      (-2*f**3+3*f*f)*y[i]+(f**3-f*f)*3600*y[i+3]:v);
  };
  const unit=(v:number[])=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
  const display=(v:number[])=>[v[0],v[2],-v[1]];
  const s=product.index.science,p=product.index.lat*Math.PI/180,l=product.index.lon*Math.PI/180;
  const up=[Math.cos(p)*Math.cos(l),Math.cos(p)*Math.sin(l),Math.sin(p)];
  const east=[-Math.sin(l),Math.cos(l),0],south=[Math.sin(p)*Math.cos(l),Math.sin(p)*Math.sin(l),-Math.cos(p)];
  const sun=position('sun'),earth=position('earth'),radius=1737.4+(s.surfaceElevationM+s.observerHeightM)/1000;
  const ray=sun.map((v:number,i:number)=>v-radius*up[i]);
  const local=unit([east,up,south].map(axis=>axis.reduce((sum,v,i)=>sum+v*ray[i],0)));
  const qa=(p-Math.PI/2)/2,qb=-(l+Math.PI/2)/2;
  let skyRotation;
  if(a.g.sky!==undefined||b.g.sky!==undefined) {
    requireCondition(a.g.sky&&b.g.sky,'UNSUPPORTED','Published sky endpoint is unavailable');
    // Full tracks are checked at product load; selected endpoints are checked again here.
    requireCondition([a.g.sky,b.g.sky].every(s=>s.fromFrame==='J2000'&&s.toFrame==='MOON_ME_DE440_ME421'&&
      s.interpolation==='slerp'&&s.quaternionOrder==='xyzw'),'INVALID_RESPONSE','Invalid published sky rotations');
    skyRotation=localSky(quaternionMatrix(interpolateOrientation(a.g.sky.rotations[a.i],b.g.sky.rotations[b.i],f)),product.index.lat,product.index.lon);
  }
  return {lighting:{sunDirectionLocal:local},
    sky:skyRotation?.sky,skyMatrix:skyRotation?.matrix,
    skyProvenance:skyRotation?{model:SKY_MODEL,interpolation:f?'slerp':'saved-rotation',
      fromFrame:'J2000',toFrame:'MOON_ME_DE440_ME421',startUtc:new Date(left).toISOString(),
      endUtc:new Date(f?left+3600000:left).toISOString()}:undefined,
    overview:{axisConvention:'x0-yNorth-zWest',moonRadiusM:1737400,siteDirectionMoon:display(up),
      sunDirectionMoon:display(unit(sun)),earthDirectionMoon:display(unit(earth)),
      moonToLocal:[Math.sin(qa)*Math.cos(qb),Math.cos(qa)*Math.sin(qb),Math.sin(qa)*Math.sin(qb),Math.cos(qa)*Math.cos(qb)]},
    sunMoon:unit(sun),earthMoon:unit(earth),
    provenance:{model:a.g.model,frame:a.g.frame,correction:a.g.correction,kernels:structuredClone(a.g.kernels),
      interpolation:f?'cubic-Hermite':'saved-state',startUtc:new Date(left).toISOString(),
      endUtc:new Date(f?left+3600000:left).toISOString()}};
}
