/** Browser checks for the main page on plain static hosting (no science service).
 * Serve app/ on 127.0.0.1:4410, then: node app/verify-main-page.mjs
 * Set TANAW_PLAYWRIGHT_PATH if Playwright is not installed locally, TANAW_TEST_BROWSER for the
 * browser channel (CI: chromium), TANAW_TEST_OUTPUT for screenshots.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4410';
const output = process.env.TANAW_TEST_OUTPUT || 'out/main-page-review';
await mkdir(output, { recursive: true });
const log = message => console.log(`PASS ${message}`);

const browser = await chromium.launch({ headless: true,
  ...(process.env.TANAW_TEST_EXECUTABLE ? { executablePath: process.env.TANAW_TEST_EXECUTABLE } : { channel: process.env.TANAW_TEST_BROWSER || 'chrome' }),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
// The page's clock set to a given UTC time and left running (Playwright's own clock would also
// stop the animations). Scripts stack, so a later one moves the clock again for the next load.
const setClock = (page, iso) => page.addInitScript((target) => {
  const D = Date, offset = D.parse(target) - D.now();
  class Shifted extends D { constructor(...a) { if (a.length) super(...a); else super(D.now() + offset); } static now() { return D.now() + offset; } }
  window.Date = Shifted;
}, iso);

async function open(width, height, { slowImages = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${width}px: ${error.message}`));
  // On 127.0.0.1 the page asks for the local science service; static hosting answers 404.
  // Requests cut off by our own reload are not page errors.
  page.on('console', message => {
    if (page.reloading && /Failed to fetch/.test(message.text())) return;
    if (message.type() === 'error' && !(message.location().url || '').endsWith('/api/health')) errors.push(`${width}px console: ${message.text()}`);
  });
  if (slowImages) await page.route('**/*.webp', async route => { await new Promise(done => setTimeout(done, 1500)); await route.continue(); });
  // Opened without a date, the page shows the current UTC hour; these checks start from the
  // published year's first hour, so the clock reads 1 Dec 2026 00:00 UTC.
  await setClock(page, '2026-12-01T00:00:00Z');
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  return page;
}
const ready = page => page.waitForFunction(() => document.querySelectorAll('#pins .pin').length > 0 &&
  document.querySelector('#status').textContent === '' && !document.querySelector('[data-arrival]'), null, { timeout: 60000 });
const pick = (page, site) => page.evaluate(id => document.dispatchEvent(new CustomEvent('tanaw:pick', { detail: { site: id } })), site);
const covering = page => page.evaluate(() => document.getElementById('site').classList.contains('full'));
const status = page => page.locator('#estimate-status').textContent();
// The normal view after an in-year date: no estimate flag in the URL, the sky clock, the Go or
// No-go call (with its Wait and Move chips on a No-go day) and Compare all back.
async function normalView(page, from) {
  await page.waitForFunction(() => !new URL(location.href).searchParams.has('estimate') && /^(Go|No-go)\b/.test(document.getElementById('call').textContent.trim()), null, { timeout: 20000 })
    .catch(() => assert.fail(`an in-year date ${from} still shows an estimate: ${page.url()}`));
  assert.ok(await page.locator('#ring').isVisible(), `sky clock is back ${from}`);
  if (/No-go/.test(await page.locator('#call').textContent())) {
    assert.ok(await page.locator('#wait .chip, #move .chip').count() > 0, `the Wait and Move chips are back ${from}`);
  }
  assert.equal(await page.locator('#compare-btn').isDisabled(), false, `Compare works ${from}`);
}
async function estimateDate(page, value) {
  const date = page.locator('#estimate-date');
  await date.fill(value);
  await date.press('Enter');
}

try {
  for (const [width, height] of [[1280, 800], [390, 844]]) {
    const page = await open(width, height, { slowImages: width === 1280 });
    if (width === 1280) {
      assert.ok(await page.locator('#status svg').isVisible(), 'loading cover shows while the Moon maps load');
      await page.waitForFunction(() => !document.getElementById('status').checkVisibility(), null, { timeout: 60000 });
      log('loading cover shows while the Moon loads, then clears');
    }
    await ready(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    // Site view: lift in, display toggles, close back to the whole Moon.
    await pick(page, 'connecting-ridge');
    await page.waitForFunction(() => document.getElementById('site').classList.contains('full'), null, { timeout: 20000 });
    for (const id of ['#show-ring', '#show-spots']) {
      const button = page.locator(id);
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'false');
      await button.click();
      assert.equal(await button.getAttribute('aria-pressed'), 'true');
    }
    await page.getByRole('button', { name: 'Whole Moon', exact: true }).click();
    await page.waitForFunction(() => !document.getElementById('site').classList.contains('full'), null, { timeout: 20000 });
    await page.waitForTimeout(2500);
    assert.equal(await covering(page), false);
    log(`${width}px: 3D site view opens, toggles work, Whole Moon returns to the whole Moon`);

    // An in-year date from the normal view keeps the normal view.
    await estimateDate(page, '2026-12-10');
    await normalView(page, 'from a normal load');
    // Quick estimate outside the published year, refusal outside manifest coverage, then back to accurate.
    await estimateDate(page, '2030-06-15');
    await page.waitForFunction(() => /Showing the estimate/.test(document.getElementById('estimate-status').textContent), null, { timeout: 60000 });
    assert.match(await page.locator('#call').innerText(), /^(Go|No-go) · /);
    assert.equal(await page.locator('html').getAttribute('data-forecast-quality'), 'estimate');
    if (width === 1280) {
      // The Sun centre works in estimate mode too: the engine supplies the orbit.
      await page.locator('[data-centre="sun"]').click();
      await page.waitForFunction(() => document.getElementById('sem').dataset.orbit === 'estimate', null, { timeout: 30000 });
      await page.locator('[data-centre="earth"]').click();
    }
    assert.match(await page.locator('[data-result]').textContent(), /2030-06-15 UTC/);
    await page.screenshot({ path: `${output}/main-${width}-estimate.png` });
    await estimateDate(page, '2101-01-01');
    await page.waitForFunction(() => /not available for this year/.test(document.getElementById('estimate-status').textContent), null, { timeout: 20000 });
    await estimateDate(page, '2027-03-01');
    await page.waitForFunction(() => /Accurate forecast loaded/.test(document.getElementById('estimate-status').textContent), null, { timeout: 60000 });
    // An in-year date leaves estimate mode for the normal view.
    await normalView(page, 'from an estimate');
    page.reloading = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    page.reloading = false;
    await ready(page);
    await page.waitForTimeout(1500);
    assert.ok(await page.locator('#ring').isVisible(), 'a reload retains the sky clock');
    log(`${width}px: an in-year date keeps the normal view; estimate for 2030, refusal for 2101, then 2027 returns the normal view`);
    await page.context().close();
  }

  const page = await open(1280, 800);
  await ready(page);

  // Compare pins the current selection and keeps the Moon available for picking.
  await page.locator('#compare-btn').click();
  await page.locator('.compare-site[data-quality]').waitFor();
  assert.equal(await page.locator('.compare-site').count(), 1);
  assert.equal(await page.locator('.compare-add').count(), 2);
  assert.equal(await page.locator('#moon').evaluate(e => getComputedStyle(e).visibility), 'visible');
  await page.locator('#compare-close').click();
  log('Compare pins the selected site with two empty slots and a visible Moon');

  // Sun-Earth-Moon diagram: each centre button becomes the pressed one.
  await page.locator('#sem-btn').click();
  for (const centre of ['moon', 'earth', 'sun']) {
    const button = page.locator(`button[data-centre="${centre}"]`);
    if (!(await button.count())) continue;
    await button.first().click();
    assert.equal(await button.first().getAttribute('aria-pressed'), 'true');
  }
  await page.locator('#sem-btn').click();
  log('diagram centre buttons switch');

  // Times holds the countdowns and heights; the height lines live in the forecast panel only.
  await page.setViewportSize({ width: 900, height: 800 });
  await pick(page, 'connecting-ridge');
  await page.waitForFunction(() => document.getElementById('site').classList.contains('full'), null, { timeout: 20000 });
  // Times is the Forecast panel's right-hand column now; there is no Times button.
  assert.equal(await page.locator('#times-btn').isVisible(), false, 'no Times button');
  if (await page.locator('#fpanel').isHidden()) await page.locator('#fc-btn').click();
  await page.waitForFunction(() => document.querySelectorAll('#fpanel #times .counts .v').length === 4);
  assert.equal(await page.locator('#times .tchart, #chart-big').count(), 0, 'no chart in the clock column');
  log('Times, in the Forecast panel, shows the countdowns and heights; no Times button and no column chart');
  await page.getByRole('button', { name: 'Whole Moon', exact: true }).click();
  await page.waitForTimeout(2500);

  // Typed coordinates open an estimate named by them; Next returns to a listed site's normal view.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#now').click();
  await page.locator('.pk-go input[name="lat"]').fill('-85.5');
  await page.locator('.pk-go input[name="lon"]').fill('30.25');
  await page.locator('.pk-go').getByRole('button', { name: 'Go', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.forecastQuality === 'estimate' &&
    /^(Go|No-go)/.test(document.getElementById('call').textContent.trim()), null, { timeout: 60000 });
  const typedName = page.locator('#now-name');
  assert.equal(await typedName.textContent(), '85.50° S, 30.25° E');
  assert.ok(await typedName.evaluate(n => n.scrollWidth <= n.clientWidth), 'the typed place\'s name fits, hemisphere letter included');
  await page.locator('#next').click();
  await normalView(page, 'after Next from typed coordinates');
  log('typed coordinates open an estimate, and Next returns to the normal view');

  // A visited site's panel shows its landing day: the touchdown in UTC and the estimated sky.
  await page.setViewportSize({ width: 1280, height: 800 });
  await pick(page, 'apollo-11');
  // The open Forecast panel can leave this lazy-loaded section below the site's photo.
  await page.locator('#panel .landing[data-site="apollo-11"]').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const box = document.querySelector('#panel .landing');
    return box && /20:17 UTC/.test(box.textContent) && /Sun (up|hidden)/.test(box.textContent) && /Earth (up|hidden)/.test(box.textContent);
  }, null, { timeout: 60000 }).catch(async () => assert.fail(`Apollo 11's landing day did not show: ${await page.locator('#panel').innerText()}`));
  assert.match(await page.locator('#panel .landing').innerText(), /days of sunlight left/);
  log('a visited site shows its landing day at 20:17 UTC with the Sun and Earth');
  // A far-side site's Earth never rises.
  await pick(page, 'change-4');
  await page.locator('#panel .landing[data-site="change-4"]').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => /Earth hidden, [^·]*· never rises here/.test(document.querySelector('#panel .landing')?.textContent || ''),
    null, { timeout: 60000 }).catch(async () => assert.fail(`Chang'e 4's landing day: ${await page.locator('#panel').innerText()}`));
  log('landing day says how long sunlight lasts, and a far-side Earth never rises');
  await page.getByRole('button', { name: 'Whole Moon', exact: true }).click();
  await page.waitForTimeout(1500);

  // Observer view from the top bar opens the observer at the selected site.
  const link = page.locator('#observer-top');
  await link.waitFor();
  const href = new URL(await link.getAttribute('href'), `${base}/`);
  await link.click();
  await page.waitForURL(url => new URL(url).pathname === '/observer/');
  await page.waitForFunction(() => document.querySelector('#forecast-status')?.textContent.match(/ · Sun (in view|hidden by terrain) · Earth /), null, { timeout: 60000 });
  assert.equal(await page.locator('#catalog-site').inputValue(), href.searchParams.get('site'));
  log('top-bar Observer view opens the observer at the selected site');

  // A page opened as an estimate link can still change site: the arrows and a pin click.
  const name = p => p.locator('#now-name').textContent();
  await page.goto(`${base}/?t=2026-01-07T00%3A00%3A00.000Z&estimate=1&site=connecting-ridge`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForFunction(() => /estimate/i.test(document.getElementById('estimate-status').textContent));
  const first = await name(page);
  await page.locator('#next').click();
  await page.waitForFunction(n => document.getElementById('now-name').textContent !== n, first, { timeout: 20000 });
  await pick(page, 'shackleton-rim');
  await page.waitForFunction(() => /Shackleton rim/i.test(document.getElementById('now-name').textContent), null, { timeout: 20000 });
  assert.equal(new URL(page.url()).searchParams.get('estimate'), '1');
  log('an estimate link can change site with the arrows and a pin');

  // Typed coordinates in the link open that place, named by its coordinates, as an estimate.
  await page.goto(`${base}/?lat=-85.5&lon=30.25`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await page.waitForFunction(() => document.getElementById('now-name').textContent.includes('85.50° S, 30.25° E'), null, { timeout: 30000 });
  await page.waitForFunction(() => /estimate/i.test(document.getElementById('estimate-status').textContent), null, { timeout: 30000 });
  log('a lat/lon link opens the typed place as an estimate');

  // Observer view from that typed place keeps the point and the date, as an estimate.
  const observerLink = page.locator('a[href^="observer/"]:visible').first();
  // The page itself is in live time (no date in its link); the Observer link carries the hour shown.
  const handoffUtc = new URL(await observerLink.getAttribute('href'), page.url()).searchParams.get('t');
  await observerLink.click();
  await page.waitForURL(url => new URL(url).pathname === '/observer/');
  await page.waitForFunction(() => /^Estimate · /.test(document.querySelector('#forecast-status')?.textContent || ''), null, { timeout: 60000 });
  const at = new URL(page.url()).searchParams;
  assert.equal(at.get('lat'), '-85.5'); assert.equal(at.get('lon'), '30.25');
  assert.equal(new Date(at.get('t')).toISOString(), new Date(handoffUtc).toISOString());
  assert.equal(await page.locator('#catalog-site').evaluate(el => el.selectedOptions[0].textContent), '85.50° S, 30.25° E');
  log('Observer view from a typed place keeps the point, the date and the estimate');

  // A click on the Moon's face, away from pins, opens that point as an estimate named by its
  // coordinates; a drag only turns the globe.
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await ready(page);
  const moonBox = await page.locator('#moon').boundingBox();
  const pinCentres = await page.evaluate(() => [...document.querySelectorAll('#pins .pin')]
    .map(e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
  const spot = [[-60, -40], [60, -60], [-80, 50], [40, 70], [0, -90]]
    .map(([dx, dy]) => [moonBox.x + moonBox.width * 0.45 + dx, moonBox.y + moonBox.height * 0.42 + dy])
    .find(([x, y]) => pinCentres.every(([px, py]) => Math.hypot(px - x, py - y) > 40));
  const beforeDrag = await page.locator('#now-name').textContent();
  await page.mouse.move(spot[0], spot[1]); await page.mouse.down();
  await page.mouse.move(spot[0] + 80, spot[1] + 30, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#now-name').textContent(), beforeDrag, 'a drag does not open a point');
  await page.mouse.click(spot[0], spot[1]);
  await page.waitForFunction(() => /^\d+\.\d\d° [NS], \d+\.\d\d° [EW]$/.test(document.getElementById('now-name').textContent), null, { timeout: 20000 });
  await page.waitForFunction(() => /estimate/i.test(document.getElementById('estimate-status').textContent), null, { timeout: 30000 });
  // In live time the link names the point but no date, so a reload opens it live again.
  const pointLink = new URL(page.url()).searchParams;
  assert.ok(pointLink.get('lat') && pointLink.get('lon'), 'the link names the clicked point');
  assert.equal(pointLink.get('t'), null, 'live time keeps the date out of the link');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.forecastQuality), 'estimate', 'the clicked point is an estimate');
  log('a click on the Moon opens that point as an estimate; a drag only turns the globe');
  // Its panel: the distance to the nearest listed site and the Sun and Earth at the selected time.
  await page.waitForFunction(() => /km from /.test(document.querySelector('#panel-id .p-coords')?.textContent || '') &&
    /Sun (up|hidden)[^·]*· (.* of sunlight left|rises in .*)/.test(document.querySelector('.point-sky')?.textContent || ''), null, { timeout: 30000 })
    .catch(async () => assert.fail(`point panel: ${await page.locator('#panel').innerText()}`));
  assert.equal(await page.evaluate(() => document.querySelector('.pick')?.hidden), false, 'the point is marked on the globe');
  log("a clicked point's panel shows the nearest listed site and the Sun and Earth now, and the globe marks it");

  // Opened without a date: the current UTC hour, in the published forecast inside 1 Dec 2026 –
  // 30 Nov 2027 and as an estimate outside it; the date button shows the live minute (which may
  // have moved on by a minute while it loads).
  for (const [now, quality, shown] of [['2026-12-14T12:34:00Z', 'accurate', '14 Dec 2026 · 12:34 UTC'], ['2026-11-15T11:17:00Z', 'estimate', '15 Nov 2026 · 11:17 UTC']]) {
    await setClock(page, now);
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(q => document.querySelector('#status').textContent === '' &&
      (document.documentElement.dataset.forecastQuality ?? 'accurate') === q &&
      /^(Go|No-go)/.test(document.querySelector('#call').textContent), quality, { timeout: 90000 });
    await page.waitForFunction(text => [text, text.replace(/(\d\d) UTC$/, (_, m) => `${String(+m + 1).padStart(2, '0')} UTC`)]
      .includes(document.querySelector('.date-trigger')?.textContent), shown, { timeout: 15000 })
      .catch(async () => assert.fail(`${now}: the date button reads ${await page.locator('.date-trigger').textContent()}`));
  }
  log('opened without a date: the current UTC hour, published in the forecast year and an estimate outside it');

  assert.deepEqual(errors, []);
  log('no browser JavaScript errors');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error(await page.evaluate(() => ({ url:location.href, date:document.querySelector('#estimate-date')?.value,
      status:document.querySelector('#estimate-status')?.textContent, result:document.querySelector('[data-result]')?.textContent })));
  }
  console.error(errors);
  throw error;
} finally {
  await browser.close();
}
