/** Real Chrome module-worker benchmark. No UI changes or third-party runtime packages.
 * node scripts/benchmark-quick.mjs [chrome executable]; writes quick-benchmarks.json.
 * Local HTTP server, empty browser cache per site/profile; includes worker delivery.
 */
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {cpus,totalmem} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';

const root=fileURLToPath(new URL('../../../',import.meta.url)),app=resolve(root,'app');
const profile=resolve(root,'out',`quick-browser-${Date.now()}`);await mkdir(profile,{recursive:true});
let servedBytes=0;
const server=createServer(async(req,res)=>{
  try {
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(path==='/__bench'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Tanaw computation benchmark</title>');return;}
    const file=resolve(app,`.${path}`);if(!file.startsWith(app+sep))throw new Error('Invalid path');
    const bytes=await readFile(file);
    res.writeHead(200,{'Content-Type':extname(file)==='.js'?'text/javascript':extname(file)==='.json'?'application/json':'application/octet-stream',
      'Content-Length':bytes.length,'Cache-Control':'public, max-age=3600'});servedBytes+=bytes.length;res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const chrome=spawn(process.argv[2]??'C:/Program Files/Google/Chrome/Application/chrome.exe',
  ['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--disable-extensions','about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try {
  let port;
  for(let i=0;i<100;i++){try{port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await delay(100);}}
  if(!port)throw new Error('Chrome did not expose a debugging port');
  const target=await (await fetch(`http://127.0.0.1:${port}/json/new?${origin}/__bench`,{method:'PUT'})).json();
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let serial=0,conditions={offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1};const pending=new Map();
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  ws.onmessage=async event=>{const message=JSON.parse(event.data);
    if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p?.reject(new Error(JSON.stringify(message.error)));else p?.resolve(message.result);}
    if(message.method==='Target.attachedToTarget'){
      const id=message.params.sessionId;
      try {
        await send('Network.enable',{},id);
        await send('Network.emulateNetworkConditionsByRule',{offline:false,matchedNetworkConditions:[{urlPattern:'',...conditions}]},id);
      } catch(e) { console.error('Worker network emulation unavailable',e);process.exitCode=1; }
      finally {await send('Runtime.runIfWaitingForDebugger',{},id);}
    }
  };
  await send('Runtime.enable');await send('Network.enable');
  await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const browser=await send('Browser.getVersion'),rows=[];
  for(const network of ['desktop','Fast 4G'])for(const site of [
    {id:'apollo-11',lat:.67416,lon:23.47314},{id:'connecting-ridge',lat:-89.4398,lon:222.83}]) {
    // Chrome DevTools Fast4GConditions: 9 Mbps * .9, 1.5 Mbps * .9, 60 ms * 2.75.
    conditions=network==='desktop'?{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1}:
      {offline:false,latency:165,downloadThroughput:1012500,uploadThroughput:168750,connectionType:'cellular4g'};
    await send('Network.emulateNetworkConditionsByRule',{offline:false,matchedNetworkConditions:[{urlPattern:'',...conditions}]});
    await send('Network.clearBrowserCache');
    await evaluate(`(async()=>{globalThis.client?.dispose();globalThis.client=(await import('/computation/dist/quick/client.js')).createQuickEstimateClient();})()`);
    for(const days of [365,7,14,28,90,182,365]) {
      const bytesBefore=servedBytes;
      const input={...site,startUtc:'2026-12-01T00:00:00Z',endUtc:new Date(Date.parse('2026-12-01T00:00:00Z')+days*86400000).toISOString()};
      const row=await evaluate(`(async()=>{const t=performance.now();const r=await client.estimate(${JSON.stringify(input)});
        return {wallMs:performance.now()-t,...r.timings,quality:r.index.quality,days:r.index.days.length};})()`);
      const serverBytes=servedBytes-bytesBefore;
      if(network==='Fast 4G'&&serverBytes>1000000&&row.wallMs<serverBytes/1012500*1000*.8)
        throw new Error('Worker network was not throttled; refusing misleading timings');
      rows.push({site:site.id,network,requestedDays:days,cache:row.horizonCacheHit?'warm':'cold',serverBytes,...row});console.log(JSON.stringify(rows.at(-1)));
    }
    await evaluate('client.dispose()');
  }
  const result={browser:browser.product,cpu:cpus()[0].model,memoryGiB:totalmem()/2**30,
    environment:'Headless Chrome on this desktop; localhost HTTP. Fast 4G is DevTools network emulation, not a physical mobile/laptop.',
    methodology:'One cold annual job per site/profile, then warm 7/14/28/90/182/365-day jobs. Includes worker startup/structured-clone delivery; no UI rendering. Worker Network.enable plus rule-based Fast 4G emulation; server bytes guard against unthrottled results.',rows};
  await writeFile(new URL('../quick-benchmarks.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
}finally {ws?.close();chrome.kill();await new Promise(r=>server.close(r));}
