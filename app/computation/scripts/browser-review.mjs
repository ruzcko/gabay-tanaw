/* Isolated CDP browser review helper. Run scripts from the repository root. */
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createRequire} from 'node:module';
export async function openBrowser({apiHandler,serviceOrigin,baseline=false,network=false,width=1280,height=800,route='/observer/?site=apollo-11&t=2026-12-01T00:00:00Z',capture}={}) {
  const root=process.cwd(),app=resolve(root,'app'),profile=resolve(root,`out/ui-chrome-${Date.now()}`);await mkdir(profile,{recursive:true});
  const server=createServer(async(req,res)=>{try{
    if(apiHandler&&req.url.startsWith('/api/')){const result=await apiHandler(new URL(req.url,'http://localhost'));const bytes=JSON.stringify(result.value);res.writeHead(result.status??200,{'Content-Type':'application/json'});res.end(bytes);return;}
    if(serviceOrigin&&req.url.startsWith('/api/')){const upstream=await fetch(serviceOrigin+req.url);const bytes=Buffer.from(await upstream.arrayBuffer());res.writeHead(upstream.status,{'Content-Type':'application/json','Content-Length':bytes.length});res.end(bytes);return;}
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),file=resolve(app,'.'+path+(path.endsWith('/')?'index.html':''));
    if(!file.startsWith(app+sep))throw Error();let bytes;
    if(baseline)try{bytes=await readFile(resolve(root,'out/ui-baseline', 'app', '.'+path+(path.endsWith('/')?'index.html':'')));}catch{}
    bytes??=await readFile(file);res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream','Content-Length':bytes.length,'Cache-Control':'public,max-age=3600'});res.end(bytes);
  }catch{res.writeHead(404);res.end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const executable=process.env.TANAW_CHROME ?? (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':createRequire(import.meta.url)(process.env.TANAW_PLAYWRIGHT_PATH||'playwright').chromium.executablePath());
  const chrome=spawn(executable,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--disable-background-networking','--disable-extensions','--enable-unsafe-swiftshader',...(process.platform==='linux'?['--no-sandbox']:[]),'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;for(let i=0;i<100;i++){try{port=(await readFile(resolve(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await delay(100);}}
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json(),ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let serial=0;const pending=new Map(),errors=[],listeners=[];
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  const conditions=network?{offline:false,latency:165,downloadThroughput:1012500,uploadThroughput:168750,connectionType:'cellular4g'}:{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1};
  ws.onmessage=async event=>{const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p?.reject(Error(JSON.stringify(m.error))):p?.resolve(m.result);}
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description??m.params.exceptionDetails.text);
    if(m.method==='Target.attachedToTarget'){try{await send('Network.enable',{},m.params.sessionId);await send('Network.emulateNetworkConditionsByRule',{offline:false,matchedNetworkConditions:[{urlPattern:'',...conditions}]},m.params.sessionId);}finally{await send('Runtime.runIfWaitingForDebugger',{},m.params.sessionId);}}
    for(const fn of listeners)fn(m);
  };
  await send('Runtime.enable');await send('Page.enable');await send('Network.enable');
  await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});
  await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await send('Network.emulateNetworkConditionsByRule',{offline:false,matchedNetworkConditions:[{urlPattern:'',...conditions}]});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`globalThis.audit={first:null,accurate:null};new MutationObserver(()=>{let ready=document.querySelector('.observer-site')?.textContent||document.querySelector('#call .verdict')?.textContent;if(ready){audit.first??=performance.now();if(document.documentElement.dataset.forecastQuality!=='estimate')audit.accurate??=performance.now();}}).observe(document,{subtree:true,childList:true,characterData:true});`});
  await send('Page.navigate',{url:origin+route});
  // Navigation can resolve before the new document has its root; do not evaluate DOM predicates yet.
  return {send,evaluate,errors,origin,listeners,async wait(expression,timeout=120000){const start=Date.now();while(Date.now()-start<timeout){if(await evaluate(`Boolean(document.documentElement)&&(${expression})`))return;await delay(100);}throw Error('Timed out: '+expression);},async screenshot(name){const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});const folder=process.env.TANAW_TEST_OUTPUT??resolve(root,'out');await mkdir(folder,{recursive:true});await writeFile(resolve(folder,name),Buffer.from(r.data,'base64'));},async close(){await Promise.race([send('Browser.close').catch(()=>{}),delay(500)]);ws.close();chrome.kill();await new Promise(r=>server.close(r));}};
}
