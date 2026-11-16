/* global window, document, localStorage, process, console, CanvasRenderingContext2D, getComputedStyle */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseUrl = process.env.IDLE_RETURN_BASE_URL ?? 'http://127.0.0.1:5173/';
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath, headless: true });
const results = [];

try {
  await mkdir('artifacts', { recursive: true });
  for (const scenario of [
    { width: 480, rules: [], slots: 4 },
    { width: 480, rules: ['expeditionChests'], slots: 28 },
    { width: 640, rules: [], slots: 4 },
    { width: 640, rules: ['expeditionChests'], slots: 28 },
    { width: 960, rules: [], slots: 4 },
    { width: 640, dpr: 1.25, zoom: 1, rules: [], slots: 4 },
    { width: 640, dpr: 2, zoom: 1, rules: [], slots: 4 },
    { width: 640, dpr: 1, zoom: 2, rules: [], slots: 4 },
    { width: 640, dpr: 1.25, zoom: 2, rules: [], slots: 4 },
    { width: 640, dpr: 2, zoom: 2, rules: [], slots: 4 },
    { width: 480, dpr: 1, zoom: 2, rules: [], slots: 4 },
  ]) {
    const zoom = scenario.zoom ?? 1, dpr = scenario.dpr ?? 1;
    const context = await browser.newContext({ viewport: { width: Math.ceil(scenario.width * zoom / dpr) + 40, height: Math.ceil(488 * zoom / dpr) + 60 }, deviceScaleFactor: dpr });
    await context.addInitScript(({ sourceWidth, zoom: sourceZoom }) => {
      localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify({ version: 1, sourceWidth, sourceHeight: 160, zoom: sourceZoom, placement: 'free', anchorX: 1, anchorY: 1 }));
      window.__drawFontCalls = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(value, ...args) { if (String(value).includes('WELCOME BACK')) window.__drawFontCalls.push({ value: String(value), font: this.font }); return original.call(this, value, ...args); };
    }, { sourceWidth: scenario.width, zoom });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseUrl}?v14=${scenario.rules.join(',')}`);
    await page.waitForFunction(() => !!window.__game);
    await page.evaluate(async rules => {
      await window.__game.whenReady(); await document.fonts.ready;
      window.__game.pause(); window.__game.setV14Rules(rules);
      window.__game.freezeClock(0); window.__game.away(8 * 60 * 60 * 1000); window.__game.freezeClock(1_000_000);
    }, scenario.rules);
    await page.waitForSelector('[data-control="welcome-collect"]');
    const state = await page.evaluate(() => {
      const canvas = document.querySelector('#game'), collect = document.querySelector('[data-control="welcome-collect"]'), close = document.querySelector('[data-control="welcome-close"]');
      const box = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      return { layout: window.__game.getLayout(), canvas: box(canvas), collect: box(collect), close: box(close), fonts: {
        regular: document.fonts.check('400 12px GameSans'), semibold: document.fonts.check('600 12px GameSans') }, calls: window.__drawFontCalls,
        before: window.__game.snapshot(), result: window.__game.getState().stats };
    });
    assert.equal(state.layout.width, scenario.width);
    assert.equal(state.layout.height, 488);
    assert.equal(state.layout.ui.welcome !== null, true);
    assert.equal(state.collect.x >= state.canvas.x && state.collect.right <= state.canvas.right, true, `Collect is within canvas at ${scenario.width}`);
    assert.equal(state.collect.y >= state.canvas.y && state.collect.bottom <= state.canvas.bottom, true, `Collect is within canvas height at ${scenario.width}`);
    assert.equal(state.close.x >= state.canvas.x && state.close.right <= state.canvas.right, true, `close is within canvas at ${scenario.width}`);
    assert.equal(state.fonts.regular && state.fonts.semibold, true, 'both bundled Noto weights loaded');
    assert.equal(state.calls.some(call => call.font.includes('GameSans') && call.font.includes('22px')), true, 'WELCOME BACK was rasterized with the requested bundled font and size');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, 'no horizontal page overflow');
    assert.equal(await page.locator('[data-control="welcome-collect"]').evaluate(el => document.elementFromPoint(el.getBoundingClientRect().x + el.offsetWidth / 2, el.getBoundingClientRect().y + el.offsetHeight / 2) === el), true);
    const screenPath = `artifacts/idle-return-layout-${scenario.width}-${scenario.slots}-z${zoom}-dpr${dpr}.png`;
    await page.screenshot({ path: screenPath, fullPage: true });
    await page.locator('[data-control="welcome-collect"]').click();
    await page.waitForFunction(() => window.__game.getLayout().ui.welcome === null);
    assert.equal(await page.evaluate(() => window.__game.getLayout().height), 160, 'frame height collapses after Collect');
    assert.equal(await page.evaluate(before => window.__game.snapshot() === before, state.before), true, 'Collect only acknowledges the already-credited result');
    assert.equal(await page.locator('[data-control="welcome-collect"]').count(), 0);
    assert.deepEqual(errors, []);
    results.push({ ...scenario, zoom, dpr, collect: state.collect, close: state.close, chestSlots: scenario.slots, fonts: state.fonts, screenshot: screenPath, errors });
    await context.close();
  }
  const early = await browser.newContext({ viewport: { width: 680, height: 600 } }), earlyPage = await early.newPage();
  await early.addInitScript(() => localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify({ version: 1, sourceWidth: 640, sourceHeight: 160, zoom: 1, placement: 'free', anchorX: 1, anchorY: 1 })));
  await earlyPage.goto(baseUrl); await earlyPage.waitForFunction(() => !!window.__game);
  await earlyPage.evaluate(async () => { await window.__game.whenReady(); window.__game.pause(); window.__game.freezeClock(0); window.__game.away(8 * 60 * 60 * 1000); });
  const earlyState = await earlyPage.evaluate(() => window.__game.snapshot());
  await earlyPage.locator('[data-control="welcome-collect"]').click();
  assert.equal(await earlyPage.locator('[data-control="welcome-collect"]').isDisabled(), true, 'early Collect begins the 240 ms hold');
  assert.equal(await earlyPage.evaluate(() => window.__game.getLayout().ui.welcome !== null), true);
  assert.equal(await earlyPage.evaluate(before => window.__game.snapshot() === before, earlyState), true);
  await earlyPage.evaluate(() => window.__game.freezeClock(241));
  await earlyPage.waitForFunction(() => window.__game.getLayout().ui.welcome === null);
  results.push({ earlyCollectHoldMs: 240, stateUnchanged: true, collapsedHeight: await earlyPage.evaluate(() => window.__game.getLayout().height) });
  await early.close();
  const scrollContext = await browser.newContext({ viewport: { width: 680, height: 300 } }), scrollPage = await scrollContext.newPage();
  await scrollContext.addInitScript(() => localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify({ version: 1, sourceWidth: 640, sourceHeight: 160, zoom: 1, placement: 'free', anchorX: 1, anchorY: 1 })));
  await scrollPage.goto(baseUrl); await scrollPage.waitForFunction(() => !!window.__game);
  await scrollPage.evaluate(async () => { await window.__game.whenReady(); window.__game.pause(); window.__game.freezeClock(0); window.__game.away(8 * 60 * 60 * 1000); window.__game.freezeClock(1_000_000); document.body.classList.add('native-shell', 'native-welcome-scroll'); });
  const scrollState = await scrollPage.evaluate(() => ({ before: window.__game.snapshot(), position: getComputedStyle(document.querySelector('#app')).position, scrollHeight: document.documentElement.scrollHeight }));
  assert.equal(scrollState.position, 'relative'); assert.equal(scrollState.scrollHeight >= 488, true, 'short native host can scroll the expanded app');
  await scrollPage.locator('[data-control="welcome-collect"]').scrollIntoViewIfNeeded();
  const collectViewport = await scrollPage.locator('[data-control="welcome-collect"]').boundingBox();
  assert.ok(collectViewport && collectViewport.y >= 0 && collectViewport.y + collectViewport.height <= 300);
  await scrollPage.locator('[data-control="welcome-collect"]').click();
  await scrollPage.waitForFunction(() => window.__game.getLayout().ui.welcome === null);
  assert.equal(await scrollPage.evaluate(before => window.__game.snapshot() === before, scrollState.before), true);
  await scrollContext.close();
  results.push({ constrainedNativeScroll: true, scrollHeight: scrollState.scrollHeight, collectReachable: true, stateUnchanged: true });
  await writeFile('artifacts/idle-return-layout-check.json', `${JSON.stringify({ results }, null, 2)}\n`);
  console.log(JSON.stringify({ results }));
} finally { await browser.close(); }
