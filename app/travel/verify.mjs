/** Real browser/worker regression. Serve app/; use the same Playwright settings as verify-main-page.mjs. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4189';
const output = process.env.TANAW_TEST_OUTPUT || 'out/travel-review';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.TANAW_TEST_BROWSER || 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [], context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
const status = page.locator('#travel [data-status]');
const click = name => name === 'Search' ? page.locator('#travel [data-search]').click() : page.getByRole('button', { name, exact: true }).click();
const complete = async () => {
  await page.waitForFunction(() => /^(Search complete|Whole-Moon screening complete|Search incomplete)/.test(document.querySelector('#travel [data-status]').textContent), null, { timeout: 240000 });
  assert.equal(await page.locator('#travel [data-error]').isVisible(), false, await page.locator('#travel [data-error]').textContent());
};
page.on('requestfailed', request => { if (request.failure()?.errorText !== 'net::ERR_ABORTED') console.log('Request failed:', request.url(), request.failure()?.errorText); });
const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
const log = text => console.log(`PASS ${text}`);
try {
  await page.goto(base); await page.waitForSelector('#travel-btn');
  assert.equal(await page.locator('#travel').isVisible(), false);
  await click('Travel'); await click('Filters 3 enabled');
  for (const name of ['Terrain', 'Sunlight', 'Earth visibility']) assert.equal(await page.getByRole('checkbox', { name, exact: true }).isChecked(), true);
  assert.equal(await page.getByLabel('Slope below · degrees').inputValue(), '10');
  assert.equal(await page.getByLabel('Longest darkness · hours').inputValue(), '0');
  assert.equal(await page.getByRole('checkbox', { name: 'Known sites first' }).isChecked(), true);
  assert.equal(await page.getByLabel('Minimum sunlight hours', { exact: true }).inputValue(), '168');
  assert.deepEqual(await page.locator('#travel-filters legend').allTextContents(), ['Sunlight', 'Earth visibility', 'Terrain']);
  await page.screenshot({ path: `${output}/desktop-filters.png` });
  await page.getByLabel('Stay · days').press('Escape');
  assert.equal(await page.locator('#travel-filters').isVisible(), false);
  assert.equal(await page.locator('[data-filters]').evaluate(n => n === document.activeElement), true);
  log('baseline filters, side expansion and Escape focus return');

  assert.equal(await page.locator('#travel [data-mode]').count(), 0);
  await page.getByLabel('Arrival · UTC', { exact: true }).fill('2027-01-10T00:00'); await click('Search'); await complete();
  await page.locator('.travel-result-pick').first().click();
  assert.equal(await page.locator('#estimate-date').inputValue(), '2027-01-10');
  assert.equal(await page.locator('#range-text').textContent(), '21 days');
  assert.equal(await page.locator('.fp-day').count(), 21);
  assert.equal(await page.locator('.fp-day[aria-current="date"]').getAttribute('data-i'), '7');
  assert.match(await page.locator('.fp-trip').getAttribute('aria-label'), /10 Jan 2027.*17 Jan 2027/);
  await page.locator('#range-btn').click();
  assert.equal(await page.getByRole('listbox', { name: 'Range number', exact: true }).getByRole('option', { selected: true }).textContent(), '21');
  await page.getByRole('listbox', { name: 'Range number', exact: true }).press('Escape');
  assert.match(await page.locator('#call').textContent(), /^Go/);
  assert.ok(await page.locator('.travel-marker').count() > 0);
  await page.locator('.travel-thumbnail canvas[data-ready="true"]').first().waitFor();
  assert.match(await page.locator('.travel-thumbnail canvas[data-ready="true"]').first().getAttribute('aria-label'), /2027-01-10.*published lighting/);
  assert.equal(await page.locator('.travel-metrics').first().isVisible(), false);
  await page.locator('.travel-info-button').first().focus();
  assert.equal(await page.locator('.travel-tooltip').first().isVisible(), true);
  await page.screenshot({ path: `${output}/desktop-information.png` });
  await page.locator('.travel-info-button').first().press('Escape');
  await noOverflow(); await page.screenshot({ path: `${output}/desktop-arrivals.png` });
  const href = await page.locator('#travel a').first().getAttribute('href');
  assert.ok(href.includes('tripEnd=2027-01-17')); log('date-only results, diamonds and coherent host selection');

  await click('Filters 3 enabled');
  await page.getByLabel('Minimum sunlight hours slider', { exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.getByLabel('Minimum sunlight hours', { exact: true }).inputValue(), '167.9');
  assert.equal(await page.locator('#travel').evaluate(n => n.classList.contains('is-loading')), true);
  assert.equal(await page.locator('#travel .travel-results').getAttribute('aria-busy'), 'true');
  await complete();
  await click('Reset defaults'); await complete();
  assert.equal(await page.getByLabel('Minimum sunlight hours', { exact: true }).inputValue(), '168');
  await click('Close Travel filters');
  log('hour sliders trigger debounced recalculation and accessible loading feedback');

  const observer = await context.newPage(); observer.on('pageerror', error => errors.push(error.message));
  await observer.goto(new URL(href, base).href);
  await observer.getByText(/Travel stay: 2027-01-10/).waitFor();
  await observer.waitForFunction(() => document.querySelector('#day').max === '6');
  assert.equal(await observer.locator('#observer-range [data-range-label]').textContent(), '7 days');
  await observer.close(); log('Observer receives exact location, arrival and seven-day trip');

  assert.equal(await page.getByText('Do not match', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Region based', exact: true }).count(), 0);
  assert.match(await page.locator('[data-map-summary]').textContent(), /checked destination areas/);
  assert.equal(await page.getByRole('button', { name: 'Load more', exact: true }).isVisible(), true);
  assert.doesNotMatch(await page.locator('#travel').innerText(), /\d+\/(2|3|12)\b/);
  assert.match(await page.locator('[data-candidate-summary]').textContent(), /terrain detail/);
  assert.ok(await page.locator('.travel-marker').count() > 0);
  await page.getByLabel('Highlight', { exact: true }).selectOption('unknown'); await noOverflow();
  await page.screenshot({ path: `${output}/desktop-candidates.png` }); log('bounded 2+3 discovery, explicit terrain shortfall and independent display layers');

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    // Keep the pre-existing forecast under its own user control on small screens.
    await page.locator('#travel .travel-main').evaluate(n => { n.scrollTop = 0; });
    await click('Filters 3 enabled'); await noOverflow();
    assert.ok((await page.locator('#travel').boundingBox()).y >= 100, 'Travel stays below the header and visible Moon');
    assert.equal(await page.getByLabel('Stay · days').isVisible(), true);
    await page.screenshot({ path: `${output}/mobile-${width}-filters.png` });
    await page.getByLabel('Stay · days').press('Escape');
    await noOverflow(); await page.screenshot({ path: `${output}/mobile-${width}.png` });
    await page.locator('#travel [data-close]').click();
    assert.equal(await page.locator('#travel').isVisible(), false);
    assert.equal(await page.locator('#pins').isVisible(), true);
    await click('Travel');
    log(`${width}px: filters, keyboard dismissal, no horizontal overflow, original pins restored`);
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#travel [data-close]').click();
  await page.locator('#travel').waitFor({ state: 'hidden' });
  await click('Travel'); await page.locator('#travel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#travel').evaluate(n => n.inert), false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  log('animated close and reopen restore focus and interactivity');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel('Arrival · UTC', { exact: true }).fill('2028-01-01T00:00'); await click('Search');
  await click('Cancel'); assert.match(await status.textContent(), /cancelled/);
  assert.equal(await page.locator('#travel [data-mode]').count(), 0);
  log('date-only quick screening remains cancellable after reopening');
  assert.deepEqual(errors, []); log('no browser JavaScript errors');
} catch (error) {
  console.log({ status: await status.textContent().catch(() => ''), error: await page.locator('#travel [data-error]').textContent().catch(() => ''), errors });
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); }
