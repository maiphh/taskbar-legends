import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { CONFIG } from '../src/config';
import { beginEncounter } from '../src/core/combat';
import { upgrade } from '../src/core/economy';
import { createState, input, step } from '../src/core/game';
import { gearTemplateId, itemId } from '../src/core/model';
import { decodeSave, encodeSave, offlineProjection, applyOffline } from '../src/core/save';
import type { GameState } from '../src/core/model';

const HOUR_MS = 3_600_000;
const trainedFormation = ['hk1', 'wiz', 'priest'];
const fallbackFormation = ['mw2', 'mw1', 'priest'];
function makeCase(seed: number, stage: 1 | 9 | 11): GameState {
  const state = createState(seed);
  // Fixed progressed test roster: configured level cap and star cap, no hand-tuned combat stats.
  for (const heroDefinition of CONFIG.heroes) {
    let hero = state.roster.find(value => value.id === heroDefinition.id);
    if (!hero) { hero = { id: heroDefinition.id, level: CONFIG.growth.levelCap, xp: 0, stars: CONFIG.growth.starMax, equipment: { weapon: null, armor: null, charm: null } }; state.roster.push(hero); }
    hero.level = CONFIG.growth.levelCap; hero.xp = 0; hero.stars = CONFIG.growth.starMax;
  }
  state.partyIds = [...trainedFormation];
  state.highestCleared = stage === 1 ? 0 : stage === 9 ? 9 : 10;
  state.progress = stage === 9
    ? { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 }
    : { kind: 'PUSHING', stage };
  beginEncounter(state);
  return state;
}
function clearRealEncounter(state: GameState): number {
  const previous = state.stats.clears;
  for (let ticks = 0; ticks < 20_000 && state.stats.clears === previous; ticks += 1) step(state);
  assert.equal(state.stats.clears, previous + 1, `real encounter failed to clear: ${state.progress.kind} stage ${state.progress.stage}`);
  return state.tick;
}
function installValidCommonWeapon(state: GameState): string {
  const id = itemId(state.seed, state.nextGearId++);
  state.inventory.push({ id, templateId: gearTemplateId('weapon', 'common'), tradeable: false,
    acquiredAt: { tick: state.tick, source: 'starter' }, slot: 'weapon', rarity: 'common', dropStage: 1, level: 0, spent: 0,
    stats: { hp: 0, atk: CONFIG.gear.slots.weapon.main.atk, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 } });
  input(state, { type: 'equip', heroId: 'hk1', gearId: id });
  upgrade(state, id);
  return id;
}
function oneRun(seed: number, stage: 1 | 9 | 11) {
  const state = makeCase(seed, stage), actualStart = structuredClone(state.encounterFarmContext);
  const clearTick = clearRealEncounter(state), proof = state.farmProofs?.find(value => value.stage === stage);
  assert.ok(proof, `stage ${stage} did not earn a proof`);
  assert.deepEqual(proof.heroes, actualStart?.heroes);
  assert.equal(proof.wallSeconds.length, 1);
  const stored = decodeSave(encodeSave({ state, savedAtMs: 123_000, remainderMs: 0 })).state;
  assert.deepEqual(stored.farmProofs, state.farmProofs);
  const earnedRate = offlineProjection(stored), earnedPayment = applyOffline(stored, HOUR_MS);
  assert.equal(earnedPayment.stage, stage); assert.equal(earnedPayment.earned, true);

  input(stored, { type: 'party', heroIds: fallbackFormation });
  const fallbackRate = offlineProjection(stored);
  assert.equal(fallbackRate.earned, false); assert.equal(fallbackRate.stage, 1);
  const fallbackPayment = applyOffline(stored, HOUR_MS);
  assert.equal(fallbackPayment.stage, 1); assert.equal(fallbackPayment.earned, false);

  input(stored, { type: 'party', heroIds: trainedFormation });
  const beforeUpgrade = offlineProjection(stored), upgradeId = installValidCommonWeapon(stored);
  const afterUpgrade = offlineProjection(stored);
  assert.equal(beforeUpgrade.earned, true); assert.equal(afterUpgrade.earned, true);
  assert.equal(afterUpgrade.stage, stage); assert.equal(afterUpgrade.clearSeconds, beforeUpgrade.clearSeconds);

  let changedTeamClear: number | null = null, changedTeamProof: boolean | null = null;
  if (stage === 1) {
    input(stored, { type: 'party', heroIds: fallbackFormation });
    stored.progress = { kind: 'FARMING', stage: 1, failedStage: 2, retryAtTick: stored.tick + 100_000,
      failedPower: stored.attemptPower, failures: 1 };
    const changedTeamStart = stored.tick;
    beginEncounter(stored);
    changedTeamClear = clearRealEncounter(stored);
    changedTeamClear -= changedTeamStart;
    changedTeamProof = stored.farmProofs?.some(value => value.stage === 1 && value.heroes.map(hero => hero.id).join(',') === fallbackFormation.join(',')) ?? false;
    assert.equal(changedTeamProof, true, 'the changed formation earns its own stage-1 proof on a real repeat clear');
  }
  return {
    seed, stage, signature: actualStart?.rulesSignature, formation: actualStart?.heroes,
    clear: { ticks: clearTick - (actualStart?.startedTick ?? 0), proof: structuredClone(proof) },
    earned: { stage: earnedRate.stage, nativeSeconds: earnedRate.clearSeconds, wallSeconds: earnedRate.wallClearSeconds, gold: earnedPayment.gold, xp: earnedPayment.xp, chests: earnedPayment.chests },
    fallback: { stage: fallbackRate.stage, nativeSeconds: fallbackRate.clearSeconds, wallSeconds: fallbackRate.wallClearSeconds, gold: fallbackPayment.gold, xp: fallbackPayment.xp, chests: fallbackPayment.chests },
    upgradedFormationRetainedProof: afterUpgrade.earned, upgradeId,
    ...(changedTeamClear === null ? {} : { changedTeamRealClearTicks: changedTeamClear, changedTeamProof }),
    final: { gold: stored.gold, tickets: stored.tickets, rng: stored.rng, proofs: structuredClone(stored.farmProofs), offlineAccrual: stored.offlineAccrual },
  };
}

const scenarios = [];
for (const stage of [1, 9, 11] as const) for (const seed of [1, 2, 3]) {
  const first = oneRun(seed, stage), repeated = oneRun(seed, stage);
  assert.deepEqual(repeated, first, `non-deterministic farm proof scenario stage${stage}, seed${seed}`);
  scenarios.push(first);
}
const report = { date: '2026-11-16', source: { configVersion: CONFIG.version, rulesSignature: scenarios[0]?.signature,
  team: trainedFormation, weakTeam: fallbackFormation, allKnownHeroesLevel: CONFIG.growth.levelCap, allKnownHeroesStars: CONFIG.growth.starMax,
  offlineIntervalHours: 1, realCombatStepLimitTicks: 20_000, cases: 'three deterministic seeds × push stage 1, boss-gate repeat stage 9, special-enemy push stage 11' }, scenarios };
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/farm-proof-check.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ cases: scenarios.length, deterministic: true, rulesSignature: report.source.rulesSignature, report: 'artifacts/farm-proof-check.json' }));
