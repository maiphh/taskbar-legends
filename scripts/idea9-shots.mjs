/* global process, window, document, localStorage, console */
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

async function openAtWidth(sourceWidth) {
  const context = await browser.newContext({
    viewport: { width: sourceWidth, height: 200 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(width => {
    localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify({
      version: 1, sourceWidth: width, sourceHeight: 160, zoom: 1, placement: 'free', anchorX: 1, anchorY: 1,
    }));
  }, sourceWidth);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error?.message ?? error)));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(async () => {
    window.__game.pause();
    await window.__game.whenReady();
    await document.fonts.load('700 11px "Galmuri11"');
    await document.fonts.ready;
  });
  const layoutWidth = await page.evaluate(() => window.__game.getLayout().width);
  if (layoutWidth !== sourceWidth) throw new Error(`expected layout width ${sourceWidth}, got ${layoutWidth}`);
  return { context, page, errors };
}

/** Pin a hit (and optional heal / kill) on a paused 1-1 board at age 0 so floats are fully opaque. */
async function pinFloats(page, { mode }) {
  return page.evaluate(async ({ mode: shotMode }) => {
    const { createState } = await import('/src/core/game.ts');
    const { beginEncounter } = await import('/src/core/combat.ts');
    window.__game.pause();
    const state = createState(1, { starterGear: true });
    state.highestCleared = 0;
    state.progress = { kind: 'PUSHING', stage: 1 };
    delete state.farmClock;
    delete state.encounterFarmContext;
    beginEncounter(state);
    for (const unit of [...state.party, ...state.enemies]) {
      unit.moving = false;
      unit.action = { state: 'idle' };
      unit.gauge = 0;
      delete unit.specialAction;
    }
    const enemy = state.enemies.find(unit => unit.hp > 0);
    const priest = state.party.find(unit => unit.sourceId === 'priest');
    const ally = state.party.find(unit => unit.sourceId === 'mw2');
    if (!enemy || !priest || !ally) return { ok: false, reason: 'missing-units' };

    const eventTick = state.tick;
    const damage = shotMode === 'kill' ? Math.max(1, enemy.hp) : 14;
    state.eventSeq += 1;
    state.events.push({
      seq: state.eventSeq,
      tick: eventTick,
      combatTick: eventTick,
      combatEncounter: state.encounter,
      data: { type: 'hit', attackerId: priest.id, targetId: enemy.id, damage, side: 'enemy' },
    });
    enemy.hp = shotMode === 'kill' ? 0 : Math.max(1, enemy.hp - 14);

    if (shotMode === 'heal') {
      ally.hp = Math.max(1, Math.floor(ally.maxHp * 0.55));
      state.eventSeq += 1;
      state.events.push({
        seq: state.eventSeq,
        tick: eventTick,
        combatTick: eventTick,
        combatEncounter: state.encounter,
        data: { type: 'heal', sourceId: priest.id, targetId: ally.id, amount: 22 },
      });
    }

    window.__game.load(state);
    window.__game.openPanel(null);
    document.getElementById('management')?.setAttribute('hidden', '');
    window.__game.pause();
    const after = window.__game.getState();
    const projection = window.__game.getCombatProjection(after);
    return {
      ok: true,
      mode: shotMode,
      encounter: after.encounter,
      tick: after.tick,
      enemyHp: after.enemies.find(u => u.id === enemy.id)?.hp ?? null,
      enemyScreenX: projection.units.find(u => u.id === enemy.id)?.screenX ?? null,
      allyScreenX: projection.units.find(u => u.id === ally.id)?.screenX ?? null,
      layoutWidth: window.__game.getLayout().width,
    };
  }, { mode });
}

/** Pin a cream hit on stage 1-10 boss, optionally with a cleave telegraph. */
async function pinBossHit(page, { telegraph }) {
  return page.evaluate(async ({ telegraph: withTelegraph }) => {
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
    if (!boss || !tank) return { ok: false, reason: 'missing-boss' };
    for (const unit of [...s.party, ...s.enemies]) {
      unit.moving = false;
      unit.action = { state: 'idle' };
      unit.gauge = 0;
    }
    boss.hp = Math.max(2, Math.floor(boss.maxHp * 0.62));
    if (withTelegraph) {
      boss.specialAction = {
        state: 'areaMark', targetId: tank.id, centerX: tank.x, radius: 56,
        startTick: s.tick, impactTick: s.tick + 80, abilityId: 'boss-ch1-cleave',
      };
    } else {
      delete boss.specialAction;
    }
    const eventTick = s.tick;
    s.eventSeq += 1;
    s.events.push({
      seq: s.eventSeq,
      tick: eventTick,
      combatTick: eventTick,
      combatEncounter: s.encounter,
      data: { type: 'hit', attackerId: tank.id, targetId: boss.id, damage: 18, side: 'enemy' },
    });
    // Also pin a party heal so rear-slot float parks under a tall telegraph plate.
    const priest = s.party.find(unit => unit.sourceId === 'priest') ?? s.party[2];
    if (priest) {
      priest.hp = Math.max(1, Math.floor(priest.maxHp * 0.6));
      s.eventSeq += 1;
      s.events.push({
        seq: s.eventSeq,
        tick: eventTick,
        combatTick: eventTick,
        combatEncounter: s.encounter,
        data: { type: 'heal', sourceId: tank.id, targetId: priest.id, amount: 11 },
      });
    }
    window.__game.load(s);
    window.__game.openPanel(null);
    document.getElementById('management')?.setAttribute('hidden', '');
    window.__game.pause();
    const after = window.__game.getState();
    const projection = window.__game.getCombatProjection(after);
    const bossUnit = after.enemies.find(u => u.sourceId === 'boss_ch1');
    return {
      ok: true,
      telegraph: withTelegraph,
      bossHp: bossUnit?.hp ?? null,
      bossScreenX: projection.units.find(u => u.id === boss.id)?.screenX ?? null,
      priestScreenX: priest ? (projection.units.find(u => u.id === priest.id)?.screenX ?? null) : null,
      special: bossUnit?.specialAction?.abilityId ?? null,
      layoutWidth: window.__game.getLayout().width,
    };
  }, { telegraph });
}

async function canvasClip(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById('game');
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.floor(rect.x)),
      y: Math.max(0, Math.floor(rect.y)),
      width: Math.max(1, Math.ceil(rect.width)),
      height: Math.max(1, Math.ceil(rect.height)),
    };
  });
}

async function sampleNear(page, { x, color, yMin = 40, yMax = 90 }) {
  return page.evaluate(({ x: cx, color: kind, yMin: ymin, yMax: ymax }) => {
    const canvas = document.querySelector('#game');
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    const target = kind === 'cream' ? [0xf2, 0xe9, 0xcf] : [0x90, 0xc9, 0x9b];
    const hits = [];
    for (let y = ymin; y < Math.min(height, ymax); y += 1) {
      for (let px = Math.max(0, cx - 40); px < Math.min(width, cx + 40); px += 1) {
        const i = (y * width + px) * 4;
        if (data[i + 3] < 140) continue;
        if (Math.abs(data[i] - target[0]) <= 22
          && Math.abs(data[i + 1] - target[1]) <= 22
          && Math.abs(data[i + 2] - target[2]) <= 22) hits.push({ x: px, y });
      }
    }
    return { count: hits.length, mid: hits.length ? hits[Math.floor(hits.length / 2)] : null };
  }, { x, color, yMin, yMax });
}

async function canvasHasInk(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#game');
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    let ink = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) ink += 1;
    return { ok: ink > 200, ink, width, height };
  });
}

const results = [];
for (const width of [1280, 480]) {
  for (const mode of ['hit', 'heal', 'kill']) {
    const { context, page, errors } = await openAtWidth(width);
    const setup = await pinFloats(page, { mode });
    console.log('setup', JSON.stringify(setup));
    if (!setup.ok) throw new Error(`setup failed: ${JSON.stringify(setup)}`);
    if (mode === 'kill' && setup.enemyHp !== 0) throw new Error(`kill shot expected hp 0, got ${setup.enemyHp}`);
    await page.waitForTimeout(120);
    const path = `${out}/idea9-${mode}-${width}.png`;
    const clip = await canvasClip(page);
    await page.screenshot({ path, clip });
    const ink = await canvasHasInk(page);
    if (!ink.ok) throw new Error(`blank canvas for ${mode}@${width}`);
    if (errors.length) throw new Error(`page errors ${mode}@${width}: ${errors.join('; ')}`);

    if (mode === 'hit' || mode === 'kill') {
      const cream = await sampleNear(page, { x: setup.enemyScreenX, color: 'cream' });
      console.log('cream near enemy', JSON.stringify(cream));
      if (cream.count < 8) throw new Error(`expected cream damage near x=${setup.enemyScreenX}, got ${cream.count}`);
    } else {
      const green = await sampleNear(page, { x: setup.allyScreenX, color: 'green' });
      console.log('green near ally', JSON.stringify(green));
      if (green.count < 8) throw new Error(`expected green heal near x=${setup.allyScreenX}, got ${green.count}`);
    }

    results.push({ width, mode, path, clip, ink, setup, errors });
    await context.close();
  }
}

for (const telegraph of [false, true]) {
  const { context, page, errors } = await openAtWidth(1280);
  const setup = await pinBossHit(page, { telegraph });
  console.log('boss setup', JSON.stringify(setup));
  if (!setup.ok) throw new Error(`boss setup failed: ${JSON.stringify(setup)}`);
  await page.waitForTimeout(120);
  const tag = telegraph ? 'boss-cleave' : 'boss-hit';
  const path = `${out}/idea9-${tag}-1280.png`;
  const clip = await canvasClip(page);
  await page.screenshot({ path, clip });
  const ink = await canvasHasInk(page);
  if (!ink.ok) throw new Error(`blank canvas for ${tag}`);
  if (errors.length) throw new Error(`page errors ${tag}: ${errors.join('; ')}`);
  // Boss float sits below the plate/icons — sample a wider y band.
  const cream = await sampleNear(page, { x: setup.bossScreenX, color: 'cream', yMin: 20, yMax: 110 });
  console.log('cream near boss', JSON.stringify(cream));
  if (cream.count < 8) throw new Error(`expected cream boss damage near x=${setup.bossScreenX}, got ${cream.count}`);
  if (setup.priestScreenX != null) {
    const green = await sampleNear(page, { x: setup.priestScreenX, color: 'green', yMin: 20, yMax: 80 });
    console.log('green near priest under plate', JSON.stringify(green));
    if (green.count < 4) throw new Error(`expected green party heal under plate near x=${setup.priestScreenX}, got ${green.count}`);
  }
  results.push({ width: 1280, mode: tag, path, clip, ink, setup, errors });
  await context.close();
}

await browser.close();
console.log(JSON.stringify(results, null, 2));
