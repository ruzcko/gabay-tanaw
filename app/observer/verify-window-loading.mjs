/** Browser integration checks. Service responses below are synthetic UI fixtures, not science evidence.
 * Serve app/ on 127.0.0.1:4410; set TANAW_PLAYWRIGHT_PATH if Playwright is not installed locally.
 */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createStaticForecastProvider } from '../computation/dist/index.js';
import { QUICK_RANGE } from '../computation/dist/quick/coverage.js';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4410';
const output = process.env.TANAW_TEST_OUTPUT || 'out/window-review';
await mkdir(output, { recursive: true });
const data = new URL('../data/', import.meta.url);
const provider = createStaticForecastProvider({ baseUrl: data, fetcher: async url => new Response(await readFile(url)) });
const requests = [], held = [], errors = [];
const catalog = JSON.parse(await readFile(new URL('sites.json', data)));
async function wireSelection(context) {
  // Exercise the same callback as the navigator at exact catalog coordinates.
  await context.route('**/observer/demo.js', async route => {
    const source = await readFile(new URL('demo.js', import.meta.url), 'utf8');
    await route.fulfill({ contentType: 'text/javascript', body: `${source}\nglobalThis.testSelectCoordinates = selectCoordinates;` });
  });
}
const pickCatalog = (page, id) => {
  const site = catalog.find(site => site.id === id);
  return page.evaluate(point => globalThis.testSelectCoordinates(point), { latitudeDeg: site.lat, longitudeEastDeg: site.lon });
};
let supported = true, online = true;
async function observation(params) {
  const site = { latitudeDeg: Number(params.get('lat')), longitudeEastDeg: Number(params.get('lon')) };
  const instantUtc = new Date(params.get('t')).toISOString();
  const result = params.has('site')
    ? await provider.observe({ site: { ...site, id: params.get('site') }, instantUtc })
    : { site: { ...site, id: `custom-${site.latitudeDeg.toFixed(6)}-${site.longitudeEastDeg.toFixed(6)}`, referenceFrame: 'MOON_ME_DE421', elevationDatum: 'sphere-1737400m', surfaceElevationM: 0, observerHeightM: 2 },
      instantUtc, directionKind: 'apparent', interpolated: false,
      bodies: { sun: { azimuthDeg: 90, elevationDeg: 12, rangeKm: 149600000, angularDiameterDeg: .53, centerVisible: true }, earth: { azimuthDeg: 0, elevationDeg: 20, rangeKm: 384400, angularDiameterDeg: 1.9, centerVisible: true } },
      provenance: { source: 'Synthetic UI fixture', model: 'Not a scientific observation' } };
  result.provenance.appearance = { frame: 'MOON_ME_DE440_ME421' };
  result.lighting = { sunDirectionLocal: [0, 1, 0] };
  result.sky = { catalogFrame: 'ICRS-J1991.25', catalogToLocal: [0, 0, 0, 1] };
  result.overview = { axisConvention: 'x0-yNorth-zWest', moonRadiusM: 1737400, moonToLocal: [0, 0, 0, 1], siteDirectionMoon: [1, 0, 0], sunDirectionMoon: [0, 1, 0], earthDirectionMoon: [0, 0, 1] };
  return result;
}
const browser = await chromium.launch({ headless: true, channel: process.env.TANAW_TEST_BROWSER || 'msedge' });
let holdWindows = false;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    const original = window.fetch;
    window.fetch = (input, init) => original(input, String(input).startsWith('/api/observer') ? { ...init, signal: undefined } : init);
  });
  await context.route('**/api/**', async route => {
    const url = new URL(route.request().url()), params = url.searchParams;
    if (url.pathname === '/api/health') return route.fulfill({ json: online ? { service: 'tanaw-observer', observerWindow: supported ? { durationDays: 30 } : undefined } : {} });
    if (url.pathname === '/api/terrain') return route.fulfill({ status: 503, json: { error: 'UI fixture: reference ground.' } });
    const request = { path: url.pathname, params: Object.fromEntries(params) }; requests.push(request);
    let outcome = {};
    if (url.pathname === '/api/observer-window' && holdWindows) {
      outcome = await new Promise(resolve => { request.release = value => resolve(value || {}); held.push(request); });
    }
    if (outcome.error) return route.fulfill({ status: 502, json: { error: 'Test preparation failed' } });
    const result = await observation(params);
    const observations = !outcome.missingDaily && url.pathname === '/api/observer-window' ? await Promise.all(Array.from({ length: 30 }, (_, day) => {
      const daily = new URLSearchParams(params);
      daily.set('t', new Date(Date.parse(params.get('startUtc')) + day*86400000 + Date.parse(params.get('t'))%86400000).toISOString());
      return observation(daily);
    })) : undefined;
    return route.fulfill({ json: url.pathname === '/api/observer-window'
      ? { coverage: { startUtc: params.get('startUtc'), endUtc: params.get('endUtc'), stepSeconds: 3600, sampleCount: outcome.invalidCoverage ? 719 : 720 }, observation: result, observations } : result });
  });
  await wireSelection(context);
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => document.querySelector('#forecast-status').textContent.match(/ · Sun (in view|hidden by terrain) · Earth /));
  const pick = async () => { assert.ok(await page.locator('#moon-navigator').isVisible()); await page.locator('.location-map canvas').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); };
  const scrub = async value => page.locator('#day').evaluate((el, n) => { el.value = n; el.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  const awaitHeld = async count => { for (let i = 0; held.length < count && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(held.length, count, JSON.stringify({ errors, status: await page.locator('#forecast-status').textContent(), error: await page.locator('#error').textContent(), url: page.url() })); };
  const utcAt = (day, hour = 14) => new Date(Date.parse('2026-12-01T00:00:00Z') + day*86400000 + hour*3600000).toISOString();
  const selectedTime = expected => page.waitForFunction(utc => new URL(location.href).searchParams.get('t') === utc, expected);
  const status = () => page.locator('#window-status').textContent();
  const log = message => console.log(`PASS ${message}`);
  async function chooseRange(target, amount, unit) {
    await target.locator('#observer-range').click();
    const units = target.getByRole('listbox', { name: 'Range unit', exact: true });
    await units.press('Home');
    for (let i = 0; i < ['day', 'week', 'month', 'year'].indexOf(unit); i++) await units.press('ArrowDown');
    const numbers = target.getByRole('listbox', { name: 'Range number', exact: true });
    await numbers.press('Home');
    for (let i = 1; i < amount; i++) await numbers.press('ArrowDown');
    await target.getByRole('button', { name: 'Confirm', exact: true }).click();
  }


  await page.goto(`${base}/observer/?t=2027-02-28T14:00:00Z`); await ready();
  await chooseRange(page, 1, 'year');
  await page.waitForTimeout(100); await ready();
  assert.equal(await page.locator('#day').getAttribute('max'), '364');
  assert.equal(requests.filter(r => r.path.includes('window')).length, 0);
  log('catalog ranges use published observations without custom preparation');

  holdWindows = true; await pick(); await awaitHeld(1);
  assert.equal(await page.locator('#observer-range').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#observer-range').isDisabled(), false);
  assert.equal(held[0].params.t, '2027-02-28T14:00:00.000Z');
  assert.match(await status(), /^0 of 365 days ready/);
  assert.match(await page.locator('#forecast-status').textContent(), /Still showing Connecting Ridge/);
  assert.equal(await page.locator('#moon-navigator').getAttribute('data-selection'), 'loading');
  assert.equal(await page.locator('.location-selection').isVisible(), true);
  assert.equal(await page.locator('#observer-range').getAttribute('aria-busy'), 'true');
  const rangeWidth = (await page.locator('#observer-range').boundingBox()).width;
  await page.screenshot({ path: `${output}/loading.png` });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const selector of ['.location-selection', '#observer-range'])
    assert.equal(await page.locator(selector).evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
  await page.screenshot({ path: `${output}/reduced-motion.png` });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  held[0].release(); await ready(); await awaitHeld(2);
  assert.match(await status(), /^30 of 365 days ready/);
  assert.equal(await page.locator('.location-selection').isVisible(), false);
  assert.equal(await page.locator('#moon-navigator').getAttribute('data-selection'), 'ready');
  assert.equal(await page.locator('#observer-range').getAttribute('aria-busy'), 'true');
  const initialCount = requests.length;
  await scrub(61); await selectedTime(utcAt(61));
  assert.equal(requests.length, initialCount);
  assert.match(await page.locator('#day').getAttribute('aria-valuetext'), /ready$/);
  log('selected chunk displays first; cached dates remain usable while annual preparation continues');

  await scrub(364);
  assert.match(await page.locator('#day').getAttribute('aria-valuetext'), /not loaded yet/);
  held[1].release(); await awaitHeld(3);
  assert.equal(held[2].params.endUtc, '2027-12-01T00:00:00.000Z');
  held[2].release(); await selectedTime(utcAt(364)); await awaitHeld(4);
  assert.match(await status(), /^90 of 365 days ready/);
  log('selecting an unavailable date prioritizes its chunk and preserves the UTC hour');

  held[3].release({ error: true });
  await page.waitForFunction(() => document.querySelector('#error').textContent.includes('Choose another location on the Moon navigator.'));
  assert.equal(new URL(page.url()).searchParams.get('t'), utcAt(364));
  assert.equal(await page.locator('#observer-range').getAttribute('aria-busy'), 'false');
  assert.match(await status(), /Loading paused/);
  const failedCount = requests.length;
  await scrub(61); await selectedTime(utcAt(61));
  assert.equal(requests.length, failedCount);
  await page.locator('#retry').click(); await awaitHeld(5);
  holdWindows = false; held[4].release();
  await page.waitForFunction(() => document.querySelector('#window-status').textContent.startsWith('365 of 365 days ready'));
  assert.equal(await page.locator('#observer-range').getAttribute('aria-busy'), 'false');
  assert.equal((await page.locator('#observer-range').boundingBox()).width, rangeWidth);
  assert.equal(new URL(page.url()).searchParams.get('t'), utcAt(61));
  for (const request of requests.filter(r => r.path === '/api/observer-window')) {
    assert.equal(Date.parse(request.params.endUtc)-Date.parse(request.params.startUtc), 30*86400000);
    assert.equal(Date.parse(request.params.t)%86400000, 14*3600000);
    assert.ok(Date.parse(request.params.t) >= Date.parse(request.params.startUtc) && Date.parse(request.params.t) < Date.parse(request.params.endUtc));
  }
  log('background failure retains loaded dates; Retry finishes the year using bounded validated chunks');

  const annualCount = requests.length;
  await chooseRange(page, 3, 'month'); await ready();
  assert.match(await status(), /^\d+ of \d+ days ready/); assert.equal(await page.locator('#observer-range [data-range-label]').textContent(), '3 months');
  await chooseRange(page, 30, 'day'); await ready();
  assert.match(await status(), /^30 of 30 days ready/);
  assert.equal(requests.length, annualCount);
  assert.equal(new URL(page.url()).searchParams.get('t'), utcAt(61));
  await pickCatalog(page, 'shackleton-rim'); await ready();
  assert.equal(await page.locator('#observer-range').getAttribute('aria-expanded'), 'false');
  log('range switches reuse available dates and preserve the shared selected date and range');

  holdWindows = true; let n = held.length;
  await pick(); await awaitHeld(n+1);
  await pickCatalog(page, 'connecting-ridge'); await ready();
  const catalogUrl = page.url(); held[n].release(); await page.waitForTimeout(100);
  assert.equal(page.url(), catalogUrl);
  assert.equal(await page.locator('#moon-navigator').getAttribute('data-selection'), 'ready');
  n = held.length;
  await pick(); await awaitHeld(n+1);
  await pick(); await awaitHeld(n+2);
  held[n+1].release(); await ready();
  const newestUrl = page.url(); held[n].release(); await page.waitForTimeout(100);
  assert.equal(page.url(), newestUrl);
  log('catalog and newer custom selections reject stale results even if transport ignores cancellation');

  for (const outcome of [{ invalidCoverage: true }, { missingDaily: true }, { error: true }]) {
    n = held.length; await pick(); await awaitHeld(n+1); held[n].release(outcome);
    await page.waitForFunction(() => document.querySelector('#error').textContent.length > 0);
    assert.equal(await page.locator('#moon-navigator').getAttribute('data-selection'), 'error');
    assert.equal(await page.locator('#observer-range').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('.location-selection').evaluate(el => getComputedStyle(el, '::before').animationName), 'none');
    assert.match(await status(), /^0 of 30 days ready/);
    await page.screenshot({ path: `${output}/error.png` });
    await page.locator('#retry').click(); await awaitHeld(n+2); held[n+1].release(); await ready();
    assert.equal(await page.locator('#moon-navigator').getAttribute('data-selection'), 'ready');
  }
  log('invalid coverage, missing daily snapshots and failed preparation remain unready and retryable');

  holdWindows = false;
  for (const [utc, first, end] of [
    ['2026-12-01T14:00:00Z', '2026-12-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z'],
    ['2027-11-30T23:00:00Z', '2027-11-01T00:00:00.000Z', '2027-12-01T00:00:00.000Z']
  ]) {
    await page.goto(`${base}/observer/?lat=1&lon=2&t=${utc}`); await ready();
    const request = requests.at(-1);
    assert.equal(request.params.startUtc, first); assert.equal(request.params.endUtc, end);
    assert.equal(request.params.t, utc.replace('Z', '.000Z'));
  }
  const lastHourCount = requests.length;
  await chooseRange(page, 1, 'year');
  await page.waitForFunction(() => document.querySelector('#window-status').textContent.startsWith('365 of 365 days ready'));
  assert.equal(new URL(page.url()).searchParams.get('t'), utcAt(364, 23));
  assert.ok(requests.slice(lastHourCount).every(request => Date.parse(request.params.t)%86400000 === 23*3600000));
  const count = requests.length;
  for (const search of [`lat=1&lon=2&t=${new Date(QUICK_RANGE.end).toISOString()}`, 't=', 'lat=&lon=2', 'lat=1&lon=0x10', 'lat=1&lon=-181',
    'lat=89.9999999&lon=2', 'lat=1&lon=2&lat=3', 't=&t=2027-01-01T00:00:00Z',
    'site=', 'site=connecting-ridge&site=connecting-ridge', 'site=connecting-ridge&lat=1&lon=2']) {
    await page.goto(`${base}/observer/?${search}`);
    await page.waitForFunction(() => document.querySelector('#error').textContent.length > 0);
    assert.equal(requests.length, count);
  }
  log('forecast boundaries preserve exact UTC time; malformed and conflicting links fail before science requests');

  supported = false;
  await page.goto(`${base}/observer/?lat=1&lon=2`);
  await page.waitForFunction(() => document.querySelector('#error').textContent.includes('30-day window'));
  assert.equal(requests.length, count);
  supported = true; await page.locator('#retry').click(); await ready();
  await page.goto(`${base}/observer/?lat=-89.4398&lon=-137.17&t=2027-02-28T14:00:00Z`); await ready();
  assert.equal(new URL(page.url()).searchParams.get('site'), 'connecting-ridge');
  assert.equal(requests.at(-1).path, '/api/observer');
  online = false; await page.goto(`${base}/observer/`); await ready();
  assert.doesNotMatch(await page.locator('#forecast-status').textContent(), /service/i);
  online = true;
  log('older service fails explicitly, Retry detects upgrade, and static catalog forecasts still work');

  const unavailable = "Custom locations need the forecast service, which isn't available on this site. Choose another location on the Moon navigator.";
  const staticContext = await browser.newContext();
  await wireSelection(staticContext);
  const staticPage = await staticContext.newPage();
  staticPage.on('pageerror', error => errors.push(error.message));
  const staticRequests = [];
  staticPage.on('request', request => staticRequests.push(new URL(request.url()).pathname));
  const staticReady = () => staticPage.waitForFunction(() => document.querySelector('#forecast-status').textContent.match(/ · Sun (in view|hidden by terrain) · Earth /)).catch(async error => {
    console.error({ errors, status: await staticPage.locator('#forecast-status').textContent(), error: await staticPage.locator('#error').textContent() });
    throw error;
  });
  const estimateShown = async expectedUtc => {
    await staticPage.waitForFunction(utc => document.querySelector('#forecast-status').textContent.startsWith('Estimate · ') &&
      /^Daily totals · Sun above terrain /.test(document.querySelector('[data-result]').textContent) &&
      /\d+\.\d\d° [NS], \d+\.\d\d° [EW]/.test(document.querySelector('.observer-site').textContent) &&
      new URL(location.href).searchParams.get('t') === utc, expectedUtc);
    assert.equal(await staticPage.locator('#error').textContent(), '');
    assert.equal(new URL(staticPage.url()).searchParams.has('site'), false);
    assert.equal(await staticPage.locator('#view').getAttribute('aria-busy'), 'false');
    assert.equal(await staticPage.locator('#moon-navigator').getAttribute('aria-busy'), 'false');
    assert.equal(await staticPage.locator('#window-status').isVisible(), false);
    assert.match(await staticPage.locator('.observer-message').textContent(), new RegExp(expectedUtc.slice(0, 16).replace('T', ' ')));
    assert.equal(await staticPage.locator('#estimate-date').getAttribute('min'), `${QUICK_RANGE.firstYear}-01-01`);
    assert.equal(await staticPage.locator('#estimate-date').getAttribute('max'), `${QUICK_RANGE.lastYear}-12-31`);
  };
  const unavailableShown = async () => {
    await staticPage.waitForFunction(message => document.querySelector('#error').textContent === message, unavailable);
    assert.equal(await staticPage.locator('#view').getAttribute('aria-busy'), 'false');
    assert.equal(await staticPage.locator('#moon-navigator').getAttribute('aria-busy'), 'false');
    assert.equal(await staticPage.locator('#forecast-status.is-loading, #observer-range.is-loading, .scene-feedback.is-loading').count(), 0);
    assert.equal(await staticPage.locator('.scene-feedback').isVisible(), false);
    assert.equal(await staticPage.locator('#window-status').isVisible(), false);
  };
  // No API mocks: the plain Python static server returns 404 for the absent service.
  await staticPage.goto(`${base}/observer/?t=2027-02-28T14:00:00Z`); await staticReady();
  await chooseRange(staticPage, 1, 'year'); await staticReady();
  await staticPage.locator('.location-map canvas').focus();
  await staticPage.keyboard.press('ArrowRight'); await staticPage.keyboard.press('Enter');
  await estimateShown('2027-02-28T14:00:00.000Z');
  assert.equal(await staticPage.locator('#observer-range').getAttribute('aria-expanded'), 'false', 'Custom estimate preserves selected range');
  assert.ok(!staticRequests.some(path => path.startsWith('/api/observer')), 'Static custom pick never requires an observer API');
  await pickCatalog(staticPage, 'shackleton-rim');
  await staticPage.waitForFunction(() => document.querySelector('#forecast-status').textContent.startsWith('Accurate forecast · ') &&
    document.querySelector('.observer-site').textContent.includes('Shackleton'));
  assert.match(await staticPage.locator('.observer-site').textContent(), /Shackleton/);
  assert.equal(await staticPage.locator('#error').textContent(), '');
  await staticPage.goto(`${base}/observer/?lat=1&lon=2&t=2026-12-02T14:00:00Z`);
  await estimateShown('2026-12-02T14:00:00.000Z');
  assert.equal(new URL(staticPage.url()).searchParams.get('lat'), '1');
  assert.equal(new URL(staticPage.url()).searchParams.get('lon'), '2');
  assert.ok(!staticRequests.some(path => path.startsWith('/api/observer')), 'Ordinary coordinate link needs no observer API');
  log('plain static hosting: custom picks and ordinary coordinate links automatically estimate, preserve UTC/range, and upgrade listed sites');

  for (const failure of ['health-network', 'no-service', 'window-network', 'window-404', 'window-json-404']) {
    await staticContext.unrouteAll();
    await wireSelection(staticContext);
    await staticContext.route('**/api/health', route => failure === 'health-network' ? route.abort('failed') :
      route.fulfill({ json: failure === 'no-service' ? {} : { service: 'tanaw-observer', observerWindow: { durationDays: 30 } } }));
    await staticContext.route('**/api/observer-window?*', route => failure === 'window-network' ? route.abort('failed') :
      failure === 'window-json-404' ? route.fulfill({ status: 404, json: { error: 'Not found' } }) :
        route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not found</h1>' }));
    await staticPage.goto(`${base}/observer/?lat=1&lon=2`);
    if (failure === 'health-network' || failure === 'no-service') await estimateShown('2026-12-01T00:00:00.000Z');
    else { await unavailableShown(); assert.equal(await staticPage.locator('.observer-site').textContent(), ''); }
    await pickCatalog(staticPage, 'connecting-ridge');
    await staticPage.waitForFunction(() => document.querySelector('.observer-site').textContent.includes('Connecting Ridge') &&
      document.querySelector('#forecast-status').textContent.match(/ · Sun (in view|hidden by terrain) · Earth /));
    assert.match(await staticPage.locator('.observer-site').textContent(), /Connecting Ridge/);
    assert.equal(await staticPage.locator('#error').textContent(), '');
    log(`${failure}: appropriate estimate or service-error path, no stuck spinner, listed-site recovery`);
  }
  await staticContext.close();

  // The Moon page's Observer view link opens this page with the selected site and UTC.
  await page.goto(`${base}/`);
  await page.waitForFunction(() => document.querySelectorAll('#pins > *').length > 0);
  await page.locator('#pins .pin:not(.many)').first().click(); // a single-site pin selects it
  const link = page.locator('a.observer'); await link.waitFor();
  const handoff = new URL(await link.getAttribute('href'), `${base}/`);
  assert.equal(handoff.pathname, '/observer/');
  for (const key of ['site', 'lat', 'lon', 't']) assert.ok(handoff.searchParams.get(key), `link carries ${key}`);
  await link.click(); await page.waitForURL(url => new URL(url).pathname === '/observer/'); await ready();
  assert.equal(new URL(page.url()).searchParams.get('site'), handoff.searchParams.get('site'));
  assert.equal(new Date(new URL(page.url()).searchParams.get('t')).toISOString(), new Date(handoff.searchParams.get('t')).toISOString());
  log('Moon page Observer view opens the observer at the selected site and UTC');

  for (const [width, height] of [[375,812], [320,568]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/observer/`); await ready();
    holdWindows = true; n = held.length; await pick(); await awaitHeld(n+1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const button = await page.locator('#observer-range').boundingBox(); assert.ok(button.height >= 44 && button.width >= 44);
    const caption = await page.locator('.location-globe figcaption').boundingBox(), viewport = await page.locator('.observer-viewport').boundingBox();
    assert.ok(caption.y + caption.height <= viewport.y + viewport.height + 1, 'navigator caption stays inside viewport');
    await page.screenshot({ path: `${output}/loading-${width}.png`, fullPage: true });
    held[n].release(); await ready(); holdWindows = false;
  }
  log('pending feedback and range controls fit 375px and 320px screens');
  assert.deepEqual(errors, []);
  log('no browser JavaScript errors');
} finally { provider.dispose(); await browser.close(); }
