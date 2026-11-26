/* global window, document, process, localStorage */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const output = process.argv[2] ?? '.grok-run/pixel-ui/shots/after';
const base = process.env.BASE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });

// Browser-only fixture. Playwright creates a fresh storage context for every preset.
function bossEncounter(enraged) {
  const game = window.__game;
  const state = game.getState();
  state.highestCleared = 9;
  state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
  delete state.farmClock;
  delete state.encounterFarmContext;
  if (state.phase.kind === 'farmPad') state.phase = { kind: 'rest', remainingTicks: 20, next: 'encounter' };
  game.load(state);
  game.input({ type: 'retry' });
  const fight = game.getState(), boss = fight.enemies.find(unit => unit.sourceId === 'boss_ch1'), front = fight.party[0];
  boss.x = front.x + 58;
  boss.hp = Math.floor(boss.maxHp * (enraged ? 0.25 : 0.62));
  boss.moving = false;
  boss.procCounters = { basicSuccess: 4, bossPattern: 0, enraged: Number(enraged) };
  boss.specialAction = {
    state: 'areaMark', targetId: front.id, centerX: front.x, radius: enraged ? 0 : 56,
    startTick: fight.tick, impactTick: fight.tick + 80,
    abilityId: enraged ? 'boss-ch1-enrage' : 'boss-ch1-cleave', ...(enraged ? { global: true } : {}),
  };
  for (const [unit, id] of [[front, 'atkUp'], [fight.party[1], 'hot'], [boss, 'dot']]) {
    unit.statuses = [{ id, sourceId: front.id, targetId: unit.id, stacks: 1, magnitude: 0.05, turnsLeft: 2, appliedAtTick: fight.tick }];
  }
  game.load(fight);
}

try {
  await mkdir(output, { recursive: true });
  for (const [width, height] of [[1280, 720], [960, 640], [480, 160]]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (width === 480) await page.addInitScript(() => {
      localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify({
        version: 1, sourceWidth: 480, sourceHeight: 160, zoom: 1, placement: 'free', anchorX: 1, anchorY: 1,
      }));
    });
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const game = window.__game;
      await game.whenReady();
      game.pause(); game.setSeed(404); game.step(40);
      const state = game.getState();
      state.gold = 4280; state.tickets = 16;
      game.load(state);
    });
    if (width === 480) assert.equal(await page.evaluate(() => window.__game.getLayout().width), width);
    for (const view of width === 480 ? ['lane', 'boss', 'enrage'] : ['home', 'heroes', 'settings']) {
      if (view === 'boss' || view === 'enrage') await page.evaluate(bossEncounter, view === 'enrage');
      await page.evaluate(tab => {
        window.__game.openPanel(tab);
        window.__management?.freezeAnimation(true);
      }, width === 480 ? null : view);
      if (width !== 480) await page.waitForSelector(`#management:not([hidden]) main[data-view="${view}"]`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('#management img')].map(img => img.decode()));
      });
      const filename = view === 'home' ? `${width}.png` : `${view}-${width}.png`;
      await page.screenshot({ path: join(output, filename) });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
