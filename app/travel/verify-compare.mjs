import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const output = 'out/travel-compare-review'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    document.addEventListener('tanaw:frame', e => { window.testFrame = e.detail; });
    const Worker = window.Worker;
    window.Worker = class extends Worker {
      constructor(url, options) { super(url, options); if (String(url).endsWith('/travel/worker.js')) this.addEventListener('message', ({ data }) => { if (data.type === 'complete') window.travelResults = data; }); }
    };
  });
  const click = name => page.getByRole('button', { name, exact: true }).click();
  await page.goto(`${process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4189'}/?site=connecting-ridge&t=2027-02-26T01:47:00Z&estimate=1`);
  await click('Travel'); await click('Filters 3 enabled');
  await page.getByLabel('Minimum sunlight hours', { exact: true }).fill('18.3');
  await page.getByLabel('Minimum Earth visibility hours', { exact: true }).fill('13.2');
  await page.getByRole('checkbox', { name: 'Terrain', exact: true }).uncheck();
  await click('Close Travel filters'); await click('Search');
  await page.waitForFunction(() => /^Search complete/.test(document.querySelector('#travel [data-status]')?.textContent), null, { timeout: 120000 });
  const total = await page.locator('.travel-result').count();
  const markers = await page.locator('.travel-marker').count();
  const random = page.locator('.travel-result').filter({ hasText: 'Lunar destination' }).first();
  const key = await random.getAttribute('data-point');
  const expected = await page.evaluate(key => [...window.travelResults.results, ...window.travelResults.sampled].find(r => `${Math.round(r.point.lat*1e7)}:${Math.round((((r.point.lon%360)+360)%360)*1e7)%3600000000}` === key), key);
  await random.getByRole('button', { name: 'Compare', exact: true }).click();
  await page.locator('.hud.travel-compare').waitFor();
  assert.equal(await page.locator('.compare-site').count(), 1);
  assert.equal(await random.locator('.travel-compare').textContent(), 'Remove site');
  assert.equal(await page.locator('.travel-result').count(), total);
  assert.equal(await page.locator('.travel-marker').count(), markers);
  const hours = expected.days.map(d => d.sunHours == null ? 'Unknown' : String(Number(d.sunHours.toFixed(1))));
  assert.deepEqual(await page.locator('.compare-table .sun td').allTextContents(), hours);
  assert.equal(await page.locator('.compare-site').getAttribute('data-quality'), 'estimate');
  const observer = random.getByRole('link', { name: '360° Observer view' });
  assert.equal(await observer.locator('svg').count(), 1);
  const link = new URL(await observer.getAttribute('href'), page.url());
  assert.equal(Number(link.searchParams.get('lat')), expected.point.lat);
  assert.equal(Number(link.searchParams.get('lon')), expected.point.lon);
  assert.equal(Date.parse(link.searchParams.get('t')), Date.parse(expected.startUtc));
  assert.equal(Date.parse(link.searchParams.get('tripEnd')), Date.parse(expected.endUtc));
  await random.getByRole('button', { name: 'Remove site' }).click();
  assert.equal(await page.locator('.compare-site').count(), 0, 'Travel can remove the initial site');
  await random.getByRole('button', { name: 'Add site', exact: true }).click();
  await page.locator('.travel-compare').filter({ hasText: /^Add site$/ }).first().click();
  await page.locator('.travel-compare').filter({ hasText: /^Add site$/ }).first().click();
  assert.equal(await page.locator('.compare-site').count(), 3);
  assert.ok(await page.locator('.travel-compare:disabled').count() > 0);
  await page.locator('.compare-remove').nth(1).click();
  await page.locator('.compare-add').click();
  const moonKey = await page.locator('.travel-result').filter({ has: page.locator('.travel-compare', { hasText: /^Add site$/ }) }).last().getAttribute('data-point');
  await page.evaluate(key => document.dispatchEvent(new CustomEvent('tanaw:travel-pick', { detail:{ key } })), moonKey);
  assert.equal(await page.locator('.compare-site').count(), 3, 'Armed comparison accepts a Travel Moon diamond');
  assert.equal(await page.locator(`.travel-result[data-point="${moonKey}"] .travel-compare`).textContent(), 'Remove site');
  const dates = await page.locator('#travel input[type="datetime-local"]').evaluateAll(nodes => nodes.map(n => n.value));
  for (const [width, height] of [[1440,900],[1280,800],[820,1000],[390,844],[320,740],[320,568]]) {
    await page.setViewportSize({ width, height });
    if (width === 320) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(400);
    const geometry = await page.evaluate(() => {
      const box = selector => { const b = document.querySelector(selector).getBoundingClientRect(); return { left:b.left, right:b.right, top:b.top, bottom:b.bottom }; };
      return { compare:box('#compare'), travel:box('#travel'), moon:window.testFrame, overflow:document.documentElement.scrollWidth > innerWidth,
        comparePosition:getComputedStyle(document.querySelector('#compare')).position,
        sharedTray:document.querySelector('#compare').parentElement.classList.contains('bar') };
    });
    console.log(width, JSON.stringify(geometry));
    assert.equal(geometry.overflow, false);
    assert.ok(geometry.moon.right - geometry.moon.left > 250);
    assert.ok(geometry.moon.bottom - geometry.moon.top > 140);
    assert.ok(geometry.sharedTray, 'Travel uses the existing Compare tray');
    assert.ok(geometry.moon.bottom <= geometry.compare.top, 'Comparison stays below the Moon');
    if (width >= 1024) {
      assert.equal(geometry.comparePosition, 'static', 'Desktop comparison remains in the bottom planning bar');
      assert.equal(geometry.moon.left, 0, 'Comparison never reserves a left sidebar');
      assert.ok(geometry.compare.right <= geometry.travel.left);
      assert.ok(geometry.travel.left >= geometry.moon.right);
    }
    else assert.ok(geometry.compare.bottom <= geometry.travel.top);
    await page.screenshot({ path: `${output}/${width}-${height}.png` });
  }
  await page.setViewportSize({ width:1440,height:900 });
  await page.waitForTimeout(400);
  const frame = await page.evaluate(() => window.testFrame);
  await page.locator('#travel [data-filters]').click(); await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(() => window.testFrame), frame, 'Filters leave the Moon in place');
  await click('Close Travel filters');
  await click('Done');
  assert.equal(await page.locator('.hud.travel-compare').count(), 0);
  assert.equal(await page.locator('.travel-result').count(), total);
  assert.deepEqual(await page.locator('#travel input[type="datetime-local"]').evaluateAll(nodes => nodes.map(n => n.value)), dates);
  assert.equal(await random.locator('.travel-compare').textContent(), 'Compare');
  assert.ok(await page.locator('.travel-result.selected .travel-compare').evaluate(n => n === document.activeElement));
  assert.deepEqual(errors, []);
  console.log('PASS Travel Compare: exact partial-day results, clicked initial site, first-site removal, membership/capacity, retained matches/markers/filters/dates, 360 Observer handoff, desktop/mobile and reduced motion.');
} finally { await browser.close(); }
