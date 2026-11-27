/* global window, document, process, requestAnimationFrame */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const phase = process.argv[2] ?? 'after';
assert.ok(['before', 'after'].includes(phase));
const output = `.grok-run/gear-ui/shots/gacha-${phase}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
try {
  for (const [width, height] of [[1280, 720], [960, 640]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const gameTime = 20000;
    const prepare = async count => {
      await page.goto(process.env.BASE_URL ?? 'http://localhost:5173/', { waitUntil: 'networkidle' });
      await page.evaluate(async ({ count, gameTime }) => {
        const game = window.__game;
        await game.whenReady();
        game.pause(); game.setSeed(4721);
        const state = game.getState();
        state.tickets = 20;
        state.pityLegendary = count === 1 ? 59 : 56;
        game.load(state); game.freezeClock(gameTime); game.openPanel('recruit');
        await document.fonts.ready;
      }, { count, gameTime });
      await page.locator('main[data-view="recruit"]').waitFor();
    };
    const capture = async (name, ms) => {
      await page.mouse.move(0, 0);
      await page.evaluate(async time => {
        window.__game.freezeClock(time);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, gameTime + ms);
      await page.screenshot({ path: `${output}/gacha-${width}-${name}.png` });
    };
    const pull = async (count, instant = false) => {
      await page.locator(`[data-action="pull-${count === 1 ? 'one' : 'ten'}"]`).click();
      await page.locator(instant ? '[data-control="reveal-ok"]' : '[data-control="reveal-skip"]').waitFor();
      const state = await page.evaluate(() => window.__game.getManagementReveal());
      assert.equal(state.pulls.length, count);
      return state.pulls;
    };
    const close = () => page.locator('[data-control="reveal-ok"]').click();
    await prepare(1);
    await capture('recruit', 0);
    const one = await pull(1);
    assert.equal(one[0].rarity, 'legendary');
    await capture('anticipation', 600);
    await capture('silhouette', 1200);
    await capture('burst', 1400);
    await capture('x1-result', 3000);
    await close();
    await prepare(10);
    const ten = await pull(10);
    await capture('x10-sequence', phase === 'before' ? 600 : 1400);
    await capture('x10-summary', 7000);
    await close();
    await prepare(10);
    assert.deepEqual(await pull(10), ten);
    await page.evaluate(time => window.__game.freezeClock(time), gameTime + 320);
    await page.locator('[data-control="reveal-skip"]').click();
    await capture('skip-summary', 320);
    assert.deepEqual(await page.evaluate(() => window.__game.getManagementReveal().pulls), ten);
    assert.equal(await page.evaluate(() => window.__game.getState().tickets), 10);
    if (phase === 'after') {
      await close();
      // Reduced motion and frozen animation must settle immediately, even with the clock parked on the click.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await prepare(10);
      assert.deepEqual(await pull(10, true), ten);
      assert.equal(await page.locator('#recruit-result-description li').count(), 10);
      assert.equal(await page.locator('[data-control="reveal-skip"]').count(), 0);
      await capture('reduced-summary', 0);
      const canvas = page.locator('.reveal-stage canvas');
      const still = await canvas.evaluate(node => node.toDataURL());
      await page.evaluate(time => window.__game.freezeClock(time), gameTime + 600);
      await page.waitForTimeout(150);
      assert.equal(await canvas.evaluate(node => node.toDataURL()), still);
      await page.locator('[data-control="reveal-again"]').press('Enter');
      await page.waitForFunction(() => window.__game.getState().tickets === 0);
      assert.ok(await page.locator('[data-control="reveal-again"]').isDisabled());
      await close();

      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await prepare(1);
      await page.evaluate(() => window.__management.freezeAnimation(true));
      assert.deepEqual(await pull(1, true), one);
      await close();

      await prepare(1);
      await page.locator('[data-tab="settings"]').click();
      await page.locator('[data-action="reduced-motion"]').click();
      await page.locator('[data-tab="recruit"]').click();
      assert.deepEqual(await pull(1, true), one);
      await close();
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally { await browser.close(); }
