// v1.4 shots: chest choice (CR-14-08) and luck meters (CR-14-01/02/03). npm run shot:v14
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { CONFIG, setV14Rules, ticksForSeconds } from '../src/config';
import { chest } from '../src/core/economy';
import { createState, step } from '../src/core/game';
import type { GameState } from '../src/core/model';
import { referencePolicy } from '../src/core/policy';
import '../src/debug';

if (!process.argv.includes('--no-build')) execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
// Fixture: 1.3.0 reference play for 40 open minutes (farming 1-9), then two v1.4 chests land as pick-1-of-2 choices.
const fixture = createState(1), cursor = { revision: -1 };
for (let tick = 0; tick < ticksForSeconds(40 * 60); tick += 1) { referencePolicy(fixture, cursor); step(fixture); }
setV14Rules(['chestChoice', 'farmChest']); chest(fixture, fixture.progress.stage); chest(fixture, fixture.progress.stage); setV14Rules([]);
const server = await preview({ preview: { host: '127.0.0.1', port: 4176, strictPort: true } });
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => existsSync(path));
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--no-sandbox'] });
const errors: string[] = [], checks: Record<string, unknown> = {};
try {
  for (const width of [1280, 960]) {
    const page = await browser.newPage({ viewport: { width, height: CONFIG.view.canvasHeight }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:4176${process.env.VITE_BASE_PATH || '/'}?shot&v14=chestChoice,farmChest`, { waitUntil: 'networkidle' });
    await page.evaluate(async (state: GameState) => { window.__game.pause(); await window.__game.whenReady(); window.__game.load(state); }, fixture);
    if (width === 1280) await page.screenshot({ path: 'shots/22-chest-choice-strip-1280.png', omitBackground: true });
    await page.setViewportSize({ width, height: CONFIG.ui.expanded.height });
    await page.evaluate(() => { window.__game.openPanel('gear'); });
    await page.waitForFunction(() => window.__game.getLayout().height > 160);
    await page.screenshot({ path: `shots/${width === 1280 ? 23 : 24}-chest-choice-gear-${width}.png`, omitBackground: true });
    // Hit regions: the heading hotspot and both Keep buttons sit inside getHitRegions(), so click-through never eats them.
    const inside = await page.evaluate(() => {
      const regions = window.__game.getHitRegions();
      return ['chest-keep-0', 'chest-keep-1'].map(id => {
        const box = document.querySelector(`[data-control="${id}"]`)?.getBoundingClientRect();
        return { id, inside: !!box && regions.some(r => box.left >= r.x && box.top >= r.y && box.right <= r.x + r.width && box.bottom <= r.y + r.height) };
      });
    });
    const before = await page.evaluate(() => window.__game.getState().pendingChoice?.length ?? 0);
    await page.click('[data-control="chest-keep-1"]');
    const after = await page.evaluate(() => { const state = window.__game.getState(); return { pending: state.pendingChoice?.length ?? 0, lastEvent: state.events.at(-1)?.data, rules: window.__game.getV14Rules() }; });
    await page.evaluate(() => { window.__game.openPanel(null); });
    await page.waitForFunction(() => window.__game.getLayout().height === 160);
    await page.setViewportSize({ width, height: CONFIG.view.canvasHeight });
    const hotspot = await page.evaluate(() => {
      const box = document.querySelector('[data-control="chest-choice"]')?.getBoundingClientRect(), regions = window.__game.getHitRegions();
      return { present: !!box, inside: !!box && regions.some(r => box.left >= r.x && box.top >= r.y && box.right <= r.x + r.width && box.bottom <= r.y + r.height) };
    });
    await page.click('[data-control="chest-choice"]');
    const opened = await page.evaluate(() => window.__game.getLayout().ui.panel);
    checks[String(width)] = { keepButtonsInsideHitRegions: inside, pendingBefore: before, afterKeep: after, headingHotspot: hotspot, hotspotOpens: opened };
    await page.close();
  }
  // Luck meters (CR-14-01/02/03): all v1.4 rules on, 40 open minutes of reference play so the counters have moved.
  setV14Rules(['chestChoice', 'farmChest', 'recruitPity', 'gearFortune']);
  const luck = createState(2), luckCursor = { revision: -1 };
  for (let tick = 0; tick < ticksForSeconds(40 * 60); tick += 1) { referencePolicy(luck, luckCursor); step(luck); }
  referencePolicy(luck, luckCursor); setV14Rules([]);
  const meterChecks: Record<string, unknown> = {};
  for (const width of [1280, 960]) {
    const page = await browser.newPage({ viewport: { width, height: CONFIG.view.canvasHeight }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:4176${process.env.VITE_BASE_PATH || '/'}?shot&v14=all`, { waitUntil: 'networkidle' });
    await page.evaluate(async (state: GameState) => { window.__game.pause(); await window.__game.whenReady(); window.__game.load(state); }, luck);
    await page.screenshot({ path: `shots/${width === 1280 ? 25 : 26}-luck-meters-strip-${width}.png`, omitBackground: true });
    const regions = await page.evaluate(() => ['recruit-meter', 'fortune-meter'].map(id => {
      const box = document.querySelector(`[data-control="${id}"]`)?.getBoundingClientRect(), hits = window.__game.getHitRegions();
      return { id, present: !!box, inside: !!box && hits.some(r => box.left >= r.x && box.top >= r.y && box.right <= r.x + r.width && box.bottom <= r.y + r.height),
        tooltip: document.querySelector(`[data-control="${id}"]`)?.getAttribute('title') };
    }));
    await page.setViewportSize({ width, height: CONFIG.ui.expanded.height });
    const opened: Record<string, unknown> = {};
    for (const [id, panel, shot] of [['recruit-meter', 'recruit', 27], ['fortune-meter', 'gear', 28]] as const) {
      const present = await page.locator(`[data-control="${id}"]`).count();
      if (!present) { opened[id] = 'not drawn at this width'; continue; }
      await page.click(`[data-control="${id}"]`);
      await page.waitForFunction(() => window.__game.getLayout().height > 160);
      opened[id] = await page.evaluate(() => window.__game.getLayout().ui.panel);
      if (width === 1280) await page.screenshot({ path: `shots/${shot}-luck-meter-${panel}-panel-1280.png`, omitBackground: true });
      await page.evaluate(() => { window.__game.openPanel(null); });
      await page.waitForFunction(() => window.__game.getLayout().height === 160);
    }
    const state = await page.evaluate(() => { const s = window.__game.getState(); return { pity: s.pity, pityLegendary: s.pityLegendary, pityNewHero: s.pityNewHero, gearSinceLegendary: s.gearSinceLegendary, gearLegendaryFound: s.gearLegendaryFound, roster: s.roster.length }; });
    meterChecks[String(width)] = { regions, opened, state };
    await page.close();
  }
  const metersOk = Object.values(meterChecks).every(value => { const c = value as { regions: { id: string; present: boolean; inside: boolean }[]; opened: Record<string, unknown> };
    return c.regions.every(r => !r.present || r.inside) && c.regions.some(r => r.id === 'recruit-meter' && r.present) && c.opened['recruit-meter'] === 'recruit' && (c.opened['fortune-meter'] === 'gear' || c.opened['fortune-meter'] === 'not drawn at this width'); });
  checks.meters = meterChecks; checks.metersOk = metersOk;
  const ok = metersOk && Object.entries(checks).filter(([key]) => key === '1280' || key === '960').map(([, value]) => value).every(value => { const c = value as { keepButtonsInsideHitRegions: { inside: boolean }[]; pendingBefore: number; afterKeep: { pending: number }; headingHotspot: { inside: boolean }; hotspotOpens: string };
    return c.keepButtonsInsideHitRegions.every(k => k.inside) && c.afterKeep.pending === c.pendingBefore - 1 && c.headingHotspot.inside && c.hotspotOpens === 'gear'; });
  await writeFile('shots/v14-chest-choice-checks.json', JSON.stringify({ fixture: 'seed 1, 40 open min reference play (1.3.0), then 2 chests with chestChoice on', checks, ok, errors }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ screenshots: ['22-chest-choice-strip-1280.png', '23-chest-choice-gear-1280.png', '24-chest-choice-gear-960.png', '25-luck-meters-strip-1280.png', '26-luck-meters-strip-960.png', '27-luck-meter-recruit-panel-1280.png', '28-luck-meter-gear-panel-1280.png'], ok, errors, checks }, null, 2) + '\n');
  if (!ok || errors.length) process.exitCode = 1;
} finally { await browser.close(); await new Promise<void>(resolve => { server.httpServer.close(() => resolve()); }); }
