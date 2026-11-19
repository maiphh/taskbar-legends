/* global process, window, document, console */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = '.grok-run/shots';
await mkdir(out, { recursive: true });

async function setupBoss(page, { abilityId, telegraphLabel, hpRatio, enraged = false, radius = 56 }) {
  await page.evaluate(({ abilityId: id, telegraphLabel: label, hpRatio: ratio, enraged: isEnraged, radius: r }) => {
    window.__game.pause();
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
      boss.hp = Math.max(1, Math.floor(boss.maxHp * ratio));
      boss.moving = false;
      boss.procCounters = { ...(boss.procCounters ?? {}), basicSuccess: 4, bossPattern: 0, ...(isEnraged ? { enraged: 1 } : {}) };
      boss.specialAction = {
        state: 'areaMark', targetId: tank.id, centerX: tank.x, radius: r,
        startTick: s.tick, impactTick: s.tick + 80, abilityId: id,
        ...(id.includes('enrage') ? { global: true } : {}),
      };
      void label;
      window.__game.load(s);
    }
    window.__game.openPanel(null);
    document.getElementById('management')?.setAttribute('hidden', '');
    window.__game.pause();
  }, { abilityId, telegraphLabel, hpRatio, enraged, radius });
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const wide = await browser.newPage({ viewport: { width: 1280, height: 180 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await wide.goto(base, { waitUntil: 'networkidle' });
await wide.evaluate(async () => {
  window.__game.pause();
  await window.__game.whenReady();
  window.__game.setSeed(404);
});

await setupBoss(wide, { abilityId: 'boss-ch1-cleave', telegraphLabel: 'CLEAVE!', hpRatio: 0.62, radius: 56 });
await wide.waitForTimeout(120);
await wide.screenshot({ path: `${out}/boss-fight-1-10.png` });
await wide.screenshot({ path: `${out}/boss-fight-cleave.png` });
await wide.screenshot({ path: `${out}/boss-fight-lane.png` });

await setupBoss(wide, { abilityId: 'boss-ch1-enrage', telegraphLabel: 'ENRAGE!', hpRatio: 0.25, enraged: true, radius: 0 });
await wide.waitForTimeout(120);
await wide.screenshot({ path: `${out}/boss-fight-enrage.png` });

const cleaveInfo = await wide.evaluate(() => {
  const state = window.__game.getState();
  const boss = state.enemies.find(unit => unit.sourceId === 'boss_ch1');
  return { progress: state.progress.kind, ability: boss?.specialAction?.abilityId, hp: boss?.hp, maxHp: boss?.maxHp, enraged: boss?.procCounters?.enraged };
});
console.log('wide', JSON.stringify(cleaveInfo));

const narrow = await browser.newPage({ viewport: { width: 480, height: 180 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await narrow.goto(base, { waitUntil: 'networkidle' });
await narrow.evaluate(async () => {
  window.__game.pause();
  await window.__game.whenReady();
  window.__game.setSeed(404);
});
await setupBoss(narrow, { abilityId: 'boss-ch1-cleave', telegraphLabel: 'CLEAVE!', hpRatio: 0.62, radius: 56 });
await narrow.waitForTimeout(120);
await narrow.screenshot({ path: `${out}/boss-fight-cleave-narrow.png` });
await setupBoss(narrow, { abilityId: 'boss-ch1-enrage', telegraphLabel: 'ENRAGE!', hpRatio: 0.25, enraged: true, radius: 0 });
await narrow.waitForTimeout(120);
await narrow.screenshot({ path: `${out}/boss-fight-enrage-narrow.png` });

await browser.close();
console.log('done');
