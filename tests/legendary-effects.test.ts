import { describe, expect, it } from 'vitest';
import { createState, snapshot } from '../src/core/game';
import { LegendaryEffects } from '../src/legendary-effects';

describe('legendary presentation effects', () => {
  it('does not mutate game state and expires on its render clock', () => {
    const state = createState(9182), before = snapshot(state), effects = new LegendaryEffects();
    effects.trigger('skill', 100, 'HOLY SMITE');
    expect(snapshot(state)).toBe(before);
    expect(effects.current(200)?.kind).toBe('skill');
    expect(effects.current(1200)).toBeNull();
    effects.trigger('drop', 2000, 'LEGENDARY WEAPON');
    expect(effects.current(2999)?.kind).toBe('drop');
    expect(effects.current(3000)).toBeNull();
    expect(snapshot(state)).toBe(before);
  });
});
