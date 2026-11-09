import { describe, expect, it } from 'vitest';
import { gachaCohort, runReference } from '../src/core/policy';
import { distribution } from '../src/core/statistics';
import { aggregateReference, measureReference, runReferenceAggregate } from '../src/sim/aggregate';
import type { ReferenceMeasurement } from '../src/sim/aggregate';

const fixture = (seed: number): ReferenceMeasurement => ({ seed, days: 7, firstFiveOpenSeconds: 500,
  bossOneOpenHours: 2, bossTwoDay: 5, fullRosterDay: 7, starterHighestCleared: 7,
  farmMinSeconds: 20, farmMaxSeconds: 40, farmSamples: 3, farmTimingCounts: null, maxNonBossStallSeconds: 2000 });
const gacha = { seeds: 10000, initialRoster: '3 starter heroes', medianPullsToFullRoster: 124,
  minPulls: 25, maxPulls: 803, pullDistribution: distribution([100, 124, 148]),
  observedRarityRates: { common: 0.5, rare: 0.33, epic: 0.13, legendary: 0.04 } };

describe('aggregate reference-player reports', () => {
  it('calculates R-7 p10/median/p90 and does not discard unreached seeds', () => {
    expect(distribution(Array.from({ length: 100 }, (_, index) => index + 1))).toEqual({ count: 100, observed: 100, censored: 0, p10: 10.9, median: 50.5, p90: 90.10000000000001 });
    expect(distribution([1, 2, null, null])).toEqual({ count: 4, observed: 2, censored: 2, p10: 1.3, median: null, p90: null });
    expect(distribution([])).toEqual({ count: 0, observed: 0, censored: 0, p10: null, median: null, p90: null });
    expect(() => distribution([NaN])).toThrow();
  });
  it('measures all seven targets, percentages and universal bounds rather than only medians', () => {
    const samples = Array.from({ length: 100 }, (_, index) => fixture(index + 1));
    const good = aggregateReference(samples, gacha);
    expect(good.matchesDesignReferenceCohort).toBe(true);
    expect(good.targets.map(target => target.pass)).toEqual([true, true, true, true, true, true, true]);
    for (const sample of samples.slice(0, 6)) sample.firstFiveOpenSeconds = 601;
    const last = samples.at(-1); if (!last) throw new Error('Fixture');
    last.farmMaxSeconds = 40.05; last.maxNonBossStallSeconds = 2700.05; last.starterHighestCleared = 8;
    const failed = aggregateReference(samples, gacha);
    expect(failed.targets.map(target => target.pass)).toEqual([false, true, true, true, false, false, false]);
    expect(failed.targets[0]?.distribution.median).toBe(500);
  });
  it('retains horizon censoring and distinguishes roster pending from definite failure', () => {
    const sample = { ...fixture(1), fullRosterDay: null, bossTwoDay: null };
    const report = aggregateReference([sample], gacha);
    expect(report.targets[3]?.pass).toBeNull();
    expect(report.targets[3]?.distribution.censored).toBe(1);
    expect(aggregateReference([{ ...sample, days: 8 }], gacha).targets[3]?.pass).toBe(false);
    expect(() => aggregateReference([], gacha)).toThrow();
    expect(() => aggregateReference([sample, sample], gacha)).toThrow();
    expect(() => aggregateReference([sample, { ...sample, seed: 2, days: 8 }], gacha)).toThrow();
  });
  it('is deterministic using actual seeded policy, offline sessions and gacha', () => {
    const run = () => aggregateReference([11, 12].map(seed => measureReference(runReference(seed, 2, 120))), gachaCohort(32));
    expect(run()).toEqual(run());
    expect(() => runReferenceAggregate({ firstSeed: 1, seeds: 0, days: 7, gachaSeeds: 10 })).toThrow();
    expect(() => runReferenceAggregate({ firstSeed: 0xffffffff, seeds: 2, days: 7, gachaSeeds: 10 })).toThrow();
  });
});
