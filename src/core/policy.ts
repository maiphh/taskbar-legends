import { CONFIG, heroConfig, ticksForSeconds } from '../config';
import { autoEquip, autoParty, cheapestEquippedUpgrade, drawHero, partyPower, pull, upgrade, upgradeCost } from './economy';
import { createState, input, step, summary } from './game';
import type { GameState } from './model';
import { applyOffline } from './save';
import { distribution } from './statistics';

export interface PolicyCursor { revision: number }
export function referencePolicy(state: GameState, cursor: PolicyCursor): void {
  if (cursor.revision !== state.economyRevision) {
    while (state.tickets >= CONFIG.gacha.costTickets) pull(state);
    autoParty(state); autoEquip(state);
    for (;;) {
      const item = cheapestEquippedUpgrade(state);
      if (!item || upgradeCost(item) > state.gold) break;
      upgrade(state, item.id);
    }
    cursor.revision = state.economyRevision;
  }
  const progress = state.progress;
  if (progress.kind === 'BOSS_READY' && (progress.bossLosses === 0 || partyPower(state) >= progress.failedPower * (1 + CONFIG.progression.powerGainRetryPct))) input(state, { type: 'retry' });
}
export function runReference(seed: number, days: number, openSecondsPerDay = CONFIG.referencePlayer.openHoursPerDay * 3600) {
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) throw new Error('Days must be an integer from 1 to 365');
  const state = createState(seed);
  const cursor: PolicyCursor = { revision: -1 };
  const milestones: { firstClearDay: Record<string, number>; fullRosterDay: number | null } = { firstClearDay: {}, fullRosterDay: null };
  const daily: { day: number; summary: ReturnType<typeof summary>; offlineBeforeSession: ReturnType<typeof applyOffline> | null }[] = [];
  for (let day = 1; day <= days; day += 1) {
    const offlineBeforeSession = day > 1 ? applyOffline(state, (24 * 3600 - openSecondsPerDay) * 1000) : null;
    const stopTick = state.tick + ticksForSeconds(openSecondsPerDay);
    while (state.tick < stopTick) {
      referencePolicy(state, cursor);
      step(state);
      if (state.metrics.fullRosterTick !== null && milestones.fullRosterDay === null) milestones.fullRosterDay = day;
      for (const stage of Object.keys(state.metrics.firstClearTicks)) milestones.firstClearDay[stage] ??= day;
    }
    referencePolicy(state, cursor);
    daily.push({ day, summary: summary(state), offlineBeforeSession });
  }
  return { state, daily, milestones };
}
export function gachaCohort(count: number) {
  const pulls: number[] = [];
  const rates = { common: 0, rare: 0, epic: 0, legendary: 0 };
  let total = 0;
  for (let seed = 1; seed <= count; seed += 1) {
    const rng = { rng: seed >>> 0 };
    const owned = new Set(CONFIG.heroes.filter(hero => hero.starter).map(hero => hero.id));
    let pity = 0, n = 0;
    while (owned.size < CONFIG.heroes.length) {
      const draw = drawHero(rng, pity, owned);
      pity = draw.nextPity; owned.add(draw.hero.id); n += 1; rates[draw.rarity] += 1; total += 1;
    }
    pulls.push(n);
  }
  pulls.sort((a, b) => a - b);
  const left = pulls[Math.floor((count - 1) / 2)] ?? 0, right = pulls[Math.floor(count / 2)] ?? 0;
  return { seeds: count, initialRoster: '3 starter heroes', medianPullsToFullRoster: (left + right) / 2,
    minPulls: pulls[0] ?? null, maxPulls: pulls.at(-1) ?? null,
    pullDistribution: distribution(pulls),
    observedRarityRates: Object.fromEntries(Object.entries(rates).map(([key, value]) => [key, value / total])) };
}
export function balanceReport(run: ReturnType<typeof runReference>, gachaSeeds = 10_000) {
  const state = run.state;
  const clear = (stage: number): number | null => {
    const value = state.metrics.firstClearTicks[String(stage)];
    return value === undefined ? null : value / CONFIG.sim.ticksPerSecond;
  };
  const first5 = clear(5), boss1 = clear(10), boss2day = run.milestones.firstClearDay['20'] ?? null;
  const starter = createState(state.seed); step(starter, ticksForSeconds(3600));
  const cohort = gachaCohort(gachaSeeds);
  const minFarm = state.metrics.farmMinSeconds, maxFarm = state.metrics.farmMaxSeconds;
  const rosterDay = run.milestones.fullRosterDay;
  const pending = Object.entries(state.metrics.firstAttemptTicks).filter(([stage]) => !state.metrics.firstClearTicks[stage] && !CONFIG.stages[Number(stage) - 1]?.isBoss)
    .map(([stage, tick]) => ({ stage, seconds: (state.tick - tick) / CONFIG.sim.ticksPerSecond }));
  const stall = Math.max(state.metrics.maxNonBossStallSeconds, ...pending.map(stage => stage.seconds));
  return {
    scope: 'Single seeded reference run. Per-run thresholds below are diagnostics, NOT 100-seed medians or a population pass. Gacha target uses its own specified cohort.',
    referencePolicy: CONFIG.referencePlayer,
    targets: [
      { id: 1, target: 'Clear 1-5 within 600 open seconds; >=95% of seeds 1..100', measured: { openSeconds: first5 }, pass: first5 !== null && first5 <= 600, aggregatePass: null, requiredCohort: 100 },
      { id: 2, target: 'Median chapter 1 boss clear between 1.5 and 2.5 open hours', measured: { openHours: boss1 === null ? null : boss1 / 3600 }, pass: boss1 !== null && boss1 >= 5400 && boss1 <= 9000, aggregatePass: null, requiredCohort: 100 },
      { id: 3, target: 'Median chapter 2 boss clear day 4..6', measured: { day: boss2day }, pass: boss2day !== null && boss2day >= 4 && boss2day <= 6, aggregatePass: null, requiredCohort: 100 },
      { id: 4, target: 'Median 100..140 pulls for all heroes (10k gacha seeds); reference owns all on day 6..8', measured: { ...cohort, referenceRosterDay: rosterDay },
        pass: rosterDay === null && run.daily.length < 8 ? null : cohort.medianPullsToFullRoster >= 100 && cohort.medianPullsToFullRoster <= 140 && rosterDay !== null && rosterDay >= 6 && rosterDay <= 8,
        status: rosterDay === null && run.daily.length < 8 ? 'reference-roster-pending-through-day-8' : 'measured',
        gachaPass: cohort.medianPullsToFullRoster >= 100 && cohort.medianPullsToFullRoster <= 140, referenceAggregatePass: null },
      { id: 5, target: 'No-input starters never clear 1-8 in 1 open hour', measured: { highestCleared: starter.highestCleared, firstClear1_8OpenSeconds: starter.metrics.firstClearTicks['8'] === undefined ? null : starter.metrics.firstClearTicks['8'] / CONFIG.sim.ticksPerSecond }, pass: starter.highestCleared < 8 },
      { id: 6, target: 'Every farm clear takes 20..40 seconds', measured: { minSeconds: minFarm, maxSeconds: maxFarm, samples: state.metrics.farmSamples }, pass: minFarm !== null && maxFarm !== null && minFarm >= 20 && maxFarm <= 40 },
      { id: 7, target: 'Every non-boss clears within 2700 open seconds of first attempt', measured: { maxSeconds: stall, pending }, pass: stall <= 2700 },
    ],
    partyRoles: state.partyIds.map(id => heroConfig(id).role),
  };
}
