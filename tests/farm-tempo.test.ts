import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, farmTempoSchema, ticksForSeconds } from '../src/config';
import { beginEncounter } from '../src/core/combat';
import { partyPower } from '../src/core/economy';
import { bossSecondsRemaining, createState, input, load, snapshot, statusText, step } from '../src/core/game';
import type { GameState } from '../src/core/model';
import { referencePolicy } from '../src/core/policy';
import { applyOffline } from '../src/core/save';
import { farmCycleDistribution } from '../src/sim/aggregate';
import { setFarmProofFixture } from './helpers/farm-proof-fixture';

// Clock arithmetic below is written for a 6 s stage gap (1.4.2 and 1.4.4; 1.4.3 shipped 8), so tempo() pins 6 and afterEach restores it.
const original = { scale: CONFIG.combat.nonBossFarmTimeScale, floor: CONFIG.combat.nonBossFarmMinCycleSec, retry: CONFIG.progression.powerGainRetryMinSec, gap: CONFIG.sim.stageGapSec, bossRepeat: CONFIG.combat.bossRepeatMinCycle };
afterEach(() => { CONFIG.combat.bossRepeatMinCycle = original.bossRepeat; CONFIG.combat.nonBossFarmTimeScale = original.scale; CONFIG.combat.nonBossFarmMinCycleSec = original.floor; CONFIG.progression.powerGainRetryMinSec = original.retry; CONFIG.sim.stageGapSec = original.gap; });
function tempo(scale: number, floor: number): void { CONFIG.combat.nonBossFarmTimeScale = scale; CONFIG.combat.nonBossFarmMinCycleSec = floor; CONFIG.sim.stageGapSec = 6; }
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
  it('advances farm-clock combat time by scale during battle when repeat tempo is configured', () => {
    tempo(3, 20); const state = controlled(1000);
    // Keep the wave alive so scale applies for the full step window.
    for (const enemy of state.enemies) { enemy.hp = 1e9; enemy.maxHp = 1e9; }
    for (const hero of state.party) { hero.gauge = 0; hero.atk = 0; }
    step(state, 10);
    expect(state.tick).toBe(10); expect(state.farmClock?.elapsedTicks).toBe(30);
    tempo(1, 0); state.farmClock!.scale = 1; state.farmClock!.remainder = 0; step(state);
    expect(state.farmClock?.elapsedTicks).toBe(31);
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
  it('records actual native time when an encounter takes longer than the configured floor', () => {
    // Tanky board so the scale-1 twin (and wall pad) both land above the 20 s floor.
    tempo(3, 20);
    const state = createState(11);
    for (const hero of state.roster) { hero.level = 8; hero.stars = 2; }
    state.highestCleared = 5;
    state.progress = { kind: 'FARMING', stage: 5, failedStage: 6, retryAtTick: 1e9, failTick: 0, failedPower: 1e9, failures: 1 };
    beginEncounter(state);
    state.wave = CONFIG.stages[4]?.waves.length ?? 3;
    const enemy = state.enemies[0]; if (!enemy) throw new Error('Fixture');
    state.enemies = [enemy];
    enemy.hp = 18_000; enemy.maxHp = 18_000; enemy.def = 40; enemy.atk = 1; enemy.x = 160; enemy.speed = 0;
    enemy.gauge = 0; enemy.action = { state: 'idle' }; delete enemy.specialAction;
    for (const hero of state.party) {
      hero.hp = hero.maxHp; hero.atk = 55; hero.def = 30; hero.gauge = hero.slot === 0 ? 10000 : 0;
      hero.action = { state: 'idle' }; hero.moving = false;
    }
    untilClear(state);
    expect(state.metrics.farmMaxSeconds).toBeGreaterThanOrEqual(20);
    expect(state.metrics.nativeFarmClearSeconds?.[0]).toBeGreaterThan(40);
    expect(state.metrics.nativeFarmClearSeconds?.[0] ?? 0).toBeGreaterThan(state.metrics.farmClearSeconds?.[0] ?? 0);
  });
  it('records wall farm clears in the 20–40 s band while native payout matches a scale-1 full-clip clear', () => {
    // Fixture: one tanky grunt. Full-clip push stays slow; scaled farm with short beats clears inside the T6 band.
    const toughFight = (kind: 'farm' | 'push' | 'farmScale1'): GameState => {
      tempo(kind === 'farmScale1' ? 1 : 3, 20);
      const state = createState(11);
      for (const hero of state.roster) { hero.level = 8; hero.stars = 2; }
      state.highestCleared = kind === 'push' ? 4 : 5;
      state.progress = kind === 'push'
        ? { kind: 'PUSHING', stage: 5 }
        : { kind: 'FARMING', stage: 5, failedStage: 6, retryAtTick: 1e9, failTick: 0, failedPower: 1e9, failures: 1 };
      beginEncounter(state);
      state.wave = CONFIG.stages[4]?.waves.length ?? 3;
      const enemy = state.enemies[0]; if (!enemy) throw new Error('Fixture');
      state.enemies = [enemy];
      enemy.hp = 18_000; enemy.maxHp = 18_000; enemy.def = 40; enemy.atk = 1; enemy.x = 160; enemy.speed = 0;
      enemy.gauge = 0; enemy.action = { state: 'idle' }; delete enemy.specialAction;
      for (const hero of state.party) {
        hero.hp = hero.maxHp; hero.atk = 55; hero.def = 30; hero.gauge = hero.slot === 0 ? 10000 : 0;
        hero.action = { state: 'idle' }; hero.moving = false;
      }
      return state;
    };
    const farm = toughFight('farm'), farmStart = farm.tick, farmClears = farm.stats.clears;
    for (let tick = 0; tick < 20_000 && farm.stats.clears === farmClears; tick += 1) step(farm);
    expect(farm.stats.clears).toBe(farmClears + 1);
    const farmWall = (farm.tick - farmStart) / CONFIG.sim.ticksPerSecond;
    expect(farmWall).toBeGreaterThanOrEqual(19.95);
    expect(farmWall).toBeLessThanOrEqual(40.05);
    expect(farm.metrics.farmMinSeconds).toBeGreaterThanOrEqual(19.95);
    expect(farm.metrics.farmMaxSeconds).toBeLessThanOrEqual(40.05);

    const push = toughFight('push'), pushStart = push.tick, pushClears = push.stats.clears;
    expect(push.farmClock).toBeUndefined();
    for (let tick = 0; tick < 40_000 && push.stats.clears === pushClears; tick += 1) step(push);
    expect(push.stats.clears).toBe(pushClears + 1);
    const pushWall = (push.tick - pushStart) / CONFIG.sim.ticksPerSecond;
    // Same board without farm clock keeps the long full-clip timeline (well above the 20–40 farm band).
    expect(pushWall).toBeGreaterThan(80);
    expect(pushWall).toBeGreaterThan(farmWall * 3);
    expect(farmWall).toBeLessThanOrEqual(40.05);

    // Scale-3 native payout equals the scale-1 full-clip clear (combat + stage gap); 8 h offline gold matches.
    const scale1 = toughFight('farmScale1');
    untilClear(scale1);
    expect(farm.metrics.nativeFarmClearSeconds?.[0]).toBeCloseTo(scale1.metrics.farmClearSeconds[0] ?? 0, 5);
    expect(farm.metrics.nativeFarmClearSeconds?.[0]).toBeGreaterThan(pushWall);
    const offlineFrom = (nativeSeconds: number): number => {
      const frozen = load(snapshot(farm));
      frozen.metrics.farmClearSeconds = [farmWall];
      frozen.metrics.nativeFarmClearSeconds = [nativeSeconds];
      setFarmProofFixture(frozen, 5, nativeSeconds, farmWall);
      return applyOffline(frozen, 8 * 3600000).gold;
    };
    expect(offlineFrom(farm.metrics.nativeFarmClearSeconds![0]!)).toBe(offlineFrom(scale1.metrics.farmClearSeconds[0]!));
  });

  it('applies the farm damage ramp only while farmClock.scale > 1 after the configured combat seconds', () => {
    tempo(3, 20);
    const state = controlled();
    const enemy = state.enemies[0]!; enemy.hp = 1e6; enemy.maxHp = 1e6; enemy.def = 0; enemy.x = 120;
    const hero = state.party[0]!; hero.atk = 100; hero.gauge = 10000; hero.x = 100; hero.action = { state: 'idle' };
    for (const unit of state.party) if (unit !== hero) { unit.hp = 0; unit.gauge = 0; }
    // Before the ramp window: one hit at base damage.
    step(state, 4);
    const earlyHit = [...state.events].reverse().find(event => event.data.type === 'hit' && event.data.attackerId === hero.id);
    expect(earlyHit?.data.type).toBe('hit');
    if (earlyHit?.data.type !== 'hit') throw new Error('expected hit');
    const baseDamage = earlyHit.data.damage;
    // Jump past farmDamageRampAfterSec on the farm clock and take another hit.
    state.farmClock!.elapsedTicks = ticksForSeconds(CONFIG.combat.farmDamageRampAfterSec ?? 20);
    hero.gauge = 10000; hero.action = { state: 'idle' }; enemy.hp = 1e6;
    const before = state.events.length;
    step(state, 6);
    const lateHit = state.events.slice(before).reverse().find(event => event.data.type === 'hit' && event.data.attackerId === hero.id);
    expect(lateHit?.data.type).toBe('hit');
    if (lateHit?.data.type !== 'hit') throw new Error('expected ramp hit');
    expect(lateHit.data.damage).toBe(Math.max(1, Math.round(baseDamage * (CONFIG.combat.farmDamageRampMult ?? 1.5))));
    // Push (no farm clock) never ramps.
    const push = createState(3); push.progress = { kind: 'PUSHING', stage: 1 }; beginEncounter(push);
    expect(push.farmClock).toBeUndefined();
  });

  it('applies the farm damage ramp to hero DoT ticks after the configured combat seconds', () => {
    tempo(3, 20);
    const state = controlled();
    const enemy = state.enemies[0]!; enemy.hp = 1e6; enemy.maxHp = 1e6; enemy.def = 0; enemy.x = 120;
    enemy.shield = 0; delete enemy.shieldProviderId; enemy.shieldUntilTick = 0;
    const hero = state.party[0]!; hero.atk = 100; hero.gauge = 0; hero.x = 100; hero.action = { state: 'idle' };
    for (const unit of state.party) if (unit !== hero) { unit.hp = 0; unit.gauge = 0; }
    const magnitude = 0.1;
    const baseDot = Math.max(1, Math.round(enemy.maxHp * magnitude));
    enemy.statuses = [{ id: 'dot', sourceId: hero.id, targetId: enemy.id, stacks: 1, magnitude, turnsLeft: 3 }];
    // Force the enemy's own turn so the DoT ticks once at base (before the ramp window).
    enemy.gauge = 10000; enemy.action = { state: 'idle' };
    const beforeEarly = state.events.length;
    step(state, 6);
    const earlyDot = state.events.slice(beforeEarly).find(event => event.data.type === 'hit' && event.data.dot === true);
    expect(earlyDot?.data.type).toBe('hit');
    if (earlyDot?.data.type !== 'hit') throw new Error('expected early DoT');
    expect(earlyDot.data.damage).toBe(baseDot);
    // Past the ramp window on a scaled farm: same DoT amount is multiplied.
    state.farmClock!.elapsedTicks = ticksForSeconds(CONFIG.combat.farmDamageRampAfterSec ?? 20);
    enemy.hp = 1e6; enemy.statuses = [{ id: 'dot', sourceId: hero.id, targetId: enemy.id, stacks: 1, magnitude, turnsLeft: 3 }];
    enemy.gauge = 10000; enemy.action = { state: 'idle' };
    const beforeLate = state.events.length;
    step(state, 6);
    const lateDot = state.events.slice(beforeLate).find(event => event.data.type === 'hit' && event.data.dot === true);
    expect(lateDot?.data.type).toBe('hit');
    if (lateDot?.data.type !== 'hit') throw new Error('expected ramp DoT');
    expect(lateDot.data.damage).toBe(Math.max(1, Math.round(baseDot * (CONFIG.combat.farmDamageRampMult ?? 1.5))));
    // Push (no farm clock) keeps the base DoT.
    const push = createState(3); push.progress = { kind: 'PUSHING', stage: 1 }; beginEncounter(push);
    expect(push.farmClock).toBeUndefined();
    const pushEnemy = push.enemies[0]!;
    push.enemies = [pushEnemy];
    pushEnemy.hp = 1e6; pushEnemy.maxHp = 1e6; pushEnemy.def = 0; pushEnemy.x = 120; pushEnemy.atk = 1;
    pushEnemy.shield = 0; delete pushEnemy.shieldProviderId; pushEnemy.shieldUntilTick = 0;
    pushEnemy.moving = false; pushEnemy.speed = 0;
    const pushHero = push.party[0]!;
    for (const unit of push.party) { unit.hp = unit === pushHero ? unit.maxHp : 0; unit.gauge = 0; unit.atk = 0; unit.action = { state: 'idle' }; }
    pushEnemy.statuses = [{ id: 'dot', sourceId: pushHero.id, targetId: pushEnemy.id, stacks: 1, magnitude, turnsLeft: 3 }];
    pushEnemy.gauge = 10000; pushEnemy.action = { state: 'idle' };
    const beforePush = push.events.length;
    step(push, 8);
    const pushDot = push.events.slice(beforePush).find(event => event.data.type === 'hit' && event.data.dot === true);
    expect(pushDot?.data.type).toBe('hit');
    if (pushDot?.data.type !== 'hit') throw new Error('expected push DoT');
    expect(pushDot.data.damage).toBe(baseDot);
  });
  it('never allocates or uses a tempo clock for pushes or boss fights/repeats (bossRepeatMinCycle absent, 1.4.3)', () => {
    const run = (scale: number, floor: number, boss: boolean, repeatBoss = false): GameState => {
      tempo(scale, floor); delete (CONFIG.combat as { bossRepeatMinCycle?: boolean }).bossRepeatMinCycle; const state = createState(2);
      if (boss) {
        state.highestCleared = repeatBoss ? 20 : 9;
        state.progress = repeatBoss ? { kind: 'COMPLETE', stage: 20 } : { kind: 'BOSS_FIGHT', stage: 10, failedPower: 0, bossLosses: 0 };
        beginEncounter(state);
      }
      step(state, 200); return state;
    };
    for (const [boss, repeatBoss] of [[false, false], [true, false], [true, true]]) {
      const a = run(1, 0, boss ?? false, repeatBoss), b = run(3, 20, boss ?? false, repeatBoss);
      if (a.encounterFarmContext && b.encounterFarmContext) {
        a.encounterFarmContext.rulesSignature = b.encounterFarmContext.rulesSignature;
      }
      expect(a).toEqual(b); expect(b.farmClock).toBeUndefined();
    }
  });
  it('§20: with bossRepeatMinCycle a COMPLETE boss repeat gets a scale-1 clock; boss fights and pushes still get none', () => {
    const run = (progress: GameState['progress'], highest: number): GameState => {
      tempo(3, 20); CONFIG.combat.bossRepeatMinCycle = true; const state = createState(2);
      state.highestCleared = highest; state.progress = progress; beginEncounter(state); return state;
    };
    expect(run({ kind: 'COMPLETE', stage: 20 }, 20).farmClock).toEqual({ scale: 1, minCycleTicks: 400, elapsedTicks: 0, remainder: 0 });
    expect(run({ kind: 'BOSS_FIGHT', stage: 10, failedPower: 0, bossLosses: 0 }, 9).farmClock).toBeUndefined();
    expect(run({ kind: 'BOSS_FIGHT', stage: 20, failedPower: 0, bossLosses: 0 }, 19).farmClock).toBeUndefined();
    expect(run({ kind: 'PUSHING', stage: 3 }, 2).farmClock).toBeUndefined();
    // Non-boss repeats keep the configured acceleration.
    expect(run({ kind: 'COMPLETE', stage: 20 }, 20).farmClock?.scale).toBe(1);
    expect(run({ kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 }, 9).farmClock?.scale).toBe(3);
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
    setFarmProofFixture(frozen, 1, 35, 20);
    const results: { state: GameState; report: ReturnType<typeof applyOffline> }[] = [], raw: number[] = [];
    for (const [scale, floor] of [[1, 0], [3, 20]]) {
      tempo(scale ?? 1, floor ?? 0);
      const current = load(snapshot(frozen)); setFarmProofFixture(current, 1, 35, 20);
      for (const hours of [8, 12]) {
        const state = load(snapshot(current)); const report = applyOffline(state, hours * 3600000); raw.push(report.rawSeconds);
        // rawSeconds (pre-cap time, #8) legitimately differs between 8h and 12h; everything credited must not.
        for (const event of state.events) if (event.data.type === 'offline') event.data.rawSeconds = event.data.seconds;
        results.push({ state, report: { ...report, rawSeconds: report.seconds, capped: false } });
      }
    }
    expect(raw).toEqual([28800, 43200, 28800, 43200]);
    const withoutRuntimeFingerprint = (value: typeof results[number]) => {
      const state = structuredClone(value.state);
      if (state.encounterFarmContext) state.encounterFarmContext.rulesSignature = 'tempo-test';
      for (const proof of state.farmProofs ?? []) proof.rulesSignature = 'tempo-test';
      return { ...value, state };
    };
    expect(withoutRuntimeFingerprint(results[1]!)).toEqual(withoutRuntimeFingerprint(results[0]!));
    expect(withoutRuntimeFingerprint(results[2]!)).toEqual(withoutRuntimeFingerprint(results[0]!));
    expect(withoutRuntimeFingerprint(results[3]!)).toEqual(withoutRuntimeFingerprint(results[0]!));
    expect(results[0]?.report.clears).toBe(Math.floor(28800 / 35));
    const legacyAverage = load(snapshot(frozen)); delete legacyAverage.metrics.nativeFarmClearSeconds;
    delete legacyAverage.farmProofs;
    expect(applyOffline(legacyAverage, 8 * 3600000).clears).toBe(Math.floor(28800 / CONFIG.idle.avgFarmClearSecDefault));
  });
  it('aggregates frequency-weighted current farm timing samples into exact quantiles', () => {
    const data = farmCycleDistribution([{ '400': 2, '800': 2 }]);
    expect(data).toMatchObject({ count: 4, min: 20, p10: 20, median: 30, p90: 40, max: 40 });
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
    state.tick += ticksForSeconds(6);
    const bossStage = CONFIG.stages[9];
    expect(bossSecondsRemaining(state)).toBe(bossStage?.isBoss ? bossStage.timeoutSec - 6 : null);
    state.phase = { kind: 'rest', next: 'wave', remainingTicks: 1 }; expect(bossSecondsRemaining(state)).not.toBeNull();
    state.phase = { kind: 'rest', next: 'encounter', remainingTicks: 1 }; expect(bossSecondsRemaining(state)).toBeNull();
  });
});
