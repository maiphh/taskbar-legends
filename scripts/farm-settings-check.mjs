/* global window, document, localStorage, process, console */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.FARM_SETTINGS_BASE_URL ?? 'http://127.0.0.1:5173/';
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath, headless: true });
const earnedState = async page => page.evaluate(async () => {
  await window.__game.whenReady();
  const [{ CONFIG }, game, combat] = await Promise.all([import('/src/config.ts'), import('/src/core/game.ts'), import('/src/core/combat.ts')]);
  const state = game.createState(5901);
  for (const definition of CONFIG.heroes) {
    let hero = state.roster.find(value => value.id === definition.id);
    if (!hero) { hero = { id: definition.id, level: CONFIG.growth.levelCap, xp: 0, stars: CONFIG.growth.starMax, equipment: { weapon: null, armor: null, charm: null } }; state.roster.push(hero); }
    hero.level = CONFIG.growth.levelCap; hero.xp = 0; hero.stars = CONFIG.growth.starMax;
  }
  state.partyIds = ['hk1', 'wiz', 'priest']; state.highestCleared = 0; state.progress = { kind: 'PUSHING', stage: 1 };
  combat.beginEncounter(state);
  for (let ticks = 0; ticks < 5000 && state.stats.clears === 0; ticks += 1) game.step(state);
  if (state.stats.clears !== 1 || !state.farmProofs?.some(proof => proof.stage === 1)) throw new Error('The real stage-1 encounter did not earn a proof');
  window.__game.load(state);
  return { stage: 1, clears: state.stats.clears, proof: state.farmProofs[0] };
});
const readText = async page => page.locator('#management .px-offline-summary').innerText();

try {
  await mkdir('artifacts', { recursive: true });
  const results = [];
  for (const width of [960, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(sourceWidth => localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify({ version: 1, sourceWidth, sourceHeight: 240, zoom: 1, placement: 'free', anchorX: 1, anchorY: 1 })), width);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseUrl); await page.waitForFunction(() => !!window.__game && !!window.__management);
    await page.evaluate(() => window.__game.whenReady());
    await page.evaluate(() => window.__game.openPanel('heroes'));
    await page.locator('#management [data-tab="settings"]').click();
    await page.locator('#management .px-offline-summary').waitFor();
    const fallback = await readText(page);
    assert.match(fallback, /Starting estimate/);
    await page.screenshot({ path: `artifacts/farm-settings-fallback-${width}.png` });

    const earned = await earnedState(page);
    await page.waitForFunction(() => window.__management.snapshot().offline.earned === true);
    await page.locator('#management [data-tab="settings"]').click();
    await page.waitForFunction(() => document.querySelector('#management .px-offline-summary')?.textContent?.includes('Earned by this formation'));
    const earnedText = await readText(page);
    assert.match(earnedText, /Earned by this formation/);
    await page.screenshot({ path: `artifacts/farm-settings-earned-${width}.png` });

    if (width === 960) {
      await page.locator('#management [data-tab="formation"]').click();
      await page.locator('[data-party-workspace="formation"]').click();
      await page.locator('[data-party-slot="0"]').click();
      await page.locator('[data-hero="mw2"]').click();
      await page.locator('[data-assign="mw2"]').click();
      await page.waitForFunction(() => window.__management.snapshot().partyIds[0] === 'mw2' && window.__management.snapshot().offline.earned === false);
      await page.locator('#management [data-tab="settings"]').click();
      assert.match(await readText(page), /Starting estimate/);

      const gearId = await page.evaluate(async () => {
        const { gearTemplateId, itemId } = await import('/src/core/model.ts');
        const state = window.__game.getState(); state.gold = 100_000;
        const id = itemId(state.seed, state.nextGearId++);
        state.inventory.push({ id, templateId: gearTemplateId('weapon', 'common'), tradeable: false, acquiredAt: { tick: state.tick, source: 'starter' },
          slot: 'weapon', rarity: 'common', dropStage: 1, level: 0, spent: 0, stats: { hp: 0, atk: 1, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 } });
        state.roster.find(hero => hero.id === 'hk1').equipment.weapon = id; window.__game.load(state); return id;
      });
      await page.waitForTimeout(250); // Let the real management snapshot poll adopt the loaded proof revision.
      await page.locator('#management [data-tab="formation"]').click();
      await page.locator('[data-party-slot="0"]').click(); await page.locator('[data-hero="hk1"]').click(); await page.locator('[data-assign="hk1"]').click();
      await page.waitForTimeout(400);
      const restoredFormation = await page.evaluate(() => ({ partyIds: window.__management.snapshot().partyIds,
        earned: window.__management.snapshot().offline.earned, status: document.querySelector('#management .management-status')?.textContent }));
      console.log(JSON.stringify({ width, restoredFormation }));
      assert.deepEqual(restoredFormation.partyIds, ['hk1', 'wiz', 'priest']); assert.equal(restoredFormation.earned, true);
      await page.locator('#management [data-tab="gear"]').click();
      await page.locator('[data-action="gear-upgrades"]').click();
      await page.locator(`#management [data-gear="${gearId}"]`).click();
      await page.locator('[data-action="upgrade"]').click();
      await page.waitForFunction(id => window.__management.snapshot().inventory.some(item => item.id === id && item.level === 1), gearId);
      assert.equal(await page.evaluate(() => window.__management.snapshot().offline.earned), true);
      const raw = await page.evaluate(async () => { const { makeSave } = await import('/src/core/save.ts'); return makeSave(window.__game.getState(), Date.now()); });
      await page.evaluate(value => localStorage.setItem('taskbar-legends:v1:party-v2', value), raw);
      await page.reload(); await page.waitForFunction(() => !!window.__game && !!window.__management);
      await page.evaluate(() => window.__game.whenReady()); await page.evaluate(() => window.__game.openPanel('heroes'));
      await page.locator('#management [data-tab="settings"]').click();
      await page.waitForFunction(() => document.querySelector('#management .px-offline-summary')?.textContent?.includes('Earned by this formation'));
      assert.equal(await page.evaluate(() => window.__management.snapshot().offline.earned), true, 'save reload retains the formation proof');
    }
    assert.deepEqual(errors, [], `browser errors at ${width}px: ${errors.join('; ')}`);
    results.push({ width, fallback, earned: earnedText, realClear: earned.clears, errors });
    await context.close();
  }
  await mkdir('artifacts', { recursive: true });
  console.log(JSON.stringify({ results }));
} finally { await browser.close(); }
