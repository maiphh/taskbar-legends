/* global window, document, process, requestAnimationFrame */
import assert from 'node:assert/strict';
import { copyFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const phase = process.argv[2] ?? 'after';
assert.ok(['before', 'after'].includes(phase));
const output = phase === 'before' ? '.grok-run/gear-ui/shots/gacha-before' : 'docs/screenshots/pixel-dungeon-ui';
const walkthrough = '.grok-run/gacha-v2/shots';
if (phase === 'after') await mkdir(walkthrough, { recursive: true });
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
try {
  for (const [width, height] of [[1280, 720], [960, 640]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const gameTime = 20000;
    const prepare = async (count, epic = false) => {
      await page.goto(process.env.BASE_URL ?? 'http://localhost:5173/', { waitUntil: 'networkidle' });
      await page.evaluate(async ({ count, gameTime, epic }) => {
        const game = window.__game;
        await game.whenReady();
        game.pause(); game.setSeed(epic ? 1 : 4721);
        const state = game.getState();
        state.tickets = 20;
        state.pity = epic ? 29 : 0;
        state.pityLegendary = epic ? 0 : count === 1 ? 59 : 56;
        game.load(state); game.freezeClock(gameTime); game.openPanel('recruit');
        await document.fonts.ready;
      }, { count, gameTime, epic });
      await page.locator('main[data-view="recruit"]').waitFor();
    };
    const seek = async ms => {
      await page.evaluate(async time => {
        window.__game.freezeClock(time);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }, gameTime + ms);
    };
    const capture = async (name, ms) => {
      await page.mouse.move(0, 0);
      await seek(ms);
      const file = `gacha-${width}-${name}.png`;
      await page.screenshot({ path: `${output}/${file}` });
      if (phase === 'after') await copyFile(`${output}/${file}`, `${walkthrough}/${file}`);
    };
    // Read the same pure schedule as the renderer while retaining real clicks and real rolled heroes.
    const schedule = pulls => page.evaluate(async rolls => {
      const { revealSchedule } = await import('/src/reveal-timeline.ts');
      return revealSchedule(rolls, window.__game.getState().stats.pulls - rolls.length);
    }, pulls);
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
    const single = phase === 'after' ? await schedule(one) : null;
    await capture('anticipation', 600);
    if (single) {
      assert.equal(single.preview, 'rare');
      await capture('charge', 1200);
      await capture('fakeout', single.leakAt - 280);
      await capture('leak-x1', single.leakAt + 400);
      assert.equal(await page.locator('#recruit-result-description li').count(), 0);
    }
    await capture('silhouette', single ? single.openedAt + 800 : 1200);
    await capture('burst', single ? single.cueAt + 40 : 1400);
    await capture('x1-result', single?.doneAt ?? 3000);
    await close();
    if (single) {
      await prepare(1, true);
      const epic = await pull(1);
      assert.equal(epic[0].rarity, 'epic');
      await capture('leak-x1-epic', (await schedule(epic)).leakAt + 400);
      await page.locator('[data-control="reveal-stage-skip"]').click();
      assert.deepEqual(await page.evaluate(() => window.__game.getManagementReveal()), { count: 1, done: true, pulls: epic });
      await close();
    }
    await prepare(10);
    const ten = await pull(10);
    const grid = phase === 'after' ? await schedule(ten) : null;
    if (grid) {
      assert.equal(grid.best, 'legendary');
      await capture('leak-x10', grid.leakAt + 400);
      await capture('x10-flight', grid.openedAt + 480);
      await capture('x10-facedown', grid.landedAt + 200);
    }
    await capture('x10-sequence', grid ? grid.cueAt + 40 : 600);
    await capture('x10-summary', grid?.doneAt ?? 7000);
    const normal = await page.evaluate(() => window.__game.getManagementReveal());
    assert.equal(normal.done, true);
    await close();
    await prepare(10);
    assert.deepEqual(await pull(10), ten);
    await page.evaluate(time => window.__game.freezeClock(time), gameTime + 320);
    await page.locator('[data-control="reveal-skip"]').click();
    await capture('skip-summary', 320);
    assert.deepEqual(await page.evaluate(() => window.__game.getManagementReveal()), normal);
    assert.equal(await page.evaluate(() => window.__game.getState().tickets), 10);
    if (phase === 'after') {
      await close();
      // At a parked clock, exercise the stage tap and Skip button throughout both openings.
      for (const [count, beat, control] of [
        [1, 0, 'reveal-stage-skip'], [1, single.leakAt - 1, 'reveal-skip'],
        [1, single.openAt, 'reveal-stage-skip'], [1, single.openedAt, 'reveal-skip'],
        [1, single.cueAt, 'reveal-stage-skip'], [10, grid.openedAt + 200, 'reveal-stage-skip'],
        [10, grid.flipAt[grid.highlight] - 1, 'reveal-skip'],
      ]) {
        await prepare(count);
        await pull(count);
        await seek(beat);
        const rng = await page.evaluate(() => window.__game.getState().rng);
        await page.locator(`[data-control="${control}"]`).click();
        assert.deepEqual(await page.evaluate(() => window.__game.getManagementReveal()), count === 10 ? normal : { count, done: true, pulls: one });
        assert.equal(await page.evaluate(() => window.__game.getState().rng), rng);
        await close();
      }
      // Reduced motion and frozen animation must settle immediately, even with the clock parked on the click.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await prepare(10);
      assert.deepEqual(await pull(10, true), ten);
      assert.deepEqual(await page.evaluate(() => window.__game.getManagementReveal()), normal);
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
