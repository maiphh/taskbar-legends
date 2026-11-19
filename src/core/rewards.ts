import { CONFIG, stageConfig } from '../config';
import { queueChestChoice } from './economy';
import type { GameState } from './model';
import { getPartyEnemyDefinition } from './party-enemies';
import { normalizeSeed } from './rng';

/** Per-event kill rewards shared by combat and idle-rate estimation. */
export function partyKillReward(sourceId: string, stageNumber: number): { gold: number; xp: number } {
  const base = CONFIG.enemies[getPartyEnemyDefinition(sourceId).rewardKind];
  const mult = CONFIG.rewards.killScaling ** (stageNumber - 1);
  return { gold: Math.round(base.gold * mult), xp: Math.round(base.xp * mult) };
}

/** Per-clear rewards shared by campaign progression and repeat-farm estimates. */
export function stageClearReward(stageNumber: number): { gold: number; xp: number } {
  const stage = stageConfig(stageNumber), mult = CONFIG.rewards.clearScaling ** (stage.index - 1);
  return { gold: Math.round(CONFIG.rewards.clearGold * mult), xp: Math.round(CONFIG.rewards.clearXp * mult) };
}

/** Deterministic side stream for day-one spark rolls; never advances the campaign RNG. */
function dayOneSparkStream(seed: number, tick: number): number {
  let value = (normalizeSeed(seed) ^ Math.imul(tick >>> 0, 0x9e3779b9)) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

/**
 * Day-1 decision spark (v14.dayOneSpark, rules-on with chestChoice).
 * On a farm clear of a stage below belowStage during the first maxOpenHour open hours,
 * if gapSec have passed since the last spark (or none yet), queue a pick-1-of-2 at the farm stage
 * even when dropStage < chestChoice.fromStage. Returns true when a choice was queued.
 *
 * Rolls use a side RNG mixed from seed+tick so the campaign cursor and Fortune meter stay put;
 * nextGearId, pendingChoice, stats.chests, economyRevision, and dayOneSparkAtTick still update.
 */
export function maybeDayOneSpark(state: GameState, stage: number): boolean {
  const spark = CONFIG.v14.dayOneSpark;
  if (!spark || CONFIG.v14.chestChoice.options < 2) return false;
  if (stage >= spark.belowStage) return false;
  const openSeconds = state.tick / CONFIG.sim.ticksPerSecond;
  if (openSeconds >= spark.maxOpenHour * 3600) return false;
  const last = state.dayOneSparkAtTick;
  if (last !== undefined && (state.tick - last) / CONFIG.sim.ticksPerSecond < spark.gapSec) return false;
  const savedRng = state.rng;
  const savedSince = state.gearSinceLegendary;
  const savedFound = state.gearLegendaryFound;
  state.rng = dayOneSparkStream(state.seed, state.tick);
  queueChestChoice(state, stage);
  state.rng = savedRng;
  if (savedSince === undefined) delete state.gearSinceLegendary;
  else state.gearSinceLegendary = savedSince;
  if (savedFound === undefined) delete state.gearLegendaryFound;
  else state.gearLegendaryFound = savedFound;
  state.dayOneSparkAtTick = state.tick;
  return true;
}
