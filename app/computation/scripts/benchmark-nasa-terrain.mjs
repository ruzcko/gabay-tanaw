/** Isolated delivery benchmark. Precomputed profiles exclude server generation time. */
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {openBrowser} from './browser-review.mjs';
const out=resolve(process.argv[2]??'science/cache/nasa-terrain');
const scope=process.argv[3]??'all';
const refs=scope==='native'?JSON.parse(await readFile('app/computation/matched-polar-results.json','utf8')).accuracy.rows:
 JSON.parse(await readFile(resolve(out,'horizons.json'),'utf8'));
const modes=scope==='native'?['native']:scope==='profiles'?['mosaic5-regional20','sites5-mosaic5-regional20']:
 ['native','mosaic5-regional20','sites5-mosaic5-regional20'];
const ids=['connecting-ridge-offset-1','held-malapert-massif-0','nobile-rim-1-offset-0'];
const server=createServer(async(req,res)=>{try{
  const file=resolve(out,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(out+sep)||!file.endsWith('-horizon.json.gz'))throw Error('Unsupported request');
  const b=await readFile(file);
  res.writeHead(200,{'Content-Type':'application/json','Content-Encoding':'gzip','Content-Length':b.length,
    'Cache-Control':'public,max-age=3600','Access-Control-Allow-Origin':'*'});res.end(b);
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url=`http://127.0.0.1:${server.address().port}/`,rows=[];
try{
 for(const network of [false,true])for(const id of ids)for(const mode of modes){
  const p=refs.find(r=>r.point.id===id).point,browser=await openBrowser({network,route:'/data/sites.json'});
  try{
   await browser.wait(`location.origin===${JSON.stringify(browser.origin)}&&document.readyState==='complete'`);
   const result=await browser.evaluate(`(async()=>{
    const p=${JSON.stringify(p)},mode=${JSON.stringify(mode)},base=location.origin+'/computation/dist/quick/';
    const start=Date.parse('2026-12-01T00:00:00Z'),end=Date.parse('2027-12-01T00:00:00Z'),results=[];
    const {Coefficients,loadBytes}=await import(base+'coefficients.js');
    const {QuickEphemeris}=await import(base+'ephemeris.js');
    const {buildQuickForecast}=await import(base+'forecast.js');
    const {QuickEngine}=await import(base+'engine.js');
    const engine=new QuickEngine((u,s)=>{if(u.pathname.endsWith('/data/sites.json'))throw Error('Tiled baseline');return loadBytes(u,s);});
    const coeff=new Coefficients();
    for(const cache of ['cold','warm']){
     const t=performance.now();
     if(mode==='native'){
      const r=await engine.run({...p,startUtc:new Date(start).toISOString(),endUtc:new Date(end).toISOString()});
      results.push({cache,totalMs:performance.now()-t,timings:r.timings});continue;
     }
     const [h]=await Promise.all([fetch(${JSON.stringify(url)}+p.id+'-'+mode+'-horizon.json.gz').then(r=>{if(!r.ok)throw Error('Profile load failed');return r.json();}),coeff.prepare(start,end)]);
     const loaded=performance.now();
     const q={...h,lat:p.lat,lon:p.lon,referenceFrame:'MOON_ME_DE421',model:'Tanaw-NASA-terrain-experiment-v1',terrain:'Experimental precomputed NASA profile',rangeKm:150,rayStepM:5,
       calculation:{step:.25,elevations:Float64Array.from(h.calculation.elevations)},sha256:'a'.repeat(64)};
     const e=new QuickEphemeris(coeff,p.lat,p.lon,h.surfaceElevation),v=new Float64Array(52561*8),s=new Float64Array(8);
     for(let i=0;i<52561;i++){e.sample(start+i*600000,s);v.set(s,i*8);}
     const product=buildQuickForecast(p,start,end,v,q,[]);
     if(product.index.days.length!==365)throw Error('Incomplete year');
     results.push({cache,totalMs:performance.now()-t,loadMs:loaded-t,annualMs:performance.now()-loaded});
    }
    return results;
   })()`);
   rows.push({id,mode,profile:network?'Fast 4G':'unthrottled localhost',runs:result});
   await writeFile(resolve(out,`browser-results-${scope}.json`),JSON.stringify({method:'Fresh Chrome profile per mode/site; cold then warm; Fast 4G 165 ms and 1012500 bytes/s, no CPU throttle. Precomputed profile delivery excludes backend horizon generation. Module imports and UI rendering excluded.',rows},null,2));
   console.log(id,mode,network,result);
  }finally{await browser.close();}
 }
}finally{await new Promise(r=>server.close(r));}
