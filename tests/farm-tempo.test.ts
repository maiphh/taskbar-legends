import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, farmTempoSchema, ticksForSeconds } from '../src/config';
import { beginEncounter } from '../src/core/combat';
import { partyPower } from '../src/core/economy';
import { bossSecondsRemaining, createState, input, load, snapshot, statusText, step } from '../src/core/game';
import type { GameState } from '../src/core/model';
import { referencePolicy, runReference } from '../src/core/policy';
import { applyOffline } from '../src/core/save';
import { farmCycleDistribution } from '../src/sim/aggregate';
import * as legacy from './fixtures/legacy-game';

const original = { scale: CONFIG.combat.nonBossFarmTimeScale, floor: CONFIG.combat.nonBossFarmMinCycleSec, retry: CONFIG.progression.powerGainRetryMinSec };
afterEach(() => { CONFIG.combat.nonBossFarmTimeScale = original.scale; CONFIG.combat.nonBossFarmMinCycleSec = original.floor; CONFIG.progression.powerGainRetryMinSec = original.retry; });
function tempo(scale: number, floor: number): void { CONFIG.combat.nonBossFarmTimeScale = scale; CONFIG.combat.nonBossFarmMinCycleSec = floor; }
function repeat(): GameState {
  const state = createState(7); state.highestCleared = 1;
  state.progress = { kind: 'FARMING', stage: 1, failedStage: 2, retryAtTick: 1e9, failTick: 0, failedPower: 1e9, failures: 1 };
  for (const hero of state.roster) hero.level = CONFIG.growth.levelCap;
  beginEncounter(state); return state;
}
function controlled(cooldown = 0): GameState {
  const state = repeat(); state.wave = CONFIG.stages[0]?.waves.length ?? 3;
  const enemy = state.enemies[0]; if (!enemy) throw new Error('Fixture');
  state.enemies = [enemy]; enemy.hp = cooldown ? 1 : 0; enemy.maxHp = 1; enemy.def = 0; enemy.x = 10000; enemy.atk = 1;
  for (const hero of state.party) { hero.hp = 1e6; hero.maxHp = 1e6; hero.range = 1e6; hero.atk = 1; hero.cooldown = cooldown; }
  return state;
}
function untilClear(state: GameState): void {
  const clears = state.stats.clears;
  for (let tick = 0; tick < 10000 && state.stats.clears === clears; tick += 1) step(state);
  expect(state.stats.clears).toBe(clears + 1);
}
function loseEight(): GameState {
  const state = createState(1); state.highestCleared = 7; state.progress = { kind: 'PUSHING', stage: 8 };
  beginEncounter(state); for (const hero of state.party) hero.hp = 0; step(state);
  state.phase = { kind: 'rest', next: 'encounter', remainingTicks: 10000 };
  return state;
}

describe('repeat-only native encounter clock and wall-time floor', () => {
  it('validates defaults1/0 and rejects noninteger/out-of-range scale or negative floor', () => {
    expect(farmTempoSchema.parse({})).toEqual({ nonBossFarmTimeScale: 1, nonBossFarmMinCycleSec: 0 });
    for (const scale of [0, 1.5, 5]) expect(() => farmTempoSchema.parse({ nonBossFarmTimeScale: scale })).toThrow();
    expect(() => farmTempoSchema.parse({ nonBossFarmMinCycleSec: -1 })).toThrow();
  });
  it('default tempo has byte-identical legacy state/events/rewards/rest timing on seeded native farming', () => {
    tempo(1, 0);
    const a = createState(3), b = legacy.createState(3);
    for (const state of [a, b]) {
      state.highestCleared = 9; state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
      for (const hero of state.roster) hero.level = CONFIG.growth.levelCap;
      beginEncounter(state);
    }
    step(a, 10000); legacy.step(b, 10000);
    expect(snapshot(a)).toBe(legacy.snapshot(b)); expect(a.metrics.nativeFarmClearSeconds).toBeUndefined(); expect(a.farmClock).toBeUndefined();
  });
  it('captures eligibility once and advances exactly3native substeps per wall tick', () => {
    tempo(3, 20); const state = controlled(1000); step(state, 10);
    expect(state.tick).toBe(10); expect(state.farmClock?.elapsedTicks).toBe(30); expect(state.party[0]?.cooldown).toBe(970);
    tempo(1, 0); step(state); expect(state.farmClock?.elapsedTicks).toBe(33);
  });
  it('settles a fast farm at exactly20seconds with one stage gap, no padding attacks/rewards/RNG', () => {
    tempo(3, 20); const state = controlled(); const start = state.tick; step(state);
    expect(state.phase.kind).toBe('farmPad'); const seq = state.eventSeq, rng = state.rng, gold = state.gold;
    step(state, 398); expect(state.tick - start).toBe(399); expect(state.eventSeq).toBe(seq); expect(state.rng).toBe(rng); expect(state.gold).toBe(gold); expect(state.stats.clears).toBe(0);
    step(state); expect(state.tick - start).toBe(400); expect(state.metrics.farmClearSeconds).toEqual([20]); expect(state.metrics.nativeFarmClearSeconds).toEqual([6.05]);
    expect(state.stats.clears).toBe(1); expect(state.stageStartedTick).toBe(400); expect(state.phase.kind).toBe('battle');
  });
  it('rounds fractional minimum cycles upward, never below the configured floor', () => {
    tempo(3, 20.01); const state = controlled(); untilClear(state); expect(state.tick).toBe(401); expect(state.metrics.farmClearSeconds).toEqual([20.05]);
  });
  it('measures a true slow36second cycle and retains95.9native seconds rather than clamping telemetry', () => {
    tempo(3, 20); const state = controlled(1798); untilClear(state);
    expect(state.tick).toBe(720); expect(state.metrics.farmMinSeconds).toBe(36); expect(state.metrics.farmMaxSeconds).toBe(36);
    expect(state.metrics.nativeFarmClearSeconds).toEqual([95.9]);
  });
  it('preserves native ordered hits/skills/deaths and RNG/rewards while events keep ordered wall ticks', () => {
    tempo(1, 0); const native = repeat(); untilClear(native);
    tempo(3, 20); const scaled = repeat(); untilClear(scaled);
    const actions = (state: GameState) => state.events.filter(event => !['spawn', 'stage', 'wave', 'clear'].includes(event.data.type)).map(event => event.data);
    expect(actions(scaled)).toEqual(actions(native)); expect(scaled.rng).toBe(native.rng); expect(scaled.gold).toBe(native.gold);
    expect(scaled.metrics.nativeFarmClearSeconds?.[0]).toBe(native.metrics.farmClearSeconds[0]);
    expect(scaled.events.every((event, index, events) => event.tick <= scaled.tick && (!index || event.seq > (events[index - 1]?.seq ?? 0)))).toBe(true);
  });
  it('never allocates or uses a tempo clock for pushes or boss fights/repeats', () => {
    const run = (scale: number, floor: number, boss: boolean, repeatBoss = false): GameState => {
      tempo(scale, floor); const state = createState(2);
      if (boss) {
        state.highestCleared = repeatBoss ? 20 : 9;
        state.progress = repeatBoss ? { kind: 'COMPLETE', stage: 20 } : { kind: 'BOSS_FIGHT', stage: 10, failedPower: 0, bossLosses: 0 };
        beginEncounter(state);
      }
      step(state, 200); return state;
    };
    for (const [boss, repeatBoss] of [[false, false], [true, false], [true, true]]) {
      const a = run(1, 0, boss ?? false, repeatBoss), b = run(3, 20, boss ?? false, repeatBoss);
      expect(a).toEqual(b); expect(b.farmClock).toBeUndefined();
    }
  });
  it('aborts unsettled padding on exact timer or manual retry without a farm clear/sample', () => {
    tempo(3, 20);
    for (const manual of [false, true]) {
      const state = controlled(); if (state.progress.kind !== 'FARMING') throw new Error('Fixture');
      state.progress.retryAtTick = manual ? 10000 : 100; step(state);
      if (manual) { step(state, 49); input(state, { type: 'retry' }); } else step(state, 99);
      expect(state.stats.clears).toBe(0); expect(state.metrics.farmSamples).toBe(0); expect(state.events.some(event => event.data.type === 'clear')).toBe(false);
      expect(state.farmClock).toBeUndefined(); expect(state.progress.kind).toBe('PUSHING'); expect(state.stats.retries).toBe(1);
      expect(state.events.find(event => event.data.type === 'retry')?.tick).toBe(manual ? 50 : 100);
    }
  });
  it('manual BOSS_READY input aborts a non-boss farm pad once and starts an unscaled boss', () => {
    tempo(3, 20); const state = repeat(); state.highestCleared = 9;
    state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 }; beginEncounter(state);
    state.wave = CONFIG.stages[8]?.waves.length ?? 3; for (const enemy of state.enemies) enemy.hp = 0; step(state);
    expect(state.phase.kind).toBe('farmPad'); input(state, { type: 'retry' });
    expect(state.progress.kind).toBe('BOSS_FIGHT'); expect(state.farmClock).toBeUndefined(); expect(state.stats.clears).toBe(0); expect(state.metrics.farmSamples).toBe(0); expect(state.stats.retries).toBe(1);
  });
  it('snapshot/load preserves native clock, unused remainder and pending padding', () => {
    tempo(3, 20);
    for (const [cooldown, ticks] of [[1798, 20], [0, 1]]) {
      const a = controlled(cooldown); step(a, ticks); const b = load(snapshot(a));
      expect(snapshot(b)).toBe(snapshot(a)); step(a, 800); step(b, 800); expect(a).toEqual(b);
    }
  });
  it('offline uses frozen native averages identically for8h/12h regardless of tempo/floor', () => {
    tempo(3, 20); const frozen = controlled(); step(frozen); frozen.metrics.farmClearSeconds = [20, 20]; frozen.metrics.nativeFarmClearSeconds = [30, 40];
    const results = [];
    for (const [scale, floor] of [[1, 0], [3, 20]]) {
      tempo(scale ?? 1, floor ?? 0);
      for (const hours of [8, 12]) { const state = load(snapshot(frozen)); const report = applyOffline(state, hours * 3600000); results.push({ state, report: { ...report, capped: false } }); }
    }
    expect(results[1]).toEqual(results[0]); expect(results[2]).toEqual(results[0]); expect(results[3]).toEqual(results[0]);
    expect(results[0]?.report.clears).toBe(Math.floor(28800 / 35));
    const legacyAverage = load(snapshot(frozen)); delete legacyAverage.metrics.nativeFarmClearSeconds;
    expect(applyOffline(legacyAverage, 8 * 3600000).clears).toBe(1440);
  });
  it('collects every real successful farm cycle into exact frequency-weighted quantiles', () => {
    const run = runReference(11, 1, 600, true); const data = farmCycleDistribution([run.farmTimingCounts]);
    expect(data.count).toBe(run.state.metrics.farmSamples); expect(data.count).toBeGreaterThan(0);
    expect(farmCycleDistribution([{ '400': 2, '800': 2 }])).toMatchObject({ count: 4, min: 20, p10: 20, median: 30, p90: 40, max: 40 });
  });
});

describe('power-growth retry wall-time guard and boss countdown', () => {
  it('stores failure tick and retries atT+600, neverT+599, after >=10%gain atT+100', () => {
    CONFIG.progression.powerGainRetryMinSec = 30;
    const state = loseEight(), failedAt = state.tick;
    expect(state.progress.kind === 'FARMING' && state.progress.failTick).toBe(failedAt);
    const failedPower = partyPower(state); step(state, 100); for (const hero of state.roster) hero.stars = 2;
    expect(partyPower(state)).toBeGreaterThanOrEqual(failedPower * 1.1); input(state, { type: 'autoEquip' });
    expect(statusText(state)).toContain('1:55'); step(state, 499); expect(state.tick).toBe(failedAt + 599); expect(state.stats.retries).toBe(0);
    step(state); expect(state.events.find(event => event.data.type === 'retry')?.tick).toBe(failedAt + 600);
  });
  it('fractional power minimums use the stated >=time rule without rounding down', () => {
    CONFIG.progression.powerGainRetryMinSec = 30.01;
    const state = loseEight(), start = state.tick; step(state, 100); for (const hero of state.roster) hero.stars = 2;
    input(state, { type: 'autoEquip' }); step(state, 500); expect(state.stats.retries).toBe(0);
    step(state); expect(state.events.find(event => event.data.type === 'retry')?.tick).toBe(start + 601);
  });
  it('zero guard retries on the gain action tick; timer/manual retries ignore the guard', () => {
    CONFIG.progression.powerGainRetryMinSec = 0;
    const state = loseEight(), start = state.tick; step(state, 100); for (const hero of state.roster) hero.stars = 2; input(state, { type: 'autoEquip' });
    expect(state.events.find(event => event.data.type === 'retry')?.tick).toBe(start + 100);
    CONFIG.progression.powerGainRetryMinSec = 300;
    const timed = loseEight(); const failure = timed.tick; step(timed, 2400); expect(timed.events.find(event => event.data.type === 'retry')?.tick).toBe(failure + 2400);
    const manual = loseEight(); input(manual, { type: 'retry' }); expect(manual.stats.retries).toBe(1);
  });
  it('the non-boss retry guard never delays reference-policy BOSS_READY input', () => {
    CONFIG.progression.powerGainRetryMinSec = 300;
    const state = createState(); state.highestCleared = 9;
    state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 }; beginEncounter(state);
    referencePolicy(state, { revision: -1 }); expect(state.progress.kind).toBe('BOSS_FIGHT'); expect(state.stats.retries).toBe(1);
  });
  it('loads old1.1saves without failTick and infers backoff origin for the new guard', () => {
    CONFIG.progression.powerGainRetryMinSec = 30;
    const state = loseEight(), start = state.tick; if (state.progress.kind !== 'FARMING') throw new Error('Fixture');
    delete state.progress.failTick; state.balance = '1.1.0'; const loaded = load(JSON.stringify(state)); expect(loaded.balance).toBe(CONFIG.version);
    step(loaded, 100); for (const hero of loaded.roster) hero.stars = 2; input(loaded, { type: 'autoEquip' }); step(loaded, 499); expect(loaded.stats.retries).toBe(0);
    step(loaded); expect(loaded.events.find(event => event.data.type === 'retry')?.tick).toBe(start + 600);
  });
  it('boss countdown is wall-timed, includes wave gaps and hides in the stage rest', () => {
    const state = createState(); state.highestCleared = 9; state.progress = { kind: 'BOSS_FIGHT', stage: 10, failedPower: 0, bossLosses: 0 }; beginEncounter(state);
    state.tick += ticksForSeconds(6); expect(bossSecondsRemaining(state)).toBe(CONFIG.stages[9]?.timeoutSec ? (CONFIG.stages[9].timeoutSec - 6) : null);
    state.phase = { kind: 'rest', next: 'wave', remainingTicks: 1 }; expect(bossSecondsRemaining(state)).not.toBeNull();
    state.phase = { kind: 'rest', next: 'encounter', remainingTicks: 1 }; expect(bossSecondsRemaining(state)).toBeNull();
  });
});
