import { CONFIG } from '../config';
import type { EventData, GameState } from './model';
export function emit(state: GameState, data: EventData, combatTick?: number): void {
  state.eventSeq += 1;
  state.eventCounts[data.type] = (state.eventCounts[data.type] ?? 0) + 1;
  state.events.push({ seq: state.eventSeq, tick: state.tick, ...(combatTick === undefined ? {} : { combatTick,
    ...(state.combatRules === 'party-v2' ? { combatEncounter: state.encounter } : {}) }), data });
  if (state.events.length > CONFIG.runtime.eventLogLimit) state.events.shift();
}
export function goldChange(state: GameState, amount: number, reason: string): void {
  if (!amount) return;
  state.gold += amount;
  if (amount > 0) state.stats.goldEarned += amount;
  state.economyRevision += 1;
  emit(state, { type: 'gold', amount, total: state.gold, reason });
}
