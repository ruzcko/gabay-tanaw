/** Browser integration audit; response-only observation hooks never alter shipped UI. */
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {openBrowser} from './browser-review.mjs';
const browser=await openBrowser({route:'/lighting-audit-not-found'});
const origin=process.env.TANAW_INTEGRATION_ORIGIN??browser.origin;
const rows=[],hookErrors=[];
try {
  await browser.send('Fetch.enable',{patterns:[{urlPattern:'*/observer/index.js',requestStage:'Response'}]});
  browser.listeners.push(async event=>{
    if(event.method!=='Fetch.requestPaused')return;
    const {requestId}=event.params;
    try {
      const response=await browser.send('Fetch.getResponseBody',{requestId});
      let code=response.base64Encoded?Buffer.from(response.body,'base64').toString():response.body;
      assert.ok(code.includes('snapshot = next;'));
      code=code.replace('snapshot = next;','snapshot = next; globalThis.lightingAuditSnapshot=structuredClone(next);');
      code=code.replace('terrainInfo = info;','terrainInfo = info; globalThis.lightingAuditTerrain=info.state;');
      assert.ok(code.includes('sunlight.intensity = lightDirection ? 3 : 0;'));
      code=code.replace('sunlight.intensity = lightDirection ? 3 : 0;',
        'sunlight.intensity = lightDirection ? 3 : 0; globalThis.lightingAuditIntensity=sunlight.intensity;');
      await browser.send('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(code).toString('base64')});
    }catch(e){hookErrors.push(String(e));await browser.send('Fetch.continueRequest',{requestId}).catch(()=>{});}
  });
  async function check(query,quality,name) {
    await browser.send('Page.navigate',{url:origin+'/observer/?'+query});
    await browser.wait(`globalThis.lightingAuditSnapshot?.quality===${JSON.stringify(quality)} && globalThis.lightingAuditIntensity===3`,180000);
    const s=await browser.evaluate('globalThis.lightingAuditSnapshot');
    const expected=new URLSearchParams(query).get('t');
    assert.equal(s.instantUtc,new Date(expected).toISOString());
    assert.ok(s.lighting&&s.overview);assert.ok(Math.abs(Math.hypot(...s.lighting.sunDirectionLocal)-1)<1e-10);
    assert.equal(s.sky?.catalogFrame,'ICRS-J1991.25');
    assert.ok(Math.abs(Math.hypot(...s.sky.catalogToLocal)-1)<1e-10);
    assert.equal(await browser.evaluate(`document.querySelector('#error').textContent`),'');
    await browser.evaluate(`document.querySelector('[data-look="horizon"]').click()`);
    await browser.wait(`globalThis.lightingAuditTerrain==='ready'`,120000);
    await browser.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    rows.push({name,instantUtc:s.instantUtc,quality:s.quality,site:s.site.id,sunElevationDeg:s.bodies.sun.elevationDeg,lighting:s.lighting.sunDirectionLocal,sky:s.sky.catalogToLocal,intensity:3});
    await browser.screenshot(`lighting-${name}.png`);
  }
  await check('site=apollo-17&t=2027-03-19T01:08:00Z','accurate','apollo17-minute');
  await check('site=apollo-17&t=2027-03-19T01:00:00Z','accurate','apollo17-hour');
  await check('site=change-4&t=2026-12-31T23:59:00Z','accurate','farside-seam');
  await check('site=shackleton-rim&t=2027-03-19T01:08:00Z','accurate','polar-minute');
  await check('lat=20.321&lon=30.654&t=2028-03-19T01:08:00Z&estimate=1','estimate','custom-north');
  const first=await browser.evaluate('globalThis.lightingAuditSnapshot.instantUtc');
  await browser.evaluate(`document.querySelector('#observer-play').click()`);
  await browser.wait(`globalThis.lightingAuditSnapshot.instantUtc!==${JSON.stringify(first)}`,30000);
  await browser.evaluate(`document.querySelector('#observer-play').click()`);
  const next=await browser.evaluate('globalThis.lightingAuditSnapshot');
  assert.equal(next.quality,'estimate');assert.notDeepEqual(next.lighting.sunDirectionLocal,rows.at(-1).lighting);
  assert.notDeepEqual(next.sky.catalogToLocal,rows.at(-1).sky);
  rows.push({name:'custom-playback',instantUtc:next.instantUtc,quality:next.quality,lighting:next.lighting.sunDirectionLocal});
  await check('lat=-23.456&lon=240.123&t=2028-03-19T01:08:00Z&estimate=1','estimate','custom-south-farside');
  assert.deepEqual(hookErrors,[]);assert.deepEqual(browser.errors,[]);
  await mkdir('out',{recursive:true});await writeFile('out/published-lighting-browser.json',JSON.stringify({origin,rows,errors:browser.errors},null,2));
  console.log(JSON.stringify({passed:rows.length,rows},null,2));
} finally {await browser.close();}
