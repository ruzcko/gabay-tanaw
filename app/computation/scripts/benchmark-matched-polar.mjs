/** Headless browser experiment; private tiles, no UI edits. Run from repo root. */
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {openBrowser} from './browser-review.mjs';
const out=resolve(process.argv[2]??'out/matched-polar'),tileRoot=resolve(out,'tiles');
const server=createServer(async(req,res)=>{try{
  const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(tileRoot,'.'+name);
  if(!file.startsWith(tileRoot+sep))throw Error('outside tile root');
  const bytes=await readFile(file);res.writeHead(200,{'Access-Control-Allow-Origin':'*','Content-Length':bytes.length,'Cache-Control':'no-store'});res.end(bytes);
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const tileURL=`http://127.0.0.1:${server.address().port}/`,rows=[];
const profiles=process.argv[3]==='local'?[false]:[false,true];
const resultFile=process.argv[3]==='local'?'browser-benchmarks-local.json':'browser-benchmarks.json';
const sites=JSON.parse(await readFile('app/data/sites.json','utf8')).filter(s=>['connecting-ridge','malapert-massif'].includes(s.id));
try{
  for(const network of profiles)for(const site of sites)for(const mode of ['native','coarse','fine']){
    const browser=await openBrowser({network,route:'/data/sites.json'});
    try{
      await browser.wait(`location.origin===${JSON.stringify(browser.origin)}&&document.readyState==='complete'`);
      let code=stripTypeScriptTypes(await readFile('app/computation/scripts/experimental-polar.ts','utf8'));
      code=code.replaceAll('../src/quick/coefficients.ts',browser.origin+'/computation/dist/quick/coefficients.js')
        .replaceAll('../src/core.ts',browser.origin+'/computation/dist/core.js');
      const moduleURL='data:text/javascript;base64,'+Buffer.from(code).toString('base64');
      const result=await browser.evaluate(`(async()=>{
        const start=Date.parse('2026-12-01T00:00:00Z'),end=Date.parse('2027-12-01T00:00:00Z'),site=${JSON.stringify(site)},mode=${JSON.stringify(mode)};
        const base=${JSON.stringify(browser.origin)}+'/computation/dist/quick/';
        if(mode==='native'){
          const {QuickEngine}=await import(base+'engine.js');const {loadBytes}=await import(base+'coefficients.js');
          const read=(u,s)=>{if(u.pathname.endsWith('/data/sites.json'))throw Error('Native terrain control');return loadBytes(u,s);};
          const r=await new QuickEngine(read).run({...site,startUtc:new Date(start).toISOString(),endUtc:new Date(end).toISOString()});
          return {timings:r.timings,groundM:r.horizon.surfaceElevation,quality:r.index.quality};
        }
        const {ExperimentalPolar,experimentalHorizon}=await import(${JSON.stringify(moduleURL)});
        const {Coefficients}=await import(base+'coefficients.js');const {QuickEphemeris}=await import(base+'ephemeris.js');
        const {buildQuickForecast}=await import(base+'forecast.js');
        const terrain=new ExperimentalPolar(new URL(${JSON.stringify(tileURL)}),mode==='fine'),coeff=new Coefficients(),a=performance.now();
        await Promise.all([terrain.prepare(site.lat,site.lon),coeff.prepare(start,end)]);const b=performance.now();
        const h=await experimentalHorizon(terrain,site.lat,site.lon),c=performance.now();
        const ephem=new QuickEphemeris(coeff,site.lat,site.lon,h.surfaceElevation),v=new Float64Array(52561*8),s=new Float64Array(8);
        for(let i=0;i<52561;i++){ephem.sample(start+i*600000,s);v.set(s,i*8);}
        const product=buildQuickForecast(site,start,end,v,h,[]),d=performance.now();
        return {timings:{totalMs:d-a,terrainLoadMs:b-a,horizonMs:c-b,annualMs:d-c,terrainBytes:terrain.bytesLoaded,requests:terrain.requests},groundM:h.surfaceElevation,quality:product.index.quality};
      })()`);
      rows.push({site:site.id,profile:network?'Fast 4G':'unthrottled localhost',mode,...result});
      console.log(JSON.stringify(rows.at(-1)));await writeFile(resolve(out,resultFile),JSON.stringify({method:'One fresh Chrome profile per case; cold application caches, OS cache unspecified; Fast 4G 165 ms, 1,012,500 bytes/s download, no CPU throttling; isolated page, not UI rendering; 365 days at ten-minute cadence.',rows},null,2)+'\n');
    }finally{await browser.close();}
  }
}finally{await new Promise(r=>server.close(r));}
