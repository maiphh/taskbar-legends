import { CONFIG, stageConfig } from '../config';
import type { GameState } from './model';

export function combatTime(state: GameState): number { return state.farmClock?.elapsedTicks ?? state.tick; }
export function captureFarmClock(state: GameState): void {
  delete state.farmClock;
  const progress = state.progress;
  const repeat = progress.kind === 'FARMING' || progress.kind === 'BOSS_READY' || progress.kind === 'COMPLETE';
  // §20: after the campaign the farm stage is the boss2 stage. With combat.bossRepeatMinCycle its repeats get the
  // min-cycle pad at scale 1 (padding, never acceleration, §4); without the key boss stages keep no clock.
  const bossRepeat = isBossRepeat(state);
  if (!repeat || progress.stage > state.highestCleared || (stageConfig(progress.stage).isBoss && !bossRepeat)) return;
  const scale = bossRepeat ? 1 : CONFIG.combat.nonBossFarmTimeScale, minCycleTicks = Math.ceil(CONFIG.combat.nonBossFarmMinCycleSec * CONFIG.sim.ticksPerSecond);
  if (scale === 1 && minCycleTicks === 0) return;
  state.farmClock = { scale, minCycleTicks, elapsedTicks: 0, remainder: 0 };
}
export function isBossRepeat(state: GameState): boolean {
  return state.progress.kind === 'COMPLETE' && stageConfig(state.progress.stage).isBoss && CONFIG.combat.bossRepeatMinCycle === true;
}
