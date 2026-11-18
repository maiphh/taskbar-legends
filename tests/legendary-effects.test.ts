import { describe, expect, it } from 'vitest';
import { createState, snapshot } from '../src/core/game';
import { activeEffectLayers, effectRandom, LegendaryEffects } from '../src/legendary-effects';
import { LEGENDARY_VFX_SPECS } from '../src/legendary-vfx-spec';

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
  it('activates timeline layers and strips motion layers for reduced motion', () => {
    expect(activeEffectLayers(LEGENDARY_VFX_SPECS.skill, 200).map(layer => layer.type)).toContain('rays');
    expect(activeEffectLayers(LEGENDARY_VFX_SPECS.skill, 20, true).map(layer => layer.type)).not.toContain('hitstop');
    expect(activeEffectLayers(LEGENDARY_VFX_SPECS.skill, 20, true).map(layer => layer.type)).toContain('banner');
  });
  it('has stable per-trigger random samples and supports seeking without simulation access', () => {
    expect(effectRandom(123, 4)).toBe(effectRandom(123, 4));
    const state = createState(9182), before = snapshot(state), effects = new LegendaryEffects();
    effects.trigger('skill', 100, 'HOLY SMITE'); effects.seek(400);
    expect(effects.current(900)?.age).toBe(400); expect(snapshot(state)).toBe(before);
  });
  it('is idle after expiry and does not advance game ticks', () => {
    const state = createState(91), before = snapshot(state), effects = new LegendaryEffects();
    expect(effects.isActive()).toBe(false); effects.trigger('drop', 0, 'LEGENDARY WEAPON');
    expect(effects.isActive()).toBe(true); effects.current(1000); expect(effects.isActive()).toBe(false);
    expect(state.tick).toBe(0); expect(snapshot(state)).toBe(before);
  });
});
