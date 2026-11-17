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
    await page.locator('#management [data-details-open]').click();
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
