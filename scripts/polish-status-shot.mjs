/* global process, window, document, console */
import { chromium } from 'playwright';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = '.grok-run/shots';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome',
  headless: true, args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 180 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  window.__game.pause();
  await window.__game.whenReady();
  window.__game.setSeed(404);
});
await page.evaluate(() => {
  window.__game.pause();
  const state = window.__game.getState();
  for (const hero of state.roster) { hero.level = 10; hero.stars = 2; }
  state.highestCleared = 9;
  state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
  delete state.farmClock; delete state.encounterFarmContext;
  if (state.phase?.kind === 'farmPad') state.phase = { kind: 'rest', remainingTicks: 20, next: 'encounter' };
  window.__game.load(state);
  window.__game.input({ type: 'retry' });
  window.__game.openPanel(null);
  document.getElementById('management')?.setAttribute('hidden', '');
  const s = window.__game.getState();
  const boss = s.enemies.find(u => u.sourceId === 'boss_ch1');
  const tank = s.party[0];
  const tick = s.tick;
  const stamp = (unit, statuses) => {
    unit.statuses = statuses.map((status, index) => ({
      id: status.id, sourceId: status.sourceId ?? 'shot', targetId: unit.id,
      stacks: status.stacks ?? 1, magnitude: status.magnitude ?? 0, turnsLeft: status.turnsLeft,
      ...(status.display ? { display: status.display } : {}), appliedAtTick: tick + index,
    }));
  };
  if (boss && tank) {
    boss.hp = Math.floor(boss.maxHp * 0.62);
    boss.moving = false;
    boss.x = tank.x + 48;
    boss.procCounters = { basicSuccess: 4, bossPattern: 0 };
    boss.specialAction = {
      state: 'areaMark', targetId: tank.id, centerX: tank.x, radius: 56,
      startTick: s.tick, impactTick: s.tick + 80, abilityId: 'boss-ch1-cleave',
    };
    stamp(boss, [
      { id: 'dot', magnitude: 0.04, turnsLeft: 2, stacks: 2 },
      { id: 'atkDown', magnitude: 0.2, turnsLeft: 2 },
    ]);
    stamp(tank, [
      { id: 'defDown', magnitude: 0.2, turnsLeft: 2, display: 'crushed' },
      { id: 'atkUp', magnitude: 0.15, turnsLeft: 2 },
      { id: 'dmgReduction', magnitude: 0.1, turnsLeft: 1 },
    ]);
    if (s.party[1]) stamp(s.party[1], [
      { id: 'hot', magnitude: 0.05, turnsLeft: 2 },
      { id: 'stun', magnitude: 0, turnsLeft: 1 },
    ]);
    window.__game.load(s);
  }
  window.__game.openPanel(null);
  document.getElementById('management')?.setAttribute('hidden', '');
  window.__game.pause();
});
await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/polish-1-10-cleave-statuses.png` });
await browser.close();
console.log('done');
