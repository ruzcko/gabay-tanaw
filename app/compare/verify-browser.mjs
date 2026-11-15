import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4417';
const output = process.env.TANAW_TEST_OUTPUT || 'out/compare-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.TANAW_TEST_EXECUTABLE ? { executablePath: process.env.TANAW_TEST_EXECUTABLE } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--renderer-process-limit=2', '--use-gl=angle'] });
const errors = [];
try {
  for (const [width, height] of JSON.parse(process.env.TANAW_TEST_VIEWPORTS || '[[1280,800],[390,844]]')) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: width === 320 ? 'reduce' : 'no-preference' });
    // Optional local transport when the host's loopback server is unavailable. The same
    // unmodified app and data files are served through browser requests, as on static hosting.
    if (process.env.TANAW_TEST_LOCAL_FILES === '1') {
      const root = fileURLToPath(new URL('../', import.meta.url));
      await page.route(`${base}/**`, async route => {
        const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
        const file = path.resolve(root, `.${pathname.endsWith('/') ? pathname + 'index.html' : pathname}`);
        if (!file.startsWith(root)) return route.fulfill({ status: 403, body: '' });
        try {
          const body = await readFile(file);
          const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png' };
          await route.fulfill({ status: 200, contentType: types[path.extname(file)] || 'application/octet-stream', body });
        } catch { await route.fulfill({ status: 404, body: '' }); }
      });
    }
    await page.addInitScript(() => document.addEventListener('tanaw:frame', event => { window.testFrame = event.detail; }));
    page.on('pageerror', error => { errors.push(error.message); console.log('PAGE ERROR', error.stack); });
    await page.goto(`${base}/?site=apollo-11&t=2026-12-01T08:00:00Z`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#pins .pin').length &&
      document.querySelector('#status').textContent === '' && !document.querySelector('[data-arrival]'), null, { timeout: 60000 });
    const pick = id => page.evaluate(site => document.dispatchEvent(new CustomEvent('tanaw:pick', { detail: { site } })), id);
    await pick('apollo-11');
    let releaseForecast;
    const forecastGate = new Promise(resolve => { releaseForecast = resolve; });
    await page.route('**/data/forecast/apollo-11.json', async route => { await forecastGate; await route.fallback(); });
    await page.locator('#compare-btn').click();
    await page.locator('.compare-loading').waitFor();
    assert.equal(await page.locator('.compare-loading').evaluate(el => getComputedStyle(el, '::before').animationName), width === 320 ? 'none' : 'compare-loading');
    await page.waitForTimeout(400);
    await page.locator('.compare-loading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/${width}-loading.png` });
    releaseForecast();
    if (process.env.TANAW_TEST_LOADING_ONLY === '1') { await page.close(); continue; }
    await page.locator('.compare-site[data-quality]').waitFor();
    await page.unroute('**/data/forecast/apollo-11.json');
    assert.equal(await page.locator('.compare-site').count(), 1);
    assert.equal(await page.locator('.compare-site').getAttribute('data-site'), 'apollo-11');
    assert.equal(await page.locator('#moon').evaluate(e => getComputedStyle(e).visibility), 'visible');
    await page.waitForTimeout(700); // Camera and UI entrance have settled before visual review.
    await page.screenshot({ path: `${output}/${width}-initial.png` });
    await page.locator('.compare-add').first().click();
    await pick('connecting-ridge');
    await page.locator('.compare-site[data-quality]').nth(1).waitFor();
    assert.equal(await page.locator('#compare-btn').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.compare-site').first().getAttribute('data-site'), 'apollo-11');
    await pick('shackleton-rim');
    await page.locator('#panel-compare').waitFor({state:'visible'});
    assert.equal(await page.locator('#panel-compare').textContent(), 'Add site');
    assert.equal(await page.locator('.compare-site').count(), 2);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${width}-candidate.png` });
    await page.locator('#panel-compare').click();
    await page.locator('.compare-site[data-quality]').nth(2).waitFor({state:'attached'});
    assert.ok(await page.locator('#panel').isVisible());
    assert.equal(await page.locator('#panel-compare').textContent(), 'Remove site');
    await page.locator('#panel-compare').click();
    assert.equal(await page.locator('.compare-site').count(), 2);
    assert.ok(await page.locator('#panel').isVisible());
    assert.equal(await page.locator('#panel-compare').textContent(), 'Add site');
    await page.locator('#panel-compare').click();
    await page.locator('.compare-site[data-quality]').nth(2).waitFor({state:'attached'});
    await page.locator('#panel-close').click();
    assert.equal(await page.locator('.compare-add').count(), 0);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${width}-full.png` });
    assert.equal(await page.locator('.compare-marker').count(), 3);
    assert.deepEqual(await page.locator('.compare-marker').evaluateAll(nodes => nodes.map(n => n.dataset.slot)), ['1','2','3']);
    assert.deepEqual(await page.locator('.compare-site-number').allTextContents(), ['1','2','3']);
    assert.equal(await page.locator('#pins').evaluate(el => getComputedStyle(el).display), 'none');
    assert.equal(await page.locator('.compare-scrollbar:visible').count(), 1);
    assert.ok(await page.locator('.compare-forecast').evaluateAll(charts => charts.every(chart => getComputedStyle(chart).scrollbarWidth === 'none')));
    const rail = page.locator('.compare-scrollbar');
    const handle = await rail.evaluate(el => { const b=el.getBoundingClientRect(); return { x:b.x+parseFloat(el.style.getPropertyValue('--thumb-width'))/2, y:b.y+b.height/2 }; });
    await page.mouse.move(handle.x, handle.y); await page.mouse.down();
    await page.mouse.move(handle.x + 50, handle.y, {steps:5}); await page.mouse.up();
    await page.waitForFunction(() => {
      const value = Number(document.querySelector('.compare-scrollbar').value);
      return value > 20 && [...document.querySelectorAll('.compare-forecast')].every(chart => Math.abs(chart.scrollLeft - value) < 2);
    });
    const beforeKey = Number(await rail.inputValue()); await rail.focus(); await page.keyboard.press('ArrowLeft');
    assert.equal(Number(await rail.inputValue()), Math.max(0, beforeKey - 40));
    assert.ok(await page.locator('.compare-marker').evaluateAll(markers => markers.every(marker => {
      const a = marker.getBoundingClientRect();
      return marker.contains(document.elementFromPoint(a.x + a.width / 2, a.y + a.height / 2));
    })), 'every numbered marker remains visible and clickable');
    const arrangement = await page.locator('.compare-site').evaluateAll(rows => rows.map(row => row.dataset.site));
    for (const index of [0, 1, 2]) {
      await page.locator('.compare-site-select').nth(index).click();
      await page.waitForFunction(i => {
        const marker = document.querySelectorAll('.compare-marker')[i], line = document.querySelectorAll('.compare-marker-links line')[i];
        const band = window.testFrame;
        return marker?.dataset.farSide === 'false' && marker.getAttribute('aria-pressed') === 'true' &&
          Math.hypot(Number(line.getAttribute('x1')) - (band.left+band.right)/2, Number(line.getAttribute('y1')) - (band.top+band.bottom)/2) < 2;
      }, index);
      assert.equal(await page.locator('#panel').isVisible(), false, 'row navigation keeps the comparison tray open');
    }
    assert.deepEqual(await page.locator('.compare-site').evaluateAll(rows => rows.map(row => row.dataset.site)), arrangement);
    await page.screenshot({ path: `${output}/${width}-row-navigation.png` });
    await pick('luna-24');
    await page.locator('#panel-compare-full').waitFor({state:'visible'});
    assert.equal(await page.locator('#panel-compare').isVisible(), false);
    assert.match(await page.locator('#panel-compare-full').textContent(), /Remove a site from the comparison/);
    await page.screenshot({ path: `${output}/${width}-capacity.png` });
    await page.locator('#panel-close').click();
    await pick('apollo-11');
    assert.equal(await page.locator('#panel-compare').textContent(), 'Remove site');
    assert.equal(await page.locator('#panel-compare').isDisabled(), false);
    await page.locator('#panel-close').click();
    await page.locator('.compare-site[data-site="connecting-ridge"] .compare-remove').click();
    await page.locator('.compare-add').click();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#compare-btn').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.compare-add').getAttribute('aria-pressed'), 'false');
    await page.locator('.compare-add').click();
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('tanaw:point', { detail: {lat:-8,lon:40} })));
    await page.locator('.compare-site[data-site="custom--8-40"][data-quality="estimate"]').waitFor({timeout:60000});
    assert.match(await page.locator('#day-out').textContent(), /08:00 UTC/);
    await page.locator('.compare-site[data-site="custom--8-40"] .compare-remove').click();
    await page.locator('.compare-table button').nth(4).click();
    assert.equal(await page.locator('.compare-site').first().getAttribute('data-site'), 'apollo-11');
    assert.equal(await page.locator('.compare-table button').first().getAttribute('aria-label'), '2026-12-01');
    await page.locator('.compare-add').click();
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('tanaw:point', { detail: {lat:-8,lon:40} })));
    await page.locator('.compare-site[data-site="custom--8-40"][data-quality="estimate"]').waitFor({timeout:60000});
    assert.equal(await page.locator('#compare-btn').getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.compare-table button').first().getAttribute('aria-label'), '2026-12-01');
    await page.locator('#day').evaluate(el => { el.value = '29'; el.dispatchEvent(new Event('input', {bubbles:true})); });
    await page.waitForFunction(() => [...document.querySelectorAll('.compare-forecast')].every(chart => {
      const selected = chart.querySelector('[aria-current="date"]');
      if (!selected || selected.getAttribute('aria-label') !== '2026-12-30' || chart.scrollLeft <= 0) return false;
      const a=selected.getBoundingClientRect(), b=chart.getBoundingClientRect();
      return a.left >= b.left && a.right <= b.right + 1;
    }));
    const scrolls = await page.locator('.compare-forecast').evaluateAll(nodes => nodes.map(n => n.scrollLeft));
    assert.ok(Math.max(...scrolls) - Math.min(...scrolls) < 2, 'timeline moves all charts together');
    assert.ok(Math.abs(Number(await page.locator('.compare-scrollbar').inputValue()) - scrolls[0]) < 2, 'shared scrollbar follows timeline');
    await page.locator('#compare-close').click();
    assert.equal(await page.locator('#compare-btn').getAttribute('aria-expanded'), 'false');
    if (width !== 320) assert.ok(await page.locator('#compare').evaluate(el => el.getAnimations().some(animation => animation.transitionProperty === 'max-height')), 'tray collapses on exit');
    await page.waitForTimeout(750);
    assert.equal(await page.locator('#compare').isVisible(), false);
    assert.equal(await page.locator('.compare-markers').isVisible(), false);
    assert.ok(await page.locator('#pins').isVisible());
    await page.screenshot({ path: `${output}/${width}-returned.png` });
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('tanaw:point', { detail: {lat:-6.43,lon:93.52} })));
    if (width < 1024) await page.locator('#info-btn').click();
    await page.locator('#panel-compare').click();
    await page.waitForFunction(() => document.querySelector('.compare-site')?.dataset.site === 'custom--6.43-93.52');
    await page.locator('.compare-site[data-quality]').first().waitFor({timeout:60000});
    assert.equal(await page.locator('.compare-site').getAttribute('data-quality'), 'estimate');
    await page.locator('.compare-add').first().click();
    // A real click exercises the globe raycast, not just the host's selection event.
    await page.waitForTimeout(700);
    const click = await page.evaluate(() => {
      const bounds = window.testFrame, cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2;
      const radius = Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top) * .18;
      for (let i = 0; i < 8; i++) {
        const x = cx + Math.cos(i * Math.PI / 4) * radius, y = cy + Math.sin(i * Math.PI / 4) * radius;
        if (document.elementFromPoint(x, y)?.id === 'moon') return {x, y};
      }
      throw new Error('No uncovered Moon picking target');
    });
    await page.mouse.click(click.x, click.y);
    await page.waitForFunction(() => document.querySelectorAll('.compare-site').length === 2, null, {timeout:30000});
    await page.locator('.compare-site[data-quality]').nth(1).waitFor({timeout:60000});
    assert.equal(await page.locator('.compare-site').first().getAttribute('data-site'), 'custom--6.43-93.52');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${width}-custom.png` });
    await page.locator('.compare-remove').first().click();
    assert.equal(await page.locator('.compare-site').count(), 1);
    assert.equal(await page.locator('.compare-site-number').textContent(), '1');
    assert.equal(await page.locator('.compare-marker').getAttribute('data-slot'), '1');
    await page.locator('.compare-remove').click();
    assert.equal(await page.locator('.compare-site').count(), 0);
    assert.equal(await page.locator('.compare-marker').count(), 0);
    assert.equal(await page.locator('.compare-add').count(), 3);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(`PASS ${width}px: numbered Moon markers, persistent Add/Remove panel, first-site removal, loading, chart tracking, exit transition and custom sites`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
