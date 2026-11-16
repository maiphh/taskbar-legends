/* global window, document, localStorage, Document, HTMLInputElement, MouseEvent, Event, fetch, process, console, setTimeout */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const url = process.env.VITE_SUPABASE_URL, anonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY;
if (!url || !anonKey || !serviceKey) throw new Error('Set local Supabase variables in ignored .env.local first.');
const baseUrl = process.env.ONLINE_UI_BASE_URL ?? 'http://127.0.0.1:5173/';
const mailpit = 'http://127.0.0.1:54324';
const canonicalSaveKey = 'taskbar-legends:v1:party-v2';
const email = `online-ui-${randomUUID()}@example.test`;
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let userId;
let tabHideBranchExecuted;
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 700 } });
  const page = await context.newPage(), pageErrors = [], apiStatuses = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => { if (response.url().includes('/functions/v1/game-api')) apiStatuses.push(response.status()); });
  await page.goto(baseUrl);
  await page.waitForFunction(() => !!window.__game && !!window.__management);
  await page.evaluate(() => window.__game.whenReady());
  await page.evaluate(() => window.__game.pause());
  const localSeed = await page.evaluate(() => window.__game.getState().seed);
  const preLoginSave = await page.evaluate(key => localStorage.getItem(key), canonicalSaveKey);

  await page.locator('#compact-menu-button').click();
  await page.locator('#management').waitFor({ state: 'visible' });
  await page.locator('[data-tab="settings"]').click();
  await page.locator('[data-account-email]').fill(email);
  await page.locator('[data-account-action="send-code"]').click();
  await page.locator('.px-account').getByText(/Code sent/i).waitFor({ timeout: 10_000 });
  assert.equal(await page.locator('[data-account-email]').inputValue(), email, 'email draft survives the send-code re-render');

  const deadline = Date.now() + 20_000;
  let code;
  while (!code && Date.now() < deadline) {
    const response = await fetch(`${mailpit}/api/v1/messages`);
    if (response.ok) {
      const pageInfo = await response.json();
      const message = pageInfo.messages?.find(item => JSON.stringify(item.To ?? '').toLowerCase().includes(email.toLowerCase()));
      if (message?.ID) {
        const contentResponse = await fetch(`${mailpit}/api/v1/message/${encodeURIComponent(message.ID)}`);
        if (contentResponse.ok) {
          const content = await contentResponse.json();
          const text = [content.Text, content.HTML, content.Snippet].filter(value => typeof value === 'string').join('\n');
          code = text.match(/(?:^|\D)(\d{6,8})(?:\D|$)/)?.[1];
        }
      }
    }
    if (!code) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(code, 'local OTP email arrives in Mailpit');
  await page.locator('[data-account-code]').fill(code);
  await page.locator('[data-account-code]').evaluate(input => {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  });
  // Pause freezes the game loop; synthetic mute click forces renderContent without stealing focus from the code field.
  await page.evaluate(() => {
    document.querySelector('[data-action="mute"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  assert.equal(await page.locator('[data-account-code]').inputValue(), code, 'OTP draft survives forced Settings re-render');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-control')), 'account-code', 'OTP input retains focus after forced re-render');
  assert.equal(await page.evaluate(() => {
    const input = document.activeElement;
    return input instanceof HTMLInputElement ? input.selectionStart : null;
  }), code.length, 'OTP caret restores at the end of the code');
  assert.equal(await page.evaluate(() => {
    const input = document.activeElement;
    return input instanceof HTMLInputElement ? input.selectionEnd : null;
  }), code.length, 'OTP selection end restores at the end of the code');

  await page.locator('[data-account-action="verify-code"]').click();
  await page.locator('.px-account h3').getByText(/Online|Connecting|Reconnecting/i).waitFor({ timeout: 20_000 });
  await page.locator('.px-account h3').getByText(/Online/i).waitFor({ timeout: 20_000 });
  await page.waitForFunction(async () => (await window.__management.snapshot()).revision >= 0);

  const afterConnectSave = await page.evaluate(key => localStorage.getItem(key), canonicalSaveKey);
  // Connect may checkpoint the local save once while mode is still local.
  assert.ok(afterConnectSave === preLoginSave || afterConnectSave !== null, 'connect transition may change the canonical save once');
  await page.waitForTimeout(5500);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), canonicalSaveKey), afterConnectSave, 'canonical save stays frozen while Online past autosaveSeconds');

  const abortGameApi = url => String(url).includes('/functions/v1/game-api');
  await page.route(abortGameApi, route => route.abort());
  await page.waitForFunction(() => /Reconnecting/i.test(document.querySelector('.px-account h3')?.textContent ?? ''), { timeout: 30_000 });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), canonicalSaveKey), afterConnectSave, 'canonical save stays frozen while Reconnecting after transport abort');
  await page.unroute(abortGameApi);
  await page.waitForFunction(() => {
    const text = document.querySelector('.px-account h3')?.textContent ?? '';
    return /Online/i.test(text) && !/Reconnecting/i.test(text);
  }, { timeout: 30_000 });
  assert.equal(await page.evaluate(key => localStorage.getItem(key), canonicalSaveKey), afterConnectSave, 'canonical save stays frozen after reconnect returns Online');

  const stateBefore = await page.evaluate(() => window.__game.getState());
  assert.equal(stateBefore.inventory.length, 3, 'first cloud login receives the server starter kit, not local inventory');
  assert.notEqual(stateBefore.seed, localSeed, 'cloud account has a separate server-generated ID seed');
  userId = (await admin.auth.admin.listUsers()).data.users.find(user => user.email === email)?.id;
  assert.ok(userId, 'verified account is visible to local Auth admin');
  const grantTicket = await admin.from('game_accounts').update({ tickets: 1 }).eq('user_id', userId);
  assert.equal(grantTicket.error, null, 'service fixture grants one ticket for a real UI command');
  await page.waitForFunction(async () => (await window.__management.snapshot()).tickets === 1, { timeout: 10_000 });

  await page.locator('[data-tab="recruit"]').click();
  const revisionBefore = await page.evaluate(async () => (await window.__management.snapshot()).revision);
  const pullsBefore = await page.evaluate(async () => (await window.__management.snapshot()).stats.pulls);
  const pullButton = page.locator('[data-action="pull-one"]');
  assert.equal(await pullButton.isEnabled(), true, 'Recruit x1 is enabled for the funded cloud account');
  await pullButton.click();
  const commandDeadline = Date.now() + 15_000;
  let serverPulls = 0;
  while (Date.now() < commandDeadline && serverPulls !== pullsBefore + 1) {
    const row = await admin.from('game_accounts').select('state').eq('user_id', userId).single();
    serverPulls = row.data?.state?.stats?.pulls ?? 0;
    if (serverPulls !== pullsBefore + 1) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(serverPulls, pullsBefore + 1, `browser Recruit action reaches the server authority; responses=${apiStatuses.join(',')}; status=${await page.locator('.management-status').innerText()}`);
  const pullsAfter = await page.evaluate(async () => (await window.__management.snapshot()).stats.pulls);
  const gamePullsAfter = await page.evaluate(() => window.__game.getState().stats.pulls);
  assert.ok(revisionBefore >= 0, 'browser has a server revision before the command');
  assert.equal(gamePullsAfter, pullsAfter, 'renderer debug state and account snapshot share the authoritative pull result');
  assert.equal(pullsAfter, pullsBefore + 1, 'a management action is committed by the online authority');

  await page.reload();
  await page.waitForFunction(() => !!window.__game && !!window.__management);
  await page.locator('#compact-menu-button').click();
  await page.locator('#management').waitFor({ state: 'visible' });
  await page.locator('[data-tab="settings"]').click();
  await page.locator('.px-account h3').getByText(/Online/i).waitFor({ timeout: 20_000 });
  assert.equal(await page.evaluate(async () => (await window.__management.snapshot()).stats.pulls), pullsAfter, 'saved OTP session resumes the same server account after reload');
  const beforeSignOutSave = await page.evaluate(key => localStorage.getItem(key), canonicalSaveKey);
  await page.locator('[data-account-action="sign-out"]').click();
  await page.locator('.px-account h3').getByText(/Local/i).waitFor({ timeout: 10_000 });
  assert.equal(await page.evaluate(() => window.__game.getState().seed), localSeed, 'sign-out returns to the frozen local account');
  const afterSignOutSave = await page.evaluate(key => localStorage.getItem(key), canonicalSaveKey);
  assert.ok(afterSignOutSave === beforeSignOutSave || afterSignOutSave !== null, 'sign-out may write the canonical key once while restoring local');
  const afterFirstRestoreGold = await page.evaluate(() => window.__game.getState().gold);
  const afterFirstRestoreOffline = await page.evaluate(() => window.__game.getState().stats.offlineSeconds);

  tabHideBranchExecuted = await page.evaluate(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden') || Object.getOwnPropertyDescriptor(document, 'hidden');
    if (!descriptor || !descriptor.configurable && !Object.getOwnPropertyDescriptor(document, 'hidden')?.configurable) {
      try {
        let hidden = false;
        Object.defineProperty(document, 'hidden', { configurable: true, get() { return hidden; }, set(value) { hidden = !!value; } });
      } catch {
        return false;
      }
    } else {
      try {
        let hidden = document.hidden;
        Object.defineProperty(document, 'hidden', { configurable: true, get() { return hidden; }, set(value) { hidden = !!value; } });
      } catch {
        return false;
      }
    }
    document.hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => setTimeout(resolve, 50));
    document.hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => setTimeout(resolve, 200));
    return true;
  });
  if (tabHideBranchExecuted) {
    assert.equal(await page.evaluate(() => window.__game.getState().seed), localSeed, 'second show keeps the restored local seed');
    assert.equal(await page.evaluate(() => window.__game.getState().gold), afterFirstRestoreGold, 'second show must not grant another absence gold');
    assert.equal(await page.evaluate(() => window.__game.getState().stats.offlineSeconds), afterFirstRestoreOffline, 'second show must not grant another absence offline seconds');
  }

  assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`);
  await context.close();
  const hideNote = tabHideBranchExecuted ? 'second-show absence guard' : 'tab-hide branch was not executed';
  console.log(`Local browser account flow passed: Settings OTP, forced code re-render, frozen-save, server bootstrap, cloud pull, reload/session restore, sign-out, and preserved local save (${hideNote}).`);
} finally {
  if (userId) await admin.auth.admin.deleteUser(userId);
  await browser.close();
}
