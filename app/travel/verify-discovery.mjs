/** Real engine + browser: reported filters, streamed destinations and a fresh next page. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const { chromium } = createRequire(import.meta.url)(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const output = process.env.TANAW_TEST_OUTPUT || 'out/travel-discovery-review';
await mkdir(output, { recursive: true });
const hardware = process.env.TANAW_TEST_GPU === 'hardware';
const preloadLeadMs = process.env.TANAW_PRELOAD_LEAD_MS === undefined ? null : Number(process.env.TANAW_PRELOAD_LEAD_MS);
assert.ok(preloadLeadMs === null || (Number.isFinite(preloadLeadMs) && preloadLeadMs >= 0 && preloadLeadMs <= 10000));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: hardware ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const errors = []; page.on('pageerror', e => errors.push(e.message));
const snapshotModules = new Set();
let gpu;
try {
  assert.ok(!(process.env.TANAW_TEST_PROFILE && process.env.TANAW_COMPUTATION_SNAPSHOT), 'Profile current code separately from an archived-build comparison');
  // A fixed seed and optional archived computation build allow like-for-like browser timing.
  if (process.env.TANAW_DISCOVERY_SEED) {
    const seed = Number(process.env.TANAW_DISCOVERY_SEED);
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
    await page.route('**/travel/worker.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace('crypto.getRandomValues(new Uint32Array(1))[0]', String(seed)) });
    });
  }
  if (process.env.TANAW_COMPUTATION_SNAPSHOT) await page.route('**/computation/dist/**', async route => {
    const relative = new URL(route.request().url()).pathname.split('/computation/dist/')[1];
    assert.ok(relative && !relative.split('/').includes('..'));
    await route.fulfill({ contentType: 'text/javascript', body: await readFile(resolve(process.env.TANAW_COMPUTATION_SNAPSHOT, relative)) });
    snapshotModules.add(relative);
  });
  if (process.env.TANAW_TEST_PROFILE) await page.route('**/computation/dist/quick/engine.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + `
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  for (const method of ['forecast', 'visibilityBound']) {
    const original = QuickEngine.prototype[method];
    if (!original) continue;
    QuickEngine.prototype[method] = async function(...args) {
      const result = await original.apply(this, args);
      self.postMessage({type:'benchmark-quick', method, timings:result.timings || {totalMs:result.totalMs}});
      return result;
    };
  }
}` });
  });
  await page.addInitScript(() => {
    window.discoveryMessages = []; window.travelTimings = []; window.travelWorkers = 0; window.travelTerminations = 0; window.engineTimings = []; window.preloadTimings = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) { super(...args); this.isTravel = String(args[0]).includes('/travel/worker.js'); if (this.isTravel) window.travelWorkers++; this.addEventListener('message', ({ data }) => {
        if (this.isTravel && data.type === 'benchmark-quick') window.engineTimings.push({...data, operation:window.travelTimings.length});
        if (data.type === 'warmup-complete' && this.preloadTiming) Object.assign(this.preloadTiming, { completeMs:performance.now()-this.preloadTiming.started, ready:data.ready });
        if (this.timing) {
          const elapsed = performance.now() - this.timing.started;
          if (data.type === 'catalog' && data.results.some(r => r.status === 'pass')) this.timing.firstKnownMs ??= elapsed;
          if (data.type === 'candidate') this.timing.firstCandidateMs ??= elapsed;
          if (data.type === 'complete') this.timing.completeMs = elapsed;
        }
        if (['candidate', 'complete', 'error'].includes(data.type)) window.discoveryMessages.push(data);
      }); }
      postMessage(...args) {
        if (this.isTravel && args[0].operation === 'warmup') {
          this.preloadTiming = { started: performance.now() }; window.preloadTimings.push(this.preloadTiming);
        } else if (this.isTravel) {
          this.timing = { operation: args[0].operation || 'search', started: performance.now() };
          if (!this.searched && this.preloadTiming) this.timing.preloadLeadMs = this.timing.started - this.preloadTiming.started;
          this.searched = true; window.travelTimings.push(this.timing);
        }
        return super.postMessage(...args);
      }
      terminate() { if (this.isTravel) window.travelTerminations++; return super.terminate(); }
    };
  });
  await page.goto(`${process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4189'}/?site=connecting-ridge&t=2027-02-26T01:47:00Z`);
  await page.getByRole('button', { name: 'Travel', exact: true }).waitFor({ state: 'visible', timeout: 120000 });
  const renderer = await page.locator('#moon').evaluate(canvas => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
  });
  const system = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
  gpu = { mode: hardware ? 'hardware' : 'software', renderer, devices: system.gpu.devices, featureStatus: system.gpu.featureStatus };
  if (hardware) {
    assert.ok(renderer, 'Hardware benchmark must identify the actual WebGL renderer');
    assert.doesNotMatch(renderer, /swiftshader|llvmpipe|software|microsoft basic render/i, 'Hardware benchmark cannot use software fallback');
  }
  console.log('WebGL renderer:', renderer);
  const click = name => page.getByRole('button', { name, exact: true }).click();
  const complete = () => page.waitForFunction(() => /^Search (complete|incomplete)/.test(document.querySelector('#travel [data-status]')?.textContent), null, { timeout: 240000 });
  if (preloadLeadMs !== null) {
    // Same input handlers as the visible controls, in one task: the zero-lead case must
    // not accidentally prewarm while automation spends time filling the form.
    await page.evaluate(lead => {
      document.querySelector('#travel-btn').click();
      for (const [selector, value] of [['[data-hours="sunlight"]','18.3'], ['[data-hours="earth"]','13.2']]) {
        const field = document.querySelector(`#travel ${selector}`); field.value = value;
        field.dispatchEvent(new Event('input', { bubbles:true }));
      }
      document.querySelector('#travel [data-criteria="terrainEnabled"]').click();
      if (lead === 0) document.querySelector('#travel form').requestSubmit();
    }, preloadLeadMs);
    if (preloadLeadMs > 0) {
      await page.waitForTimeout(preloadLeadMs);
      assert.equal(await page.locator('.travel-result').count(), 0, 'preload must not start a destination search');
      assert.equal(await page.getByRole('button', { name:'Cancel', exact:true }).isVisible(), false);
      await click('Search');
    }
  } else {
    await click('Travel');
    await click('Filters 3 enabled');
    await page.getByLabel('Minimum sunlight hours', { exact: true }).fill('18.3');
    await page.getByLabel('Minimum Earth visibility hours', { exact: true }).fill('13.2');
    await page.getByRole('checkbox', { name: 'Terrain', exact: true }).uncheck();
    await click('Close Travel filters'); await click('Search');
  }
  assert.equal(await page.getByRole('button', { name: 'Date based', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Region based', exact: true }).count(), 0);
  assert.equal(await page.getByLabel('Arrival · UTC', { exact: true }).isVisible(), true);
  await page.waitForFunction(() => window.discoveryMessages.some(m => m.type === 'candidate'), null, { timeout: 180000 });
  assert.ok(await page.locator('.travel-result').count() > 12, 'real random matches must stream before completion');
  await complete();
  assert.equal(await page.locator('#travel [data-error]').isVisible(), false);
  const first = await page.evaluate(() => window.discoveryMessages.filter(m => m.discovery).at(-1));
  if (process.env.TANAW_DISCOVERY_SEED) assert.equal(first.discovery.seed, Number(process.env.TANAW_DISCOVERY_SEED));
  assert.equal(first.results.filter(r => r.status === 'pass').length, 12);
  assert.ok(first.discovery.found.south > 0 && first.discovery.found.elsewhere > 0);
  assert.deepEqual(first.discovery.target, {south: 2, elsewhere: 3});
  assert.ok(first.discovery.found.south <= 2 && first.discovery.found.elsewhere <= 3);
  assert.equal(first.sampled.length, first.discovery.found.south + first.discovery.found.elsewhere);
  console.log('First browser page:', first.discovery.found, first.discovery.stopReason, Math.round(first.discovery.elapsedMs), 'ms');
  assert.ok(first.sampled.every(r => r.status === 'pass' && r.sunlight.hours >= 18.3 && r.earth.hours >= 13.2));
  assert.equal(await page.locator('.fp-day').count(), 22);
  assert.equal(await page.locator('.fp-day[aria-current="date"]').getAttribute('data-i'), '7');
  assert.match(await page.locator('.fp-trip').getAttribute('aria-label'), /26 Feb 2027.*5 Mar 2027/);
  assert.doesNotMatch(await page.locator('#travel').innerText(), /\d+\/(2|3|5|12)\b/);
  await page.screenshot({ path: `${output}/desktop-results.png` });
  // Existing cards/canvases must retain their identity while new points are appended.
  await page.locator('.travel-result').first().evaluate(n => { window.firstCard = n; });
  await click('Load more'); await complete();
  assert.equal(await page.getByRole('button', { name: 'Load more', exact: true }).count(), 0, 'one extra batch per search');
  const second = await page.evaluate(() => window.discoveryMessages.filter(m => m.discovery).at(-1));
  assert.ok(second.discovery.found.south > 0 && second.discovery.found.elsewhere > 0);
  assert.deepEqual(second.discovery.target, {south: 2, elsewhere: 3});
  assert.ok(second.discovery.found.south <= 2 && second.discovery.found.elsewhere <= 3);
  assert.equal(second.sampled.length, first.sampled.length + second.discovery.found.south + second.discovery.found.elsewhere);
  const keys = second.sampled.map(r => `${r.point.lat}:${r.point.lon}`);
  assert.equal(new Set(keys).size, second.sampled.length, 'Load more must append distinct checked locations');
  assert.ok(second.sampled.every(r => r.status === 'pass' && r.sunlight.hours >= 18.3 && r.earth.hours >= 13.2));
  assert.equal(await page.locator('.travel-result').first().evaluate(n => n === window.firstCard), true);
  await page.locator('.fp-day[data-i="6"]').click();
  await page.waitForFunction(() => document.querySelector('.fp-day[aria-current="date"]')?.dataset.i === '6');
  assert.equal(await page.locator('.travel-result').count(), 12 + second.sampled.length, 'scrubbing context preserves the planned trip and its results');
  assert.equal(await page.getByLabel('Arrival · UTC', { exact: true }).inputValue(), '2027-02-26T01:47');
  assert.match(await page.locator('.fp-trip').getAttribute('aria-label'), /26 Feb 2027.*5 Mar 2027/);
  let filtered;
  if (process.env.TANAW_TEST_REUSE) {
    const workers = await page.evaluate(() => window.travelWorkers);
    await click('Filters 2 enabled');
    await page.getByLabel('Minimum sunlight hours', { exact: true }).fill('18.4');
    await click('Close Travel filters'); await complete();
    assert.equal(await page.evaluate(() => window.travelWorkers), workers, 'completed worker survives filter changes');
    filtered = await page.evaluate(() => window.discoveryMessages.filter(m => m.discovery).at(-1));
    assert.deepEqual(filtered.discovery.found, { south: 2, elsewhere: 3 });
    assert.ok(filtered.sampled.every(r => r.status === 'pass' && r.sunlight.hours >= 18.4 && r.earth.hours >= 13.2));
    assert.equal(await page.getByRole('button', { name: 'Load more', exact: true }).isVisible(), true, 'a new search restores one optional batch');
  }
  const timings = await page.evaluate(() => window.travelTimings);
  if (process.env.TANAW_COMPUTATION_SNAPSHOT) for (const module of ['landing-source.js', 'quick/engine.js', 'quick/terrain.js']) assert.ok(snapshotModules.has(module), `Archived module was not routed: ${module}`);
  const engineTimings = await page.evaluate(() => window.engineTimings);
  const preloadTimings = await page.evaluate(() => window.preloadTimings);
  if (preloadLeadMs !== null) assert.ok(preloadTimings[0]?.ready, 'bounded preload must complete successfully');
  await writeFile(`${output}/actual-results.json`, JSON.stringify({ first, second, filtered, timings, gpu, engineTimings, preloadTimings, requestedPreloadLeadMs:preloadLeadMs, snapshotModules: [...snapshotModules] }, null, 2));
  console.log('Browser timing (ms):', timings);
  console.log('PASS actual filters, streamed matches, unique continuation and stable forecast context', { known: 12, first: first.discovery.found, next: second.discovery.found, milliseconds: [first.discovery.elapsedMs, second.discovery.elapsedMs] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.travel-main').evaluate(n => { n.scrollTop = 0; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/mobile-results.png` });
  await click('Filters 2 enabled');
  await page.getByLabel('Minimum sunlight hours', { exact: true }).fill('20');
  assert.equal(await page.locator('#travel').evaluate(n => n.classList.contains('is-loading')), true);
  await click('Close Travel filters'); await click('Cancel');
  const cancelledCount = await page.locator('.travel-result').count();
  await page.waitForTimeout(600);
  assert.equal(await page.locator('.travel-result').count(), cancelledCount, 'cancelled work must not append stale results');
  assert.equal(await page.locator('.travel-result').evaluateAll(rows => rows.includes(window.firstCard)), false, 'changed filters discard old cards');
  assert.equal(await page.locator('#travel').evaluate(n => n.classList.contains('is-loading')), false);
  if (preloadLeadMs !== null) {
    await page.locator('#travel [data-close]').click();
    const before = await page.evaluate(() => ({ workers:window.travelWorkers, terminated:window.travelTerminations, searches:window.travelTimings.length }));
    await click('Travel'); await page.locator('#travel [data-close]').click();
    const closed = await page.evaluate(() => ({ workers:window.travelWorkers, terminated:window.travelTerminations, searches:window.travelTimings.length }));
    assert.equal(closed.workers, before.workers + 1);
    assert.equal(closed.terminated, before.terminated + 1, 'closing Travel terminates speculative preparation');
    assert.equal(closed.searches, before.searches, 'opening and closing Travel must not search for destinations');
    await click('Travel');
    assert.equal(await page.locator('.travel-result').count(), 0);
    assert.equal(await page.locator('#travel').evaluate(n => n.classList.contains('is-loading')), false);
    await page.locator('#travel [data-close]').click();
    console.log('PASS close during preload, fresh reopen, and no automatic destination search');
  }
  assert.deepEqual(errors, []);
} catch (error) {
  await writeFile(`${output}/failure-messages.json`, JSON.stringify(await page.evaluate(() => window.discoveryMessages), null, 2));
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally { await browser.close(); }
