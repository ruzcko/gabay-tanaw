import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const output = 'out/travel-card-review'; await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url, options) { super(url, options); if (String(url).endsWith('/travel/worker.js')) this.addEventListener('message', ({ data }) => { if (data.type === 'complete') window.cardResults = data; }); }
    };
  });
  const click = name => page.getByRole('button', { name, exact: true }).click();
  await page.goto(`${process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4189'}/?site=connecting-ridge&t=2027-02-26T01:47:00Z&estimate=1`);
  await click('Travel'); await click('Filters 3 enabled');
  await page.getByLabel('Minimum sunlight hours', { exact: true }).fill('18.3');
  await page.getByLabel('Minimum Earth visibility hours', { exact: true }).fill('13.2');
  await page.getByRole('checkbox', { name: 'Terrain', exact: true }).uncheck();
  await click('Close Travel filters'); await click('Search');
  await page.waitForFunction(() => /^Search complete/.test(document.querySelector('#travel [data-status]')?.textContent), null, { timeout: 120000 });
  const evidence = await page.evaluate(() => {
    const results = [...window.cardResults.results, ...window.cardResults.sampled].filter(r => r.status === 'pass');
    return results.map(r => ({ name: r.point.name, days: r.days.length, sun: r.sunlight?.hours, earth: r.earth?.hours,
      dailySun: r.days.reduce((sum,d) => sum + d.sunHours, 0), dailyEarth: r.days.reduce((sum,d) => sum + d.earthHours, 0),
      duration: r.days.reduce((sum,d) => sum + d.durationHours, 0) }));
  });
  assert.ok(evidence.length >= 17);
  for (const r of evidence) { assert.equal(r.days, 8); assert.equal(r.duration, 168); assert.ok(Math.abs(r.sun - r.dailySun) < 1e-7); assert.ok(Math.abs(r.earth - r.dailyEarth) < 1e-7); }
  assert.equal(await page.locator('.travel-mini').count(), evidence.length);
  assert.equal(await page.locator('.travel-nearest').count(), evidence.length);
  const random = page.locator('.travel-result').filter({ hasText: 'Lunar destination' }).first();
  assert.match(await random.locator('.travel-nearest').innerText(), /km (N|NE|E|SE|S|SW|W|NW) of /);
  assert.equal(await random.locator('.travel-mini-table td').count(), 16);
  assert.match(await random.locator('.travel-mini-table td').first().getAttribute('aria-label'), /Estimate/);
  assert.match(await random.locator('a').getAttribute('href'), /tripEnd=/);
  assert.equal(await random.getByRole('button', { name: 'Book', exact: true }).isEnabled(), false);
  await random.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${output}/desktop.png` });
  for (const width of [820, 390, 320]) {
    await page.setViewportSize({ width, height: width === 320 ? 740 : 1000 });
    await random.scrollIntoViewIfNeeded();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const layout = await random.evaluate(n => {
      const head=n.querySelector('.travel-result-pick').getBoundingClientRect(), preview=n.querySelector('.travel-result-preview').getBoundingClientRect(), actions=n.querySelector('.travel-actions').getBoundingClientRect();
      return {head:{x:head.x,right:head.right,bottom:head.bottom}, preview:{x:preview.x,y:preview.y,right:preview.right}, actions:{right:actions.right}};
    });
    if (width === 820) assert.ok(layout.preview.x > layout.head.right, 'wide card uses the empty right side');
    else assert.ok(layout.preview.y >= layout.head.bottom, 'narrow cards stack without shrinking the Moon');
    assert.equal(layout.preview.right, layout.actions.right);
    await random.locator('.travel-mini-scroll').focus();
    assert.equal(await random.locator('.travel-mini-scroll').evaluate(n => n === document.activeElement), true);
    await page.screenshot({ path: `${output}/width-${width}.png` });
  }
  // A 30-day stay stays scrollable; unknown days are distinct from genuine zeroes.
  await page.evaluate(async () => {
    const { miniForecast } = await import('/travel/mini-forecast.js');
    const days=Array.from({length:30},(_,i)=>({date:`2027-01-${String(i+1).padStart(2,'0')}`,startUtc:`2027-01-${String(i+1).padStart(2,'0')}T00:00:00Z`,endUtc:`2027-01-${String(i+2).padStart(2,'0')}T00:00:00Z`,durationHours:24,sunHours:i===0?null:0,earthHours:24,quality:i===0?'unknown':'estimate'}));
    document.querySelector('.travel-result-preview').replaceChildren(miniForecast({startUtc:days[0].startUtc,endUtc:days.at(-1).endUtc,days}));
  });
  assert.equal(await page.locator('.travel-mini-value.is-unknown').count(), 1);
  assert.equal(await page.locator('.travel-mini-table td').first().innerText(), '?');
  assert.equal(await page.locator('.travel-mini-table td').nth(1).innerText(), '0');
  assert.equal(await page.locator('.travel-mini-scroll').first().evaluate(n=>n.scrollWidth>n.clientWidth), true);
  assert.deepEqual(errors, []);
  console.log(`PASS ${evidence.length} real destinations: daily totals match stay metrics; catalogue references; estimate labels; wide/right and narrow/stacked layouts; keyboard scrolling; 30-day overflow; unknown vs zero; Observer route and disabled Book.`);
} finally { await browser.close(); }
