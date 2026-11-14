/* global window, localStorage, console, process, document, URL */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.PHASE2_BASE_URL ?? 'http://127.0.0.1:5173/?combat=party-v2&compact=1';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 960, height: 360 } });
const errors = [];
// PixelUI dropdowns (ui/compact-menu.md §4) replace native <select>: open the 9-slice button, click the 20 px option row.
const pick = async (page, name, value) => {
  await page.locator(`[data-dd-toggle="${name}"]`).click();
  await page.locator(`[data-dd-option="${name}"][data-value="${value}"]`).click();
};
const picked = (page, name) => page.locator(`[data-dropdown="${name}"]`).getAttribute('data-value');
try {
  await context.addInitScript(() => {
    const active = new Set();
    const nativeSet = window.setInterval.bind(window), nativeClear = window.clearInterval.bind(window);
    window.setInterval = (callback, delay, ...args) => {
      const id = nativeSet(callback, delay, ...args);
      if (delay === 200) active.add(id);
      return id;
    };
    window.clearInterval = id => { active.delete(id); nativeClear(id); };
    Object.defineProperty(window, '__managementTimerCount', { get: () => active.size });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  await page.waitForFunction(() => !!window.__game && !!window.__management);
  const gearId = await page.evaluate(async () => {
    await window.__game.whenReady();
    window.__game.setSeed(2026);
    const state = window.__game.getState();
    state.tickets = 30;
    state.gold = 100000;
    const { itemId, gearTemplateId } = await import('/src/core/model.ts');
    const id = itemId(state.seed, state.nextGearId++);
    state.inventory.push({ id, templateId: gearTemplateId('weapon', 'common'), tradeable: false, acquiredAt: { tick: state.tick, source: 'starter' },
      slot: 'weapon', rarity: 'common', dropStage: 1, level: 0, spent: 0, stats: { hp: 0, atk: 3, def: 0, hpPct: 0.05, atkPct: 0.1, speedPct: 0.15 } });
    window.__game.load(state);
    window.__game.pause();
    return id;
  });

  await page.evaluate(() => localStorage.setItem('taskbar-legends:v1', 'legacy-account-marker'));
  const canvasSize = async () => page.locator('#game').evaluate(canvas => [canvas.width, canvas.height]);
  const initialCanvas = await canvasSize();
  const initialTickets = await page.evaluate(() => window.__management.snapshot().tickets);

  await page.locator('#compact-menu-button').click();
  await page.locator('#management').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => window.__managementTimerCount), 1, 'open starts one management poll timer');
  for (const tab of ['party', 'stash', 'recruit', 'upgrades', 'settings']) {
    await page.locator(`[data-tab="${tab}"]`).click();
    await page.locator('main h2').getByText(tab[0].toUpperCase() + tab.slice(1)).waitFor();
  }

  await page.locator('[data-tab="party"]').click();
  await pick(page, 'party-preset', 'fastFarm');
  await page.waitForFunction(() => window.__management.snapshot().partyPreset === 'fastFarm');
  let partySnapshot = await page.evaluate(() => window.__management.snapshot());
  assert.equal(partySnapshot.partyIds.length, 3);
  assert.ok(partySnapshot.partyIds.includes('mw2'), 'Fast farm selects its owned tank');
  assert.ok(partySnapshot.partyIds.includes('wiz'), 'Fast farm selects its owned AoE damage hero');
  await page.locator('[data-lock-hero="mw2"]').click();
  await page.waitForFunction(() => window.__management.snapshot().roster.find(hero => hero.id === 'mw2')?.partyLocked === true);
  await pick(page, 'party-preset', 'bossSustain');
  await page.waitForFunction(() => window.__management.snapshot().partyPreset === 'bossSustain');
  partySnapshot = await page.evaluate(() => window.__management.snapshot());
  assert.equal(partySnapshot.partyIds[0], 'mw2', 'preset change preserves the locked deployed slot');
  await page.evaluate(async () => {
    const state = window.__game.getState();
    for (const id of ['hk1', 'fw', 'mk1', 'ew3']) if (!state.roster.some(hero => hero.id === id)) state.roster.push({ id, level: 1, xp: 0, stars: 1, equipment: { weapon: null, armor: null, charm: null } });
    window.__game.load(state);
  });
  await page.waitForFunction(() => ['hk1', 'fw', 'mk1', 'ew3'].every(id => window.__management.snapshot().roster.some(hero => hero.id === id)));
  await page.locator('[data-hero="priest"]').click();
  assert.match(await page.locator('#management main').innerText(), /Restoration/);
  assert.match(await page.locator('#management main').innerText(), /Heal 180% ATK/);
  assert.match(await page.locator('#management main').innerText(), /Auto-casts on its next turn when ready/);
  await page.locator('[data-hero-detail="stats"]').click();
  assert.match(await page.locator('#management main').innerText(), /Turn SPD/);
  await page.locator('[data-hero-detail="items"]').click();
  assert.equal(await page.locator('#management [data-hero="priest"]').getAttribute('aria-pressed'), 'true', 'hero selection persists while switching detail tabs');
  assert.match(await page.locator('#management main').innerText(), /WEAPON/);
  assert.match(await page.locator('#management main').innerText(), /Inspect \/ Change in Stash/);
  await page.locator('[data-hero-detail="ability"]').click();
  await page.locator('[data-party-workspace="formation"]').click();
  const beforeSwap = await page.evaluate(() => window.__management.snapshot().partyIds);
  const secondStarter = beforeSwap[1];
  await page.locator(`[data-hero="${secondStarter}"]`).click();
  await page.locator('[data-party-slot="0"]').click();
  await page.locator('[data-assign]').click();
  await page.waitForFunction(([front, middle]) => { const ids = window.__management.snapshot().partyIds; return ids[0] === middle && ids[1] === front; }, [beforeSwap[0], secondStarter]);
  await page.locator('[data-party-workspace="heroes"]').click();
  await page.locator('[data-hero="mw2"]').click();

  await page.locator('[data-tab="recruit"]').click();
  const beforeRevision = await page.evaluate(() => window.__management.snapshot().revision);
  await page.locator('[data-action="pull-one"]').click();
  await page.waitForFunction(tickets => window.__management.snapshot().tickets === tickets - 1, initialTickets);
  const afterCommand = await page.evaluate(() => ({
    authority: window.__management.snapshot(),
    game: window.__game.getState(),
  }));
  assert.equal(afterCommand.authority.revision, beforeRevision + 1, 'one click produces one accepted command');
  assert.equal(afterCommand.game.tickets, afterCommand.authority.tickets, 'main game and management authority share the committed owner');
  assert.equal(afterCommand.game.stats.pulls, afterCommand.authority.stats.pulls);
  const beforeTick = afterCommand.game.tick;
  await page.evaluate(() => window.__game.step(20));
  assert.equal(await page.evaluate(() => window.__management.snapshot().tick), beforeTick + 20, 'later simulation steps continue on the same owner');

  await page.locator('[data-tab="recruit"]').click();
  const ticketsBeforeTen = await page.evaluate(() => window.__management.snapshot().tickets);
  const pullsBeforeTen = await page.evaluate(() => window.__management.snapshot().stats.pulls);
  await page.locator('[data-action="pull-ten"]').click();
  await page.waitForFunction(value => window.__management.snapshot().tickets === value - 10, ticketsBeforeTen);
  assert.equal(await page.evaluate(() => window.__management.snapshot().stats.pulls), pullsBeforeTen + 10, 'x10 recruitment commits ten real pulls');
  await page.locator('#management main ol li').first().waitFor({ state: 'attached' });
  await page.locator('[data-tab="recruit"]').click();
  await page.locator('#management main ol li').first().waitFor();

  await page.locator('[data-tab="stash"]').click();
  await pick(page, 'slot', 'weapon');
  const filter = page.locator('[data-dd-toggle="slot"]');
  await filter.focus();
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-dd-toggle')), 'slot', '5Hz snapshots preserve focused controls');
  assert.equal(await picked(page, 'slot'), 'weapon');
  await page.keyboard.press('Tab');
  assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute('data-dd-toggle')), 'slot', 'keyboard navigation advances from the persistent filter');

  await page.locator(`[data-gear="${gearId}"]`).click();
  assert.match(await page.locator('#management main').innerText(), /HP% 5 · ATK% 10 · speed 15%/, 'fractional gear percentages display as percent points');
  await pick(page, 'hero', 'mw2');
  await page.locator('main .px-deltas p', { hasText: /^ATK\s*\d+ → \d+/ }).waitFor();
  await page.locator('main').getByText(/Party utility gain/).waitFor();
  const compareDps = await page.evaluate(async id => {
    const value = window.__management.compare('mw2', id);
    const { partyBasicDpsForStats } = await import('/src/core/economy.ts');
    return { delta: value.delta.basicDps, expected: partyBasicDpsForStats('mw2', value.after) - partyBasicDpsForStats('mw2', value.before) };
  }, gearId);
  assert.ok(Math.abs(compareDps.delta - compareDps.expected) < 1e-9, 'gear comparison and Party panel share the same damage coefficient and realized cycle');
  await page.locator('[data-action="equip"]').click();
  await page.waitForFunction(id => window.__game.getState().roster.find(hero => hero.id === 'mw2').equipment.weapon === id, gearId);
  await page.locator('[data-action="upgrade"]').click();
  await page.waitForFunction(id => window.__game.getState().inventory.find(item => item.id === id).level === 1, gearId);
  await page.locator('[data-tab="upgrades"]').click();
  await page.locator(`[data-gear="${gearId}"]`).click();
  await page.locator('[data-action="upgrade"]').click();
  await page.waitForFunction(id => window.__management.snapshot().inventory.find(item => item.id === id).level === 2, gearId);

  await page.locator('[data-tab="settings"]').click();
  assert.match(await page.locator('#management main').innerText(), /use the game window recovery panel to export it or discard it/i, 'save recovery instructions tell players what to do');
  await page.locator('[data-action="pause"]').click();
  await page.waitForFunction(() => window.__management.snapshot().paused === false);
  await page.locator('[data-action="pause"]').click();
  await page.waitForFunction(() => window.__management.snapshot().paused === true);
  const mutedBefore = await page.evaluate(() => window.__game.getAudio().settings.muted);
  await page.locator('[data-action="mute"]').click();
  await page.waitForFunction(value => window.__game.getAudio().settings.muted !== value, mutedBefore);
  await page.locator('[data-zoom="2"]').click();
  await page.waitForFunction(() => window.__game.getLayout().zoom === 2);
  await page.locator('[data-zoom="1"]').click();
  await page.waitForFunction(() => window.__game.getLayout().zoom === 1);

  const root = page.locator('#management');
  await root.locator('[data-close]').click();
  await root.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__managementTimerCount), 0, 'close stops management polling immediately');
  const shellNodeCount = await root.locator('*').count();
  for (let i = 0; i < 100; i += 1) {
    await page.locator('#compact-menu-button').click();
    await root.waitFor({ state: 'visible' });
    await root.locator('[data-close]').click();
    await root.waitFor({ state: 'hidden' });
  }
  assert.equal(await root.locator('*').count(), shellNodeCount, 'reopen cycles reuse one DOM shell and listener set');
  assert.equal(await page.evaluate(() => window.__managementTimerCount), 0, '100 completed close cycles leave no poll timer');
  assert.deepEqual(await canvasSize(), initialCanvas, 'opening and closing management does not change canvas source size');
  await page.locator('#compact-menu-button').click();
  await page.locator('[data-tab="recruit"]').click();
  const ticketsBeforeSecondAction = await page.evaluate(() => window.__management.snapshot().tickets);
  const revisionBeforeSecondAction = await page.evaluate(() => window.__management.snapshot().revision);
  await page.locator('[data-action="pull-one"]').click();
  await page.waitForFunction(tickets => window.__management.snapshot().tickets === tickets - 1, ticketsBeforeSecondAction);
  assert.equal(await page.evaluate(() => window.__management.snapshot().revision), revisionBeforeSecondAction + 1, 'reopened view has one active click handler');

  await page.locator('[data-tab="stash"]').click();
  await pick(page, 'owner', 'mw1');
  assert.equal(await picked(page, 'owner'), 'mw1', 'owner filter retains its own selected value');
  assert.equal(await picked(page, 'hero'), 'mw2', 'comparison target remains independent from the owner filter');
  await pick(page, 'owner', 'mw2');
  assert.equal(await picked(page, 'owner'), 'mw2');
  await root.locator('[data-close]').click();
  await root.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__managementTimerCount), 0, 'close leaves no active poll before the deferred-response probe');

  // A pending initial snapshot resolved after close must not start an interval or render; reopening uses one timer.
  await page.evaluate(async () => {
    const { ManagementView } = await import('/src/management/view.ts');
    const root = document.createElement('section'); document.body.append(root);
    let calls = 0;
    window.__raceSnapshot = window.__management.snapshot();
    const client = {
      snapshot: () => { calls += 1; return calls === 1 ? new Promise(resolve => { window.__raceResolve = resolve; }) : Promise.resolve(window.__management.snapshot()); },
      execute: async () => { throw new Error('unused'); }, compare: async () => null, pause: async () => undefined,
      getAudio: async () => ({ muted: false, volume: 0.5 }), setAudio: async () => undefined,
      getCompactPrefs: async () => ({ version: 1, sourceWidth: 640, sourceHeight: 160, zoom: 1, placement: 'free', anchorX: 1, anchorY: 1 }),
      setCompactPrefs: async () => undefined, close: () => undefined,
    };
    window.__raceView = new ManagementView(root, client, () => { root.hidden = true; });
    window.__raceOpen = window.__raceView.open();
    window.__raceCalls = () => calls;
  });
  await page.waitForFunction(() => window.__raceCalls() === 1);
  await page.evaluate(() => { window.__raceView.close(); window.__raceResolve(window.__raceSnapshot); });
  await page.evaluate(() => window.__raceOpen);
  assert.equal(await page.evaluate(() => window.__managementTimerCount), 0, 'late snapshot cannot start a timer after close');
  await page.evaluate(() => window.__raceView.open());
  assert.equal(await page.evaluate(() => window.__managementTimerCount), 1, 'reopen after the late response starts exactly one timer');
  await page.evaluate(() => window.__raceView.dispose());
  assert.equal(await page.evaluate(() => window.__managementTimerCount), 0, 'dispose clears the reopened timer');
  await page.evaluate(() => document.querySelector('body > section:last-child')?.remove());

  const keys = await page.evaluate(() => ({
    normal: localStorage.getItem('taskbar-legends:v1'),
    preview: JSON.parse(localStorage.getItem('taskbar-legends:v1:party-v2') ?? 'null'),
  }));
  assert.equal(keys.normal, 'legacy-account-marker', 'preview leaves legacy save untouched');
  assert.equal(keys.preview.format, 'taskbar-legends-save-v2');
  assert.equal(keys.preview.state.combatRules, 'party-v2');
  const screenshots = [];
  for (const width of [480, 640, 960]) {
    const captureContext = await browser.newContext({ viewport: { width, height: 360 } });
    try {
      await captureContext.addInitScript(prefs => localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify(prefs)), {
        version: 1, sourceWidth: width, sourceHeight: 160, zoom: 1, placement: 'free', anchorX: 1, anchorY: 1,
      });
      const capture = await captureContext.newPage();
      await capture.goto(baseUrl);
      await capture.waitForFunction(() => !!window.__game);
      await capture.evaluate(() => window.__game.whenReady());
      assert.equal(await capture.evaluate(() => window.__game.getLayout().width), width, `source viewport ${width} is preserved`);
      screenshots.push(`shots/phase2-compact-${width}-closed.png`);
      await capture.screenshot({ path: screenshots.at(-1) });
      await capture.locator('#compact-menu-button').click();
      await capture.locator('#management').waitFor({ state: 'visible' });
      screenshots.push(`shots/phase2-compact-${width}-management.png`);
      await capture.screenshot({ path: screenshots.at(-1) });
      if (width === 480) {
        await capture.locator('[data-hero-detail="ability"]').click();
        screenshots.push('shots/phase2-hero-ability-480.png'); await capture.screenshot({ path: screenshots.at(-1) });
        await capture.locator('[data-hero-detail="stats"]').click();
        screenshots.push('shots/phase2-hero-stats-480.png'); await capture.screenshot({ path: screenshots.at(-1) });
        await capture.locator('[data-hero-detail="items"]').click();
        screenshots.push('shots/phase2-hero-items-480.png'); await capture.screenshot({ path: screenshots.at(-1) });
        await capture.locator('[data-party-workspace="formation"]').click();
        screenshots.push('shots/phase2-formation-480.png'); await capture.screenshot({ path: screenshots.at(-1) });
      }
    } finally { await captureContext.close(); }
  }
  const zoomContext = await browser.newContext({ viewport: { width: 960, height: 360 } });
  try {
    await zoomContext.addInitScript(prefs => localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify(prefs)), {
      version: 1, sourceWidth: 480, sourceHeight: 160, zoom: 2, placement: 'free', anchorX: 1, anchorY: 1,
    });
    const zoomPage = await zoomContext.newPage();
    await zoomPage.goto(baseUrl);
    await zoomPage.waitForFunction(() => !!window.__game);
    await zoomPage.evaluate(() => window.__game.whenReady());
    assert.equal(await zoomPage.evaluate(() => window.__game.getLayout().width), 480, '2x zoom retains the same source viewport');
    screenshots.push('shots/phase2-compact-480-zoom2.png');
    await zoomPage.screenshot({ path: screenshots.at(-1) });
  } finally { await zoomContext.close(); }
  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  assert.deepEqual(await page.evaluate(() => window.__game.getAssetErrors()), [], 'all assets load');
  await page.close();

  // Repeated menu operations and resize are presentation-only for an identical paused seed.
  const leftContext = await browser.newContext({ viewport: { width: 960, height: 360 } });
  const rightContext = await browser.newContext({ viewport: { width: 960, height: 360 } });
  try {
    const [left, right] = await Promise.all([leftContext.newPage(), rightContext.newPage()]);
    await Promise.all([left.goto(baseUrl), right.goto(baseUrl)]);
    await Promise.all([left.waitForFunction(() => !!window.__game), right.waitForFunction(() => !!window.__game)]);
    await Promise.all([left, right].map(candidate => candidate.evaluate(() => { window.__game.setSeed(97); window.__game.pause(); })));
    for (let i = 0; i < 100; i += 1) {
      await left.locator('#compact-menu-button').click();
      await left.locator('#management').waitFor({ state: 'visible' });
      await left.locator('#management [data-close]').click();
      await left.locator('#management').waitFor({ state: 'hidden' });
    }
    await left.setViewportSize({ width: 480, height: 360 });
    await Promise.all([left.evaluate(() => window.__game.step(80)), right.evaluate(() => window.__game.step(80))]);
    assert.equal(await left.evaluate(() => window.__game.snapshot()), await right.evaluate(() => window.__game.snapshot()), 'menu and resize operations do not alter deterministic combat');
  } finally { await leftContext.close(); await rightContext.close(); }

  const legacyContext = await browser.newContext({ viewport: { width: 960, height: 360 } });
  try {
    const legacy = await legacyContext.newPage();
    await legacy.goto(new URL('/', baseUrl).href);
    await legacy.waitForFunction(() => !!window.__game);
    const legacyState = await legacy.evaluate(() => ({ state: window.__game.getState(), layout: window.__game.getLayout() }));
    assert.equal(legacyState.state.combatRules, undefined, 'the default browser entry remains legacy');
    assert.equal(legacyState.layout.compact, false, 'legacy default does not activate compact presentation');
  } finally { await legacyContext.close(); }

  console.log(JSON.stringify({ passed: true, previewUrl: baseUrl, menuCycles: 100, commandRevision: afterCommand.authority.revision, screenshots }));
} finally {
  await context.close();
  await browser.close();
}
