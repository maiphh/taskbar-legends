/* global process, window, document, console, Buffer, localStorage, HTMLCanvasElement */
/** Idea 2: farm clear at 1280 with a readable ×3 token in the strip. */
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

const context = await browser.newContext({ viewport: { width: 1280, height: 200 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
await context.addInitScript(() => {
  localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify({
    version: 1, sourceWidth: 1280, sourceHeight: 160, zoom: 1, placement: 'free', anchorX: 1, anchorY: 1,
  }));
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));

await page.goto(base, { waitUntil: 'networkidle' });
await page.evaluate(async () => {
  window.__game.pause();
  await window.__game.whenReady();
  window.__game.setSeed(11);
});

const info = await page.evaluate(() => {
  window.__game.pause();
  const state = window.__game.getState();
  for (const hero of state.roster) { hero.level = 10; hero.stars = 2; }
  state.highestCleared = 5;
  state.progress = { kind: 'FARMING', stage: 5, failedStage: 6, retryAtTick: 1e9, failTick: 0, failedPower: 1e9, failures: 1 };
  delete state.encounterFarmContext;
  if (state.phase?.kind === 'farmPad') state.phase = { kind: 'rest', remainingTicks: 1, next: 'encounter' };
  window.__game.load(state);
  window.__game.step(1);
  window.__game.openPanel(null);
  document.getElementById('management')?.setAttribute('hidden', '');

  const s = window.__game.getState();
  // Keep the fight readable: one grunt in range, party full, farm clock active at ×3.
  const enemy = s.enemies[0];
  if (enemy) {
    s.enemies = [enemy];
    enemy.hp = Math.max(80, Math.floor(enemy.maxHp * 0.7));
    enemy.x = 180;
    enemy.moving = false;
    enemy.gauge = 0;
    enemy.action = { state: 'idle' };
    delete enemy.specialAction;
  }
  for (const hero of s.party) {
    hero.hp = hero.maxHp;
    hero.moving = false;
    hero.gauge = hero.slot === 1 ? 10000 : 2000;
    hero.action = { state: 'idle' };
  }
  if (!s.farmClock || s.farmClock.scale !== 3) {
    s.farmClock = { scale: 3, minCycleTicks: 420, elapsedTicks: s.farmClock?.elapsedTicks ?? 0, remainder: 0 };
  }
  window.__game.load(s);
  // Step until a hero is mid-action so the lane looks like a live farm clear.
  for (let i = 0; i < 40; i += 1) {
    window.__game.step(1);
    const live = window.__game.getState();
    if (live.party.some(unit => unit.action?.state === 'windup' || unit.action?.state === 'recovery')) break;
  }
  window.__game.pause();
  window.__game.openPanel(null);
  document.getElementById('management')?.setAttribute('hidden', '');
  const final = window.__game.getState();
  const layout = window.__game.getLayout();
  return {
    width: layout.width,
    progress: final.progress.kind,
    stage: final.progress.stage,
    farmScale: final.farmClock?.scale ?? null,
    phase: final.phase.kind,
    acting: final.party.filter(unit => unit.action && unit.action.state !== 'idle').map(unit => ({ id: unit.sourceId, state: unit.action.state })),
    enemyHp: final.enemies.map(unit => unit.hp),
  };
});

if (info.width !== 1280) throw new Error(`expected sourceWidth 1280, got ${info.width}`);
if (info.farmScale !== 3) throw new Error(`expected farmClock.scale 3, got ${info.farmScale}`);
if (info.progress !== 'FARMING') throw new Error(`expected FARMING, got ${info.progress}`);

await page.waitForTimeout(150);
await page.screenshot({ path: `${out}/idea2-farm-x3-1280.png` });

// Crop the status band so the ×3 token is obvious in review.
// Compact lane text is at coreY - 40 (= 40 with sourceHeight 160 / coreHeight 80); glyphs sit on y 41–50.
const band = await page.evaluate(() => {
  const canvas = document.querySelector('#game');
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const tmp = document.createElement('canvas');
  tmp.width = 420; tmp.height = 16;
  const ctx = tmp.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 40, 420, 16, 0, 0, 420, 16);
  return tmp.toDataURL('image/png');
});
if (band) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(`${out}/idea2-farm-x3-band-1280.png`, Buffer.from(band.split(',')[1], 'base64'));
}

console.log(JSON.stringify({ info, errors, shots: [`${out}/idea2-farm-x3-1280.png`, `${out}/idea2-farm-x3-band-1280.png`] }));
if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
await browser.close();
