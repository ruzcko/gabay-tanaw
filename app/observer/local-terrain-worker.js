// Dataset sampling only. No astronomical or visibility computations.
import { TERRAIN_MODEL } from '../computation/dist/quick/terrain.js';
import {polarPixel, terrainAxis, lunarRadiusM} from './terrain-sampling.js';
const rad = Math.PI/180;
const cache = new Map(), controllers=new Map();
self.onmessage = async ({ data: { id, cancel, baseUrl, site, level, sampleOnly, detailed = false, coarse = false } }) => {
  if(cancel){controllers.get(id)?.abort();return;}
  const controller=new AbortController();controllers.set(id,controller);
  try {
    const quick=site.terrainModel===TERRAIN_MODEL && site.referenceFrame==='MOON_ME_DE421';
    const polar=site.latitudeDeg<=-87.5;
    // Display preview only: avoid downloading the 20 m patch before first paint.
    // Ground sampling retains its original source selection.
    const preview=coarse&&!sampleOnly;
    const regionalDisplay=detailed||preview&&polar;
    const axisM=sampleOnly?new Float32Array([0]):detailed&&!polar&&site.latitudeDeg<=-60.1
      ? Float32Array.from({length:257},(_,i)=>(i-128)*256) : terrainAxis(level,polar);
    const ppm = 16, side = ppm*10, width = axisM.length;
    const spacingM = sampleOnly ? 1 : axisM[(width+1)/2], radius=lunarRadiusM;
    const lat=site.latitudeDeg*rad, lon=site.longitudeEastDeg*rad;
    const up=[Math.cos(lat)*Math.cos(lon),Math.sin(lat),-Math.cos(lat)*Math.sin(lon)];
    const east=[-Math.sin(lon),0,-Math.cos(lon)], south=[Math.sin(lat)*Math.cos(lon),-Math.cos(lat),-Math.sin(lat)*Math.sin(lon)];
    const samples=[], keys=new Set(), uv=new Float32Array(width*width*2);
    const point = (x,y) => { x=((x%(360*ppm))+360*ppm)%(360*ppm); y=Math.max(0,Math.min(180*ppm-1,y)); const key=`16/${Math.floor(y/side)}-${Math.floor(x/side)}`; keys.add(key); return {key,index:(y%side)*side+(x%side)}; };
    const polePoint=(x,y)=>{const key=`polar20/${Math.floor(y/512)}-${Math.floor(x/512)}`;keys.add(key);return {key,index:(y%512)*512+x%512};};
    const regionalPoint=(x,y)=>{const key=`polar240/${Math.floor(y/512)}-${Math.floor(x/512)}`;keys.add(key);return {key,index:(y%512)*512+x%512};};
    const interpolation=(px,py,getPoint)=>{const ix=Math.floor(px),iy=Math.floor(py);return {fx:px-ix,fy:py-iy,points:[getPoint(ix,iy),getPoint(ix+1,iy),getPoint(ix,iy+1),getPoint(ix+1,iy+1)]};};
    for(let row=0;row<width;row++) for(let col=0;col<width;col++) {
      const x=axisM[col],z=axisM[row],y=Math.sqrt(radius*radius-x*x-z*z);
      const v=up.map((n,i)=>(n*y+east[i]*x+south[i]*z)/radius);
      const latitude=Math.asin(Math.max(-1,Math.min(1,v[1])))/rad, longitude=Math.atan2(-v[2],v[0])/rad;
      let u=(longitude+180)/360;const centerU=(site.longitudeEastDeg+180)/360;
      if(u-centerU>.5)u-=1;if(u-centerU<-.5)u+=1;
      uv.set([u,(latitude+90)/180],(row*width+col)*2);
      // Smooth transition at the source boundary, identical for ground and mesh.
      // The outer mesh is already sparse: blend to the regional grid there,
      // retaining the 20 m source around the observer and for ground sampling.
      const nearWeight=detailed&&!sampleOnly?Math.max(0,Math.min(1,(5120-Math.max(Math.abs(x),Math.abs(z)))/2560)):1;
      const weight=preview ? 0 : nearWeight*(quick ? Number(latitude<=-87.5) : Math.max(0,Math.min(1,(-latitude-87.5)/.2)));
      const regional=regionalDisplay?Math.max(0,Math.min(1,(-latitude-60.1)/.2)):0;
      const sample={weight:weight*weight*(3-2*weight),regionalWeight:regional*regional*(3-2*regional)};
      if(weight<1&&regional<1)sample.global=interpolation((longitude+180)*ppm-.5,(90-latitude)*ppm-.5,point);
      if(weight<1&&regional>0){
        const rho=2*radius*Math.tan(Math.PI/4+latitude*rad/2);
        sample.regional=interpolation(3879.5+rho*Math.sin(longitude*rad)/240,3879.5-rho*Math.cos(longitude*rad)/240,regionalPoint);
      }
      if(weight>0)sample.polar=interpolation(...polarPixel(latitude,longitude),polePoint);
      samples.push(sample);
    }
    const tiles=new Map();
    // Limit simultaneous network/decompression work, including patches spanning a pole.
    const queue=[...keys];
    await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{
      while(queue.length) { controller.signal.throwIfAborted();const key=queue.shift(), url=`${baseUrl}/${key}.bin.gz`;let buffer=cache.get(url);if(!buffer){const response=await fetch(url,{signal:controller.signal,cache:'force-cache'});if(!response.ok)throw new Error(`Terrain tile ${response.status}`);buffer=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();const size=key.startsWith('polar')?512:side;if(buffer.byteLength!==size*size*2)throw new Error('Invalid terrain tile length');cache.set(url,buffer);while(cache.size>48)cache.delete(cache.keys().next().value);}else{cache.delete(url);cache.set(url,buffer);}tiles.set(key,new DataView(buffer)); }
    }));
    const elevationsM=new Float32Array(samples.length);
    const sampleHeight=({fx,fy,points},isPolar)=>{const h=points.map(p=>isPolar?tiles.get(p.key).getInt16(p.index*2,true)/2:tiles.get(p.key).getUint16(p.index*2,true)/2-10000);return (h[0]*(1-fx)+h[1]*fx)*(1-fy)+(h[2]*(1-fx)+h[3]*fx)*fy;};
    samples.forEach((s,i)=>{elevationsM[i]=(s.global?sampleHeight(s.global,false)*(1-s.regionalWeight)*(1-s.weight):0)+(s.regional?sampleHeight(s.regional,true)*s.regionalWeight*(1-s.weight):0)+(s.polar?sampleHeight(s.polar,true)*s.weight:0);});
    controller.signal.throwIfAborted();
    self.postMessage({ id, result: { width,height:width,spacingM,axisM,elevationsM,uv,metadata:{projection:'local-orthographic-east-south',latitudeDeg:site.latitudeDeg,longitudeEastDeg:site.longitudeEastDeg,referenceFrame:quick?'MOON_ME_DE421':'LOLA-ME',elevationDatum:'sphere-1737400m',radiusM:radius,noData:null,source:polar&&!preview?'NASA LOLA 20 m south-polar grid; lower-resolution terrain at distance and coverage edge':regionalDisplay&&site.latitudeDeg<=-60.1?'NASA LOLA LDEM_60S_240M (240 m grid; blended coverage edge)':'NASA SVS / LRO LOLA (16 pixels/degree)',license:'NASA media, free to use with attribution',detailAvailable:!preview&&(polar||detailed&&site.latitudeDeg<=-60.3),sourceResolutionM:site.latitudeDeg<=-87.7&&!preview?20:regionalDisplay&&site.latitudeDeg<=-60.3?240:Math.PI*radius/(180*ppm)} } },[elevationsM.buffer,uv.buffer,axisM.buffer]);
  } catch(error) { self.postMessage({id,error:error.message}); } finally {controllers.delete(id);}
};
