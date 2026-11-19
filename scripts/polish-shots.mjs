/* global process, window, document, console */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/';
const out = '.grok-run/shots';
await mkdir(out, { recursive: true });

async function ready(page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    window.__game.pause();
    await window.__game.whenReady();
    window.__game.setSeed(404);
  });
}

async function setupBoss(page, { stage = 10, abilityId, hpRatio, enraged = false, radius = 56, approach = false }) {
  const result = await page.evaluate(({ stage: st, abilityId: id, hpRatio: ratio, enraged: isEnraged, radius: r, approach: isApproach }) => {
    try {
      window.__game.pause();
      const state = window.__game.getState();
      for (const hero of state.roster) { hero.level = 10; hero.stars = 2; }
      const cleared = st - 1;
      state.highestCleared = cleared;
      state.progress = { kind: 'BOSS_READY', stage: cleared, bossStage: st, failedPower: 0, bossLosses: 0 };
      delete state.farmClock;
      delete state.encounterFarmContext;
      if (state.phase?.kind === 'farmPad') state.phase = { kind: 'rest', remainingTicks: 20, next: 'encounter' };
      window.__game.load(state);
      window.__game.input({ type: 'retry' });
      window.__game.openPanel(null);
      document.getElementById('management')?.setAttribute('hidden', '');
      const s = window.__game.getState();
      const bossId = st === 20 ? 'boss_ch2' : 'boss_ch1';
      const boss = s.enemies.find(unit => unit.sourceId === bossId);
      const tank = s.party[0];
      if (!boss || !tank) return { ok: false, reason: 'missing', progress: s.progress, enemies: s.enemies.map(e => e.sourceId) };
      boss.hp = Math.max(1, Math.floor(boss.maxHp * ratio));
      boss.moving = false;
      if (isApproach) {
        boss.x = tank.x + 180;
        boss.specialAction = undefined;
        boss.procCounters = { ...(boss.procCounters ?? {}), basicSuccess: 0, bossPattern: 0 };
      } else {
        boss.x = tank.x + 48;
        boss.procCounters = { ...(boss.procCounters ?? {}), basicSuccess: 4, bossPattern: 0, ...(isEnraged ? { enraged: 1 } : {}) };
        boss.specialAction = {
          state: 'areaMark', targetId: tank.id, centerX: tank.x, radius: r,
          startTick: s.tick, impactTick: s.tick + 80, abilityId: id,
          ...(id.includes('enrage') ? { global: true } : {}),
        };
      }
      window.__game.load(s);
      window.__game.openPanel(null);
      document.getElementById('management')?.setAttribute('hidden', '');
      window.__game.pause();
      return { ok: true, boss: boss.sourceId, hp: boss.hp, special: boss.specialAction?.abilityId };
    } catch (err) {
      return { ok: false, error: String(err), issues: err?.issues ?? err?.log ?? null };
    }
  }, { stage, abilityId, hpRatio, enraged, radius, approach });
  console.log('setup', JSON.stringify(result));
  if (!result.ok) throw new Error('setup failed: ' + JSON.stringify(result));
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || '/usr/bin/google-chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-gpu'],
});

const cases = [
  { tag: '1-10-approach', stage: 10, abilityId: 'boss-ch1-cleave', hpRatio: 1, approach: true },
  { tag: '1-10-cleave', stage: 10, abilityId: 'boss-ch1-cleave', hpRatio: 0.62, radius: 56 },
  { tag: '1-10-enrage', stage: 10, abilityId: 'boss-ch1-enrage', hpRatio: 0.25, enraged: true, radius: 0 },
  { tag: '2-10-approach', stage: 20, abilityId: 'boss-ch2-cleave', hpRatio: 1, approach: true },
  { tag: '2-10-cleave', stage: 20, abilityId: 'boss-ch2-cleave', hpRatio: 0.62, radius: 64 },
  { tag: '2-10-enrage', stage: 20, abilityId: 'boss-ch2-enrage', hpRatio: 0.25, enraged: true, radius: 0 },
];

for (const width of [1280, 480]) {
  const page = await browser.newPage({ viewport: { width, height: 180 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ready(page);
  for (const c of cases) {
    await setupBoss(page, c);
    await page.waitForTimeout(150);
    const suffix = width === 1280 ? '' : '-narrow';
    const path = `${out}/polish-${c.tag}${suffix}.png`;
    await page.screenshot({ path });
    console.log('shot', path);
  }
  await page.close();
}

await browser.close();
console.log('done');
