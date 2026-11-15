import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
const { chromium } = createRequire(import.meta.url)(process.env.TANAW_PLAYWRIGHT_PATH || 'playwright');
const output = process.env.TANAW_TEST_OUTPUT || 'out/travel-compare-entry'; await mkdir(output, { recursive: true });
for (const [width, height] of JSON.parse(process.env.TANAW_TEST_VIEWPORTS || '[[1280,800],[390,844],[320,568]]')) {
  // Each entry flow starts with a fresh browser, including the forecast workers.
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    console.log(`Checking ${width}px comparison entry`);
    const page = await browser.newPage({ viewport:{width,height}, reducedMotion:width === 320 ? 'reduce' : 'no-preference' });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const click = name => page.getByRole('button', { name, exact:true }).click();
    await page.goto(`${process.env.TANAW_TEST_BASE_URL || 'http://127.0.0.1:4189'}/?site=malapert-massif&t=2027-02-26T01:47:00Z&estimate=1`);
    await page.locator('#compare-btn').click();
    await page.locator('.compare-site[data-quality]').waitFor();
    await page.locator('.compare-add').first().click();
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('tanaw:pick', {detail:{site:'im3-reiner-gamma'}})));
    await page.locator('.compare-site[data-quality]').nth(1).waitFor();
    const members = () => page.locator('.compare-site').evaluateAll(rows => rows.map(row => row.dataset.site));
    const dates = () => page.locator('.compare-site').first().locator('thead button').evaluateAll(cells => cells.map(c => c.getAttribute('aria-label')));
    const originalMembers = await members(), originalDates = await dates();
    async function assertCombined() {
      assert.equal(await page.locator('.hud.compare.travel-open.travel-compare').count(), 1);
      assert.ok(await page.locator('#compare').isVisible());
      assert.equal(await page.locator('#ring').evaluate(n => getComputedStyle(n).visibility), 'hidden');
      assert.equal(await page.locator('#ring').evaluate(n => n.inert), true);
      assert.equal(await page.locator('#fpanel').isVisible(), false);
      assert.equal(await page.locator('.plan').isVisible(), false);
      assert.equal(await page.locator('#panel').isVisible(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    }
    await click('Travel');
    await assertCombined();
    assert.deepEqual(await members(), originalMembers);
    assert.deepEqual(await dates(), originalDates, 'Opening Travel does not replace the comparison window');
    await page.locator('#travel [data-close]').click();
    assert.ok(await page.locator('#compare').isVisible(), 'Closing added Travel returns to the same comparison');
    assert.equal(await page.locator('#ring').evaluate(n => getComputedStyle(n).visibility), 'hidden');
    assert.deepEqual(await members(), originalMembers);
    await click('Travel');
    if (width <= 760) await click('Expand Travel');
    await click('Filters 3 enabled');
    await page.getByLabel('Minimum sunlight hours', {exact:true}).fill('18.3');
    await page.getByLabel('Minimum Earth visibility hours', {exact:true}).fill('13.2');
    await page.getByRole('checkbox', {name:'Terrain',exact:true}).uncheck();
    await click('Close Travel filters'); await click('Search');
    await page.waitForFunction(() => /^Search complete/.test(document.querySelector('#travel [data-status]')?.textContent), null, {timeout:120000}).catch(async error => {
      console.error(await page.locator('#travel').innerText());
      console.error(errors);
      await page.screenshot({path:`${output}/${width}-failure.png`});
      throw error;
    });
    if (width <= 760) await click('Collapse Travel');
    await assertCombined(); assert.deepEqual(await members(), originalMembers);
    if (width <= 760) await click('Expand Travel');
    const first = page.locator('.travel-result').filter({has:page.locator('strong', {hasText:/^Malapert massif$/})});
    await first.getByRole('button', {name:'Remove site',exact:true}).click();
    assert.deepEqual(await members(), ['im3-reiner-gamma']);
    await first.getByRole('button', {name:'Add site',exact:true}).click();
    assert.deepEqual(await members(), [...originalMembers].reverse(), 'Re-added site moves to the end of the comparison');
    assert.deepEqual(await page.locator('.compare-site-number').allTextContents(), ['1','2']);
    assert.deepEqual(await page.locator('.compare-marker b').allTextContents(), ['1','2']);
    if (width <= 760) await click('Collapse Travel');
    await page.locator('.compare-site-select').first().click();
    await page.waitForTimeout(1400);
    await assertCombined();
    await page.screenshot({path:`${output}/${width}.png`});
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${width}px: Compare → Travel preserves sites/window/hidden panels; closing Travel retains Compare; search and Add/Remove work without leaving Compare.`);
  } catch (error) { console.error(error); throw error; }
  finally { await browser.close(); }
}
