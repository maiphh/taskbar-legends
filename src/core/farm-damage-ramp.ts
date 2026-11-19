import { CONFIG, ticksForSeconds } from '../config';
import type { GameState, Unit } from './model';

/** Hero damage multiplier for scaled farm clocks after the configured combat seconds. Pushes (no clock) and scale-1 pads stay at 1. */
export function farmDamageRampMultiplier(state: GameState, source: Unit): number {
  const clock = state.farmClock;
  if (source.side !== 'hero' || !clock || clock.scale <= 1) return 1;
  const afterSec = CONFIG.combat.farmDamageRampAfterSec, mult = CONFIG.combat.farmDamageRampMult;
  if (afterSec === undefined || mult === undefined) return 1;
  if (clock.elapsedTicks < ticksForSeconds(afterSec)) return 1;
  return mult;
}
