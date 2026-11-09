import { z } from 'zod';
import { CONFIG, TICK_MS, stageConfig } from '../config';
import { chest, grantXp } from './economy';
import { emit, goldChange } from './events';
import { cloneState, stateSchema } from './model';
import type { GameState } from './model';

const saveSchema = z.object({ format: z.literal('taskbar-legends-save-v1'), savedAtMs: z.number().finite().nonnegative(),
  remainderMs: z.number().nonnegative().lt(TICK_MS), state: stateSchema }).strict();
export function makeSave(state: GameState, savedAtMs: number, remainderMs = 0): string {
  return JSON.stringify(saveSchema.parse({ format: 'taskbar-legends-save-v1', savedAtMs, remainderMs, state }));
}
export function expectedFarmRewards(stageNumber: number) {
  const stage = stageConfig(stageNumber);
  let gold = Math.round(CONFIG.rewards.clearGold * CONFIG.rewards.clearScaling ** (stageNumber - 1));
  let xp = Math.round(CONFIG.rewards.clearXp * CONFIG.rewards.clearScaling ** (stageNumber - 1));
  const killMult = CONFIG.rewards.killScaling ** (stageNumber - 1);
  for (const wave of stage.waves) {
    const kinds = 'enemies' in wave ? wave.enemies : [wave.boss, ...wave.adds];
    for (const kind of kinds) { gold += Math.round(CONFIG.enemies[kind].gold * killMult); xp += Math.round(CONFIG.enemies[kind].xp * killMult); }
  }
  return { gold, xp };
}
export function applyOffline(state: GameState, elapsedMs: number) {
  if (!Number.isFinite(elapsedMs)) throw new Error('Invalid elapsed time');
  const seconds = Math.min(Math.max(0, elapsedMs / 1000), CONFIG.idle.offlineCapHours * 3600);
  const samples = state.metrics.farmClearSeconds;
  const average = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : CONFIG.idle.avgFarmClearSecDefault;
  const clears = Math.floor(seconds / average);
  const stage = Math.max(1, state.highestCleared);
  const rewards = expectedFarmRewards(stage);
  const gold = Math.floor(rewards.gold * clears * CONFIG.idle.offlineEfficiency);
  const xp = Math.floor(rewards.xp * clears * CONFIG.idle.offlineEfficiency);
  const chests = Math.min(CONFIG.idle.offlineChestMax, Math.floor(seconds / (CONFIG.idle.offlineChestEveryHours * 3600)));
  goldChange(state, gold, 'offline'); grantXp(state, xp, state.partyIds);
  for (let index = 0; index < chests; index += 1) chest(state, stage);
  state.stats.offlineClears += clears; state.stats.offlineSeconds += Math.floor(seconds);
  // Offline does not advance open ticks, progression, retry deadlines, or summon tickets.
  if (seconds) emit(state, { type: 'offline', seconds, clears, gold, xp, chests });
  return { seconds, clears, gold, xp, chests, capped: elapsedMs > CONFIG.idle.offlineCapHours * 3_600_000 };
}
export function restoreSave(raw: string, nowMs: number) {
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error('Invalid current timestamp');
  const value: unknown = JSON.parse(raw);
  const save = saveSchema.parse(value);
  const state = cloneState(save.state);
  const result = applyOffline(state, Math.max(0, nowMs - save.savedAtMs));
  return { state, ...result, remainderMs: save.remainderMs };
}
