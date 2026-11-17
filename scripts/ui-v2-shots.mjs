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
      for (let i = 0; i < 15 && state.inventory.length < 30; i++) {
        const serial = state.nextGearId++, slot = slots[i % slots.length], rarity = rarities[(i * 3 + 1) % rarities.length];
        state.inventory.push({ id: `itm_${namespace}_${serial.toString(16).padStart(8, '0')}`, templateId: `gear.${slot}.${rarity}`, tradeable: false,
          acquiredAt: { tick: state.tick, source: 'drop' }, slot, rarity, dropStage: 4, level: i % 7, spent: 0,
          stats: { hp: slot === 'armor' ? 28 + i * 3 : 0, atk: slot === 'weapon' ? 9 + i * 2 : 0, def: slot === 'armor' ? 4 + i : 0,
            atkPct: slot === 'charm' && i % 2 ? 0.04 : 0, hpPct: slot === 'charm' && i % 2 === 0 ? 0.04 : 0, speedPct: 0 }, ...(i === 5 ? { locked: true } : {}) });
      }
      state.gearSinceLegendary = 14;
      state.gold = Math.max(state.gold, 4280); state.tickets = Math.max(state.tickets, 16);
      window.__game.load(state);
      window.__game.openPanel('home');
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
    await page.locator('#management [data-view="heroes"] [data-details-open]').first().click();
    await page.waitForSelector('#management .px-v2-detail');
    await page.screenshot({ path: `artifacts/ui-v2/hero-detail-${width}.png` });
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
      window.__game.load(state);
      window.__game.openPanel('home');
    });
    await page.waitForFunction(() => document.querySelector('#management [data-view="home"]') && document.querySelector('#management').innerText.includes('Boss ready'));
    await page.screenshot({ path: `artifacts/ui-v2/home-boss-ready-${width}.png` });
    await page.close();
  }
} finally { await browser.close(); }
