/* global window, document, process, localStorage */
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { URL } from 'node:url';
import { chromium } from 'playwright';

const output = process.argv[2] ?? '.grok-run/pixel-ui/shots/after';
const base = process.env.BASE_URL ?? 'http://localhost:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'] });

// Browser-only fixture. Playwright creates a fresh storage context for every preset.
function bossEncounter({ enraged = false, chapter = 1 } = {}) {
  const game = window.__game;
  const state = game.getState();
  const bossStage = chapter * 10;
  state.highestCleared = bossStage - 1;
  state.progress = { kind: 'BOSS_READY', stage: bossStage - 1, bossStage, failedPower: 0, bossLosses: 0 };
  delete state.farmClock;
  delete state.encounterFarmContext;
  if (state.phase.kind === 'farmPad') state.phase = { kind: 'rest', remainingTicks: 20, next: 'encounter' };
  game.load(state);
  game.input({ type: 'retry' });
  const fight = game.getState(), boss = fight.enemies.find(unit => unit.sourceId === `boss_ch${chapter}`), front = fight.party[0];
  boss.x = front.x + 58;
  boss.hp = Math.floor(boss.maxHp * (enraged ? 0.25 : 0.62));
  for (const unit of fight.enemies) unit.moving = false;
  boss.procCounters = { basicSuccess: 4, bossPattern: 0, enraged: Number(enraged) };
  boss.specialAction = {
    state: 'areaMark', targetId: front.id, centerX: front.x, radius: enraged ? 0 : 56,
    startTick: fight.tick, impactTick: fight.tick + 80,
    abilityId: `boss-ch${chapter}-${enraged ? 'enrage' : 'cleave'}`, ...(enraged ? { global: true } : {}),
  };
  for (const [unit, id] of [[front, 'atkUp'], [fight.party[1], 'hot'], [boss, 'dot']]) {
    unit.statuses = [{ id, sourceId: front.id, targetId: unit.id, stacks: 1, magnitude: 0.05, turnsLeft: 2, appliedAtTick: fight.tick }];
  }
  game.load(fight);
}

// Exercise the desktop placement code at the configured native control-window size.
// The host answers geometry IPC and composites the real control.html at the bounds it receives.
function desktopHost({ width, height }) {
  if (window !== window.top) return;
  const origin = { x: 0, y: 0 }, size = { width: window.innerWidth, height: window.innerHeight };
  const monitor = { name: 'Fixture', scaleFactor: 1, position: origin, size, workArea: { position: origin, size } };
  window.isTauri = true;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' } },
    transformCallback: () => 1,
    invoke: async (command, args) => {
      switch (command) {
        case 'shell_mode': return 'overlay';
        case 'plugin:window|get_all_windows': return ['main', 'controls'];
        case 'plugin:window|inner_size':
        case 'plugin:window|outer_size': return args.label === 'controls' ? { width, height } : size;
        case 'plugin:window|inner_position':
        case 'plugin:window|outer_position': return origin;
        case 'plugin:window|available_monitors': return [monitor];
        case 'plugin:window|current_monitor': return monitor;
        case 'set_control_bounds': {
          const bounds = args.bounds;
          let frame = document.querySelector('#desktop-controls');
          if (!frame) {
            frame = document.createElement('iframe'); frame.id = 'desktop-controls'; frame.src = '/control.html';
            document.body.append(frame);
          }
          Object.assign(frame.style, { position: 'fixed', zIndex: 10, border: 0, left: `${bounds.x}px`,
            top: `${bounds.y}px`, width: `${bounds.width}px`, height: `${bounds.height}px` });
          break;
        }
      }
    },
  };
}

try {
  await mkdir(output, { recursive: true });
  const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
  const controls = config.app.windows.find(w => w.label === 'controls');
  for (const [width, height, desktop] of [[1280, 720], [960, 640], [480, 160], [480, 320], [480, 160, true], [480, 320, true]]) {
    const zoom = height === 320 ? 2 : 1;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    if (desktop) await page.addInitScript(desktopHost, controls);
    if (width === 480) await page.addInitScript(zoom => {
      localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify({
        version: 1, sourceWidth: 480, sourceHeight: 160, zoom, placement: 'free', anchorX: 1, anchorY: 1,
      }));
    }, zoom);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const game = window.__game;
      await game.whenReady();
      game.pause(); game.setSeed(404); game.step(40);
      const state = game.getState();
      state.gold = 4280; state.tickets = 16;
      game.load(state);
    });
    if (width === 480) assert.equal(await page.evaluate(() => window.__game.getLayout().width), width / zoom);
    if (desktop) {
      const frame = page.frameLocator('#desktop-controls');
      await frame.getByRole('button', { name: 'Edit' }).waitFor();
      await frame.locator('body').evaluate(async () => { await document.fonts.ready; });
      const bounds = await page.locator('#desktop-controls').boundingBox();
      assert.deepEqual(bounds, { x: width - controls.width - 8, y: 4, width: controls.width, height: controls.height });
    }
    const views = desktop || zoom === 2 ? ['lane'] : width === 480 ? ['lane', 'boss', 'enrage', 'nyx-loot'] : ['home', 'heroes', 'settings'];
    for (const view of views) {
      if (view === 'boss' || view === 'enrage') await page.evaluate(bossEncounter, { enraged: view === 'enrage' });
      if (view === 'nyx-loot') {
        await page.evaluate(bossEncounter, { chapter: 2 });
        await page.evaluate(() => window.__game.debugShowcase('drop', 'charm'));
      }
      await page.evaluate(tab => {
        window.__game.openPanel(tab);
        window.__management?.freezeAnimation(true);
      }, width === 480 ? null : view);
      if (width !== 480) await page.waitForSelector(`#management:not([hidden]) main[data-view="${view}"]`);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('#management img')].map(img => img.decode()));
      });
      const filename = view === 'home' ? `${width}.png` : `${desktop ? 'desktop-' : ''}${view}-${width}${zoom === 2 ? '-2x' : ''}.png`;
      await page.screenshot({ path: join(output, filename) });
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
