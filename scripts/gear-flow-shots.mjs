/* global window, document, process */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const phase = process.argv[2] ?? 'after';
assert.ok(['before', 'after'].includes(phase));
const output = `.grok-run/gear-ui/shots/${phase}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
try {
  for (const [width, height] of [[1280, 720], [960, 640]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.BASE_URL ?? 'http://localhost:5173/', { waitUntil: 'networkidle' });
    const weapon = await page.evaluate(async () => {
      const { chest, equip } = await import('/src/core/economy.ts');
      const game = window.__game;
      await game.whenReady();
      game.pause(); game.setSeed(4721);
      const state = game.getState();
      for (let i = 0; i < 18; i++) chest(state, 5);
      const armor = state.inventory.find(item => item.slot === 'armor' && item.acquiredAt.source === 'drop');
      equip(state, 'mw1', armor.id);
      const candidate = state.inventory.filter(item => item.slot === 'weapon').sort((a,b) => b.stats.atk - a.stats.atk)[0];
      state.gold = 4280;
      game.load(state); game.openPanel('gear'); window.__management.freezeAnimation(true);
      return candidate.id;
    });
    const root = page.locator('#management');
    const capture = async name => {
      await page.mouse.move(0, 0);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('#management img')].map(img => img.decode()));
      });
      await page.screenshot({ path: `${output}/gear-${width}-${name}.png` });
    };
    await root.locator('main[data-view="gear"]').waitFor();
    await capture('tab');
    await root.locator('nav [data-tab="heroes"]').click();
    await root.locator('[data-details-open][data-hero="mw1"]').click();
    await capture('hero');
    await root.locator('[data-loadout-slot="weapon"]').first().click();
    await root.locator('.px-equip-deltas').getByText('ATK', { exact: true }).waitFor();
    await capture('slot');
    await root.locator(`[data-equip-item="${weapon}"]`).click();
    await root.locator('.px-equip-deltas').getByText('ATK', { exact: true }).waitFor();
    await capture('compare');
    await root.locator('[data-action="equip-selected"]').click();
    await page.waitForFunction(id => window.__game.getState().roster.find(hero => hero.id === 'mw1').equipment.weapon === id, weapon);
    await capture('equipped');
    const unequip = root.getByRole('button', { name: /unequip/i });
    if (phase === 'before') {
      assert.ok(await unequip.isDisabled());
      // The only existing way to clear this slot is to move the weapon to a second hero.
      await root.locator('[data-equip-cycle="next"]').click();
      await root.locator(`[data-equip-item="${weapon}"]`).click();
      await root.locator('[data-action="equip-selected"]').click();
      await root.locator('[data-equip-cycle="prev"]').click();
    } else {
      await unequip.click();
    }
    await page.waitForFunction(() => window.__game.getState().roster.find(hero => hero.id === 'mw1').equipment.weapon === null);
    await capture('unequipped');
    if (phase === 'after') {
      const action = name => root.locator(`[data-action="${name}"]`);
      const pick = async (name, value) => {
        await root.locator(`[data-dd-toggle="${name}"]`).click();
        await root.locator(`[data-dd-option="${name}"][data-value="${value}"]`).click();
      };
      await root.locator('[data-equip-lock="false"]').click();
      assert.ok(await action('salvage').isDisabled());
      await root.locator('[data-equip-lock="true"]').click();
      await action('salvage').click();
      await page.keyboard.press('Escape');
      await action('salvage').click();
      await capture('salvage');
      const payout = await page.evaluate(async id => {
        const { salvageGold } = await import('/src/core/economy.ts');
        const state = window.__game.getState();
        return state.gold + salvageGold(state.inventory.find(item => item.id === id));
      }, weapon);
      await action('confirm-salvage').click();
      await page.waitForFunction(({ weapon, payout }) => {
        const state = window.__game.getState();
        return state.gold === payout && !state.inventory.some(item => item.id === weapon);
      }, { weapon, payout });
      await root.locator('[data-equip-back]').click();
      assert.equal(await root.locator('[data-loadout-slot="weapon"]').evaluate(node => node === document.activeElement), true);

      await root.locator('nav [data-tab="gear"]').click();
      await root.locator('[data-hero="mw1"]').click();
      await root.locator('[data-equip-slot="armor"]').click();
      const armor = await root.locator('[data-equip-item][aria-pressed="true"]').getAttribute('data-equip-item');
      await pick('equip-filter', 'free');
      assert.ok(await root.locator('[data-equip-item]').count() > 0);
      assert.equal(await root.locator(`[data-equip-item="${armor}"]`).count(), 0);
      await pick('equip-filter', 'all');
      await root.locator(`[data-equip-item="${armor}"]`).click();
      await pick('equip-hero', 'priest');
      await root.getByRole('button', { name: 'Transfer & equip' }).click();
      await page.waitForFunction(id => {
        const { roster } = window.__game.getState();
        return roster.find(hero => hero.id === 'mw1').equipment.armor === null
          && roster.find(hero => hero.id === 'priest').equipment.armor === id;
      }, armor);
      await action('unequip').click();
      await root.locator('[data-equip-back]').click();
      await root.locator('[data-gear-page="stash"]').click();
      await root.locator(`[data-gear="${armor}"]`).click();
      await action('manage-item').click();
      assert.equal(await root.locator('[data-equip-item][aria-pressed="true"]').getAttribute('data-equip-item'), armor);
      await root.locator('[data-equip-back]').click();
      await root.getByRole('heading', { name: 'Stash' }).waitFor();
      await capture('stash');
      await root.locator('[data-gear-page="loadouts"]').click();
      await root.locator('[data-gear-page="upgrades"]').click();
      await capture('upgrades');
    }
    await page.close();
    assert.deepEqual(errors, []);
  }
} finally {
  await browser.close();
}
