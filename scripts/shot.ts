import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { CONFIG, ticksForSeconds } from '../src/config';
import { createState, step } from '../src/core/game';
import type { GameState } from '../src/core/model';
import { partyPower } from '../src/core/economy';
import { beginEncounter } from '../src/core/combat';
import '../src/debug';

execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
await mkdir('shots', { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4175, strictPort: true } });
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(path => existsSync(path));
const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true, args: ['--no-sandbox'] });
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: CONFIG.view.defaultWidth, height: CONFIG.view.canvasHeight }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:4175${process.env.VITE_BASE_PATH || '/'}?shot`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => { window.__game.pause(); window.__game.setSeed(1); await window.__game.whenReady(); window.__game.step(30); });
  const assets = await page.evaluate(() => window.__game.getAssetErrors());
  if (assets.length) throw new Error(`Atlas failures: ${assets.join('; ')}`);
  await page.screenshot({ path: 'shots/01-pushing-1280.png', omitBackground: true });
  await page.evaluate(() => {
    const snap = window.__game.snapshot(); window.__game.input({ type: 'pull' }); window.__game.input({ type: 'autoParty' }); window.__game.input({ type: 'autoEquip' });
    window.__game.step(600); window.__game.load(snap);
    if (window.__game.snapshot() !== snap) throw new Error('Browser snapshot roundtrip failed');
  });
  // Natural one-hour no-input baseline; its frontier depends on the delivered balance.
  const natural = createState(1); step(natural, ticksForSeconds(3600));
  await page.evaluate((state: GameState) => { window.__game.load(state); }, natural);
  await page.screenshot({ path: 'shots/02-baseline-1h-1280.png', omitBackground: true });
  // Deterministic failed-frontier fixture, visibly labelled in the artifact metadata.
  const farm = createState(1); farm.highestCleared = 7;
  farm.progress = { kind: 'FARMING', stage: 7, failedStage: 8, retryAtTick: ticksForSeconds(120), failedPower: partyPower(farm), failures: 1 };
  farm.gold = 125; beginEncounter(farm); step(farm, 80);
  await page.evaluate((state: GameState) => window.__game.load(state), farm);
  await page.screenshot({ path: 'shots/03-farming-1280.png', omitBackground: true });
  await page.setViewportSize({ width: 640, height: CONFIG.view.canvasHeight });
  await page.screenshot({ path: 'shots/04-farming-640.png', omitBackground: true });
  const closedFinal = await page.evaluate(() => ({ state: window.__game.getState(), hitRegions: window.__game.getHitRegions(), layout: window.__game.getLayout(), events: window.__game.getEvents(), assetErrors: window.__game.getAssetErrors() }));
  await writeFile('shots/final-state.json', JSON.stringify({ scenario: 'failed-stage-1-8 fixture; natural one-hour no-input baseline in screenshot 02', ...closedFinal }, null, 2));
  await page.setViewportSize({ width: 1280, height: 488 });
  await page.evaluate((state: GameState) => { window.__game.load(state); }, natural);
  const beforePanel = await page.evaluate(() => window.__game.getLayout());
  await page.locator('[data-control="open-heroes"]').click();
  const expanded = await page.evaluate(() => window.__game.getLayout());
  if (expanded.height !== 488 || expanded.baselineY !== 464 || expanded.resizeCount !== beforePanel.resizeCount + 1) throw new Error('Panel must grow once, baseline bottom offset unchanged');
  const formationBeforeSelection = await page.evaluate(() => window.__game.getState().partyIds);
  await page.locator('[data-control="hero-mw2"]').focus();
  await page.keyboard.press('End');
  if (!await page.locator('[data-control="hero-ew3"]').isVisible()) throw new Error('Hero 18 unreachable by keyboard');
  if (JSON.stringify(formationBeforeSelection) !== JSON.stringify(await page.evaluate(() => window.__game.getState().partyIds))) throw new Error('Inspecting a hero changed formation');
  await page.keyboard.press('Home');
  await page.locator('[data-control="auto-equip-heroes"]').click();
  const beforeUpgradeGold = await page.evaluate(() => window.__game.getState().gold);
  await page.locator('[data-control="hero-upgrade"]').click();
  if (await page.evaluate(() => window.__game.getState().gold) >= beforeUpgradeGold) throw new Error('Upgrade button did not spend actual gold');
  await page.screenshot({ path: 'shots/05-heroes-panel-1280.png', omitBackground: true });
  await page.locator('[data-control="tab-gear"]').click();
  const afterTab = await page.evaluate(() => window.__game.getLayout());
  if (afterTab.resizeCount !== expanded.resizeCount) throw new Error('Switching tabs resized the framebuffer');
  await page.screenshot({ path: 'shots/06-gear-panel-1280.png', omitBackground: true });
  await page.locator('[data-control="tab-recruit"]').click();
  const beforePull = await page.evaluate(() => window.__game.getState().tickets);
  await page.locator('[data-control="recruit-one"]').click();
  if (await page.evaluate(() => window.__game.getState().tickets) !== beforePull - CONFIG.gacha.costTickets) throw new Error('Recruit did not deduct exact ticket cost');
  await page.screenshot({ path: 'shots/07-recruit-panel-1280.png', omitBackground: true });
  await page.evaluate(() => window.__game.resume());
  const runningTick = await page.evaluate(() => window.__game.getState().tick);
  await page.waitForFunction((tick: number) => window.__game.getState().tick > tick, runningTick);
  await page.evaluate(() => window.__game.pause());
  const beforeEffectStep = await page.evaluate(() => window.__game.getLayout().resizeCount);
  await page.evaluate(() => window.__game.step(1000));
  if (await page.evaluate(() => window.__game.getLayout().resizeCount) !== beforeEffectStep) throw new Error('Combat effect caused a resize');
  const noTickets = await page.evaluate(() => window.__game.getState()); noTickets.tickets = 0;
  await page.evaluate((state: GameState) => window.__game.load(state), noTickets);
  if (!await page.locator('[data-control="recruit-one"]').isDisabled() || !await page.locator('[data-control="recruit-ten"]').isDisabled()) throw new Error('Insufficient ticket actions must be disabled');
  const panelState = await page.evaluate(() => ({ state: window.__game.getState(), layout: window.__game.getLayout(), hitRegions: window.__game.getHitRegions() }));
  await writeFile('shots/panel-state.json', JSON.stringify(panelState, null, 2));
  await page.keyboard.press('Escape');
  const closedAgain = await page.evaluate(() => window.__game.getLayout());
  if (closedAgain.height !== 160 || closedAgain.baselineY !== 136 || closedAgain.resizeCount !== beforeEffectStep + 1) throw new Error('Close did not restore once');
  await page.setViewportSize({ width: 1920, height: 160 });
  await page.evaluate((state: GameState) => { window.__game.load(state); }, farm);
  await page.screenshot({ path: 'shots/08-strip-reference-1920.png', omitBackground: true });
  const flash = createState(1); const firstEnemy = flash.enemies[0], frontHero = flash.party[0]; if (!firstEnemy || !frontHero) throw new Error('Flash fixture missing');
  firstEnemy.x = frontHero.x + CONFIG.combat.enemyMeleeStopOffsetPx; step(flash);
  await page.setViewportSize({ width: 1280, height: 160 });
  await page.evaluate((state: GameState) => window.__game.load(state), flash);
  await page.screenshot({ path: 'shots/10-hit-flash-1280.png', omitBackground: true });
  const flashWhitePixels = await page.evaluate(() => { const ctx = document.querySelector('canvas')?.getContext('2d'); if (!ctx) throw new Error('Canvas'); const data = ctx.getImageData(304, 0, 672, 160).data; let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) count += 1; return count; });
  await writeFile('shots/hit-flash-state.json', JSON.stringify({ scenario: 'both hero and enemy hit on tick 1, age 0ms, paused', hitFlashMs: CONFIG.view.hitFlashMs, hitFlashColor: CONFIG.view.hitFlashColor, state: flash, whitePixels: flashWhitePixels }, null, 2));
  await page.evaluate(() => window.__game.step(2));
  await page.screenshot({ path: 'shots/11-hit-recovered-1280.png', omitBackground: true });
  const recoveredWhitePixels = await page.evaluate(() => { const ctx = document.querySelector('canvas')?.getContext('2d'); if (!ctx) throw new Error('Canvas'); const data = ctx.getImageData(304, 0, 672, 160).data; let count = 0; for (let i = 0; i < data.length; i += 4) if (data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255) count += 1; return count; });
  if (flashWhitePixels <= 0 || recoveredWhitePixels >= flashWhitePixels) throw new Error('Uniform runtime flash did not visibly expire after two 20Hz ticks');
  const alphaCheck = await page.evaluate(() => {
    const canvas = document.querySelector('canvas'); const ctx = canvas?.getContext('2d');
    return { topAlpha: ctx?.getImageData(0, 0, 1, 1).data[3], coreAlpha: ctx?.getImageData(0, 100, 1, 1).data[3] };
  });
  if (alphaCheck.topAlpha !== 0 || alphaCheck.coreAlpha !== 255) throw new Error('Transparent ceiling / opaque strip invariant failed');
  const dpiChecks = [];
  for (const dpr of [1, 1.25, 1.5]) {
    const context = await browser.newContext({ viewport: { width: Math.round(1920 / dpr), height: Math.ceil(160 / dpr) }, deviceScaleFactor: dpr });
    const dpiPage = await context.newPage();
    await dpiPage.goto(`http://127.0.0.1:4175${process.env.VITE_BASE_PATH || '/'}?shot`, { waitUntil: 'networkidle' });
    await dpiPage.evaluate(async () => { window.__game.pause(); await window.__game.whenReady(); window.__game.setSeed(1); window.__game.step(30); });
    const layout = await dpiPage.evaluate(() => window.__game.getLayout());
    if (layout.width !== 1920 || layout.height !== 160 || Math.abs(layout.cssHeight - 160 / dpr) > 1e-6) throw new Error(`Physical-pixel DPI layout failed: ${dpr}`);
    dpiChecks.push({ emulatedDpr: dpr, sourceWidth: layout.width, sourceHeight: layout.height, cssHeight: layout.cssHeight, pass: true });
    if (dpr === 1.25) await dpiPage.locator('canvas').screenshot({ path: 'shots/09-dpi125-canvas.png', omitBackground: true });
    await context.close();
  }
  await writeFile('shots/ui-checks.json', JSON.stringify({ browser: { panelOpenOneResize: true, tabSwitchNoResize: true, closeOneResize: true, baseline136_464: true,
    all18HeroesKeyboardReachable: true, inspectionDoesNotChangeFormation: true, actualUpgradeAndRecruitCosts: true, insufficientTicketsDisabled: true,
    panelDoesNotPauseBattle: true, effectsNeverResize: true, alphaCheck, hitRegionCountClosed: closedFinal.hitRegions.length, hitRegionCountExpanded: panelState.hitRegions.length,
    uniformHitFlash: { durationMs: CONFIG.view.hitFlashMs, color: CONFIG.view.hitFlashColor, flashWhitePixels, recoveredWhitePixels, pass: true },
    fontsReady: panelState.layout.ui.fontsReady, assetErrors: assets, dpiChecks }, nativeWindows: 'NOT TESTED: real desktop click-through, OS docking, monitor transfer, work-area/fullscreen handling and Windows 100/125/150% pixel appearance require M2 Tauri/Windows.' }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  process.stdout.write(JSON.stringify({ screenshots: ['01-pushing-1280.png', '02-baseline-1h-1280.png', '03-farming-1280.png', '04-farming-640.png', '05-heroes-panel-1280.png', '06-gear-panel-1280.png', '07-recruit-panel-1280.png', '08-strip-reference-1920.png', '09-dpi125-canvas.png', '10-hit-flash-1280.png', '11-hit-recovered-1280.png'], finalState: 'shots/final-state.json', browserErrors: errors, assetErrors: assets }, null, 2) + '\n');
} finally {
  await browser.close();
  await new Promise<void>((resolve, reject) => { server.httpServer.close(error => error ? reject(error) : resolve()); });
}
