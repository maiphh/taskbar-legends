/* global window, localStorage, process, console */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.PHASE1_BASE_URL ?? 'http://127.0.0.1:5173/?combat=party-v2';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 220 } });
try {
  await context.addInitScript(() => localStorage.setItem('taskbar-legends:v1', 'untouched-normal-account-marker'));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(async () => { await window.__game.whenReady(); window.__game.setSeed(91); });
  await page.evaluate(() => {
    const state = window.__game.getState();
    const archer = state.enemies[0];
    state.enemies = [archer];
    Object.assign(archer, { sourceId: 'archer', x: 210, hp: 2000, maxHp: 2000, atk: 24, range: 260, speed: 0,
      radius: 10, facing: -1, targetId: null, moving: false, action: { state: 'idle' } });
    for (const unit of state.party) Object.assign(unit, { action: { state: 'idle' }, targetId: null, moving: false });
    state.party.find(unit => unit.sourceId === 'mw2').partyCooldowns = { 'guardian-shield': Number.MAX_SAFE_INTEGER };
    state.party.find(unit => unit.sourceId === 'mw1').partyCooldowns = { cleave: Number.MAX_SAFE_INTEGER };
    state.party.find(unit => unit.sourceId === 'priest').partyCooldowns = { 'priest-burst-heal': Number.MAX_SAFE_INTEGER };
    state.events = []; state.eventSeq = 0; state.eventCounts = {};
    window.__game.load(state);
    window.__game.pause();
  });
  const initial = await page.evaluate(() => ({
    state: window.__game.getState(), projection: window.__game.getCombatProjection(),
  }));
  assert.equal(initial.state.combatRules, 'party-v2');
  assert.deepEqual(initial.state.partyIds, ['mw2', 'mw1', 'priest']);
  const originalMeleeX = initial.state.party.find(unit => unit.sourceId === 'mw1').x;
  await page.screenshot({ path: 'shots/phase1-party-approach.png' });

  let started = false, finalState;
  for (let tick = 0; tick < 100 && !started; tick += 1) {
    finalState = await page.evaluate(() => window.__game.step(1));
    started = finalState.events.some(event => event.data.type === 'actionStart' && event.data.unitId === 'hero-mw1');
  }
  assert.ok(started, 'melee hero should enter an authored windup after approaching');
  let current = finalState;
  const actionStart = current.events.find(event => event.data.type === 'actionStart' && event.data.unitId === 'hero-mw1');
  assert.ok(actionStart);
  await page.screenshot({ path: 'shots/phase1-party-windup.png' });
  let meleeHit;
  for (let tick = 0; tick < 12 && !meleeHit; tick += 1) {
    current = await page.evaluate(() => window.__game.step(1));
    meleeHit = current.events.find(event => event.data.type === 'hit' && event.data.attackerId === 'hero-mw1' && event.data.targetId === actionStart.data.targetId);
  }
  assert.ok(meleeHit, 'melee action should land after its windup');
  assert.equal(meleeHit.combatTick, actionStart.data.impactTick, 'visual contact time and committed impact must share a native combat tick');
  const contact = await page.evaluate(() => ({ state: window.__game.getState(), projection: window.__game.getCombatProjection() }));
  const melee = contact.state.party.find(unit => unit.id === 'hero-mw1');
  const target = contact.state.enemies.find(unit => unit.id === actionStart.data.targetId);
  const screenMelee = contact.projection.units.find(unit => unit.id === melee.id).screenX;
  const screenTarget = contact.projection.units.find(unit => unit.id === target.id).screenX;
  const worldSeparation = Math.abs(melee.x - target.x), screenSeparation = Math.abs(screenMelee - screenTarget);
  const edgeAtImpact = worldSeparation - melee.radius - target.radius;
  assert.ok(edgeAtImpact <= melee.range, `melee contact exceeded reach: edge=${edgeAtImpact}, reach=${melee.range}`);
  assert.ok(Math.abs(worldSeparation - screenSeparation) <= 1, `screen/world translation mismatch: world=${worldSeparation}, screen=${screenSeparation}`);
  assert.ok(melee.x > originalMeleeX, 'melee hero should visibly advance from its formation anchor');
  assert.ok(contact.state.party.find(unit => unit.id === 'hero-mw2').hp < contact.state.party.find(unit => unit.id === 'hero-mw2').maxHp,
    'the archer should contest the frontline while melee closes');
  await page.screenshot({ path: 'shots/phase1-party-contact.png' });

  await page.waitForTimeout(5500);
  const persistence = await page.evaluate(() => ({
    normal: localStorage.getItem('taskbar-legends:v1'),
    preview: JSON.parse(localStorage.getItem('taskbar-legends:v1:party-v2') ?? 'null'),
  }));
  assert.equal(persistence.normal, 'untouched-normal-account-marker', 'preview must not overwrite normal account key');
  assert.equal(persistence.preview.format, 'taskbar-legends-save-v2');
  assert.equal(persistence.preview.state.combatRules, 'party-v2');
  assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
  assert.deepEqual(await page.evaluate(() => window.__game.getAssetErrors()), [], 'all assets should load');

  // Same seed and deliberate tick sequence in isolated contexts; presentation operations must not alter simulation.
  const comparison = await browser.newContext({ viewport: { width: 1280, height: 220 } });
  try {
    const [left, right] = await Promise.all([context.newPage(), comparison.newPage()]);
    await Promise.all([left.goto(baseUrl), right.goto(baseUrl)]);
    await Promise.all([left.waitForFunction(() => !!window.__game), right.waitForFunction(() => !!window.__game)]);
    await Promise.all([
      left.evaluate(async () => { await window.__game.whenReady(); window.__game.setSeed(17); window.__game.step(25); }),
      right.evaluate(async () => { await window.__game.whenReady(); window.__game.setSeed(17); window.__game.step(25); }),
    ]);
    await left.evaluate(() => window.__game.openPanel('heroes'));
    await left.setViewportSize({ width: 1000, height: 220 });
    await Promise.all([left.evaluate(() => window.__game.step(35)), right.evaluate(() => window.__game.step(35))]);
    assert.equal(await left.evaluate(() => window.__game.snapshot()), await right.evaluate(() => window.__game.snapshot()));
  } finally { await comparison.close(); }

  console.log(JSON.stringify({
    passed: true,
    previewUrl: baseUrl,
    meleeStartTick: actionStart.data.startTick,
    impactTick: meleeHit.combatTick,
    initialMeleeWorldX: originalMeleeX,
    meleeWorldXAtContact: melee.x,
    targetWorldXAtContact: target.x,
    edgeDistanceAtContact: edgeAtImpact,
    reach: melee.range,
    worldCenterSeparation: worldSeparation,
    screenCenterSeparation: screenSeparation,
    screenshots: ['shots/phase1-party-approach.png', 'shots/phase1-party-windup.png', 'shots/phase1-party-contact.png'],
  }));
  await context.close();
} finally { await browser.close(); }
