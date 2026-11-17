/* global process, window, document */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.MANAGEMENT_BASE_URL ?? 'http://127.0.0.1:5173/';
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH;
await mkdir('artifacts/ui-v2', { recursive: true });
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--no-sandbox'] });
try {
  for (const [width, height] of [[1280, 720], [960, 640]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      window.__game.pause();
      window.__management?.freezeAnimation(true);
      await window.__game.whenReady();
      window.__game.setSeed(4721);
      window.__game.step(10000);
      const state = window.__game.getState();
      const template = state.roster[0];
      if (template) { for (const id of ['mw1', 'priest', 'hu1', 'wiz', 'mh1']) if (!state.roster.some(hero => hero.id === id) && state.roster.length < 12) state.roster.push({ ...JSON.parse(JSON.stringify(template)), id, level: 8, stars: 1, xp: 0, equipment: { weapon: null, armor: null, charm: null } }); }
      let ns = (state.seed ^ 0x9e3779b9) >>> 0; ns = Math.imul(ns ^ (ns >>> 16), 0x85ebca6b) >>> 0; ns = Math.imul(ns ^ (ns >>> 13), 0xc2b2ae35) >>> 0; ns = (ns ^ (ns >>> 16)) >>> 0;
      const namespace = ns.toString(16).padStart(8, '0');
      const slots = ['weapon', 'armor', 'charm'];
      const rarities = ['common', 'rare', 'epic', 'legendary'];
      const equippedFixtures = {};
      for (let i = 0; i < 50 && state.inventory.length < 50; i++) {
        const serial = state.nextGearId++, slot = slots[i % slots.length], rarity = rarities[(i * 3 + 1) % rarities.length];
        const itemId = `itm_${namespace}_${serial.toString(16).padStart(8, '0')}`;
        state.inventory.push({ id: itemId, templateId: `gear.${slot}.${rarity}`, tradeable: false,
          acquiredAt: { tick: state.tick, source: 'drop' }, slot, rarity, dropStage: 4, level: i % 7, spent: 0,
          stats: { hp: slot === 'armor' ? 28 + i * 3 : 0, atk: slot === 'weapon' ? 9 + i * 2 : 0, def: slot === 'armor' ? 4 + i : 0,
            atkPct: slot === 'charm' && i % 2 ? 0.04 : 0, hpPct: slot === 'charm' && i % 2 === 0 ? 0.04 : 0, speedPct: slot === 'charm' ? (i % 2 ? 0.02 : 0.1) : 0 }, ...(i === 5 ? { locked: true } : {}) });
        const wearer = i < 1 || i === 26 || i === 28 ? 'mw1' : i === 25 ? 'priest' : '';
        if (wearer) { const hero = state.roster.find(value => value.id === wearer); if (hero) hero.equipment[slot] = itemId; equippedFixtures[wearer + slot[0].toUpperCase() + slot.slice(1)] = itemId; }
        if (i === 5) equippedFixtures.weakerCharm = itemId;
      }
      state.gearSinceLegendary = 14;
      state.gold = Math.max(state.gold, 4280); state.tickets = Math.max(state.tickets, 16);
      window.__game.load(state);
      window.__uiShotItems = equippedFixtures;
      window.__game.openPanel('home');
      window.__management?.freezeAnimation(true);
    });
    await page.waitForSelector('#management:not([hidden]) [data-view="home"]');
    for (const screen of ['home', 'heroes', 'formation', 'gear', 'recruit', 'stages', 'settings']) {
      if (screen !== 'home') {
        await page.evaluate(name => window.__game.openPanel(name), screen);
        await page.waitForFunction(name => document.querySelector(`#management [data-view="${name}"]`), screen);
      }
      await page.screenshot({ path: `artifacts/ui-v2/${screen}-${width}.png` });
    }
    await page.evaluate(() => window.__game.openPanel('heroes'));
    await page.waitForSelector('#management [data-view="heroes"] [data-details-open]');
    await page.locator('#management [data-view="heroes"] [data-hero="mw1"]').click();
    await page.waitForSelector('#management .px-v2-detail');
    await page.screenshot({ path: `artifacts/ui-v2/hero-detail-${width}.png` });
    await page.locator('#management .px-v2-detail [data-loadout-slot="armor"]').first().click();
    await page.waitForSelector('#management [data-view="equip"] .px-equip-screen');
    await page.screenshot({ path: `artifacts/ui-v2/equip-${width}.png` });
    const swapArmor = await page.evaluate(() => window.__uiShotItems.priestArmor);
    await page.locator(`#management [data-view="equip"] [data-equip-item="${swapArmor}"]`).click();
    await page.waitForFunction(() => document.querySelector('#management [data-view="equip"] .px-equip-deltas')?.innerText.includes('ATK'));
    await page.screenshot({ path: `artifacts/ui-v2/equip-compare-${width}.png` });
    await page.locator('#management [data-view="equip"] [data-equip-back]').click();
    await page.locator('#management [data-details-close]').click();
    await page.evaluate(() => {
      const state = window.__game.getState(), hero = state.roster.find(value => value.id === 'mw1');
      if (hero) hero.equipment.weapon = null;
      window.__game.load(state); window.__game.openPanel('heroes');
    });
    await page.waitForSelector('#management [data-view="heroes"] [data-details-open]');
    await page.locator('#management [data-view="heroes"] [data-hero="mw1"]').click();
    await page.waitForSelector('#management .px-v2-detail');
    await page.locator('#management .px-v2-detail [data-loadout-slot="weapon"]').first().click();
    await page.waitForSelector('#management [data-view="equip"] .px-equip-screen');
    await page.waitForFunction(() => document.querySelector('#management [data-view="equip"] .px-equip-slot[data-equip-slot="weapon"]')?.classList.contains('is-empty'));
    await page.screenshot({ path: `artifacts/ui-v2/equip-empty-slot-${width}.png` });
    await page.locator('#management [data-view="equip"] [data-equip-back]').click();
    await page.locator('#management [data-details-close]').click();
    await page.locator('#management [data-view="heroes"] [data-hero="mw1"]').click();
    await page.locator('#management .px-v2-detail [data-loadout-slot="charm"]').click();
    await page.locator(`#management [data-view="equip"] [data-equip-item="${await page.evaluate(() => window.__uiShotItems.weakerCharm)}"]`).click();
    await page.waitForFunction(() => document.querySelector('#management [data-view="equip"] .px-equip-deltas')?.innerText.includes('SPD'));
    await page.screenshot({ path: `artifacts/ui-v2/equip-speed-loss-${width}.png` });
    await page.locator('#management [data-view="equip"] [data-equip-back]').click();
    await page.locator('#management [data-details-close]').click();
    await page.locator('#management [data-locked-hero]').first().click();
    await page.waitForSelector('#management .px-howto-card');
    await page.screenshot({ path: `artifacts/ui-v2/locked-hero-${width}.png` });
    await page.evaluate(() => {
      const state = window.__game.getState();
      state.highestCleared = 9;
      state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
      delete state.farmClock;
      delete state.encounterFarmContext;
      // Since live farming clears stages, the seeded run may be in a farm pad, which requires the clock just removed.
      if (state.phase.kind === 'farmPad') state.phase = { kind: 'rest', remainingTicks: 20, next: 'encounter' };
      window.__game.load(state);
      window.__game.openPanel('home');
    });
    await page.waitForFunction(() => document.querySelector('#management [data-view="home"]') && document.querySelector('#management').innerText.includes('Boss ready'));
    await page.screenshot({ path: `artifacts/ui-v2/home-boss-ready-${width}.png` });
    await page.evaluate(() => window.__game.openPanel('recruit'));
    await page.locator('[data-action="pull-one"]').click();
    await page.locator('.reveal-stage:not([hidden])').waitFor();
    await page.locator('[data-control="reveal-skip"]').click();
    await page.locator('[data-control="reveal-ok"]').waitFor();
    await page.screenshot({ path: `artifacts/ui-v2/recruit-result-x1-${width}.png` });
    const finishReveal = page.locator('[data-control="reveal-ok"]');
    await finishReveal.waitFor(); await finishReveal.click();
    await page.waitForFunction(() => document.querySelector('.reveal-stage')?.hidden === true);
    await page.locator('[data-action="pull-ten"]').click();
    await page.locator('.reveal-stage:not([hidden])').waitFor();
    await page.locator('[data-control="reveal-skip"]').click();
    await page.locator('[data-control="reveal-ok"]').waitFor();
    await page.screenshot({ path: `artifacts/ui-v2/recruit-result-x10-${width}.png` });
    if (width === 960) {
      const activeReveal = page.locator('.reveal-stage:not([hidden])');
      if (await activeReveal.count()) {
        const revealOk = page.locator('[data-control="reveal-ok"]');
        await revealOk.waitFor(); await revealOk.click();
        await page.waitForFunction(() => document.querySelector('.reveal-stage')?.hidden === true);
      }
      await page.setViewportSize({ width: 960, height: 600 });
      await page.waitForTimeout(100);
      await page.evaluate(() => window.__game.openPanel('home'));
      await page.waitForFunction(() => document.querySelector('#management')?.dataset.preset === '960');
      await page.screenshot({ path: 'artifacts/ui-v2/home-min-960.png' });
      const minBounds = await page.locator('#management [data-close]').boundingBox();
      if (!minBounds || minBounds.y < 0 || minBounds.y + minBounds.height > 600) throw new Error(`close control clipped at 960x600: ${JSON.stringify(minBounds)}`);
      const minInterior = await page.evaluate(() => {
        const main = document.querySelector('#management main'), campaign = document.querySelector('.px-home-campaign'), actions = document.querySelector('.px-home-actions');
        if (!main || !campaign || !actions) return null;
        const m = main.getBoundingClientRect(), c = campaign.getBoundingClientRect(), a = actions.getBoundingClientRect();
        return { main: [m.top,m.bottom], campaign: [c.top,c.bottom], actions: [a.top,a.bottom] };
      });
      if (!minInterior || minInterior.campaign[1] > minInterior.main[1] || minInterior.actions[1] > minInterior.campaign[1]) throw new Error(`Home interior clips at 960x600: ${JSON.stringify(minInterior)}`);
      await page.evaluate(() => window.__game.openPanel('heroes'));
      await page.waitForSelector('#management [data-view="heroes"] [data-details-open]');
      await page.locator('#management [data-view="heroes"] [data-hero="mw1"]').click();
      await page.waitForSelector('#management .px-v2-detail');
      await page.locator('#management .px-v2-detail [data-loadout-slot="armor"]').first().click();
      await page.waitForSelector('#management [data-view="equip"] .px-equip-screen');
      await page.locator('#management [data-view="equip"] [data-equip-item]').first().click();
      await page.waitForFunction(() => document.querySelector('#management [data-view="equip"] .px-equip-deltas')?.innerText.includes('ATK'));
      const minEquip = await page.evaluate(() => {
        const rect = selector => { const el = document.querySelector(selector), r = el?.getBoundingClientRect(); return r ? [r.left,r.top,r.right,r.bottom] : null; };
        return { drawer: rect('#management .px-equip-drawer'), meta: rect('#management .px-equip-hero-meta'), compare: rect('#management .px-equip-compare'), actions: [...document.querySelectorAll('#management .px-equip-actions > .px-btn')].map(el => { const r = el.getBoundingClientRect(); return [r.top,r.bottom,r.height]; }) };
      });
      if (!minEquip.drawer || !minEquip.meta || !minEquip.compare || minEquip.meta[3] > minEquip.drawer[1] + 1 || !minEquip.actions.length || minEquip.actions.some(([top,bottom,height]) => top < minEquip.compare[1] || bottom > minEquip.compare[3] || bottom > 600 || height < 40)) throw new Error(`Equip compare clipped at 960x600: ${JSON.stringify(minEquip)}`);
      for (const viewport of [{ width: 1200, height: 720 }, { width: 1280, height: 640 }, { width: 2560, height: 1440 }]) {
        await page.setViewportSize(viewport); await page.waitForTimeout(50);
        const box = await page.locator('#management').boundingBox();
        if (!box || box.x < 0 || box.y < 0 || box.x + box.width > viewport.width || box.y + box.height > viewport.height) throw new Error(`preset clipped at ${viewport.width}x${viewport.height}: ${JSON.stringify(box)}`);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.evaluate(() => window.__game.openPanel('heroes'));
      await page.waitForSelector('#management [data-view="heroes"] [data-details-open]');
      await page.locator('#management [data-view="heroes"] [data-hero="mw1"]').click();
      await page.waitForSelector('#management .px-v2-detail-art img');
      await page.setViewportSize({ width: 960, height: 640 }); await page.waitForTimeout(80);
      const resizedSmall = await page.locator('#management .px-v2-detail-art img').boundingBox();
      if (!resizedSmall || resizedSmall.width > 112 || resizedSmall.height > 112) throw new Error(`detail art stayed at wide preset after resize: ${JSON.stringify(resizedSmall)}`);
      await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(80);
      const resizedLarge = await page.locator('#management .px-v2-detail-art img').boundingBox();
      if (!resizedLarge || resizedLarge.width > 240 || resizedLarge.height > 208) throw new Error(`detail art stayed at compact preset after resize: ${JSON.stringify(resizedLarge)}`);
    }
    await page.close();
  }
} finally { await browser.close(); }
