/** Real browser boundary checks. Run with Node 24 and an optional Chrome executable/output directory. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,extname,sep,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {QUICK_RANGE,ESTIMATE_UNAVAILABLE} from '../computation/dist/quick/coverage.js';

const app=resolve(fileURLToPath(new URL('../',import.meta.url)));
const profile=await mkdtemp(join(tmpdir(),'tanaw-estimate-test-'));
const output=resolve(process.argv[3]??profile);await mkdir(output,{recursive:true});
const requests=[];
let detailGate,releaseDetail;
const server=createServer(async(req,res)=>{
  try {
    const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file=resolve(app,`.${path.endsWith('/')?path+'index.html':path}`);
    if(!file.startsWith(app+sep))throw new Error('Invalid path');
    // Attribute a request when it starts, not when asynchronous disk I/O completes.
    requests.push(path);const bytes=await readFile(file);
    if(path.includes('/terrain/polar240/')&&detailGate)await detailGate;
    const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg'};
    res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream'});res.end(bytes);
  }catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.TANAW_PLAYWRIGHT_PATH||'playwright');
const browser=await chromium.launch({headless:true,executablePath:process.argv[2],args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const context=await browser.newContext(),page=await context.newPage(),cdp=await context.newCDPSession(page);
  // A published scene can display before its parallel quick preload finishes. Observe
  // the real initializer promise so this download test starts after BOTH have settled.
  await page.route('**/observer/demo.js',async route=>{
    const response=await route.fetch(),source=await response.text();
    assert.match(source,/\ninitialize\(\);\s*$/);
    await route.fulfill({response,body:source.replace(/\ninitialize\(\);\s*$/,
      '\ninitialize().finally(()=>{globalThis.testObserverInitialized=true;});\n')});
  });
  const errors=[],send=(method,params={})=>cdp.send(method,params);
  cdp.on('Runtime.exceptionThrown',event=>errors.push(event.exceptionDetails));
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const waitFor=async expression=>{for(let i=0;i<300;i++){if(await evaluate(expression))return;await delay(100);}throw new Error(`Timed out: ${expression}`);};
  // Compact observer readouts keep UTC/quality with the scene and daily totals separately.
  const acceptedDate = date => `(location.pathname==='/observer/' ? document.querySelector('.observer-message')?.textContent.includes('${date} ') : document.querySelector('[data-result]')?.textContent.includes('${date} UTC'))`;
  const accurateShown = `(location.pathname==='/observer/' ? document.querySelector('#forecast-status')?.textContent.startsWith('Accurate forecast') : document.querySelector('[data-result]')?.textContent.startsWith('Accurate forecast'))`;
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`document.addEventListener('tanaw:select',e=>window.testScene=e.detail);`});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  for (const route of ['/observer/','/']) {
  console.log(`CHECK ${route}: boundary dates, source priority, and scene controls`);
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}${route}?site=apollo-11&t=2026-12-01T00:00:00Z`});
  await waitFor(`!!document.querySelector('#estimate-date')?.min`);
  assert.deepEqual(await evaluate(`({min:document.querySelector('#estimate-date').min,max:document.querySelector('#estimate-date').max})`),
    {min:new Date(QUICK_RANGE.start).toISOString().slice(0,10),max:new Date(QUICK_RANGE.end-86400000).toISOString().slice(0,10)});
  assert.equal(await evaluate(`document.querySelector('#quick-estimate button[type="submit"]')`),null,'Date selection needs no calculate button');
  // Finish the initial published selection before measuring boundary-date downloads.
  await waitFor(route==='/observer/' ? acceptedDate('2026-12-01') : `window.testScene?.instant==='2026-12-01T00:00:00.000Z'`);
  if(route==='/observer/')await waitFor('globalThis.testObserverInitialized===true');
  if (route === '/') {
    await waitFor(`!!document.querySelector('#clock svg')`);
    // Times is the Forecast panel's right-hand column.
    await page.getByRole('button', {name:'Forecast', exact:true}).click();
    await waitFor(`document.querySelectorAll('#fpanel #times .counts .v').length===4`);
    await page.getByRole('button', {name:'Forecast', exact:true}).click();
  }
  const select=async date=>evaluate(`(()=>{const input=document.querySelector('#estimate-date');input.value=${JSON.stringify(date)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  let previousScene;
  const checkClock = async (quality, date) => {
    if (route !== '/') return;
    assert.deepEqual(await evaluate(`(()=>{const r=document.querySelector('#ring');return [r.hidden,r.dataset.quality,r.dataset.instant];})()`),
      [false,quality,`${date}T00:00:00.000Z`], 'Sky clock follows the accepted product');
    assert.ok(await evaluate(`document.querySelector('#clock svg .sun').children.length > 250`), 'Sky clock retains its 30-day track');
    const enlarge = await evaluate(`document.querySelector('#side').clientWidth===0`);
    if (enlarge) await page.locator('#clock').click();
    await waitFor(`!!document.querySelector('#side svg')`);
    assert.ok(await evaluate(`!!document.querySelector('#side svg')`), 'Sky strip renders');
    assert.ok(await evaluate(`![...document.querySelectorAll('#clock svg *,#side svg *')].some(n=>[...n.attributes].some(a=>/NaN|undefined/.test(a.value)))`), 'All sky coordinates are finite');
    assert.equal(await evaluate(`document.querySelector('#ring h2').textContent.includes('Estimate')`),quality==='estimate');
    if (enlarge) await page.locator('#clock-close').click();
    assert.deepEqual(await evaluate(`['times','sem'].map(id=>{const e=document.getElementById(id);return [e.hidden,e.dataset.quality,e.dataset.instant];})`),
      [[false,quality,`${date}T00:00:00.000Z`],[false,quality,`${date}T00:00:00.000Z`]], 'Times and diagram share the accepted result');
    await page.getByRole('button', {name:'Forecast',exact:true}).click();
    await waitFor(`document.querySelectorAll('#fpanel #times .counts .v').length===4`);
    assert.ok(await evaluate(`![...document.querySelectorAll('#sem svg *')].some(n=>[...n.attributes].some(a=>/NaN|undefined|Infinity/.test(a.value)))`),'Diagram coordinates are finite');
    assert.ok(await evaluate(`[...document.querySelectorAll('#times .counts .v')].every(e=>e.textContent && !/NaN|undefined/.test(e.textContent))`),'Countdowns and current heights are populated');
    assert.equal(await evaluate(`document.querySelector('[data-centre="sun"]').disabled`),false,'The Sun centre works on every date (the estimate engine supplies its orbit)');
    for (const centre of ['moon','earth']) {
      await page.locator(`[data-centre="${centre}"]`).click();
      assert.equal(await page.locator(`[data-centre="${centre}"]`).getAttribute('aria-pressed'),'true');
    }
    await page.getByRole('button', {name:'Forecast',exact:true}).click();
  };
  for(const date of [`${QUICK_RANGE.firstYear}-01-01`,`${QUICK_RANGE.lastYear}-07-01`,`${QUICK_RANGE.lastYear}-12-31`]){
    requests.length=0;await select(date);
    await waitFor(acceptedDate(date));
    const result=await evaluate(`document.querySelector('[data-result]').textContent`);
    if(route==='/observer/') {
      assert.ok(await evaluate(`document.querySelector('#forecast-status').textContent.startsWith('Estimate · ')`));
      assert.ok(await evaluate(`document.querySelector('.observer-site').textContent.includes('Apollo 11')`));
      assert.match(result,/^Daily totals · Sun above terrain /);
    } else assert.ok(result.includes(`Estimate · Apollo 11 · ${date} UTC: Sun above terrain`),result||await evaluate(`document.querySelector('#estimate-status').textContent`));
    assert.equal(await evaluate(`new URL(location.href).searchParams.get('t')`),`${date}T00:00:00.000Z`);
    const sceneExpression=route==='/observer/' ? `document.querySelector('.observer-readout').textContent` : `window.testScene.directions`;
    // The forecast result is accepted before the observer's next animation frame paints its readout.
    if (previousScene) await waitFor(`JSON.stringify(${sceneExpression})!==${JSON.stringify(JSON.stringify(previousScene))}`);
    const scene=await evaluate(sceneExpression);
    if (previousScene) assert.notDeepEqual(scene,previousScene,'Sun/Earth positions follow the date');
    previousScene=scene;
    await checkClock('estimate',date);
    console.log(`PASS ${route}: estimate and scene for ${date}`);
    assert.ok(await evaluate(route==='/observer/' ? `document.querySelector('.observer-message').textContent.includes('${date} 00:00 UTC')` : `window.testScene.instant==='${date}T00:00:00.000Z'`));
    if (route === '/') assert.ok(await evaluate(`new URL(document.querySelector('#observer-top').href).searchParams.get('t')==='${date}T00:00:00.000Z'`), 'Top-bar Observer link follows the estimate date');
    const packs=requests.filter(p=>/\/quick\/\d{4}\.bin\.gz$/.test(p));
    assert.ok(packs.every(p=>p.endsWith(`/${date.slice(0,4)}.bin.gz`)),`${date}: unexpected coefficient requests ${JSON.stringify(packs)}`);
  }
  // A new selection anchors the range at zero, including the terminal day.
  await select(`${QUICK_RANGE.lastYear}-12-30`);
  await waitFor(`new URL(location.href).searchParams.get('t')==='${QUICK_RANGE.lastYear}-12-30T00:00:00.000Z'`);
  // Exercise worker error transport independently of the panel's preflight check.
  for (const [step,date] of [[1,`${QUICK_RANGE.lastYear}-12-31`],[-1,`${QUICK_RANGE.lastYear}-12-30`],[1,`${QUICK_RANGE.lastYear}-12-31`]]) {
    await evaluate(`(()=>{const slider=document.querySelector('#day');slider.value=Number(slider.value)+${step};slider.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await waitFor(`new URL(location.href).searchParams.get('t')==='${date}T00:00:00.000Z'`);
    assert.equal(await evaluate(`document.querySelector('#estimate-date').value`),date,'Picker follows scrubber');
  }
  const workerErrors=await evaluate(`(async()=>{const c=(await import('../computation/dist/quick/client.js')).createQuickEstimateClient();const errors=[];
    try{for(const year of [${QUICK_RANGE.firstYear-1},${QUICK_RANGE.lastYear+1}])try{await c.estimate({lat:0,lon:0,startUtc:year+'-01-01T00:00:00Z',endUtc:year+'-01-02T00:00:00Z'});}catch(e){errors.push(e.message);}return errors;}finally{c.dispose();}})()`);
  assert.deepEqual(workerErrors,[ESTIMATE_UNAVAILABLE,ESTIMATE_UNAVAILABLE]);
  for(const year of [QUICK_RANGE.firstYear-1,QUICK_RANGE.lastYear+1]){
    requests.length=0;await select(`${year}-01-01`);
    assert.equal(await evaluate(`document.querySelector('#estimate-status').textContent`),ESTIMATE_UNAVAILABLE);
    assert.ok(await evaluate(acceptedDate(`${QUICK_RANGE.lastYear}-12-31`)),'Unavailable selections retain the accepted readout');
    assert.equal(requests.filter(p=>/\/quick\/\d{4}\.bin\.gz$/.test(p)).length,0);
    assert.equal(await evaluate(`new URL(location.href).searchParams.get('t')`),`${QUICK_RANGE.lastYear}-12-31T00:00:00.000Z`,'Unavailable selection never changes the scene date');
  }
  await select('2026-12-01');
  await waitFor(accurateShown);
  if (route === '/') await waitFor(`document.querySelector('#ring').dataset.instant==='2026-12-01T00:00:00.000Z'`);
  await checkClock('accurate','2026-12-01');
  console.log(`PASS ${route}: restored accurate forecast at coverage start`);
  if (route === '/') {
    // While new tracks load, retain the previous clock; the completed saved product wins.
    let releaseAccurate;
    const accurateGate=new Promise(resolve=>{releaseAccurate=resolve;});
    await page.route('**/data/forecast/apollo-11/2027-*.json',async route=>{await accurateGate;await route.continue();});
    try {
      await select('2027-05-31');
      assert.equal(await evaluate(`document.querySelector('#day').value`),'0','New date anchors the selected range');
      assert.equal(await evaluate(`document.querySelector('#ring').dataset.quality`),'accurate');
      assert.equal(await evaluate(`document.querySelector('[data-centre="sun"]').disabled`),false);
      releaseAccurate();
      await waitFor(`document.querySelector('#ring').dataset.instant==='2027-05-31T00:00:00.000Z'`);
      await checkClock('accurate','2027-05-31');
      for (const length of [91,365,30]) {
        await page.locator('#range-btn').click(); // the range choices sit in its menu
        const units=page.getByRole('listbox',{name:'Range unit',exact:true});
        await units.press('Home');
        await page.getByRole('listbox',{name:'Range number',exact:true}).getByRole('option',{name:String(length),exact:true}).click();
        await page.getByRole('button',{name:'Confirm',exact:true}).click();
        await waitFor(`document.querySelector('#estimate-status').textContent==='Accurate forecast loaded.'`);
        assert.equal(await evaluate(`Number(document.querySelector('#day').max)+1`),length,'The range sets the timeline');
      }
      await select('2027-11-30');
      await waitFor(`document.querySelector('#ring').dataset.quality==='accurate' && document.querySelector('#ring').dataset.instant==='2027-11-30T00:00:00.000Z'`);
      await checkClock('accurate','2027-11-30');
      await select('2026-12-01');
      await waitFor(`document.querySelector('#ring').dataset.instant==='2026-12-01T00:00:00.000Z'`);
    } finally { releaseAccurate(); await page.unroute('**/data/forecast/apollo-11/2027-*.json'); }
  }
  if (route==='/observer/') {
    await waitFor(`document.querySelector('#terrain-status').textContent.includes('SLDEM2015')`);
    assert.ok(await evaluate(`document.querySelector('#terrain-note').textContent.startsWith('Detailed terrain loaded.')`));
  }
  assert.equal(await evaluate(`new URL(location.href).searchParams.get('t')`),'2026-12-01T00:00:00.000Z');
  for(const [width,height] of [[1280,900],[390,844]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await evaluate(`document.querySelector('#quick-estimate').scrollIntoView({block:'end'})`);await delay(200);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'No horizontal overflow');
    assert.ok(await evaluate(`[...document.querySelectorAll('#quick-estimate input,#quick-estimate button')].filter(e=>e.checkVisibility()).every(e=>e.getBoundingClientRect().height>=44)`),'44px control targets');
    if (route === '/observer/') {
      const buttonSize = () => evaluate(`(()=>{const r=document.querySelector('#ui-toggle').getBoundingClientRect();return [r.width,r.height];})()`);
      const before = await buttonSize();
      await page.locator('#ui-toggle').click();
      assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('cinematic')),true);
      assert.deepEqual(await buttonSize(), before, 'Cinematic toggle preserves button dimensions');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('cinematic')),false);
      assert.deepEqual(await buttonSize(), before, 'Esc restores the UI without resizing its toggle');
    }
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(output,`${route==='/observer/'?'observer':'moon'}-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  }
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/?estimate=1&lat=-49.052462&lon=6.725317&t=2100-12-31T00:00:00Z`});
  await waitFor(`document.querySelector('[data-result]')?.textContent.includes('2100-12-31 UTC')`);
  assert.deepEqual(await evaluate(`(()=>{const p=new URL(document.querySelector('#observer-top').href).searchParams;return [p.get('lat'),p.get('lon'),p.get('t'),p.get('estimate'),p.has('site')];})()`),
    ['-49.052462','6.725317','2100-12-31T00:00:00.000Z','1',false], 'Custom location and date survive the top-bar Observer link');
  // Hold real detailed tiles: the quick scene and coarse mesh must be usable first.
  detailGate=new Promise(resolve=>{releaseDetail=resolve;});requests.length=0;
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/observer/?estimate=1&lat=-64.860842&lon=66.222911&t=${QUICK_RANGE.firstYear}-01-01T00:00:00Z`});
  await waitFor(`${acceptedDate(`${QUICK_RANGE.firstYear}-01-01`)} && document.querySelector('#terrain-work')?.textContent.includes('Loading detailed terrain')`);
  assert.equal(await evaluate(`document.querySelector('#terrain-note').textContent`),'');
  releaseDetail();detailGate=null;
  await waitFor(`document.querySelector('#terrain-note').textContent.startsWith('Detailed terrain loaded.')`);
  assert.ok(requests.filter(p=>p.includes('/terrain/polar240/')).length<20,'Load only the selected patch, not the regional dataset');
  assert.equal(await evaluate(`document.querySelector('#estimate-date').value`),`${QUICK_RANGE.firstYear}-01-01`);
  await evaluate(`(()=>{const input=document.querySelector('#estimate-date');input.value='2100-12-31';input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await waitFor(`${acceptedDate('2100-12-31')} && document.querySelector('#terrain-note').textContent.startsWith('Detailed terrain loaded.')`);
  assert.equal(await evaluate(`document.querySelector('.location-map .globe-compass').textContent`),'NESW');
  assert.equal(await evaluate(`document.querySelector('#mode, #catalog-site, #observer-back')`),null);
  assert.equal(await evaluate(`document.querySelector('.navigator-open')`),null);
  assert.ok(await evaluate(`new URL(document.querySelector('.observer-topbar a').href).searchParams.get('t')==='2100-12-31T00:00:00.000Z'`));
  for(const [width,height] of [[1280,900],[390,844],[320,568]]){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await delay(200);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'Observer controls fit without horizontal overflow');
    assert.ok(await evaluate(`(()=>{const controls=[...document.querySelectorAll('.look-controls button, #horizon-toggle, #options-toggle')];return controls.every(el=>{const r=el.getBoundingClientRect();return r.width>=44&&r.height>=44;});})()`),'Remaining controls retain touch targets');
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(output,`observer-controls-${width}.png`),Buffer.from(shot.data,'base64'));
  }
  assert.deepEqual(errors,[],'No browser JavaScript exceptions');
  for (const route of ['/observer/','/']) {
    for (const [site,date] of [['apollo-11','1969-07-20'],['apollo-12','1969-11-19']]) {
      await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}${route}?site=${site}&t=${date}T00:00:00Z`});
      await waitFor(acceptedDate(date));
      assert.equal(await evaluate(`document.querySelector('#estimate-date').min`),`${QUICK_RANGE.firstYear}-01-01`);
    }
    const outside=new Date(QUICK_RANGE.start-86400000).toISOString().slice(0,10);
    await evaluate(`(()=>{const d=document.querySelector('#estimate-date');d.value='${outside}';d.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await waitFor(`document.querySelector('#quick-estimate [role="status"]')?.textContent.includes('${ESTIMATE_UNAVAILABLE}')`);
  }
  console.log('PASS: manifest picker bounds; both scenes at first/last years and terminal day; sky clock, strip, countdowns, heights and diagrams; range choices; accurate priority and coverage edges; coarse then detailed terrain at boundary dates; on-demand packs/terrain; worker and inline unavailable errors; compass and simplified Observer controls; desktop/mobile layout.');
  console.log(`Screenshots: ${output}`);
} finally {releaseDetail?.();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
