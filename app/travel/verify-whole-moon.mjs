import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const reducedMotion of ['reduce', 'no-preference']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    // Observe the actual renderer without adding a production debug interface.
    await page.route('**/globe.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + '\nwindow.travelCamera = () => ({ distance: camera.position.length(), home: HOME_D, q: camera.quaternion.toArray(), mode, descending: !!descent });\n' });
    });
    await page.goto('http://127.0.0.1:4189/?site=connecting-ridge&t=2027-02-26T01:47:00Z');
    await page.getByRole('button', { name: 'Travel', exact: true }).click();
    await page.getByRole('button', { name: 'Filters 3 enabled', exact: true }).click();
    await page.getByLabel('Minimum sunlight hours', { exact: true }).fill('18.3');
    await page.getByRole('button', { name: 'Close Travel filters', exact: true }).click();
    const snapshot = () => page.evaluate(() => ({ url: location.href, inputs: [...document.querySelectorAll('#travel input, #travel select')].map(n => [n.value, n.checked]), results: document.querySelector('.travel-results').textContent }));
    const before = await snapshot();
    const whole = page.locator('#travel [data-whole]');
    await page.mouse.move(500, 300); await page.mouse.wheel(0, -650);
    await page.waitForFunction(() => window.travelCamera().distance < window.travelCamera().home * .9);
    const zoomed = await page.evaluate(() => window.travelCamera());
    await whole.click();
    await page.waitForFunction(() => Math.abs(window.travelCamera().distance - window.travelCamera().home) < .001);
    const framed = await page.evaluate(() => window.travelCamera());
    assert.ok(framed.q.every((v, i) => Math.abs(v - zoomed.q[i]) < .001), 'Whole Moon keeps the facing direction');
    assert.equal(await page.locator('#view-menu').evaluate(n => n.matches(':popover-open')), false);
    assert.deepEqual(await snapshot(), before, 'trip, filters, selection and results remain unchanged');
    await whole.press('Enter');
    assert.equal(await page.locator('#view-menu').evaluate(n => n.matches(':popover-open')), false, 'repeat keyboard activation does not open View');
    await page.locator('#mode-es').click();
    await page.waitForFunction(() => window.travelCamera().mode === 'es');
    await whole.click();
    await page.waitForFunction(() => window.travelCamera().mode === 'close' && Math.abs(window.travelCamera().distance - window.travelCamera().home) < .001);
    assert.deepEqual(await snapshot(), before);
    await page.setViewportSize({ width: 390, height: 844 });
    await whole.click();
    assert.equal(await page.locator('#view-menu').evaluate(n => n.matches(':popover-open')), false);
    assert.equal(await page.locator('#travel').isVisible(), true);
    if (reducedMotion === 'no-preference') {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator('#travel [data-close]').click();
      await page.evaluate(() => document.dispatchEvent(new CustomEvent('tanaw:pick', { detail: { site: 'connecting-ridge' } })));
      await page.waitForFunction(() => document.getElementById('site').classList.contains('full'), null, { timeout: 20000 });
      await page.getByRole('button', { name: 'Travel', exact: true }).click();
      await whole.click();
      await page.waitForFunction(() => !window.travelCamera().descending && Math.abs(window.travelCamera().distance - window.travelCamera().home) < .001, null, { timeout: 20000 });
      assert.equal(await page.locator('#view-menu').evaluate(n => n.matches(':popover-open')), false);
      console.log('PASS Whole Moon during the terrain-to-globe transition.');
    }
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${reducedMotion}: zoom reset, facing direction, Earth & Sun return, no menu, unchanged trip/filters/results, repeat keyboard and mobile.`);
  }
} finally { await browser.close(); }
