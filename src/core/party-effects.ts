import { combatTime } from './clock';
import { ticksForSeconds } from '../config';
import { getPartyEnemyDefinition } from './party-enemies';
import type { GameState, PartyEffect, Unit } from './model';

function sourceAlive(state: GameState, sourceId: string): boolean {
  const source = [...state.party, ...state.enemies].find(unit => unit.id === sourceId);
  return Boolean(source && source.hp > 0);
}
export function activePartyEffects(state: GameState, targetId: string): PartyEffect[] {
  const now = combatTime(state), effects = state.partyEffects ?? [];
  return effects.filter(effect => effect.targetId === targetId && effect.expiresAtTick > now
    && (effect.stackPolicy !== 'sourceAura' || sourceAlive(state, effect.sourceId)));
}
export function prunePartyEffects(state: GameState): void {
  const now = combatTime(state);
  state.partyEffects = (state.partyEffects ?? []).filter(effect => effect.expiresAtTick > now
    && (effect.stackPolicy !== 'sourceAura' || sourceAlive(state, effect.sourceId)));
}
export function applyPartyEffect(state: GameState, next: PartyEffect): void {
  const effects = state.partyEffects ?? (state.partyEffects = []);
  const existing = effects.find(effect => effect.targetId === next.targetId && effect.group === next.group);
  if (!existing) { effects.push(next); return; }
  if (next.stackPolicy === 'strongestRefresh') {
    const wasStrongest = next.magnitude >= existing.magnitude;
    existing.magnitude = Math.max(existing.magnitude, next.magnitude);
    existing.expiresAtTick = Math.max(existing.expiresAtTick, next.expiresAtTick);
    existing.appliedAtTick = Math.max(existing.appliedAtTick, next.appliedAtTick);
    if (wasStrongest) existing.sourceId = next.sourceId;
  } else {
    existing.sourceId = next.sourceId; existing.magnitude = next.magnitude;
    existing.appliedAtTick = next.appliedAtTick; existing.expiresAtTick = next.expiresAtTick;
  }
}
function sum(state: GameState, unit: Unit, kind: PartyEffect['kind']): number {
  return activePartyEffects(state, unit.id).filter(effect => effect.kind === kind).reduce((total, effect) => total + effect.magnitude, 0);
}
export function effectiveAttack(state: GameState, unit: Unit): number {
  const bonus = Math.min(0.5, sum(state, unit, 'atkBonus'));
  const reduction = Math.min(0.5, sum(state, unit, 'atkReduction'));
  const enemy = state.combatRules === 'party-v2' && unit.side === 'enemy' ? getPartyEnemyDefinition(unit.sourceId) : undefined;
  const bossEnraged = Boolean(enemy?.special && ['bossLocal', 'bossGlobal'].includes(enemy.special.kind)
    && combatTime(state) - (unit.nativeBornTick ?? unit.bornTick) >= ticksForSeconds(60));
  return Math.max(0, unit.atk * (1 + bonus) * (1 - reduction) * (bossEnraged ? 1.5 : 1));
}
export function effectiveDefense(state: GameState, unit: Unit): number {
  return Math.max(0, unit.def * (1 - Math.min(0.6, sum(state, unit, 'defReduction'))));
}
export function effectiveDamageReduction(state: GameState, unit: Unit): number {
  return Math.min(0.5, sum(state, unit, 'damageReduction'));
}
export function effectActive(state: GameState, targetId: string, group: string): boolean {
  return activePartyEffects(state, targetId).some(effect => effect.group === group);
}
