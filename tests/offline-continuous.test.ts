import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, setV14Rules } from '../src/config';
import { createState, snapshot } from '../src/core/game';
import { getPartyEnemyDefinition, partyWaveKinds } from '../src/core/party-enemies';
import { decodeSave, encodeSave, expectedFarmRewards, applyOffline, makeSave, restoreSave } from '../src/core/save';
import type { GameState } from '../src/core/model';
import { setFarmProofFixture } from './helpers/farm-proof-fixture';

const HOUR = 3_600_000;
function farmer(seed = 73): GameState {
  const state = createState(seed); state.metrics.farmClearSeconds = [30]; setFarmProofFixture(state, 1, 30, 30); return state;
}
const persistedCopy = (state: GameState): GameState => decodeSave(encodeSave({ state, savedAtMs: 1234, remainderMs: 0 })).state;

afterEach(() => setV14Rules([]));

describe('continuous idle reward rates', () => {
  it('prices the actual padded/replaced encounters and agrees with authored per-kill rounding', () => {
    for (const stage of CONFIG.stages) {
      const clearGold = Math.round(CONFIG.rewards.clearGold * CONFIG.rewards.clearScaling ** (stage.index - 1));
      const clearXp = Math.round(CONFIG.rewards.clearXp * CONFIG.rewards.clearScaling ** (stage.index - 1));
      let gold = clearGold, xp = clearXp;
      stage.waves.forEach((wave, index) => {
        const original = 'enemies' in wave ? wave.enemies : [wave.boss, ...wave.adds];
        for (const sourceId of partyWaveKinds(stage.index, index + 1, original, stage.isBoss)) {
          const rewardKind = getPartyEnemyDefinition(sourceId).rewardKind;
          const base = CONFIG.enemies[rewardKind];
          const mult = CONFIG.rewards.killScaling ** (stage.index - 1);
          gold += Math.round(base.gold * mult); xp += Math.round(base.xp * mult);
        }
      });
      expect(expectedFarmRewards(stage.index), stage.id).toEqual({ gold, xp });
    }
    expect(expectedFarmRewards(9).gold).toBe(226);
    expect(expectedFarmRewards(11).gold).toBe(119);
    expect(expectedFarmRewards(20).gold).toBe(2593);
  });

  it('makes three 10-second visits equal one 30-second absence across save roundtrips', () => {
    const one = farmer(), split = farmer();
    const before = one.gold, expected = expectedFarmRewards(1);
    const oneResult = applyOffline(one, 30_000);
    const partialResults = [];
    let continued = split;
    for (let index = 0; index < 3; index += 1) { partialResults.push(applyOffline(continued, 10_000)); continued = persistedCopy(continued); }
    expect(one.gold - before).toBe(Math.floor(30 / 30 * expected.gold * CONFIG.idle.offlineEfficiency));
    expect(continued.gold).toBe(one.gold); expect(continued.offlineAccrual).toEqual(one.offlineAccrual);
    expect(continued.stats.offlineClears).toBe(one.stats.offlineClears);
    expect(continued.stats.offlineSeconds).toBe(one.stats.offlineSeconds);
    expect(continued.roster.filter(hero => continued.partyIds.includes(hero.id)).map(hero => [hero.level, hero.xp]))
      .toEqual(one.roster.filter(hero => one.partyIds.includes(hero.id)).map(hero => [hero.level, hero.xp]));
    expect(partialResults[0]?.clears).toBe(0); expect(oneResult.clears).toBe(1);
    expect(continued.highestCleared).toBe(1); expect(continued.progress).toEqual({ kind: 'PUSHING', stage: 2 });
  });

  it('carries normal and expedition chest thresholds across visits and never converts their banks', () => {
    const once = farmer(), split = farmer();
    expect(applyOffline(once, 2 * HOUR).chests).toBe(1);
    for (let index = 0; index < 4; index += 1) applyOffline(split, HOUR / 2);
    expect(split.stats.chests).toBe(once.stats.chests); expect(split.rng).toBe(once.rng);
    const state = farmer(); applyOffline(state, HOUR / 2);
    const normalBank = state.offlineAccrual?.normalChestFraction;
    setV14Rules(['expeditionChests']); applyOffline(state, HOUR / 2);
    expect(state.offlineAccrual?.normalChestFraction).toBe(normalBank);
    expect(state.offlineAccrual?.expeditionChestFraction).toBeCloseTo(0.75, 10);
    setV14Rules([]); applyOffline(state, HOUR / 2);
    expect(state.offlineAccrual?.normalChestFraction).toBeCloseTo(0.5, 10);
  });

  it('does not reprice old partial resources when the stage and clear-rate sample change', () => {
    const state = farmer(); state.metrics.farmClearSeconds = [100]; setFarmProofFixture(state, 1, 100, 100);
    const stageOne = expectedFarmRewards(1).gold, stageNine = expectedFarmRewards(9).gold;
    const rate = CONFIG.idle.offlineEfficiency;
    const oldOwed = 10 / 100 * stageOne * rate, firstWhole = Math.floor(oldOwed);
    applyOffline(state, 10_000);
    state.highestCleared = 9; state.metrics.farmClearSeconds = [60]; setFarmProofFixture(state, 9, 60, 60);
    const newOwed = 10 / 60 * stageNine * rate, total = oldOwed - firstWhole + newOwed;
    const before = state.gold; const second = applyOffline(state, 10_000);
    expect(state.gold - before).toBe(Math.floor(total));
    expect(second.stage).toBe(9); expect(state.offlineAccrual?.goldFraction).toBeCloseTo(total - Math.floor(total), 8);
  });

  it('preserves cap rules and leaves all state untouched for zero/negative time', () => {
    const a = farmer(), b = farmer(); applyOffline(a, 8 * HOUR); applyOffline(b, 12 * HOUR);
    expect([a.gold, a.offlineAccrual, a.stats.offlineClears, a.stats.offlineSeconds, a.rng]).toEqual([b.gold, b.offlineAccrual, b.stats.offlineClears, b.stats.offlineSeconds, b.rng]);
    const state = farmer(); applyOffline(state, 10_000); const before = snapshot(state);
    expect(applyOffline(state, 0).seconds).toBe(0); expect(snapshot(state)).toBe(before);
    expect(applyOffline(state, -1_000).gold).toBe(0); expect(snapshot(state)).toBe(before);
    expect(() => applyOffline(state, Number.NaN)).toThrow(); expect(() => applyOffline(state, Number.POSITIVE_INFINITY)).toThrow();
  });

  it('roundtrips new banks, loads an old bankless save as zero, and rejects invalid fractions', () => {
    const old = farmer(), oldCopy = persistedCopy(old); expect(oldCopy.offlineAccrual).toBeUndefined();
    applyOffline(old, 10_000); const expected = old.offlineAccrual;
    expect(persistedCopy(old).offlineAccrual).toEqual(expected);
    expect(restoreSave(makeSave(old, 12_000), 12_000).state.offlineAccrual).toEqual(expected);
    for (const fraction of [-0.1, 1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bad = structuredClone(old); bad.offlineAccrual!.goldFraction = fraction;
      expect(() => encodeSave({ state: bad, savedAtMs: 0, remainderMs: 0 })).toThrow();
    }
  });
});
