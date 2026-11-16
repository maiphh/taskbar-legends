/* global window, document, localStorage, process, Event, console */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.OFFLINE_LIFECYCLE_BASE_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 480 } });
  await context.addInitScript(() => {
    Date.now = () => Number(localStorage.getItem('__offlineTestNow') ?? 100_000);
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  await page.waitForFunction(() => !!window.__game && !!window.__management);
  const seeded = await page.evaluate(async () => {
    await window.__game.whenReady();
    const state = window.__game.getState();
    state.tickets = 6;
    const { applyOffline, makeSave } = await import('/src/core/save.ts');
    const prior = applyOffline(state, 10_000);
    window.__game.load(state);
    localStorage.setItem('taskbar-legends:v1:party-v2', makeSave(state, 100_000));
    return { gold: state.gold, offlineClears: state.stats.offlineClears, priorGold: prior.gold };
  });

  await page.evaluate(() => {
    localStorage.setItem('__offlineTestNow', '90000');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const hiddenCommand = await page.evaluate(() => {
    const snapshot = window.__management.snapshot();
    const reply = window.__management.execute({ clientId: 'hidden-check', requestId: 'pull-hidden', expectedRevision: snapshot.revision, action: { type: 'pull' } });
    window.__game.input({ type: 'pull' });
    return { accepted: reply.accepted, reason: reply.reason, tickets: window.__management.snapshot().tickets, pulls: window.__management.snapshot().stats.pulls };
  });
  assert.equal(hiddenCommand.accepted, false);
  assert.match(hiddenCommand.reason ?? '', /hidden/);
  assert.equal(hiddenCommand.tickets, 6);
  assert.equal(hiddenCommand.pulls, 0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('taskbar-legends:v1:party-v2')).savedAtMs), 100_000, 'hide checkpoint keeps the consumed timestamp through wall-clock rollback');

  await page.evaluate(() => {
    localStorage.setItem('__offlineTestNow', '100000');
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(50);
  const afterForeground = await page.evaluate(() => ({ gold: window.__game.getState().gold, offlineClears: window.__game.getState().stats.offlineClears, tickets: window.__management.snapshot().tickets }));
  assert.equal(afterForeground.gold, seeded.gold, 'foreground restore does not reprice the consumed interval');
  assert.equal(afterForeground.offlineClears, seeded.offlineClears);
  assert.equal(afterForeground.tickets, 6);

  await page.evaluate(() => {
    localStorage.setItem('__offlineTestNow', '90000');
    window.dispatchEvent(new Event('pagehide'));
  });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('taskbar-legends:v1:party-v2')).savedAtMs), 100_000, 'ordinary save also retains the timestamp high-water');
  await page.reload();
  await page.waitForFunction(() => !!window.__game && !!window.__management);
  await page.evaluate(() => window.__game.whenReady());
  const afterReload = await page.evaluate(() => ({ gold: window.__game.getState().gold, offlineClears: window.__game.getState().stats.offlineClears, tickets: window.__management.snapshot().tickets }));
  assert.deepEqual(afterReload, afterForeground, 'clock recovery and reload do not duplicate offline income or accept hidden commands');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ seeded, hiddenCommand, afterForeground, afterReload, errors }));
  await context.close();
} finally { await browser.close(); }
