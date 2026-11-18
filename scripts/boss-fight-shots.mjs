/* global process, window, document, console */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = '.grok-run/shots';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 180 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  window.__game.pause();
  await window.__game.whenReady();
  window.__game.setSeed(404);
  const state = window.__game.getState();
  for (const hero of state.roster) { hero.level = 10; hero.stars = 2; }
  state.highestCleared = 9;
  state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
  delete state.farmClock;
  delete state.encounterFarmContext;
  if (state.phase?.kind === 'farmPad') state.phase = { kind: 'rest', remainingTicks: 20, next: 'encounter' };
  window.__game.load(state);
  window.__game.input({ type: 'retry' });
  window.__game.openPanel(null);
  document.getElementById('management')?.setAttribute('hidden', '');
  const s = window.__game.getState();
  const boss = s.enemies.find(unit => unit.sourceId === 'boss_ch1');
  const tank = s.party[0];
  if (boss && tank) {
    boss.hp = Math.floor(boss.maxHp * 0.62);
    boss.moving = false;
    boss.procCounters = { ...(boss.procCounters ?? {}), basicSuccess: 4, bossPattern: 0 };
    boss.specialAction = {
      state: 'areaMark', targetId: tank.id, centerX: tank.x, radius: 56,
      startTick: s.tick, impactTick: s.tick + 80, abilityId: 'boss-ch1-cleave',
    };
    window.__game.load(s);
  }
  window.__game.openPanel(null);
  document.getElementById('management')?.setAttribute('hidden', '');
  window.__game.pause();
});
await page.waitForTimeout(100);
await page.screenshot({ path: `${out}/boss-fight-1-10.png` });
await page.screenshot({ path: `${out}/boss-fight-cleave.png` });
const info = await page.evaluate(() => {
  const state = window.__game.getState();
  const boss = state.enemies.find(unit => unit.sourceId === 'boss_ch1');
  return { progress: state.progress.kind, ability: boss?.specialAction?.abilityId, hp: boss?.hp, maxHp: boss?.maxHp };
});
console.log(JSON.stringify(info));
await browser.close();
console.log('done');
