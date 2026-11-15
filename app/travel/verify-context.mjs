import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const [arrival, count, first, last] of [
    ['2027-01-10T00:00', 21, '3 Jan 2027', '23 Jan 2027'],
    ['2027-02-26T01:47', 22, '19 Feb 2027', '12 Mar 2027'],
    ['2026-12-01T00:00', 21, '24 Nov 2026', '14 Dec 2026'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4189'}/?site=connecting-ridge&t=${arrival}:00Z`);
    await page.getByRole('button', { name: 'Travel', exact: true }).click();
    if (arrival.includes('01:47')) {
      await page.getByRole('button', {name:'Filters 3 enabled',exact:true}).click();
      await page.getByLabel('Minimum sunlight hours',{exact:true}).fill('18.3');
      await page.getByLabel('Minimum Earth visibility hours',{exact:true}).fill('13.2');
      await page.getByRole('checkbox',{name:'Terrain',exact:true}).uncheck();
      await page.getByRole('button',{name:'Close Travel filters',exact:true}).click();
    }
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await page.waitForFunction(n => document.querySelectorAll('.fp-day').length === n && document.querySelector('.fp-day[aria-current="date"]')?.dataset.i === '7', count, { timeout: 60000 });
    // Context rendering is independent of preload/search completion. Inspect stable results.
    await page.waitForFunction(() => /^Search (complete|incomplete)/.test(document.querySelector('#travel [data-status]')?.textContent), null, { timeout: 240000 });
    assert.equal(await page.locator('#travel [data-error]').isVisible(), false);
    assert.ok((await page.locator('.fp-day').first().getAttribute('aria-label')).includes(first));
    assert.ok((await page.locator('.fp-day').last().getAttribute('aria-label')).includes(last));
    assert.equal(await page.locator('.fp-sel').evaluate(n => getComputedStyle(n).gridColumnStart), '9');
    assert.equal(await page.locator('.fp-trip').count(), 1);
    if (arrival.includes('01:47')) {
      const matches = await page.locator('.travel-result').count();
      assert.ok(matches > 0);
      await page.locator('.travel-result-pick').first().click();
      await page.waitForFunction(() => document.querySelector('#now-name').textContent.includes('Malapert massif'));
      assert.equal(await page.locator('.travel-result').count(), matches, 'selecting a known result retains its matches despite longitude roundoff');
    }
    if (arrival.startsWith('2026-12')) {
      await page.waitForFunction(() => document.documentElement.dataset.forecastQuality === 'accurate');
      assert.match(await page.locator('.fp-day').first().getAttribute('aria-label'), /unknown/);
      assert.equal(await page.locator('.fp-c.sun').first().textContent(), '—');
      assert.doesNotMatch(await page.locator('#fp-table').innerText(), /Infinity|NaN/);
    }
    assert.deepEqual(errors, []);
    console.log('PASS exact travel outline, white arrival selection and context boundaries', arrival, count);
    await page.close();
  }
} finally { await browser.close(); }
