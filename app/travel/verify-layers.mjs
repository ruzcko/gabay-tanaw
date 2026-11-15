/** Integration: main's map overlays coexist with Travel and arrival-lit previews. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4189';
const output = 'out/travel-layer-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.location().url?.endsWith('/api/health')) errors.push(m.text()); });
  const click = name => page.getByRole('button', { name, exact: true }).click();
  // The Layers menu: a switch per layer (menuitemcheckbox, the menu stays open) and "All off".
  const openLayers = async () => {
    if (!(await page.locator('#layer-menu').evaluate(m => m.matches(':popover-open')))) await click('Layers');
  };
  const layer = async name => {
    await openLayers();
    const item = page.getByRole('menuitemcheckbox', { name, exact: true });
    if (await item.getAttribute('aria-checked') !== 'true') await item.click();
    assert.equal(await item.getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Escape');
  };
  const allOff = async () => {
    await openLayers();
    await page.getByRole('menuitem', { name: 'All off', exact: true }).click();
  };
  await page.goto(`${base}/?site=connecting-ridge&t=2027-01-10T00:00:00Z`);
  await page.getByRole('button', { name: 'Travel', exact: true }).waitFor();
  const slopeLoaded = page.waitForResponse(r => r.url().endsWith('/slope-global.png') && r.ok());
  await layer('Slope'); await slopeLoaded;
  const shadowLoaded = page.waitForResponse(r => r.url().endsWith('/shadow-south.png') && r.ok());
  await layer('Permanent shadow'); await shadowLoaded;
  await click('Travel'); await click('Search');
  const preview = page.locator('.travel-thumbnail canvas[data-ready="true"]').first();
  await preview.waitFor();
  // Wait for stable search controls; completion may race a click on Cancel.
  await page.waitForFunction(() => /^Search (complete|incomplete)/.test(document.querySelector('#travel [data-status]')?.textContent), null, { timeout: 240000 });
  assert.equal(await page.locator('#travel [data-error]').isVisible(), false);
  const pixels = await preview.evaluate(canvas => {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0, coloured = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]), min = Math.min(data[i], data[i + 1], data[i + 2]);
      if (max > 30) { lit++; if ((max - min) / max > .25) coloured++; }
    }
    return { lit, colouredFraction: coloured / lit };
  });
  assert.ok(pixels.lit > 1000, 'preview contains a rendered lunar surface');
  assert.ok(pixels.colouredFraction < .001, 'preview must not inherit slope or permanent-shadow overlays');
  assert.ok(await page.locator('.travel-marker').count() > 0);
  await page.screenshot({ path: `${output}/slope-with-travel.png` });
  for (const name of ['Sunlight', 'Permanent shadow']) {
    await layer(name);
    assert.equal(await page.locator('#travel').isVisible(), true);
    assert.equal(await page.locator('#layer-key').isVisible(), true);
  }
  // Sunlight turned Slope off; shadow stacks over it, one key line each.
  assert.equal(await page.getByRole('menuitemcheckbox', { name: 'Slope', exact: true, includeHidden: true }).getAttribute('aria-checked'), 'false');
  assert.equal(await page.locator('#layer-key .layer-line').count(), 2);
  await page.locator('#travel [data-close]').click();
  assert.equal(await page.locator('#layers-btn').getAttribute('aria-pressed'), 'true');
  await allOff();
  assert.equal(await page.locator('#layer-key').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS slope/sunlight/shadow switches (Sunlight replaces Slope, shadow stacks, All off), Travel matches and diamonds, neutral arrival-lit thumbnails, layer persistence after closing Travel', pixels);
} finally { await browser.close(); }
