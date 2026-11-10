/* global process, sessionStorage, localStorage, window, document, Event, DOMException, Storage, console, URL */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const raw = '{"format":"taskbar-legends-save-v999","preserve":"phase0-browser-check"}';
const baseUrl = process.env.PHASE0_BASE_URL ?? 'http://127.0.0.1:5173/';
const validFixture = JSON.parse(await readFile(new URL('../tests/fixtures/save-v1-fresh.json', import.meta.url), 'utf8'));
validFixture.savedAtMs = Date.now();
const validRaw = JSON.stringify(validFixture);
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const setVisibility = (page, hidden) => page.evaluate(isHidden => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: isHidden });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);
try {
  let context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(({ key, value }) => {
    if (sessionStorage.getItem('__phase0Seeded') !== 'yes') {
      localStorage.setItem(key, value);
      sessionStorage.setItem('__phase0Seeded', 'yes');
    }
  }, { key: 'taskbar-legends:v1', value: raw });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  await page.getByRole('heading', { name: 'Save could not be loaded' }).waitFor();
  await page.waitForTimeout(5500);
  assert.equal(await page.evaluate(() => localStorage.getItem('taskbar-legends:v1')), raw, 'autosave must not overwrite primary raw bytes');
  assert.equal(await page.evaluate(() => localStorage.getItem('taskbar-legends:v1:failed')), raw, 'quarantine copy must exist');
  await page.reload();
  await page.getByRole('heading', { name: 'Save could not be loaded' }).waitFor();
  await setVisibility(page, true);
  assert.equal(await page.evaluate(() => localStorage.getItem('taskbar-legends:v1')), raw, 'hidden recovery must not write the save');
  assert.equal(await page.evaluate(() => localStorage.getItem('taskbar-legends:v1:failed')), raw, 'hidden recovery must retain quarantine');
  await setVisibility(page, false);
  await page.getByRole('heading', { name: 'Save could not be loaded' }).waitFor();
  await page.waitForTimeout(5500);
  assert.equal(await page.evaluate(() => localStorage.getItem('taskbar-legends:v1')), raw, 'hide/show recovery must not enable autosave');
  assert.equal(await page.evaluate(() => localStorage.getItem('taskbar-legends:v1:failed')), raw, 'hide/show must retain quarantine bytes');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export original save' }).click();
  const download = await downloadPromise;
  const path = await download.path();
  assert.equal(await readFile(path, 'utf8'), raw, 'download must contain exact original bytes');
  await page.getByRole('button', { name: 'Discard save and start fresh' }).click();
  await page.getByRole('heading', { name: 'Save could not be loaded' }).waitFor({ state: 'hidden' });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('taskbar-legends:v1') ?? 'null')?.format === 'taskbar-legends-save-v2');
  assert.equal(await page.evaluate(() => localStorage.getItem('taskbar-legends:v1:failed')), null, 'explicit discard clears quarantine');
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  await context.close(); context = await browser.newContext({ acceptDownloads: true });
  const denied = await context.newPage();
  const deniedErrors = [];
  denied.on('pageerror', error => deniedErrors.push(error.message));
  await denied.addInitScript(({ key, value }) => {
    let prototype = window, descriptor;
    while (prototype && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(prototype, 'localStorage'); prototype = Object.getPrototypeOf(prototype); }
    if (!descriptor?.get) throw new Error('Could not capture native localStorage getter');
    const backing = descriptor.get.call(window);
    backing.setItem(key, value);
    let denials = 2; // audio's settings read and the first save-store operation
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { if (denials-- > 0) throw new DOMException('Storage denied by test', 'SecurityError'); return backing; },
    });
  }, { key: 'taskbar-legends:v1', value: raw });
  await denied.goto(baseUrl);
  await denied.getByRole('heading', { name: 'Save could not be loaded' }).waitFor();
  const recoveredDownloadPromise = denied.waitForEvent('download');
  await denied.getByRole('button', { name: 'Export original save' }).click();
  const recoveredDownload = await recoveredDownloadPromise;
  assert.equal(await readFile(await recoveredDownload.path(), 'utf8'), raw, 'primary bytes must remain exportable after transient access failure');
  assert.deepEqual(deniedErrors, [], `denied-storage browser errors: ${deniedErrors.join('; ')}`);
  await context.close(); context = await browser.newContext({ acceptDownloads: true });
  const blocked = await context.newPage();
  const blockedErrors = [];
  blocked.on('pageerror', error => blockedErrors.push(error.message));
  await blocked.addInitScript(() => Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('Storage denied by test', 'SecurityError'); },
  }));
  await blocked.goto(baseUrl);
  await blocked.getByRole('heading', { name: 'Save could not be loaded' }).waitFor();
  await blocked.getByRole('button', { name: 'Export original save' }).click();
  await blocked.getByRole('button', { name: 'Discard save and start fresh' }).click();
  await blocked.getByRole('heading', { name: 'Save could not be loaded' }).waitFor();
  assert.deepEqual(blockedErrors, [], `permanently denied-storage browser errors: ${blockedErrors.join('; ')}`);
  await context.close(); context = await browser.newContext({ acceptDownloads: true });
  const retry = await context.newPage();
  const retryErrors = [];
  retry.on('pageerror', error => retryErrors.push(error.message));
  await retry.addInitScript(({ key, value }) => {
    let prototype = window, descriptor;
    while (prototype && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(prototype, 'localStorage'); prototype = Object.getPrototypeOf(prototype); }
    const backing = descriptor.get.call(window);
    backing.setItem(key, value);
    let failed = true;
    const proxy = new Proxy(backing, { get(target, property) {
      if (property === 'getItem') return storageKey => {
        if (storageKey === key && failed) { failed = false; throw new DOMException('Transient read failure', 'SecurityError'); }
        return backing.getItem(storageKey);
      };
      const valueAtKey = Reflect.get(target, property, target);
      return typeof valueAtKey === 'function' ? valueAtKey.bind(target) : valueAtKey;
    } });
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => proxy });
  }, { key: 'taskbar-legends:v1', value: validRaw });
  await retry.goto(baseUrl);
  await retry.getByRole('heading', { name: 'Save could not be loaded' }).waitFor();
  await setVisibility(retry, true);
  await retry.getByRole('heading', { name: 'Save could not be loaded' }).waitFor();
  await setVisibility(retry, false);
  await retry.getByRole('heading', { name: 'Save could not be loaded' }).waitFor({ state: 'hidden' });
  await retry.waitForFunction(() => window.__game?.getState().tick >= 200);
  const originalRosterIds = validFixture.state.roster.map(hero => hero.id);
  assert.deepEqual(await retry.evaluate(() => window.__game.getState().roster.map(hero => hero.id)), originalRosterIds);
  assert.equal(await retry.evaluate(() => window.__game.getState().highestCleared), validFixture.state.highestCleared);
  await retry.waitForTimeout(5500);
  assert.equal(await retry.evaluate(() => JSON.parse(localStorage.getItem('taskbar-legends:v1')).format), 'taskbar-legends-save-v2', 'successful retry should resume autosaving');
  assert.deepEqual(retryErrors, [], `transient valid-save recovery errors: ${retryErrors.join('; ')}`);
  await context.close(); context = await browser.newContext({ acceptDownloads: true });
  const audioDenied = await context.newPage();
  const audioDeniedErrors = [];
  audioDenied.on('pageerror', error => audioDeniedErrors.push(error.message));
  await audioDenied.addInitScript(({ key, value }) => {
    const backingGetter = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem');
    const nativeGetter = (() => { let p = window, d; while (p && !d) { d = Object.getOwnPropertyDescriptor(p, 'localStorage'); p = Object.getPrototypeOf(p); } return d.get; })();
    const backing = nativeGetter.call(window); backing.setItem(key, value);
    const proxy = new Proxy(backing, { get(target, property) {
      if (property === 'getItem') return storageKey => { if (storageKey === 'taskbar-legends:audio') throw new DOMException('Audio preference read denied', 'SecurityError'); return backingGetter.value.call(target, storageKey); };
      const valueAtKey = Reflect.get(target, property, target);
      return typeof valueAtKey === 'function' ? valueAtKey.bind(target) : valueAtKey;
    } });
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => proxy });
  }, { key: 'taskbar-legends:v1', value: raw });
  await audioDenied.goto(baseUrl);
  await audioDenied.getByRole('heading', { name: 'Save could not be loaded' }).waitFor();
  assert.deepEqual(audioDeniedErrors, [], `audio preference read error: ${audioDeniedErrors.join('; ')}`);
  console.log('PASS: corrupt raw save survives autosave/reload/true hidden-visible transitions; exact export downloads; explicit discard enables fresh v2 save; transient valid-save recovery restores account and autosaves; transient/permanent localStorage and audio preference failures reach recovery without uncaught errors.');
  await context.close();
} finally {
  await browser.close();
}
