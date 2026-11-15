import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const output = 'out/travel-sort-review'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker; window.sortPosts = []; window.sortResult = null;
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options); this.isTravel = String(url).endsWith('/travel/worker.js');
        if (this.isTravel) this.addEventListener('message', ({ data }) => { if (data.type === 'complete') window.sortResult = data; });
      }
      postMessage(data, ...args) { if (this.isTravel) window.sortPosts.push(data.operation); super.postMessage(data, ...args); }
    };
    const animate = Element.prototype.animate; window.sortAnimations = 0;
    Element.prototype.animate = function(...args) { if (this.classList.contains('travel-results')) window.sortAnimations++; return animate.apply(this, args); };
  });
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const select = (name, value) => page.getByRole('combobox', { name, exact: true }).selectOption(value);
  const complete = () => page.waitForFunction(() => /^Search complete/.test(document.querySelector('#travel [data-status]')?.textContent), null, { timeout: 120000 });
  await page.goto(`${process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4189'}/?site=connecting-ridge&t=2027-02-26T01:47:00Z&estimate=1`);
  await click('Travel'); await click('Filters 3 enabled');
  await page.getByLabel('Minimum sunlight hours', { exact: true }).fill('18.3');
  await page.getByLabel('Minimum Earth visibility hours', { exact: true }).fill('13.2');
  await page.getByRole('checkbox', { name: 'Terrain', exact: true }).uncheck();
  await click('Close Travel filters'); await click('Search'); await complete();
  await page.evaluate(() => { window.sortCards = [...document.querySelectorAll('.travel-result')]; });
  const posts = await page.evaluate(() => window.sortPosts.length);
  await click('Filters 2 enabled'); await page.getByRole('checkbox', { name: 'Known sites first', exact: true }).uncheck();
  async function checkOrder(field, direction, grouped = false) {
    const rows = await page.evaluate(() => {
      const key = p => `${Math.round(p.lat * 1e7)}:${Math.round((((p.lon % 360) + 360) % 360) * 1e7) % 3600000000}`;
      const known = new Set(window.sortResult.results.map(r => r.point.id));
      const byPoint = new Map([...window.sortResult.results, ...window.sortResult.sampled].map(r => [key(r.point), r]));
      return [...document.querySelectorAll('.travel-result')].map(n => ({ ...byPoint.get(n.dataset.point), known: known.has(byPoint.get(n.dataset.point).point.id) }));
    });
    assert.ok(rows.length >= 17);
    if (grouped) assert.ok(rows.every((r, i) => i === 0 || rows[i - 1].known || !r.known));
    const value = r => field === 'name' ? r.point.name : field === 'terrain' ? r.terrain.slopeDeg : field === 'coordinates' ? (r.point.lon + 360) % 360 : r[field].hours;
    for (let i = 1; i < rows.length; i++) {
      if (grouped && rows[i - 1].known !== rows[i].known) continue;
      const a = value(rows[i - 1]), b = value(rows[i]);
      if (b == null) continue;
      assert.notEqual(a, null, 'unknown values stay last');
      const comparison = field === 'name' ? a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) : a - b;
      assert.ok(direction === 'asc' ? comparison <= 0 : comparison >= 0, `${field} ${direction}: ${a}, ${b}`);
    }
  }
  for (const field of ['sunlight', 'earth', 'terrain', 'name', 'coordinates']) for (const direction of ['asc', 'desc']) {
    await select('Sort field', field); await select('Sort direction', direction); await checkOrder(field, direction);
  }
  assert.equal(await page.evaluate(() => window.sortAnimations), 0, 'reduced motion skips sorting fades');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await select('Sort field', 'name'); await select('Sort direction', 'asc');
  assert.ok(await page.evaluate(() => window.sortAnimations) > 0);
  await page.getByRole('checkbox', { name: 'Known sites first', exact: true }).check(); await checkOrder('name', 'asc', true);
  assert.equal(await page.evaluate(() => window.sortPosts.length), posts, 'sorting never starts or cancels science work');
  assert.equal(await page.locator('#travel').evaluate(n => n.classList.contains('is-loading')), false);
  assert.equal(await page.evaluate(() => window.sortCards.every(n => n.isConnected)), true, 'sorting reuses existing cards and thumbnails');
  await page.screenshot({ path: `${output}/desktop-filters.png` });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.getByRole('combobox', { name: 'Sort field', exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await select('Sort direction', 'desc'); await checkOrder('name', 'desc', true);
    await page.screenshot({ path: `${output}/mobile-${width}-filters.png` });
  }
  await page.setViewportSize({ width: 1280, height: 800 }); await click('Close Travel filters');
  await click('Load more'); await complete(); await checkOrder('name', 'desc', true);
  assert.equal(await page.locator('[data-load-more]').isVisible(), false, 'one additional batch remains the limit');
  await click('Filters 2 enabled'); await click('Reset defaults');
  assert.equal(await page.getByRole('combobox', { name: 'Sort field', exact: true }).inputValue(), 'sunlight');
  assert.equal(await page.getByRole('combobox', { name: 'Sort direction', exact: true }).inputValue(), 'desc');
  await click('Close Travel filters'); await page.locator('#travel [data-close]').click();
  assert.deepEqual(errors, []);
  console.log('PASS all five sorts in both directions, known-first priority, unknowns last, no science reload, reused thumbnails, reduced motion, desktop/390/320 layouts, Load more sorting and reset');
} finally { await browser.close(); }
