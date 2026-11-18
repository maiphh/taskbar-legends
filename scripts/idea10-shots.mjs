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
    viewport: { width: sourceWidth, height: 180 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  });
  await context.addInitScript(width => {
    localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify({
      version: 1, sourceWidth: width, sourceHeight: 160, zoom: 1, placement: 'free', anchorX: 1, anchorY: 1,
    }));
  }, sourceWidth);
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    window.__game.pause();
    await window.__game.whenReady();
    window.__game.setSeed(410);
  });
  const layoutWidth = await page.evaluate(() => window.__game.getLayout().width);
  if (layoutWidth !== sourceWidth) throw new Error(`expected layout width ${sourceWidth}, got ${layoutWidth}`);
  return { context, page };
}

/** Pause combat, idle everyone, put one hero into a cast windup with abilityId. */
async function setWindup(page, { heroSourceId, abilityId, kind }) {
  const result = await page.evaluate(({ heroSourceId: id, abilityId: skill, kind: actionKind }) => {
    window.__game.pause();
    const state = window.__game.getState();
    for (const hero of state.roster) { hero.level = 8; hero.stars = 2; }
    state.highestCleared = 0;
    state.progress = { kind: 'PUSHING', stage: 1 };
    delete state.farmClock;
    delete state.encounterFarmContext;
    if (state.phase?.kind === 'farmPad') state.phase = { kind: 'rest', remainingTicks: 20, next: 'encounter' };
    window.__game.load(state);
    window.__game.input({ type: 'retry' });
    window.__game.openPanel(null);
    document.getElementById('management')?.setAttribute('hidden', '');

    const s = window.__game.getState();
    const tick = s.tick;
    const actor = s.party.find(unit => unit.sourceId === id);
    if (!actor) return { ok: false, reason: 'missing-hero', party: s.party.map(u => u.sourceId) };
    const target = actionKind === 'heal'
      ? (s.party.find(unit => unit.id !== actor.id && unit.hp > 0) ?? actor)
      : (s.enemies.find(unit => unit.hp > 0) ?? actor);
    for (const unit of [...s.party, ...s.enemies]) {
      unit.moving = false;
      unit.action = { state: 'idle' };
      unit.gauge = 0;
      delete unit.specialAction;
    }
    actor.action = {
      state: 'windup',
      kind: actionKind,
      targetId: target.id,
      targetSide: target.side,
      targetSlot: target.slot,
      targetCount: s.enemies.length,
      startTick: tick,
      impactTick: tick + 40,
      delivery: 'cast',
      abilityId: skill,
    };
    actor.gauge = 4000;
    window.__game.load(s);
    window.__game.openPanel(null);
    document.getElementById('management')?.setAttribute('hidden', '');
    window.__game.pause();
    const pos = window.__game.getLayout?.();
    return {
      ok: true,
      actorId: actor.id,
      slot: actor.slot,
      abilityId: skill,
      layoutWidth: pos?.width,
      party: s.party.map(u => ({ id: u.sourceId, slot: u.slot, x: u.x })),
    };
  }, { heroSourceId, abilityId, kind });
  console.log('setup', JSON.stringify(result));
  if (!result.ok) throw new Error('setup failed: ' + JSON.stringify(result));
  return result;
}

/** Sample the canvas to find the turn-floor centre x (role-coloured 2 px line). */
async function sampleFloorX(page, roleRgb) {
  return page.evaluate(rgb => {
    const canvas = document.querySelector('#game');
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    const matches = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        if (data[i] === rgb[0] && data[i + 1] === rgb[1] && data[i + 2] === rgb[2] && data[i + 3] > 200) {
          matches.push(x);
        }
      }
    }
    if (!matches.length) return { count: 0 };
    matches.sort((a, b) => a - b);
    const mid = matches[Math.floor(matches.length / 2)];
    return { count: matches.length, mid, min: matches[0], max: matches[matches.length - 1], width };
  }, roleRgb);
}

const cases = [
  {
    tag: 'tank-windup',
    heroSourceId: 'mw2',
    abilityId: 'guardian-strike',
    kind: 'attack',
    // tank role colour #74baf4
    roleRgb: [0x74, 0xba, 0xf4],
    expectedX: { 480: 133, 1280: 375 },
  },
  {
    tag: 'priest-prayer',
    heroSourceId: 'priest',
    abilityId: 'priest-burst-heal',
    kind: 'heal',
    // support role colour #83dccc
    roleRgb: [0x83, 0xdc, 0xcc],
    expectedX: { 480: 20, 1280: 20 },
  },
];

for (const width of [1280, 480]) {
  const { context, page } = await openAtWidth(width);
  for (const c of cases) {
    await setWindup(page, c);
    await page.waitForTimeout(200);
    const path = `${out}/idea10-${c.tag}-${width}.png`;
    await page.screenshot({ path });
    const floor = await sampleFloorX(page, c.roleRgb);
    const expect = c.expectedX[width];
    console.log('shot', path, 'floor', JSON.stringify(floor), 'expect~', expect);
    if (!floor?.count) throw new Error(`no floor colour found for ${c.tag}@${width}`);
    // Floor is a 32 px bar centered on the actor; mid should sit near formationScreenX.
    if (Math.abs(floor.mid - expect) > 20) {
      throw new Error(`floor mid ${floor.mid} far from expected ${expect} for ${c.tag}@${width}`);
    }
  }
  await context.close();
}

await browser.close();
console.log('done');
