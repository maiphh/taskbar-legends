import { CONFIG, stageConfig } from '../config';
import type { GameState } from './model';

export function combatTime(state: GameState): number { return state.farmClock?.elapsedTicks ?? state.tick; }
export function captureFarmClock(state: GameState): void {
  delete state.farmClock;
  const progress = state.progress;
  const repeat = progress.kind === 'FARMING' || progress.kind === 'BOSS_READY' || progress.kind === 'COMPLETE';
  if (!repeat || progress.stage > state.highestCleared || stageConfig(progress.stage).isBoss) return;
  const scale = CONFIG.combat.nonBossFarmTimeScale, minCycleTicks = Math.ceil(CONFIG.combat.nonBossFarmMinCycleSec * CONFIG.sim.ticksPerSecond);
  if (scale === 1 && minCycleTicks === 0) return;
  state.farmClock = { scale, minCycleTicks, elapsedTicks: 0, remainder: 0 };
}
