import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4189';
const output = process.env.TANAW_TEST_OUTPUT || 'out/travel-compact-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [];
  await page.addInitScript(() => document.addEventListener('tanaw:frame', e => { window.moonFrame = e.detail; }));
  page.on('pageerror', e => errors.push(e.stack || e.message));
  await page.goto(`${base}/?site=connecting-ridge&t=2027-01-10T00:00:00Z`);
  await page.getByRole('button', { name: 'Travel', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Forecast', exact: true }).click();
  const normalHeight = (await page.locator('#fp-table').boundingBox()).height;
  const normalRows = await page.locator('#fp-table .fp-l').allTextContents();
  await page.getByRole('button', { name: 'Travel', exact: true }).click();
  const beforeFilters = await page.evaluate(() => window.moonFrame);
  await page.getByRole('button', { name: 'Filters 3 enabled', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.moonFrame), beforeFilters, 'opening filters must not reframe the Moon');
  const layout = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    return { freeHeight: box('.bar').top - box('.topbar').bottom - 16,
      forecastHeight: box('#fp-table').height, forecastRight: box('#fpanel').right,
      travelLeft: box('#travel').left, filtersBottom: box('#travel-filters').bottom,
      planTop: box('.plan').top, overflow: document.documentElement.scrollWidth > innerWidth,
      rows: [...document.querySelectorAll('#fp-table .fp-l')].map(n => n.textContent) };
  });
  assert.ok(layout.freeHeight >= 300, JSON.stringify(layout));
  assert.ok(layout.forecastHeight <= normalHeight - 60, JSON.stringify(layout));
  assert.ok(layout.filtersBottom <= layout.planTop, 'filters must not cover the existing forecast controls');
  assert.ok(layout.forecastRight <= layout.travelLeft);
  assert.deepEqual(layout.rows, normalRows, 'Travel preserves every row of the current main forecast');
  assert.equal(layout.overflow, false);
  await page.screenshot({ path: `${output}/desktop-compact.png` });
  await page.getByRole('button', { name: 'Close Travel filters', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.moonFrame), beforeFilters, 'closing filters must not reframe the Moon');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.locator('.travel-main').evaluate(n => { n.scrollTop = 0; });
    await page.getByRole('button', { name: 'Filters 3 enabled', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.ok((await page.locator('#travel').boundingBox()).y > 100);
    await page.screenshot({ path: `${output}/mobile-${width}-filters.png` });
    await page.getByRole('button', { name: 'Close Travel filters', exact: true }).click();
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator('#travel [data-close]').click();
  assert.equal((await page.locator('#fp-table').boundingBox()).height, normalHeight);
  await page.getByRole('button', { name: 'Travel', exact: true }).click();
  await page.mouse.click((beforeFilters.left + beforeFilters.right) / 2, (beforeFilters.top + beforeFilters.bottom) / 2);
  assert.equal(await page.locator('#travel [data-mode]').count(), 0, 'Moon selection cannot restore the removed mode tabs');
  assert.equal(await page.getByLabel('Arrival · UTC', { exact: true }).isVisible(), true);
  assert.equal(await page.locator('#travel').evaluate(n => n.classList.contains('is-loading')), false, 'Moon selection does not launch a region search');
  await page.setViewportSize({ width: 1200, height: 720 });
  assert.equal(await page.locator('#fpanel').isVisible(), false, 'forecast waits for the picked point to load');
  assert.deepEqual(errors, []);
  console.log('PASS Moon space, compact forecast with every row, filter clearance, mobile layouts and original-layout restoration', layout);
} finally { await browser.close(); }
