import { CONFIG, stageConfig } from '../config';
import { getPartyEnemyDefinition } from './party-enemies';

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
