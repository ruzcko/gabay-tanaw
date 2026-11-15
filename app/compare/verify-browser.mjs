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
    await page.locator('#compare-btn').click();
    await page.locator('.compare-site[data-quality]').waitFor();
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
    await page.locator('.compare-site[data-quality]').nth(2).waitFor();
    assert.equal(await page.locator('.compare-add').count(), 0);
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${width}-full.png` });
    await pick('apollo-11');
    assert.equal(await page.locator('#panel-compare').textContent(), 'Site added');
    assert.ok(await page.locator('#panel-compare').isDisabled());
    await page.locator('#panel-close').click();
    await page.locator('.compare-remove').first().click();
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
    await page.locator('#compare-close').click();
    assert.equal(await page.locator('#compare-btn').getAttribute('aria-expanded'), 'false');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('tanaw:point', { detail: {lat:-6.43,lon:93.52} })));
    if (width < 1024) await page.locator('#info-btn').click();
    await page.locator('#panel-compare').click();
    await page.waitForFunction(() => document.querySelector('.compare-site')?.dataset.site === 'custom--6.43-93.52');
    await page.locator('.compare-site[data-quality]').first().waitFor({timeout:60000});
    assert.equal(await page.locator('.compare-site').getAttribute('data-quality'), 'estimate');
    await page.locator('.compare-add').first().click();
    // A real click exercises the globe raycast, not just the host's selection event.
    await page.waitForTimeout(700);
    const bounds = await page.evaluate(() => window.testFrame);
    await page.mouse.click((bounds.left + bounds.right) / 2 + Math.min(bounds.right - bounds.left, bounds.bottom - bounds.top) * .18,
      (bounds.top + bounds.bottom) / 2);
    await page.waitForFunction(() => document.querySelectorAll('.compare-site').length === 2, null, {timeout:30000});
    await page.locator('.compare-site[data-quality]').nth(1).waitFor({timeout:60000});
    assert.equal(await page.locator('.compare-site').first().getAttribute('data-site'), 'custom--6.43-93.52');
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/${width}-custom.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(`PASS ${width}px: pinned selection, both add flows, duplicates, removal, Escape, date sync, custom sites and Moon picking`);
    await page.close();
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
