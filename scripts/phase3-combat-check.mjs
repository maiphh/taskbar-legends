/* global window, document, process, console, localStorage, getComputedStyle */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.PHASE3_BASE_URL ?? 'http://127.0.0.1:5173/?combat=party-v2&compact=1';
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 480, height: 220 }, deviceScaleFactor: 1 });
const errors = [];
try {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('taskbar-legends:compact-window:v1', JSON.stringify({
    version: 1, sourceWidth: 480, sourceHeight: 160, zoom: 1, placement: 'free', anchorX: 1, anchorY: 1,
  })));
  await page.goto(baseUrl);
  await page.waitForFunction(() => !!window.__game);
  await page.evaluate(async () => { await window.__game.whenReady(); window.__game.setSeed(252); window.__game.pause(); });
  const sourceLayout = await page.evaluate(() => ({ layout: window.__game.getLayout(), canvas: document.querySelector('#game') && {
    width: document.querySelector('#game').width, cssWidth: parseFloat(getComputedStyle(document.querySelector('#game')).width),
  } }));
  assert.equal(sourceLayout.layout.width, 480, 'compact source layout uses the visible 480px field');
  assert.equal(sourceLayout.canvas?.width, 480, 'canvas backing width matches the visible field at DPR 1');
  assert.equal(sourceLayout.canvas?.cssWidth, 480, 'canvas CSS width matches the visible field at DPR 1');

  await page.evaluate(() => {
    const state = window.__game.getState(), tank = state.party.find(unit => unit.sourceId === 'mw2'), priest = state.party.find(unit => unit.sourceId === 'priest');
    state.tick = 100;
    if (!tank || !priest) throw new Error('starter party fixture missing tank or priest');
    const source = state.enemies[0]; if (!source) throw new Error('enemy fixture missing');
    Object.assign(tank, { x: 140, action: { state: 'recovery', kind: 'attack', targetId: tank.id, startTick: 0, impactTick: 0, readyTick: Number.MAX_SAFE_INTEGER }, speed: 0 });
    for (const unit of state.party) if (unit !== tank) Object.assign(unit, { x: unit.sourceId === 'mw1' ? 95 : 50, action: { state: 'recovery', kind: 'attack', targetId: unit.id, startTick: 0, impactTick: 0, readyTick: Number.MAX_SAFE_INTEGER }, speed: 0 });
    const assassin = { ...source, id: 'enemy-assassin-browser', sourceId: 'assassin', hp: 65, maxHp: 65, atk: 60, def: 5, attackTicks: 24, range: 12, x: 650, slot: 0, boss: false,
      radius: 10, speed: 110, facing: -1, targetId: null, moving: false, action: { state: 'idle' }, specialAction: undefined, partyCooldowns: {}, procCounters: {} };
    const archer = { ...source, id: 'enemy-archer-browser', sourceId: 'archer', hp: 500, maxHp: 500, atk: 24, def: 0, attackTicks: 24, range: 260, x: 820, slot: 1, boss: false,
      radius: 10, speed: 55, facing: -1, targetId: tank.id, moving: false, action: { state: 'windup', kind: 'attack', targetId: tank.id, startTick: state.tick, impactTick: state.tick + 200 }, specialAction: undefined, partyCooldowns: {}, procCounters: {} };
    state.enemies = [assassin, archer]; state.projectiles = []; state.partyEffects = []; state.nextProjectileId = 0;
    state.progress = { kind: 'PUSHING', stage: 12 }; state.highestCleared = 11; state.phase = { kind: 'battle' };
    state.events = []; state.eventSeq = 0; state.eventCounts = {};
    window.__game.load(state);
  });
  await page.evaluate(() => window.__game.step(1));
  const mark = await page.evaluate(() => ({ state: window.__game.getState(), projection: window.__game.getCombatProjection() }));
  const assassinMark = mark.state.enemies.find(unit => unit.sourceId === 'assassin');
  assert.equal(assassinMark?.specialAction?.state, 'assassinMark');
  assert.equal(assassinMark?.specialAction?.targetId, mark.state.party.find(unit => unit.sourceId === 'priest')?.id);
  const fieldRight = mark.projection.fieldLeft + mark.projection.fieldWidth;
  const offscreenCommitted = mark.state.enemies.filter(enemy => enemy.specialAction || enemy.action?.state === 'windup')
    .filter(enemy => { const screenX = mark.projection.units.find(unit => unit.id === enemy.id)?.screenX; return screenX !== undefined && (screenX < mark.projection.fieldLeft || screenX > fieldRight); });
  assert.equal(offscreenCommitted.length, 2, 'separated committed threats are both offscreen at 480px and require edge cues');
  assert.deepEqual(mark.projection.edgeMarkers.map(marker => marker.threatId).sort(), ['enemy-archer-browser', 'enemy-assassin-browser'], 'the renderer projection exposes a matching edge cue for each committed offscreen threat');
  assert.ok(mark.projection.edgeMarkers.every(marker => marker.screenX >= mark.projection.fieldLeft && marker.screenX <= fieldRight), `every canonical threat marker lies inside the visible 480px field: ${JSON.stringify(mark.projection.edgeMarkers)} field=${mark.projection.fieldLeft},${fieldRight}`);
  const edgeCuePixels = await page.evaluate(({ right, coreY }) => {
    const canvas = document.querySelector('#game'), ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return false;
    const image = ctx.getImageData(Math.max(0, right - 18), Math.max(0, coreY + 6), 18, 24).data;
    for (let i = 0; i < image.length; i += 4) if ((image[i] ?? 0) > 180 && (image[i + 1] ?? 255) < 150) return true;
    return false;
  }, { right: fieldRight, coreY: await page.evaluate(() => window.__game.getLayout().coreY) });
  assert.ok(edgeCuePixels, 'at least one explicit red canvas edge cue is painted for the offscreen threats');
  await page.screenshot({ path: 'shots/phase3-480-assassin-mark.png' });
  const assassinStartX = assassinMark.x;
  await page.evaluate(() => window.__game.step(20));
  const dash = await page.evaluate(() => window.__game.getState().enemies.find(unit => unit.sourceId === 'assassin'));
  assert.equal(dash?.specialAction?.state, 'assassinDash');
  assert.ok((dash?.x ?? assassinStartX) < assassinStartX, 'the assassin traverses the lane after the mark');
  await page.screenshot({ path: 'shots/phase3-480-assassin-dash.png' });
  const landed = await page.evaluate(() => {
    for (let i = 0; i < 50; i += 1) {
      const current = window.__game.getState().enemies.find(unit => unit.sourceId === 'assassin');
      if (current?.action?.state === 'windup') return current;
      window.__game.step(1);
    }
    return window.__game.getState().enemies.find(unit => unit.sourceId === 'assassin');
  });
  assert.equal(landed?.action?.state, 'windup');
  assert.equal(landed?.action?.targetId, mark.state.party.find(unit => unit.sourceId === 'priest')?.id);
  assert.equal((await page.evaluate(() => window.__game.getState().events.some(event => event.data.type === 'hit' && event.data.attackerId === 'enemy-assassin-browser'))), false, 'no damage during dash or landing windup');
  await page.evaluate(() => window.__game.step(4));
  const defense = await page.evaluate(() => {
    const state = window.__game.getState(), guardian = state.party.find(unit => unit.sourceId === 'mw2');
    if (!guardian) throw new Error('guardian missing for guard/status view');
    state.partyEffects = [{ id: `party-atk-buff:${guardian.id}`, sourceId: 'hero-mk1', targetId: guardian.id, group: 'party-atk-buff', kind: 'atkBonus', magnitude: 0.15, appliedAtTick: state.tick, expiresAtTick: state.tick + 60, stackPolicy: 'strongestRefresh' }];
    window.__game.load(state);
    return { state: window.__game.getState(), projection: window.__game.getCombatProjection() };
  });
  assert.ok(defense.state.events.some(event => event.data.type === 'guard' && event.data.fromTargetId === 'hero-priest' && event.data.toTargetId === 'hero-mw2'), 'guardian automatically intercepts the landing strike');
  assert.ok((defense.state.party.find(unit => unit.sourceId === 'priest')?.hp ?? 0) > 0, 'healthy starter support survives the first response window');
  assert.ok(defense.projection.guardCues.length > 0, 'a recent real guard event produces a visible presentation cue');
  assert.ok(defense.projection.statusCues.some(cue => cue.label === 'ATK up'), 'active status effects produce a readable cue');
  const statusPixels = await page.evaluate(({ x }) => {
    const canvas = document.querySelector('#game'), ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return false;
    const image = ctx.getImageData(Math.max(0, x - 24), 0, 48, canvas.height).data;
    for (let i = 0; i < image.length; i += 4) if ((image[i] ?? 0) > 150 && (image[i + 1] ?? 0) > 170 && (image[i + 2] ?? 0) > 130) return true;
    return false;
  }, { x: defense.projection.statusCues[0].screenX });
  assert.ok(statusPixels, 'canvas contains the restrained active-effect label');
  await page.screenshot({ path: 'shots/phase3-480-guard-status.png' });
  await page.screenshot({ path: 'shots/phase3-480-threat-edge-markers.png' });

  await page.evaluate(() => {
    const state = window.__game.getState(), tank = state.party.find(unit => unit.sourceId === 'mw2'), melee = state.party.find(unit => unit.sourceId === 'mw1'), priest = state.party.find(unit => unit.sourceId === 'priest');
    if (!tank || !melee || !priest) throw new Error('starter party fixture missing');
    Object.assign(tank, { x: 220, hp: tank.maxHp, guardReadyTick: Number.MAX_SAFE_INTEGER });
    Object.assign(melee, { x: 180, hp: melee.maxHp }); Object.assign(priest, { x: 100, hp: priest.maxHp });
    for (const unit of state.party) Object.assign(unit, { speed: 0, action: { state: 'recovery', kind: 'attack', targetId: unit.id, startTick: 0, impactTick: 0, readyTick: Number.MAX_SAFE_INTEGER }, moving: false });
    const base = state.enemies[0]; if (!base) throw new Error('bomber fixture missing');
    const bomber = { ...base, id: 'enemy-bomber-browser', sourceId: 'bomber', hp: 90, maxHp: 90, atk: 45, def: 5, attackTicks: 30, range: 200, x: 300,
      radius: 10, speed: 50, facing: -1, targetId: tank.id, moving: false, action: { state: 'idle' }, partyCooldowns: { 'bomber-blast': 120 }, procCounters: {},
      specialAction: { state: 'areaMark', targetId: tank.id, centerX: 220, radius: 48, startTick: state.tick, impactTick: state.tick + 20, abilityId: 'bomber-blast' } };
    state.enemies = [bomber]; state.events = []; state.eventSeq = 0; state.eventCounts = {}; state.projectiles = []; state.partyEffects = [];
    window.__game.load(state);
  });
  await page.screenshot({ path: 'shots/phase3-480-bomber-area-mark.png' });
  await page.evaluate(() => window.__game.step(20));
  const area = await page.evaluate(() => window.__game.getState());
  assert.ok(area.events.some(event => event.data.type === 'hit' && event.data.attackerId === 'enemy-bomber-browser' && event.data.targetId === 'hero-mw1'), 'local blast contacts the nearby ally');
  assert.ok(!area.events.some(event => event.data.type === 'hit' && event.data.attackerId === 'enemy-bomber-browser' && event.data.targetId === 'hero-priest'), 'local blast excludes the outside ally');
  await page.screenshot({ path: 'shots/phase3-480-bomber-area-impact.png' });

  await page.evaluate(() => {
    const state = window.__game.getState(), ranger = state.party.find(unit => unit.sourceId === 'mw2'), target = state.enemies[0];
    if (!ranger || !target) throw new Error('ranged contact fixture missing');
    Object.assign(ranger, { sourceId: 'hu1', x: 140, atk: 100, range: 260, facing: 1, partyCooldowns: { 'ranged-burst': Number.MAX_SAFE_INTEGER },
      action: { state: 'idle' }, targetId: null, moving: false });
    for (const unit of state.party) if (unit !== ranger) { unit.hp = 0; }
    Object.assign(target, { sourceId: 'grunt', x: 400, hp: 10000, maxHp: 10000, def: 0, shield: 0, shieldUntilTick: 0,
      action: { state: 'recovery', kind: 'attack', targetId: target.id, startTick: 0, impactTick: 0, readyTick: Number.MAX_SAFE_INTEGER } });
    state.enemies = [target]; state.projectiles = []; state.partyEffects = []; state.events = []; state.eventSeq = 0; state.eventCounts = {};
    window.__game.load(state);
  });
  await page.evaluate(() => window.__game.step(1));
  const windup = await page.evaluate(() => window.__game.getState());
  assert.ok(windup.party.find(unit => unit.sourceId === 'hu1')?.action?.state === 'windup', 'an idle hu1 starts its real basic decision');
  assert.equal(windup.party.find(unit => unit.sourceId === 'hu1')?.action?.abilityId, 'ranger-shot');
  const beforeLaunchHp = windup.enemies[0]?.hp;
  await page.evaluate(() => window.__game.step(4));
  const released = await page.evaluate(() => window.__game.getState());
  assert.ok(released.projectiles?.some(projectile => projectile.sourceId === 'hero-mw2' && projectile.abilityId === 'ranger-shot'), 'the basic decision releases its projectile payload');
  assert.equal(released.enemies[0]?.hp, beforeLaunchHp, 'the release does not deal its hit before flight contact');
  assert.ok(!released.events.some(event => event.data.type === 'hit' && event.data.attackerId === 'hero-mw2'), 'no hit is emitted on the release tick');
  await page.evaluate(() => window.__game.step(4));
  const midflight = await page.evaluate(() => ({ projection: window.__game.getCombatProjection(), layout: window.__game.getLayout() }));
  assert.equal(midflight.projection.projectiles.length, 1, 'a released arrow is represented in the real combat projection');
  const projectileMark = midflight.projection.projectiles[0];
  assert.ok(projectileMark.screenX > 180 && projectileMark.screenX < 320, 'the paused arrow is visibly separated between the x140 source and x400 target');
  const arrowPixels = await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('#game'), ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return false;
    const image = ctx.getImageData(Math.max(0, x - 8), Math.max(0, y - 7), 16, 14).data;
    for (let i = 0; i < image.length; i += 4) if ((image[i] ?? 0) > 220 && (image[i + 1] ?? 0) > 120 && (image[i + 2] ?? 255) < 180) return true;
    return false;
  }, { x: projectileMark.screenX, y: projectileMark.y });
  assert.ok(arrowPixels, 'canvas pixels contain the visible arrow at the projected in-flight position');
  await page.screenshot({ path: 'shots/phase3-480-projectile-flight.png' });
  await page.evaluate(() => window.__game.step(10));
  const impact = await page.evaluate(() => window.__game.getState());
  assert.ok(impact.events.some(event => event.data.type === 'projectile' && event.data.action === 'impact'), 'the released projectile resolves through subsequent browser steps');
  assert.ok(impact.events.some(event => event.data.type === 'hit' && event.data.attackerId === 'hero-mw2'), 'projectile contact damages its target');
  const debuffActive = await page.evaluate(async () => {
    const state = window.__game.getState(), caster = state.party.find(unit => unit.id === 'hero-mw2'), enemy = state.enemies[0];
    if (!caster || !enemy) throw new Error('visible debuff fixture is missing its caster or enemy');
    caster.sourceId = 'ew1'; caster.hp = caster.maxHp; caster.partyCooldowns = { weaken: state.tick + 60 };
    for (const unit of state.party) Object.assign(unit, { speed: 0, action: { state: 'recovery', kind: 'attack', targetId: unit.id, startTick: 0, impactTick: 0, readyTick: Number.MAX_SAFE_INTEGER }, moving: false });
    Object.assign(enemy, { hp: 10000, maxHp: 10000, atk: 50, def: 100, action: { state: 'recovery', kind: 'attack', targetId: enemy.id, startTick: 0, impactTick: 0, readyTick: Number.MAX_SAFE_INTEGER }, speed: 0 });
    state.projectiles = []; state.partyEffects = []; state.events = []; state.eventSeq = 0; state.eventCounts = {};
    const { applyPartyEffect, effectiveAttack, effectiveDefense } = await import('/src/core/party-effects.ts');
    applyPartyEffect(state, { id: `enemy-atk-weaken:${enemy.id}`, sourceId: caster.id, targetId: enemy.id, group: 'enemy-atk-weaken', kind: 'atkReduction', magnitude: 0.2, appliedAtTick: state.tick, expiresAtTick: state.tick + 20, stackPolicy: 'strongestRefresh' });
    applyPartyEffect(state, { id: `enemy-def-weaken:${enemy.id}`, sourceId: caster.id, targetId: enemy.id, group: 'enemy-def-weaken', kind: 'defReduction', magnitude: 0.25, appliedAtTick: state.tick, expiresAtTick: state.tick + 20, stackPolicy: 'strongestRefresh' });
    window.__game.load(state);
    const restored = window.__game.getState(), activeEnemy = restored.enemies[0];
    return { state: restored, projection: window.__game.getCombatProjection(), atkReduced: effectiveAttack(restored, activeEnemy) < activeEnemy.atk,
      defReduced: effectiveDefense(restored, activeEnemy) < activeEnemy.def };
  });
  assert.ok(debuffActive.atkReduced && debuffActive.defReduced, 'the authoritative EW1 effects reduce enemy ATK and DEF');
  const activeEnemyCues = debuffActive.projection.statusCues.filter(cue => cue.targetId === debuffActive.state.enemies[0].id);
  assert.deepEqual(activeEnemyCues.map(cue => cue.label), ['ATK down', 'DEF down'], 'the canonical cue projection includes both readable enemy debuffs');
  const debuffPixels = await page.evaluate(({ x, y }) => {
    const canvas = document.querySelector('#game'), ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return false;
    const image = ctx.getImageData(Math.max(0, x - 42), Math.max(0, y - 20), 84, 32).data;
    for (let i = 0; i < image.length; i += 4) if ((image[i] ?? 0) > 180 && (image[i + 1] ?? 0) > 140 && (image[i + 2] ?? 255) < 235) return true;
    return false;
  }, { x: activeEnemyCues[0].screenX, y: activeEnemyCues[1].y });
  assert.ok(debuffPixels, 'canvas pixels show enemy debuff labels while the enemy remains visible');
  await page.screenshot({ path: 'shots/phase3-enemy-debuff-active.png' });
  await page.evaluate(() => window.__game.step(25));
  const debuffExpired = await page.evaluate(() => ({ state: window.__game.getState(), projection: window.__game.getCombatProjection() }));
  assert.ok(debuffExpired.state.enemies[0].hp > 0, 'enemy stays alive after both effects expire');
  assert.equal(debuffExpired.state.partyEffects?.filter(effect => effect.targetId === debuffExpired.state.enemies[0].id).length, 0, 'both authoritative enemy effects have expired');
  assert.equal(debuffExpired.projection.statusCues.filter(cue => cue.targetId === debuffExpired.state.enemies[0].id).length, 0, 'enemy status cues disappear after expiry');
  await page.screenshot({ path: 'shots/phase3-enemy-debuff-expired.png' });
  assert.deepEqual(errors, [], 'browser has no uncaught errors');
  console.log(JSON.stringify({ screenshots: ['phase3-480-assassin-mark.png', 'phase3-480-assassin-dash.png', 'phase3-480-threat-edge-markers.png', 'phase3-480-bomber-area-mark.png', 'phase3-480-bomber-area-impact.png', 'phase3-480-projectile-flight.png', 'phase3-480-guard-status.png', 'phase3-enemy-debuff-active.png', 'phase3-enemy-debuff-expired.png'], edgeMarkers: mark.projection.edgeMarkers, projectile: projectileMark, guardCues: defense.projection.guardCues.length, statusCues: defense.projection.statusCues, enemyDebuffCues: activeEnemyCues.map(cue => cue.label), assassinLanding: landed?.x, assassinHP: defense.state.party.find(unit => unit.sourceId === 'priest')?.hp, areaHitTargets: area.events.filter(event => event.data.type === 'hit' && event.data.attackerId === 'enemy-bomber-browser').map(event => event.data.targetId) }));
} finally {
  await context.close(); await browser.close();
}
