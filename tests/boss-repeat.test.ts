// design.md §20: COMPLETE boss repeats padded to combat.nonBossFarmMinCycleSec at native speed (combat.bossRepeatMinCycle).
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, setSalvageRules, setV14Rules, ticksForSeconds } from '../src/config';
import { beginEncounter } from '../src/core/combat';
import { bossSecondsRemaining, createState, load, snapshot, step } from '../src/core/game';
import { parseState } from '../src/core/model';
import type { GameState } from '../src/core/model';
import { runReference } from '../src/core/policy';
import { applyOffline } from '../src/core/save';

// Config 1.4.5 rules-off golden (same constant as tests/v14.test.ts); with the key absent the run must still hash to it.
const V145_RULES_OFF_GOLDEN = '2512106f91a82c87211c0eeecc20aadb03287f5e17efa1e701a6306798516c0e';
const original = CONFIG.combat.bossRepeatMinCycle;
afterEach(() => { CONFIG.combat.bossRepeatMinCycle = original; setV14Rules([]); setSalvageRules('default'); });
const key = (on: boolean): void => { if (on) CONFIG.combat.bossRepeatMinCycle = true; else delete (CONFIG.combat as { bossRepeatMinCycle?: boolean }).bossRepeatMinCycle; };
const BOSS2 = CONFIG.stages.length;

/** Campaign complete, farming the boss2 stage; the last wave is one 1-HP enemy, so the boss2 kill takes `fightTicks`. */
function bossRepeat(fightTicks = 20): GameState {
  const state = createState(5); state.highestCleared = BOSS2; state.progress = { kind: 'COMPLETE', stage: BOSS2 };
  beginEncounter(state); state.wave = CONFIG.stages[BOSS2 - 1]?.waves.length ?? 1;
  const enemy = state.enemies[0]; if (!enemy) throw new Error('Fixture');
  state.enemies = [enemy]; enemy.hp = 1; enemy.maxHp = 1; enemy.def = 0; enemy.x = 10000; enemy.atk = 1;
  for (const hero of state.party) { hero.hp = 1e6; hero.maxHp = 1e6; hero.range = 1e6; hero.atk = 1; hero.cooldown = fightTicks; }
  return state;
}
function untilClear(state: GameState): void {
  const clears = state.stats.clears;
  for (let tick = 0; tick < 20_000 && state.stats.clears === clears; tick += 1) step(state);
  expect(state.stats.clears).toBe(clears + 1);
}
const last = (values: number[] | undefined): number | undefined => values?.[values.length - 1];

describe('§20 boss repeat min-cycle pad', () => {
  it('1. a COMPLETE boss2 kill under 14 s settles at the farm floor; native time stays the unpadded fight + gap', () => {
    key(true); const state = bossRepeat(); expect(state.farmClock?.scale).toBe(1);
    const start = state.stageStartedTick;
    for (let i = 0; i < 2000 && state.phase.kind === 'battle'; i += 1) step(state);
    const fightSeconds = (state.tick - start) / CONFIG.sim.ticksPerSecond; expect(fightSeconds).toBeLessThan(14);
    untilClear(state);
    const floor = CONFIG.combat.nonBossFarmMinCycleSec, wall = last(state.metrics.farmClearSeconds) ?? 0, native = last(state.metrics.nativeFarmClearSeconds) ?? 0;
    expect(wall).toBeGreaterThanOrEqual(floor); expect(wall).toBe(floor);
    expect(native).toBeCloseTo(fightSeconds + CONFIG.sim.stageGapSec, 6); expect(native).toBeLessThan(floor);
    expect(state.metrics.farmSamples).toBe(1); expect(state.progress).toEqual({ kind: 'COMPLETE', stage: BOSS2 });
    // The next repeat gets a fresh scale-1 clock.
    expect(state.farmClock).toMatchObject({ scale: 1, elapsedTicks: 0 });
  });
  it('2. with the key absent the boss repeat is unpadded (fight + stageGapSec) and the rules-off golden is unchanged (1.4.5 config)', { timeout: 60_000 }, () => {
    key(false); const state = bossRepeat(); expect(state.farmClock).toBeUndefined();
    untilClear(state);
    expect(last(state.metrics.farmClearSeconds)).toBeLessThan(CONFIG.combat.nonBossFarmMinCycleSec);
    expect(state.metrics.nativeFarmClearSeconds).toBeUndefined();
    setV14Rules([]); setSalvageRules('default');
    const run = runReference(3, 1); applyOffline(run.state, 9 * 3600 * 1000);
    expect(createHash('sha256').update(snapshot(run.state)).digest('hex')).toBe(V145_RULES_OFF_GOLDEN);
  });
  it('key on and key absent play the boss fight identically (padding is not acceleration, §4)', () => {
    const fight = (on: boolean) => { key(on); const state = bossRepeat(); for (let i = 0; i < 400 && state.phase.kind === 'battle'; i += 1) step(state); return state; };
    const on = fight(true), off = fight(false), before = (state: GameState) => state.events.filter(event => event.tick < state.tick).map(event => event.data);
    // Same kill tick and the same combat log up to it; only what follows the kill (pad vs immediate award) differs.
    expect(on.tick).toBe(off.tick); expect(before(on)).toEqual(before(off)); expect(on.phase.kind).toBe('farmPad'); expect(off.phase.kind).toBe('rest');
  });
  it('3. a save made mid-pad round-trips through load and settles identically', () => {
    key(true); const a = bossRepeat();
    for (let i = 0; i < 2000 && a.phase.kind !== 'farmPad'; i += 1) step(a);
    expect(a.phase.kind).toBe('farmPad'); step(a, ticksForSeconds(10));
    expect(a.phase.kind).toBe('farmPad'); expect(a.stats.clears).toBe(0);
    const b = load(snapshot(a)); expect(snapshot(b)).toBe(snapshot(a));
    untilClear(a); untilClear(b); expect(b).toEqual(a);
  });
  it('shows no boss countdown during the pad', () => {
    key(true); const state = bossRepeat();
    for (let i = 0; i < 2000 && state.phase.kind !== 'farmPad'; i += 1) step(state);
    expect(state.phase.kind).toBe('farmPad'); expect(bossSecondsRemaining(state)).toBeNull();
  });
  it('save validation accepts only a scale-1 clock on a COMPLETE boss stage', () => {
    key(true); const state = bossRepeat();
    expect(() => parseState(JSON.parse(snapshot(state)))).not.toThrow();
    const scaled = JSON.parse(snapshot(state)); scaled.farmClock.scale = 3; scaled.farmClock.remainder = 0;
    expect(() => parseState(scaled)).toThrow(/Tempo clock/);
    const fight = JSON.parse(snapshot(state)); fight.progress = { kind: 'BOSS_FIGHT', stage: BOSS2, failedPower: 0, bossLosses: 0 }; fight.highestCleared = BOSS2 - 1;
    expect(() => parseState(fight)).toThrow();
  });
});
