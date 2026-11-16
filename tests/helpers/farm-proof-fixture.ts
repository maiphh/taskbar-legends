import { currentFarmRulesSignature } from '../../src/core/farm-proof';
import { CONFIG, stageConfig } from '../../src/config';
import { getOwned, heroStats } from '../../src/core/economy';
import type { GameState } from '../../src/core/model';

/** Explicit proof fixture for rate arithmetic tests; real certification is exercised by game-step tests. */
export function setFarmProofFixture(state: GameState, stage = Math.max(1, state.highestCleared), nativeSeconds = 30, wallSeconds = nativeSeconds): void {
  const heroes = state.partyIds.map(id => ({ id, ...heroStats(state, getOwned(state, id)) }));
  state.highestCleared = Math.max(state.highestCleared, stage);
  if (state.progress.kind === 'PUSHING' && state.progress.stage <= stage) {
    state.progress = stage >= CONFIG.stages.length ? { kind: 'COMPLETE', stage }
      : stageConfig(stage + 1).isBoss ? { kind: 'BOSS_READY', stage, bossStage: stage + 1, failedPower: state.attemptPower, bossLosses: 0 }
        : { kind: 'PUSHING', stage: stage + 1 };
  }
  state.farmProofs = [{ stage, rulesSignature: currentFarmRulesSignature(), heroes: structuredClone(heroes).map(({ id, maxHp, atk, def, attackTicks }) => ({ id, maxHp, atk, def, attackTicks })),
    nativeSeconds: [nativeSeconds], wallSeconds: [wallSeconds] }];
}
