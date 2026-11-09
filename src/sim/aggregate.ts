import { CONFIG, ticksForSeconds } from '../config';
import { createState, step } from '../core/game';
import { gachaCohort, runReference } from '../core/policy';
import { distribution } from '../core/statistics';

export function measureReference(run: ReturnType<typeof runReference>) {
  const { state, milestones } = run;
  const firstClear = (stage: number): number | null => {
    const tick = state.metrics.firstClearTicks[String(stage)];
    return tick === undefined ? null : tick / CONFIG.sim.ticksPerSecond;
  };
  const bossOne = firstClear(10);
  const starter = createState(state.seed);
  step(starter, ticksForSeconds(3600));
  const pendingStalls = Object.entries(state.metrics.firstAttemptTicks)
    .filter(([stage]) => !state.metrics.firstClearTicks[stage] && !CONFIG.stages[Number(stage) - 1]?.isBoss)
    .map(([, tick]) => (state.tick - tick) / CONFIG.sim.ticksPerSecond);
  return {
    seed: state.seed, days: run.daily.length, firstFiveOpenSeconds: firstClear(5),
    bossOneOpenHours: bossOne === null ? null : bossOne / 3600,
    bossTwoDay: milestones.firstClearDay['20'] ?? null, fullRosterDay: milestones.fullRosterDay,
    starterHighestCleared: starter.highestCleared,
    farmMinSeconds: state.metrics.farmMinSeconds, farmMaxSeconds: state.metrics.farmMaxSeconds,
    farmSamples: state.metrics.farmSamples, farmTimingCounts: run.farmTimingCounts,
    maxNonBossStallSeconds: Math.max(state.metrics.maxNonBossStallSeconds, ...pendingStalls),
  };
}
export type ReferenceMeasurement = ReturnType<typeof measureReference>;

export function farmCycleDistribution(histograms: readonly (Record<string, number> | null)[]) {
  const counts: Record<string, number> = {};
  for (const histogram of histograms) for (const [ticks, count] of Object.entries(histogram ?? {})) counts[ticks] = (counts[ticks] ?? 0) + count;
  const values = Object.entries(counts).map(([ticks, count]) => ({ seconds: Number(ticks) / CONFIG.sim.ticksPerSecond, count })).sort((a, b) => a.seconds - b.seconds);
  const count = values.reduce((sum, value) => sum + value.count, 0);
  const at = (rank: number): number | null => {
    let cumulative = 0;
    for (const value of values) { cumulative += value.count; if (rank < cumulative) return value.seconds; }
    return null;
  };
  const quantile = (fraction: number): number | null => {
    if (!count) return null;
    const position = (count - 1) * fraction, lower = at(Math.floor(position)), upper = at(Math.ceil(position));
    return lower === null || upper === null ? null : lower + (upper - lower) * (position - Math.floor(position));
  };
  return { count, min: values[0]?.seconds ?? null, p10: quantile(0.1), median: quantile(0.5), p90: quantile(0.9), max: values.at(-1)?.seconds ?? null, countsByWallTicks: counts };
}
export function aggregateReference(samples: readonly ReferenceMeasurement[], gacha: ReturnType<typeof gachaCohort>) {
  if (samples.length === 0 || new Set(samples.map(sample => sample.seed)).size !== samples.length) throw new Error('Aggregate needs distinct, nonempty seed samples');
  const days = samples[0]?.days;
  if (samples.some(sample => sample.days !== days)) throw new Error('Aggregate samples must use the same day horizon');
  const firstFive = distribution(samples.map(sample => sample.firstFiveOpenSeconds));
  const chapterOne = distribution(samples.map(sample => sample.bossOneOpenHours));
  const chapterTwo = distribution(samples.map(sample => sample.bossTwoDay));
  const roster = distribution(samples.map(sample => sample.fullRosterDay));
  const starters = distribution(samples.map(sample => sample.starterHighestCleared));
  const farmMin = distribution(samples.map(sample => sample.farmMinSeconds));
  const farmMax = distribution(samples.map(sample => sample.farmMaxSeconds));
  const stall = distribution(samples.map(sample => sample.maxNonBossStallSeconds));
  const earlyClears = samples.filter(sample => sample.firstFiveOpenSeconds !== null && sample.firstFiveOpenSeconds <= 600).length;
  const rosterPass = roster.median === null ? ((days ?? 0) < 8 ? null : false) : roster.median >= 6 && roster.median <= 8;
  const gachaPass = gacha.medianPullsToFullRoster >= 100 && gacha.medianPullsToFullRoster <= 140;
  return {
    scope: 'Population reference-player cohort, not pooled ticks. Consecutive reference seeds; independent gacha seeds 1..N.',
    referencePlayer: CONFIG.referencePlayer, days, seedCount: samples.length, seeds: samples.map(sample => sample.seed),
    matchesDesignReferenceCohort: samples.length === 100 && samples.every((sample, index) => sample.seed === index + 1),
    quantileMethod: 'R-7 linear interpolation, p*(n-1). Censored/unreached values rank above finite observations and yield null when the quantile touches censoring. No survivor-only medians.',
    targets: [
      { id: 1, target: 'At least 95% clear 1-5 within 600 open seconds', unit: 'open seconds', distribution: firstFive,
        clearedWithin600: earlyClears, fractionWithin600: earlyClears / samples.length, pass: earlyClears / samples.length >= 0.95 },
      { id: 2, target: 'Median chapter 1 boss clear 1.5..2.5 open hours', unit: 'open hours', distribution: chapterOne,
        pass: chapterOne.median !== null && chapterOne.median >= 1.5 && chapterOne.median <= 2.5 },
      { id: 3, target: 'Median chapter 2 boss clear day 4..6', unit: 'day', distribution: chapterTwo,
        pass: chapterTwo.median === null ? ((days ?? 0) < 6 ? null : false) : chapterTwo.median >= 4 && chapterTwo.median <= 6 },
      { id: 4, target: 'Median reference full roster day 6..8 AND median 100..140 pulls in 10k gacha cohort', unit: 'day',
        distribution: roster, gacha: { ...gacha, pass: gachaPass },
        pass: !gachaPass ? false : rosterPass },
      { id: 5, target: 'Every no-input starter seed remains below 1-8 after 1 open hour', unit: 'highest cleared stage index', distribution: starters,
        violatingSeeds: samples.filter(sample => sample.starterHighestCleared >= 8).map(sample => sample.seed),
        pass: samples.every(sample => sample.starterHighestCleared < 8) },
      { id: 6, target: 'Every farm clear takes 20..40 seconds', unit: 'seconds', distribution: farmMax,
        minimumPerSeed: farmMin, maximumPerSeed: farmMax,
        samples: samples.reduce((sum, sample) => sum + sample.farmSamples, 0),
        pass: samples.some(sample => (sample.farmMinSeconds !== null && sample.farmMinSeconds < 20) || (sample.farmMaxSeconds !== null && sample.farmMaxSeconds > 40)) ? false
          : samples.some(sample => sample.farmSamples === 0) ? null : true },
      { id: 7, target: 'Every non-boss clears within 2700 open seconds of first attempt', unit: 'open seconds', distribution: stall,
        pass: samples.every(sample => sample.maxNonBossStallSeconds <= 2700) },
    ],
    farmCycles: farmCycleDistribution(samples.map(sample => sample.farmTimingCounts)),
    perSeed: samples,
  };
}
export function runReferenceAggregate(options: { firstSeed: number; seeds: number; days: number; gachaSeeds: number; onProgress?: (completed: number, seed: number) => void }) {
  if (!Number.isSafeInteger(options.seeds) || options.seeds < 1 || options.seeds > 1000) throw new Error('--seeds must be an integer from 1 to 1000');
  if (!Number.isSafeInteger(options.firstSeed) || options.firstSeed < 1 || options.firstSeed + options.seeds - 1 > 0xffffffff) throw new Error('Aggregate seed range must be within 1..4294967295');
  const measurements: ReferenceMeasurement[] = [];
  for (let index = 0; index < options.seeds; index += 1) {
    const seed = options.firstSeed + index;
    measurements.push(measureReference(runReference(seed, options.days, CONFIG.referencePlayer.openHoursPerDay * 3600, true)));
    options.onProgress?.(index + 1, seed);
  }
  return aggregateReference(measurements, gachaCohort(options.gachaSeeds));
}
