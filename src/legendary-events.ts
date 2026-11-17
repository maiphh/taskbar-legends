import { heroConfig } from './config';
import type { GameEvent, Unit } from './core/model';

/** Consume a retained event log only when its authoritative sequence has advanced. */
export function consumeNewEvents(eventSeq: number, lastSeq: number, events: readonly GameEvent[], visit: (event: GameEvent) => void): number {
  if (eventSeq <= lastSeq) return lastSeq;
  for (const event of events) if (event.seq > lastSeq) visit(event);
  return Math.max(eventSeq, lastSeq);
}

/** Render-only Legendary triggers. Combat unit IDs are mapped through sourceId to roster configuration. */
export function triggerLegendaryEvent(event: GameEvent, party: readonly Unit[], enemies: readonly Unit[], trigger: (kind: 'skill' | 'drop', label: string) => void): void {
  const data = event.data;
  if (data.type === 'skill') {
    const caster = party.find(unit => unit.id === data.unitId) ?? enemies.find(unit => unit.id === data.unitId);
    if (caster?.side === 'hero' && heroConfig(caster.sourceId).rarity === 'legendary') trigger('skill', data.skill.replaceAll('-', ' ').toUpperCase());
  } else if (data.type === 'gear' && data.rarity === 'legendary') trigger('drop', `LEGENDARY ${data.slot.toUpperCase()}`);
}
