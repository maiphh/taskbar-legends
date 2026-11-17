import { describe, expect, it, vi } from 'vitest';
import { createState } from '../src/core/game';
import { emit } from '../src/core/events';
import { spawnParty } from '../src/core/combat';
import { consumeNewEvents, triggerLegendaryEvent } from '../src/legendary-events';
import type { GameEvent } from '../src/core/model';

describe('Legendary presentation event consumption', () => {
  it('triggers from a real combat unit skill event and ignores non-Legendary casters', () => {
    const state = createState(4421), template = state.roster[0]!;
    for (const id of ['mh3', 'priest']) if (!state.roster.some(hero => hero.id === id)) state.roster.push({ ...structuredClone(template), id });
    state.partyIds = ['mh3', 'mw1', 'priest']; spawnParty(state);
    const effects: string[] = [], trigger = (kind: string, label: string) => effects.push(`${kind}:${label}`);
    emit(state, { type: 'skill', unitId: 'hero-mh3', skill: 'heavy-single-burst' });
    emit(state, { type: 'skill', unitId: 'hero-mw1', skill: 'basic-strike' });
    let lastSeq = 0;
    const visit = (event: GameEvent) => triggerLegendaryEvent(event, state.party, state.enemies, trigger);
    lastSeq = consumeNewEvents(state.eventSeq, lastSeq, state.events, visit);
    consumeNewEvents(state.eventSeq, lastSeq, state.events, visit);
    expect(effects).toEqual(['skill:HEAVY SINGLE BURST']);
  });

  it('does not iterate retained history on unchanged idle frames', () => {
    let traversals = 0;
    const events = new Proxy([] as GameEvent[], { get(target, property, receiver) {
      if (property === Symbol.iterator) traversals += 1;
      return Reflect.get(target, property, receiver);
    } });
    expect(consumeNewEvents(20, 20, events, vi.fn())).toBe(20);
    expect(traversals).toBe(0);
  });
});
