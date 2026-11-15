import assert from 'node:assert/strict';
import { QUICK_RANGE } from '../computation/dist/quick/coverage.js';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const app = resolve(fileURLToPath(new URL('../', import.meta.url)));
const output = resolve(process.env.TANAW_TEST_OUTPUT || 'out/date-picker-review');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    const file = resolve(app, `.${path.endsWith('/') ? path + 'index.html' : path}`);
    if (!file.startsWith(app + sep)) throw new Error('Invalid path');
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' })[extname(file)] || 'application/octet-stream' });
    res.end(data);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true, channel: process.env.TANAW_TEST_BROWSER || 'chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let release;
try {
  const errors = [];
  for (const route of ['/', '/observer/']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      document.addEventListener('tanaw:sky', e => window.testSky = e.detail);
      document.addEventListener('tanaw:select', e => window.testScene = e.detail);
      document.addEventListener('tanaw:frame', e => window.testFrame = e.detail);
      new MutationObserver(() => {
        if (window.testArrival || !document.querySelector('[data-arrival="revealing"]')) return;
        window.testArrival = ['#moon', '.topbar', '#ring', '.plan', '#quick-estimate'].map(selector => {
          const e = document.querySelector(selector), style = getComputedStyle(e);
          return { delay:style.animationDelay, animation:style.animationName, height:e.getBoundingClientRect().height };
        });
      }).observe(document, { subtree:true, attributes:true, attributeFilter:['data-arrival'] });
    });
    let releaseMoon;
    if (route === '/') {
      const moonGate = new Promise(resolve => releaseMoon = resolve);
      await page.route('**/assets/moon-color-1k.webp', async request => { await moonGate; await request.continue(); });
    }
    await page.goto(`http://127.0.0.1:${server.address().port}${route}?site=apollo-11&t=2026-12-01T00:00:00Z`, { waitUntil:'domcontentloaded' });
    await page.waitForFunction(() => !!document.querySelector('.date-trigger'));
    if (route === '/') {
      assert.equal(await page.locator('#quick-estimate').evaluate(e => getComputedStyle(e).visibility), 'hidden', 'Date controls wait for the Moon');
      releaseMoon();
      await page.waitForFunction(() => document.querySelector('#status').textContent === '');
      assert.deepEqual(await page.evaluate(() => window.testArrival.map(s => s.delay)), ['0s','0.08s','0.16s','0.22s','0.32s']);
      await page.waitForFunction(() => !document.querySelector('[data-arrival]'));
      assert.equal(await page.locator('#quick-estimate').evaluate(e => getComputedStyle(e).visibility), 'visible');
    }
    const trigger = page.getByRole('button', { name: 'Choose date and time', exact: true });
    const popup = page.getByRole('dialog', { name: 'Choose date and time (UTC)', exact: true });
    const input = page.locator('#estimate-date');
    const openYears = async () => {
      await trigger.click();
      await popup.getByRole('button', { name:'Choose month', exact:true }).click();
      await popup.getByRole('button', { name:'Choose year', exact:true }).click();
    };
    for (const [width, height] of [[1280,900],[390,844],[320,568]]) {
      await page.setViewportSize({ width, height });
      await trigger.click();
      const calendarBox = await popup.boundingBox();
      for (let month = 0; month < 2; month++) {
        await popup.getByRole('button', { name:'Next month', exact:true }).click();
        const nextBox = await popup.boundingBox();
        assert.equal(nextBox.height, calendarBox.height, 'Four-, five-, and six-row months keep the same height');
        assert.equal(nextBox.y, calendarBox.y, `Changing month keeps the calendar anchored (${route}, ${width}px)`);
      }
      await page.keyboard.press('Escape');
      await openYears();
      assert.equal(await popup.locator('[data-view="years"] button').count(), QUICK_RANGE.lastYear - QUICK_RANGE.firstYear + 1);
      assert.equal(await popup.locator('.date-grid').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length), 4);
      assert.equal(await page.evaluate(() => document.activeElement.textContent), '2026');
      const bounds = await popup.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= height, 'Picker fits viewport');
      await page.screenshot({ path: `${output}/${route === '/' ? 'moon' : 'observer'}-years-${width}.png` });
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), '2027');
      await page.keyboard.press('Escape');
      assert.equal(await popup.count(), 0);
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    }
    await page.setViewportSize({ width:1280, height:900 });
    await openYears();
    await popup.getByRole('button', { name:'2028', exact:true }).click();
    assert.equal(await input.inputValue(), '2026-12-01', 'Year selection does not start computing');
    await popup.getByRole('button', { name:'February', exact:true }).click();
    assert.equal(await popup.locator('.date-grid button').count(), 29, 'Leap-year February has 29 days');
    assert.equal(await input.inputValue(), '2026-12-01', 'Month selection does not start computing');
    await popup.getByRole('button', { name:'29 February 2028', exact:true }).click();
    assert.equal(await input.inputValue(), '2026-12-01', 'Day remains a draft until Confirm');
    await popup.getByRole('button', {name:'Confirm',exact:true}).click();
    await page.waitForFunction((route) => document.querySelector(route === '/' ? '[data-result]' : '.observer-message')
      .textContent.includes(route === '/' ? '2028-02-29 UTC' : '2028-02-29 00:00 UTC'), route);
    assert.equal(await input.inputValue(), '2028-02-29');
    assert.equal(await page.locator(route === '/' ? '#day' : '#date-scrubber input[type=range]').inputValue(), '0', 'Picker resets the range to its start');
    assert.equal(await popup.count(), 0);
    await openYears(); await page.keyboard.press('Control+Home');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), String(QUICK_RANGE.firstYear));
    await page.keyboard.press('Control+End');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '2100');
    await page.keyboard.press('Escape');
    await trigger.click(); await trigger.click();
    assert.equal(await popup.count(), 0, 'Calendar button toggles closed');
    await trigger.click(); await page.locator('h1').first().click({ force:true });
    assert.equal(await popup.count(), 0, 'Outside click dismisses the picker');

    if (route === '/') {
      // Times is the Forecast panel's right-hand column.
      if (await page.locator('#fpanel').isHidden()) await page.getByRole('button', { name:'Forecast', exact:true }).click();
      await page.waitForFunction(() => document.querySelectorAll('#fpanel #times .counts .v').length === 4);
      for (const width of [982, 1280]) {
        await page.setViewportSize({ width, height:900 });
        await page.waitForFunction(() => document.querySelector('#times').checkVisibility());
        assert.equal(await page.locator('#times').evaluate(e => e.parentElement.id), 'fpanel', 'Times sits in the Forecast panel');
      }
      await page.waitForTimeout(400);
      const before = await page.evaluate(() => ({ top:document.querySelector('#dayctl').getBoundingClientRect().top,
        result:document.querySelector('[data-result]').textContent, ring:document.querySelector('#clock').innerHTML,
        heights:document.querySelector('#times .counts').textContent, sky:window.testSky, directions:window.testScene.directions,
        bodies:[...document.querySelectorAll('.overhead,.edge')].map(e=>[e.hidden,e.style.transform]) }));
      const gate = new Promise(r => release = r);
      await page.route('**/quick/2035.bin.gz', async r => { await gate; await r.continue(); });
      await input.fill('2035-06-15'); await input.press('Enter');
      await page.waitForFunction(() => document.querySelector('#quick-estimate').getAttribute('aria-busy') === 'true');
      const pending = await page.evaluate(() => ({ top:document.querySelector('#dayctl').getBoundingClientRect().top,
        result:document.querySelector('[data-result]').textContent, ring:document.querySelector('#clock').innerHTML,
        heights:document.querySelector('#times .counts').textContent,
        animation:getComputedStyle(document.querySelector('#estimate-status'),'::before').animationName }));
      assert.equal(pending.result,before.result); assert.equal(pending.ring,before.ring); assert.equal(pending.heights,before.heights);
      assert.ok(Math.abs(pending.top-before.top)<1, 'Loading does not move the timeline');
      assert.equal(pending.animation,'forecast-spin');
      await page.screenshot({ path:`${output}/loading.png` });
      release();
      await page.waitForFunction(() => window.testSky?.hour === '2035-06-15T00:00:00.000Z');
      const after = await page.evaluate(() => ({ sky:window.testSky, directions:window.testScene.directions }));
      for (const key of ['sunAz','sunEl','earthAz','earthEl']) assert.ok(Number.isFinite(after.sky[key]), `${key} is delivered to the site renderer`);
      assert.notDeepEqual(after.directions,before.directions, 'Quick geometric directions change with the date');
      await page.waitForFunction(old => JSON.stringify([...document.querySelectorAll('.overhead,.edge')].map(e=>[e.hidden,e.style.transform])) !== JSON.stringify(old),before.bodies);
      await page.screenshot({ path:`${output}/updated-bodies.png` });
      await page.goto(`http://127.0.0.1:${server.address().port}/?site=connecting-ridge&t=2026-12-01T00:00:00Z`);
      await page.waitForFunction(() => !!document.querySelector('#clock svg'));
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('tanaw:pick', {detail:{site:'connecting-ridge'}})));
      await page.waitForFunction(() => document.querySelector('#site').classList.contains('full'));
      await input.fill('2036-06-15'); await input.press('Enter');
      assert.equal(await page.locator('#site').evaluate(e => e.classList.contains('full')), true, 'Loading retains the 3D site view');
      await page.waitForFunction(() => window.testSky?.hour === '2036-06-15T00:00:00.000Z');
      assert.equal(await page.evaluate(() => window.testScene.view), 'site', 'Quick result keeps the chosen view');
      assert.equal(await page.locator('#site').evaluate(e => e.classList.contains('full')), true, 'Quick result updates the existing site scene');
      const lightBefore=await page.evaluate(()=>window.testSky.sunDirectionLocal);
      assert.ok(lightBefore.every(Number.isFinite),'Quick snapshot supplies geometric local lighting');
      await page.locator('#day').fill('12'); await page.locator('#day').dispatchEvent('input');
      await page.waitForFunction(()=>window.testSky?.hour==='2036-06-27T00:00:00.000Z');
      assert.notDeepEqual(await page.evaluate(()=>window.testSky.sunDirectionLocal),lightBefore,'Lighting changes during scrubbing');

    }
    const selectedDay = await input.inputValue();
    await trigger.click();
    await page.getByRole('button',{name:'Choose time (UTC)',exact:true}).click();
    const minutes = page.getByRole('listbox',{name:'UTC minute',exact:true});
    await minutes.press('Home'); await minutes.press('ArrowUp');
    await page.waitForFunction(() => document.querySelector('.date-time-value').textContent.endsWith(':59 UTC'));
    await minutes.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('.date-time-value').textContent.endsWith(':00 UTC'));
    await minutes.press('ArrowDown');
    await page.waitForFunction(() => document.querySelector('.date-time-value').textContent.endsWith(':01 UTC'));
    await page.getByRole('listbox',{name:'UTC hour',exact:true}).getByRole('option',{name:'13',exact:true}).click();
    await page.getByRole('listbox',{name:'UTC minute',exact:true}).getByRole('option',{name:'37',exact:true}).click();
    assert.equal(await input.inputValue(),selectedDay,'Time remains a draft');
    await popup.getByRole('button',{name:'Confirm',exact:true}).click();
    await page.waitForFunction(day => new URL(location.href).searchParams.get('t') === `${day}T13:37:00.000Z`, selectedDay);
    assert.equal(await input.inputValue(),selectedDay,'Time selection preserves the date');
    // A minute inside the published year must use accurate interpolation in either host.
    await input.fill('2027-01-31'); await input.press('Enter');
    await page.waitForFunction(route => route === '/' ? document.querySelector('[data-result]').textContent.includes('Accurate forecast (interpolated)')
      : /^2027-01-31 13:37 UTC/.test(document.querySelector('.observer-message').textContent), route);
    assert.equal(new URL(page.url()).searchParams.get('t'),'2027-01-31T13:37:00.000Z');
    await trigger.click();
    // Today is the current UTC day on both pages (outside the published year the Moon page estimates).
    const today = await page.evaluate(() => new Date().toISOString().slice(0, 10));
    await popup.getByRole('button', { name:'Today', exact:true }).click();
    await popup.getByRole('button',{name:'Confirm',exact:true}).click();
    assert.equal(await input.inputValue(), today, 'Today selects the current UTC day');
    assert.equal(await popup.count(), 0, 'Today commits and closes the picker');
    await page.waitForFunction(([route, day]) => route === '/' ? document.querySelector('[data-result]').textContent.includes(`${day} UTC`)
      : document.querySelector('.observer-message').textContent.includes(`${day} `), [route, today]);
    if (route === '/') {
      assert.equal(await page.locator('[data-arrival]').count(), 0, 'Date changes do not replay the entrance');
      await page.emulateMedia({ reducedMotion:'reduce' });
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#status').textContent === '' && window.testArrival);
      assert.ok((await page.evaluate(() => window.testArrival)).every(s => s.animation === 'none'), 'Reduced motion reveals without choreography');
    }
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: year grid, month/day selection, leap day, date bounds, keyboard, dismissal, 320px/390px/desktop layout, retained loading panels and updated quick Sun/Earth directions and markers.');
} finally { release?.(); await browser.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
