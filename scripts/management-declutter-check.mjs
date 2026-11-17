/* global window, document, process, console, innerWidth, getComputedStyle */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.MANAGEMENT_BASE_URL ?? 'http://127.0.0.1:5173/';
const executablePath = process.env.CHROMIUM_EXECUTABLE_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(baseUrl);
  await page.waitForFunction(() => !!window.__game && !!window.__management);
  await page.evaluate(async () => {
    await window.__game.whenReady();
    const state = window.__game.getState();
    for (const id of ['hk1', 'fw', 'mk1', 'ew3']) if (!state.roster.some(hero => hero.id === id)) state.roster.push({ id, level: 1, xp: 0, stars: 1, equipment: { weapon: null, armor: null, charm: null } });
    window.__game.load(state); window.__game.resume();
  });
  await page.locator('#compact-menu-button').click();
  await page.locator('#management').waitFor({ state: 'visible' });
  await page.locator('nav [data-tab="formation"]').click();
  await page.locator('#management').screenshot({ path: 'artifacts/management-formation-960.png' });
  const bounds = await page.evaluate(() => {
    const root = document.querySelector('#management'), view = root.querySelector('.px-formation-view');
    const actions = root.querySelector('.px-formation-assign'); return { viewport: innerWidth, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, view: view.getBoundingClientRect().toJSON(), slots: [...root.querySelectorAll('[data-party-slot]')].map(node => node.getBoundingClientRect().toJSON()), roster: root.querySelector('[data-scroll="formation-roster"]').getBoundingClientRect().toJSON(), actions: { text: actions.innerText, bounds: actions.getBoundingClientRect().toJSON(), position: getComputedStyle(actions).position } };
  });
  assert.ok(bounds.slots.length === 3);
  assert.ok(bounds.slots[0].width > 100, `slots too narrow: ${JSON.stringify(bounds.slots)}`);
  const before = await page.evaluate(() => window.__management.snapshot().partyIds);
  const slot0 = page.locator('[data-party-slot="0"]'), slot2 = page.locator('[data-party-slot="2"]');
  let transitionBefore = await page.evaluate(() => window.__management.snapshot().partyIds);
  let transitionBox = await slot0.boundingBox();
  await page.mouse.move(transitionBox.x + transitionBox.width / 2, transitionBox.y + transitionBox.height / 2); await page.mouse.down();
  await page.mouse.move(transitionBox.x + transitionBox.width / 2 + 12, transitionBox.y + transitionBox.height / 2);
  await page.locator('nav [data-tab="recruit"]').focus(); await page.keyboard.press('Enter'); await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => window.__management.snapshot().partyIds), transitionBefore, 'tab change cancels an active drag');
  await page.locator('nav [data-tab="formation"]').click();
  transitionBox = await page.locator('[data-party-slot="0"]').boundingBox();
  await page.mouse.move(transitionBox.x + transitionBox.width / 2, transitionBox.y + transitionBox.height / 2); await page.mouse.down();
  await page.mouse.move(transitionBox.x + transitionBox.width / 2 + 12, transitionBox.y + transitionBox.height / 2);
  await page.locator('nav [data-tab="heroes"]').focus(); await page.keyboard.press('Enter'); await page.mouse.up();
  assert.deepEqual(await page.evaluate(() => window.__management.snapshot().partyIds), transitionBefore, 'workspace change cancels an active drag');
  await page.locator('nav [data-tab="formation"]').click();
  const frontHelp = page.locator('[data-party-slot="0"]'), rearHelp = page.locator('[data-party-slot="2"]');
  let hoverBox = await frontHelp.boundingBox(); await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2);
  await page.waitForFunction(() => document.querySelector('[data-party-slot="0"]')?.getAttribute('aria-describedby') === 'px-management-tooltip');
  hoverBox = await rearHelp.boundingBox(); await page.mouse.move(hoverBox.x + hoverBox.width / 2, hoverBox.y + hoverBox.height / 2); await page.waitForTimeout(300);
  assert.equal(await frontHelp.getAttribute('aria-describedby'), null, 'moving hover removes the old anchor description');
  assert.equal(await rearHelp.getAttribute('aria-describedby'), 'px-management-tooltip', 'moving hover describes the new anchor');
  await page.mouse.move(500, 550); await page.waitForTimeout(180);
  await page.waitForFunction(() => document.querySelector('#px-management-tooltip')?.hidden === true);
  assert.equal(await rearHelp.getAttribute('aria-describedby'), null, 'outside tap clears tooltip description');
  const start = await slot0.boundingBox(), end = await slot2.boundingBox();
  const tickBefore = await page.evaluate(() => window.__game.getState().tick);
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down(); await page.mouse.move(start.x + start.width / 2 + 16, start.y + start.height / 2, { steps: 2 });
  await page.waitForTimeout(260);
  const tickDuringDrag = await page.evaluate(() => window.__game.getState().tick);
  assert.ok(tickDuringDrag > tickBefore, 'simulation advances while a drag gesture is active');
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(([a, c]) => { const ids = window.__management.snapshot().partyIds; return ids[0] === c && ids[2] === a; }, [before[0], before[2]], { timeout: 3000 });
  const afterSlotSwap = await page.evaluate(() => window.__management.snapshot().partyIds);
  assert.deepEqual(afterSlotSwap, [before[2], before[1], before[0]], 'real slot drag swaps through authority');
  const afterFirstDragRevision = await page.evaluate(() => window.__management.snapshot().revision);
  await page.locator('[data-party-slot="2"]').click();
  assert.equal(await page.locator('[data-party-slot="2"]').getAttribute('aria-pressed'), 'true', 'a deliberate click right after dragging still selects a slot');
  assert.equal(await page.evaluate(() => window.__management.snapshot().revision), afterFirstDragRevision, 'slot selection has no gameplay command');
  const noOpRevision = await page.evaluate(() => window.__management.snapshot().revision);
  const same = await slot0.boundingBox(); await page.mouse.move(same.x + same.width / 2, same.y + same.height / 2); await page.mouse.down();
  await page.mouse.move(same.x + same.width / 2 + 12, same.y + same.height / 2); await page.mouse.up();
  assert.equal(await page.evaluate(() => window.__management.snapshot().revision), noOpRevision, 'same-slot drop has no command');
  const outsideStart = await slot0.boundingBox(); await page.mouse.move(outsideStart.x + outsideStart.width / 2, outsideStart.y + outsideStart.height / 2); await page.mouse.down();
  await page.mouse.move(500, 20, { steps: 4 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => window.__management.snapshot().revision), noOpRevision, 'drop outside the menu has no command');
  await page.mouse.move(outsideStart.x + outsideStart.width / 2, outsideStart.y + outsideStart.height / 2); await page.mouse.down();
  await page.mouse.move(outsideStart.x + outsideStart.width / 2 + 12, outsideStart.y + outsideStart.height / 2); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(await page.evaluate(() => window.__management.snapshot().revision), noOpRevision, 'Escape cancels the drag');
  const bench = page.locator('[data-drag-hero="hk1"]'), middle = page.locator('[data-party-slot="1"]');
  await bench.scrollIntoViewIfNeeded();
  const benchBox = await bench.boundingBox(), middleBox = await middle.boundingBox(), beforeReplace = await page.evaluate(() => window.__management.snapshot().partyIds);
  await page.mouse.move(benchBox.x + benchBox.width / 2, benchBox.y + benchBox.height / 2); await page.mouse.down();
  await page.mouse.move(middleBox.x + middleBox.width / 2, middleBox.y + middleBox.height / 2, { steps: 5 }); await page.mouse.up();
  await page.waitForFunction(ids => window.__management.snapshot().partyIds[1] === ids[0], ['hk1']);
  assert.notEqual((await page.evaluate(() => window.__management.snapshot().partyIds))[1], beforeReplace[1]);
  const staleStart = await page.locator('[data-party-slot="0"]').boundingBox();
  await page.mouse.move(staleStart.x + staleStart.width / 2, staleStart.y + staleStart.height / 2); await page.mouse.down();
  await page.mouse.move(staleStart.x + staleStart.width / 2 + 12, staleStart.y + staleStart.height / 2); await page.waitForTimeout(240);
  const external = await page.evaluate(async () => {
    const snap = window.__management.snapshot(), ids = [...snap.partyIds]; [ids[0], ids[2]] = [ids[2], ids[0]];
    const reply = await window.__management.execute({ clientId: 'formation-browser-check', requestId: 'external-reorder', expectedRevision: snap.revision, action: { type: 'party', heroIds: ids } });
    return { ids, revision: reply.snapshot.revision };
  });
  await page.waitForTimeout(280);
  const staleTarget = await page.locator('[data-party-slot="2"]').boundingBox(); await page.mouse.move(staleTarget.x + staleTarget.width / 2, staleTarget.y + staleTarget.height / 2); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.management-status').textContent.includes('changed while dragging'));
  assert.deepEqual(await page.evaluate(() => window.__management.snapshot().partyIds), external.ids, 'stale gesture leaves the intervening party command intact');
  const beforeKeyboard = await page.evaluate(() => window.__management.snapshot().partyIds);
  const keyboardHero = page.locator('[data-hero="fw"]'); await keyboardHero.scrollIntoViewIfNeeded(); await keyboardHero.focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(ids => window.__management.snapshot().partyIds[2] === 'fw' && window.__management.snapshot().partyIds[0] === ids[0], beforeKeyboard);
  const keyboardSlot = page.locator('[data-party-slot="1"]'); await keyboardSlot.focus(); await page.keyboard.press('Enter');
  const keyboardBenchHero = page.locator('[data-hero="ew3"]'); await keyboardBenchHero.scrollIntoViewIfNeeded(); await keyboardBenchHero.focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__management.snapshot().partyIds[1] === 'ew3', undefined, { timeout: 3000 });
  const formationEquip = page.locator('[data-control="formation-equip-fw"]'); await formationEquip.focus(); await page.keyboard.press('Enter');
  await page.locator('[data-view="equip"] [data-equip-slot="weapon"]').waitFor();
  for (const slotName of ['armor', 'charm', 'weapon']) {
    const slotButton = page.locator(`[data-view="equip"] [data-control="equip-slot-${slotName}"]`);
    await slotButton.focus(); await page.keyboard.press('Enter');
    assert.equal(await slotButton.getAttribute('aria-pressed'), 'true', `keyboard selects ${slotName} slot after Formation Equip`);
  }
  await page.locator('[data-view="equip"] [data-control="equip-back"]').focus(); await page.keyboard.press('Enter');
  await page.locator('[data-view="formation"] [data-control="formation-equip-fw"]').waitFor();
  const formationDetails = page.locator('[data-control="formation-detail-fw"]'); await formationDetails.focus(); await page.keyboard.press('Enter');
  await page.locator('.px-v2-detail').waitFor();
  await page.locator('[data-details-close]').focus(); await page.keyboard.press('Enter');
  await page.locator('[data-view="formation"] [data-control="formation-detail-fw"]').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-control')), 'formation-detail-fw', 'Back restores keyboard focus to the Formation detail opener');
  await page.locator('[data-help-toggle]').focus();
  const help = page.locator('#px-management-tooltip');
  await help.waitFor({ state: 'visible' });
  const tooltipBox = await help.boundingBox();
  assert.ok(tooltipBox.x >= 0 && tooltipBox.y >= 0 && tooltipBox.x + tooltipBox.width <= 960 && tooltipBox.y + tooltipBox.height <= page.viewportSize().height, `tooltip outside viewport: ${JSON.stringify(tooltipBox)}`);
  await page.keyboard.press('Escape'); await help.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('[data-help-toggle]').getAttribute('aria-describedby'), null, 'Escape removes aria-describedby');
  const formationHelpToggle = page.locator('[data-help-toggle]').first();
  await formationHelpToggle.evaluate(node => node.click()); await help.waitFor({ state: 'visible' });
  await page.locator('#compact-menu-button').focus(); await page.keyboard.press('Escape');
  await help.waitFor({ state: 'hidden' });
  assert.equal(await formationHelpToggle.getAttribute('aria-describedby'), null, 'Escape outside management clears pinned tooltip description');
  await formationHelpToggle.evaluate(node => node.click()); await help.waitFor({ state: 'visible' });
  await page.mouse.click(500, 20); await help.waitFor({ state: 'hidden' });
  assert.equal(await formationHelpToggle.getAttribute('aria-describedby'), null, 'document outside click clears pinned tooltip description');
  await formationHelpToggle.evaluate(node => node.click()); await help.waitFor({ state: 'visible' });
  await page.locator('nav [data-tab="formation"]').click();
  await page.waitForFunction(() => document.querySelector('#px-management-tooltip')?.hidden === true);
  assert.equal(await formationHelpToggle.getAttribute('aria-describedby'), null, 'tab change clears pinned tooltip description');
  await page.locator('#management').screenshot({ path: 'artifacts/management-formation-960-after.png' });
  const viewportChecks = [];
  for (const width of [960, 1280]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 640 });
    await page.locator('#management').screenshot({ path: `artifacts/management-formation-${width}.png` });
    viewportChecks.push(await page.evaluate(() => ({ width: innerWidth, root: document.querySelector('#management').getBoundingClientRect().toJSON(), scrollWidth: document.querySelector('#management').scrollWidth })));
  }
  const touchContext = await browser.newContext({ viewport: { width: 960, height: 640 }, hasTouch: true, isMobile: true });
  try {
    const touchPage = await touchContext.newPage(); await touchPage.goto(baseUrl);
    await touchPage.waitForFunction(() => !!window.__game && !!window.__management);
    await touchPage.evaluate(async () => {
      await window.__game.whenReady(); const state = window.__game.getState();
      for (const id of ['hk1', 'fw', 'mk1', 'ew3']) if (!state.roster.some(hero => hero.id === id)) state.roster.push({ id, level: 1, xp: 0, stars: 1, equipment: { weapon: null, armor: null, charm: null } });
      const { CONFIG } = await import('/src/config.ts');
      for (const definition of CONFIG.heroes) if (!state.roster.some(hero => hero.id === definition.id)) state.roster.push({ id: definition.id, level: 1, xp: 0, stars: 1, equipment: { weapon: null, armor: null, charm: null } });
      window.__game.load(state);
    });
    await touchPage.evaluate(() => document.querySelector('#compact-menu-button').click()); await touchPage.locator('nav [data-tab="formation"]').waitFor(); await touchPage.locator('nav [data-tab="formation"]').evaluate(node => node.click());
    const cdp = await touchContext.newCDPSession(touchPage);
    await touchPage.evaluate(() => { window.__touchLog = []; for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture']) document.addEventListener(type, event => window.__touchLog.push({ type, pointerType: event.pointerType, id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target?.getAttribute?.('data-party-slot') ?? event.target?.getAttribute?.('data-drag-grip') ?? event.target?.className }), true); });
    const firstCard = touchPage.locator('.px-formation-roster [data-drag-hero]').first();
    const swipeBox = await firstCard.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: swipeBox.x + swipeBox.width / 2, y: swipeBox.y + swipeBox.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: swipeBox.x + swipeBox.width / 2, y: swipeBox.y + swipeBox.height / 2 - 50 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touchPage.waitForFunction(() => document.querySelector('[data-scroll="formation-roster"]').scrollTop > 0, undefined, { timeout: 2500 }).catch(async () => { console.log('touch scroll debug', await touchPage.evaluate(() => ({ scroll: document.querySelector('[data-scroll="formation-roster"]').scrollTop, height: document.querySelector('[data-scroll="formation-roster"]').clientHeight, content: document.querySelector('[data-scroll="formation-roster"]').scrollHeight, log: window.__touchLog }))); throw new Error('touch swipe did not scroll Formation roster'); });
    const roster = touchPage.locator('[data-scroll="formation-roster"]'), rosterBox = await roster.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rosterBox.x + rosterBox.width / 2, y: rosterBox.y + 34 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rosterBox.x + rosterBox.width / 2, y: rosterBox.y + 124 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touchPage.waitForFunction(() => document.querySelector('[data-scroll="formation-roster"]').scrollTop === 0, undefined, { timeout: 2500 });
    const grip = touchPage.locator('[data-drag-grip="fw"]');
    let gripBox = null, stable = 0, priorBox = null, gripHit = false, priorScroll = -1;
    for (let attempt = 0; attempt < 20 && stable < 3; attempt += 1) {
      gripBox = await grip.boundingBox();
      gripHit = gripBox ? await touchPage.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-drag-grip]')?.getAttribute('data-drag-grip') === 'fw', { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 }) : false;
      const scrollTop = await roster.evaluate(node => node.scrollTop);
      if (gripBox && priorBox && Math.abs(gripBox.x - priorBox.x) < .5 && Math.abs(gripBox.y - priorBox.y) < .5 && scrollTop === priorScroll && gripHit) stable += 1; else stable = 0;
      priorScroll = scrollTop;
      priorBox = gripBox; await touchPage.waitForTimeout(80);
    }
    if (!(gripBox && stable >= 3 && gripHit)) await touchPage.screenshot({ path: 'artifacts/management-touch-failure.png' });
    assert.ok(gripBox && stable >= 3 && gripHit, `stable visible grip center must hit the explicit touch handle before dispatch; ${JSON.stringify({ gripBox, stable, gripHit, scrollTop: await touchPage.locator('[data-scroll="formation-roster"]').evaluate(node => node.scrollTop), grips: await touchPage.locator('[data-drag-grip]').evaluateAll(nodes => nodes.map(node => ({ id: node.getAttribute('data-drag-grip'), rect: node.getBoundingClientRect().toJSON(), parent: node.parentElement?.outerHTML.slice(0, 160) }))), hit: gripBox ? await touchPage.evaluate(({ x, y }) => ({ tag: document.elementFromPoint(x, y)?.tagName, cls: document.elementFromPoint(x, y)?.className, grip: document.elementFromPoint(x, y)?.closest('[data-drag-grip]')?.getAttribute('data-drag-grip') }), { x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 }) : null })}`);
    const touchTarget = await touchPage.locator('[data-party-slot="1"]').boundingBox();
    const beforeTouch = await touchPage.evaluate(() => window.__management.snapshot().partyIds);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gripBox.x + gripBox.width / 2, y: gripBox.y + gripBox.height / 2 }] });
    for (let i = 1; i <= 5; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: gripBox.x + gripBox.width / 2 + (touchTarget.x + touchTarget.width / 2 - gripBox.x - gripBox.width / 2) * i / 5, y: gripBox.y + gripBox.height / 2 + (touchTarget.y + touchTarget.height / 2 - gripBox.y - gripBox.height / 2) * i / 5 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touchPage.waitForFunction(() => window.__management.snapshot().partyIds[1] === 'fw', undefined, { timeout: 3000 }).catch(async () => { console.log('touch result', await touchPage.evaluate(() => ({ party: window.__management.snapshot().partyIds, status: document.querySelector('.management-status').textContent, scrollTop: document.querySelector('[data-scroll="formation-roster"]').scrollTop, log: window.__touchLog }))); throw new Error('touch grip did not assign'); });
    assert.notEqual((await touchPage.evaluate(() => window.__management.snapshot().partyIds))[1], beforeTouch[1], 'explicit touch grip replaces a slot');
  } finally { await touchContext.close(); }
  await page.setViewportSize({ width: 960, height: 640 });
  await page.locator('nav [data-tab="recruit"]').click();
  await page.screenshot({ path: 'artifacts/management-recruit-960.png' });
  await page.locator('[data-control="recruit-help"]').focus();
  await help.waitFor({ state: 'visible' });
  assert.match(await help.innerText(), /Epic\+ guaranteed/);
  await page.keyboard.press('Escape');
  await page.locator('nav [data-tab="settings"]').click();
  await page.screenshot({ path: 'artifacts/management-settings-960.png' });
  assert.equal(await page.locator('.px-offline-summary p').count(), 2, 'offline summary separates its farm rate and carryover note');
  assert.equal(await page.locator('[data-slider="music"]').isVisible(), true, 'music slider is visible in the grouped audio panel');
  assert.equal(await page.locator('[data-slider="sfx"]').isVisible(), true, 'SFX slider is visible in the grouped audio panel');
  assert.equal(await page.locator('[data-slider="ui"]').isVisible(), true, 'UI slider is visible in the grouped audio panel');
  assert.match(await page.locator('.px-offline-summary').innerText(), /Partial gold, XP, tickets, and chest progress carry/);
  const recoveryHelp = page.locator('[data-control="recovery-help"]');
  await recoveryHelp.focus(); await help.waitFor({ state: 'visible' });
  await page.locator('#management [data-close]').click();
  assert.equal(await recoveryHelp.getAttribute('aria-describedby'), null, 'closing management clears tooltip description');
  await help.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(async () => {
    const { ManagementView } = await import('/src/management/view.ts');
    const root = document.createElement('div'); root.id = 'management-app'; document.body.classList.add('management-window'); document.body.append(root);
    const client = {
      snapshot: async () => window.__management.snapshot(),
      execute: async (action, revision, requestId) => { const reply = await window.__management.execute({ clientId: 'native-standin', requestId, expectedRevision: revision, action }); return { ...reply, requestId }; },
      compare: async (heroId, gearId) => window.__management.compare(heroId, gearId),
      pause: async () => undefined,
      getAudio: async () => ({ muted: false, volume: .5, buses: { music: .5, sfx: .5, ui: .5 } }),
      setAudio: async () => undefined,
      getCompactPrefs: async () => ({ version: 1, sourceWidth: 640, sourceHeight: 160, zoom: 1, placement: 'free', anchorX: .5, anchorY: .5 }),
      setCompactPrefs: async () => undefined,
      close: () => undefined,
    };
    const view = new ManagementView(root, client, () => undefined, { variant: 'native' }); window.__nativeStandin = { root, view }; await view.open('formation');
  });
  await page.locator('#management-app nav [data-tab="formation"]').click();
  await page.locator('#management-app .px-formation-view').waitFor();
  const nativeCard = page.locator('#management-app [data-hero="ew3"]'); await nativeCard.focus();
  await page.locator('body > .px-tooltip:visible').last().waitFor({ state: 'visible' });
  const nativeTooltip = await page.locator('#management-app [data-hero="ew3"]').getAttribute('aria-describedby');
  const nativeTooltipBounds = await page.locator('body > .px-tooltip:visible').last().boundingBox();
  assert.ok(nativeTooltipBounds.x >= 0 && nativeTooltipBounds.y >= 0 && nativeTooltipBounds.x + nativeTooltipBounds.width <= 1280 && nativeTooltipBounds.y + nativeTooltipBounds.height <= 720, `native tooltip outside viewport: ${JSON.stringify(nativeTooltipBounds)}`);
  await page.locator('#management-app').screenshot({ path: 'artifacts/management-formation-native-1280x720.png' });
  await page.evaluate(() => { window.__nativeStandin.view.dispose(); document.body.classList.remove('management-window'); });
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`);
  console.log(JSON.stringify({ passed: true, bounds, before, afterSlotSwap, afterReplace: await page.evaluate(() => window.__management.snapshot().partyIds), staleExternal: external, tickBefore, tickDuringDrag, tooltip: tooltipBox, nativeTooltip, nativeTooltipBounds, viewportChecks }));
} finally { await browser.close(); }
