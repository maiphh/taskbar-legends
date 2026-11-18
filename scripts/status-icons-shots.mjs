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

async function prep(page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    window.__game.pause();
    await window.__game.whenReady();
    window.__game.setSeed(707);
  });
}

const wide = await browser.newPage({ viewport: { width: 1280, height: 180 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await prep(wide);

await wide.evaluate(() => {
  window.__game.pause();
  const state = window.__game.getState();
  for (const hero of state.roster) { hero.level = 8; hero.stars = 2; }
  state.highestCleared = 5;
  state.progress = { kind: 'PUSHING', stage: 6 };
  delete state.farmClock;
  delete state.encounterFarmContext;
  if (state.phase?.kind === 'farmPad') state.phase = { kind: 'rest', remainingTicks: 20, next: 'encounter' };
  window.__game.load(state);
  window.__game.input({ type: 'retry' });
  window.__game.openPanel(null);
  document.getElementById('management')?.setAttribute('hidden', '');

  const s = window.__game.getState();
  const tick = s.tick;
  const stamp = (unit, statuses) => {
    unit.statuses = statuses.map((status, index) => ({
      id: status.id,
      sourceId: status.sourceId ?? 'shot',
      targetId: unit.id,
      stacks: status.stacks ?? 1,
      magnitude: status.magnitude ?? 0,
      turnsLeft: status.turnsLeft,
      ...(status.display ? { display: status.display } : {}),
      appliedAtTick: tick + index,
    }));
    unit.moving = false;
    unit.action = { state: 'idle' };
    unit.gauge = 4000;
    delete unit.specialAction;
  };

  stamp(s.party[0], [
    { id: 'atkUp', magnitude: 0.15, turnsLeft: 2 },
    { id: 'dmgReduction', magnitude: 0.1, turnsLeft: 1 },
    { id: 'hot', magnitude: 0.05, turnsLeft: 2 },
  ]);
  stamp(s.party[1], [
    { id: 'stun', magnitude: 0, turnsLeft: 1 },
    { id: 'dot', magnitude: 0.04, turnsLeft: 2, stacks: 2 },
    { id: 'spdDown', magnitude: 0.3, turnsLeft: 2 },
    { id: 'atkDown', magnitude: 0.2, turnsLeft: 1 },
    { id: 'steadfast', magnitude: 0, turnsLeft: 2 },
  ]);
  s.party[1].shield = 40;
  s.party[1].shieldUntilTick = tick + 100;
  stamp(s.party[2], [{ id: 'dot', magnitude: 0.04, turnsLeft: 1, stacks: 3 }]);
  if (s.enemies[0]) stamp(s.enemies[0], [
    { id: 'atkDown', magnitude: 0.2, turnsLeft: 2 },
    { id: 'defDown', magnitude: 0.25, turnsLeft: 2 },
    { id: 'dot', magnitude: 0.04, turnsLeft: 2, stacks: 2 },
  ]);
  if (s.enemies[1]) stamp(s.enemies[1], [
    { id: 'spdDown', magnitude: 0.3, turnsLeft: 1 },
    { id: 'stun', magnitude: 0, turnsLeft: 1 },
  ]);
  if (s.enemies[2]) stamp(s.enemies[2], [
    { id: 'defDown', magnitude: 0.4, turnsLeft: 2 },
    { id: 'atkDown', magnitude: 0.2, turnsLeft: 2 },
    { id: 'spdDown', magnitude: 0.3, turnsLeft: 2 },
    { id: 'dot', magnitude: 0.04, turnsLeft: 2, stacks: 3 },
  ]);
  window.__game.load(s);
  window.__game.openPanel(null);
  document.getElementById('management')?.setAttribute('hidden', '');
  window.__game.pause();
});
await wide.waitForTimeout(120);
await wide.screenshot({ path: `${out}/status-icons-party.png` });
await wide.screenshot({ path: `${out}/status-icons-overflow.png` });

await wide.evaluate(() => {
  window.__game.pause();
  const state = window.__game.getState();
  for (const hero of state.roster) { hero.level = 10; hero.stars = 2; }
  state.highestCleared = 9;
  state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
  delete state.farmClock;
  delete state.encounterFarmContext;
  for (const unit of [...state.party, ...state.enemies]) unit.statuses = [];
  if (state.phase?.kind === 'farmPad') state.phase = { kind: 'rest', remainingTicks: 20, next: 'encounter' };
  window.__game.load(state);
  window.__game.input({ type: 'retry' });
  window.__game.openPanel(null);
  document.getElementById('management')?.setAttribute('hidden', '');

  const s = window.__game.getState();
  const boss = s.enemies.find(unit => unit.sourceId === 'boss_ch1');
  const tank = s.party[0];
  const tick = s.tick;
  if (boss && tank) {
    boss.hp = Math.max(1, Math.floor(boss.maxHp * 0.55));
    boss.moving = false;
    boss.statuses = [{
      id: 'dot', sourceId: tank.id, targetId: boss.id, stacks: 2, magnitude: 0.04, turnsLeft: 2, appliedAtTick: tick,
    }];
    tank.statuses = [{
      id: 'defDown', sourceId: boss.id, targetId: tank.id, stacks: 1, magnitude: 0.2, turnsLeft: 2,
      display: 'crushed', appliedAtTick: tick,
    }, {
      id: 'atkUp', sourceId: tank.id, targetId: tank.id, stacks: 1, magnitude: 0.15, turnsLeft: 2, appliedAtTick: tick,
    }];
    window.__game.load(s);
  }
  window.__game.openPanel(null);
  document.getElementById('management')?.setAttribute('hidden', '');
  window.__game.pause();
});
await wide.waitForTimeout(120);
await wide.screenshot({ path: `${out}/status-icons-boss-crushed.png` });

const info = await wide.evaluate(() => {
  const state = window.__game.getState();
  const boss = state.enemies.find(unit => unit.sourceId === 'boss_ch1');
  return {
    bossStatuses: boss?.statuses?.map(s => ({ id: s.id, stacks: s.stacks })),
    tankStatuses: state.party[0]?.statuses?.map(s => ({ id: s.id, display: s.display })),
    overflowHero: state.party[1]?.statuses?.length,
  };
});
console.log(JSON.stringify(info));
await browser.close();
console.log('done');
