/** Real browser coverage for quick fallback and mixed-source stays. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const output = 'out/travel-source-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: process.env.TANAW_TEST_GPU === 'hardware' ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    window.travelMessages = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) { super(...args); this.addEventListener('message', ({ data }) => {
        if (data.type === 'candidate-progress') window.travelMessages.push({ type: data.type, progress: data.progress });
        if (data.discovery) window.travelMessages.push({ type: data.type, discovery: data.discovery });
      }); }
    };
  });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const click = name => name === 'Search' ? page.locator('#travel [data-search]').click() : page.getByRole('button', { name, exact: true }).click();
  const complete = async () => {
    await page.waitForFunction(() => /^Search (complete|incomplete)/.test(document.querySelector('#travel [data-status]')?.textContent), null, { timeout: 240000 });
    assert.equal(await page.locator('#travel [data-error]').isVisible(), false);
  };
  await page.goto(`${process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4189'}/?site=connecting-ridge&t=2027-01-10T00:00:00Z`);
  console.log('Loaded source regression page');
  await click('Travel');
  await page.getByLabel('Arrival · UTC', { exact: true }).fill('2027-01-10T00:00');
  await click('Search'); await complete();
  const messages = await page.evaluate(() => window.travelMessages);
  assert.ok(messages.some(m => m.type === 'candidate-progress'));
  const discovery = messages.find(m => m.discovery).discovery;
  assert.ok(['time-budget', 'sample-budget'].includes(discovery.stopReason));
  assert.ok(discovery.shortfall.elsewhere > 0);
  assert.match(await page.locator('[data-candidate-summary]').textContent(), /Load more/);
  await page.screenshot({ path: `${output}/candidate-shortfall.png` });
  console.log('PASS real candidate-progress followed by explicit bounded shortfall', discovery.stopReason, discovery.found);
  await page.getByText('About these results', { exact: true }).click();
  await click('Scan whole Moon');
  await page.waitForFunction(() => /Screened/.test(document.querySelector('#travel [data-status]').textContent), null, { timeout: 120000 });
  await click('Cancel');
  await page.getByText('About these results', { exact: true }).click();
  console.log('PASS optional whole-Moon map reports real progress and cancels');
  await click('Filters 3 enabled');
  await page.getByRole('checkbox', { name: 'Terrain', exact: true }).uncheck();
  await page.getByLabel('Minimum sunlight hours', { exact: true }).fill('0');
  await page.getByLabel('Minimum Earth visibility hours', { exact: true }).fill('0');
  await click('Close Travel filters');
  await page.getByLabel('Arrival · UTC', { exact: true }).fill('2027-01-01T00:00');
  await click('Search'); await complete();
  const finalDiscovery = await page.evaluate(() => window.travelMessages.filter(m => m.discovery).at(-1).discovery);
  assert.deepEqual(finalDiscovery.found, { south: 2, elsewhere: 3 });
  const estimate = page.locator('.travel-result').filter({ has: page.getByText('Estimate', { exact: true }) }).first();
  await estimate.scrollIntoViewIfNeeded();
  assert.equal(await estimate.getByText('Visibility only · terrain not required', { exact: true }).isVisible(), true);
  await estimate.locator('.travel-info-button').focus();
  assert.match(await estimate.locator('.travel-tooltip').textContent(), /published.*unavailable|published coverage.*missing/i);
  await page.screenshot({ path: `${output}/published-year-quick-fallback.png` });
  await estimate.locator('.travel-info-button').press('Escape');
  console.log('PASS date-only discovery fills 2 south-pole and 3 other checked estimates, with explicit source labels');
  // Inspect a real mixed published/estimated stay as soon as known matches stream.
  await page.getByLabel('Arrival · UTC', { exact: true }).fill('2027-11-28T00:00');
  await click('Search');
  const mixed = page.locator('.travel-result').filter({ has: page.getByText('Mixed forecast & estimate', { exact: true }) }).first();
  await mixed.waitFor({ timeout: 120000 });
  await complete();
  await mixed.scrollIntoViewIfNeeded(); await mixed.locator('.travel-info-button').focus();
  assert.match(await mixed.locator('.travel-tooltip').textContent(), /Mixed · published forecast and estimate/);
  await page.screenshot({ path: `${output}/mixed-stay.png` });
  console.log('PASS date-only boundary-crossing stays retain mixed provenance');
  assert.deepEqual(errors, []);
} catch (error) {
  console.log(await page?.locator('#travel').innerText().catch(() => 'Travel unavailable'));
  await page?.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); }
