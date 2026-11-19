import { describe, expect, it } from 'vitest';
import { createState, snapshot } from '../src/core/game';
import { activeEffectLayers, effectRandom, LegendaryEffects } from '../src/legendary-effects';
import { LEGENDARY_VFX_SPECS } from '../src/legendary-vfx-spec';
import { dropCardSize, LanePositionCache, PresentationLaneClock } from '../src/legendary-presentation';

describe('legendary presentation effects', () => {
  it('does not mutate game state and expires on its render clock', () => {
    const state = createState(9182), before = snapshot(state), effects = new LegendaryEffects();
    effects.trigger('skill', 100, 'HOLY SMITE');
    expect(snapshot(state)).toBe(before);
    expect(effects.current(200)?.kind).toBe('skill');
    expect(effects.current(1899)?.kind).toBe('skill');
    expect(effects.current(1900)).toBeNull();
    effects.trigger('drop', 2000, 'LEGENDARY WEAPON');
    expect(effects.current(4099)?.kind).toBe('drop');
    expect(effects.current(4100)).toBeNull();
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
    expect(effects.isActive()).toBe(true); effects.current(2100); expect(effects.isActive()).toBe(false);
    expect(state.tick).toBe(0); expect(snapshot(state)).toBe(before);
  });
  it('uses the requested readable timelines and strips every animated layer in reduced motion', () => {
    expect(LEGENDARY_VFX_SPECS.skill.durationMs).toBeGreaterThanOrEqual(1600);
    expect(LEGENDARY_VFX_SPECS.skill.durationMs).toBeLessThanOrEqual(2000);
    expect(LEGENDARY_VFX_SPECS.drop.durationMs).toBeGreaterThanOrEqual(1800);
    expect(LEGENDARY_VFX_SPECS.drop.durationMs).toBeLessThanOrEqual(2200);
    expect(activeEffectLayers(LEGENDARY_VFX_SPECS.drop, 300, true).map(layer => layer.type)).toEqual(['banner']);
    expect(activeEffectLayers(LEGENDARY_VFX_SPECS.skill, 200).find(layer => layer.type === 'hitstop')?.params.holdMs).toBe(140);
  });
  it('keeps the lane clock monotonic through pause, tick gaps, repeated casts, and replacement', () => {
    const clock = new PresentationLaneClock(), hitstop = { holdMs: 140, slowFactor: 0.5 };
    clock.reset(10, 'a:1');
    expect(clock.sample(12, hitstop, 100, false, false, 'a:1').time).toBe(10);
    expect(clock.sample(14, hitstop, 200, false, false, 'a:1').time).toBe(11);
    expect(clock.sample(14, hitstop, 220, true, false, 'a:1').time).toBe(11);
    expect(clock.sample(20, hitstop, 240, false, false, 'a:1').time).toBe(14);
    expect(clock.sample(21, null, 500, false, false, 'a:1').time).toBe(21);
    expect(clock.sample(23, hitstop, 100, false, false, 'a:1').time).toBe(21);
    expect(clock.sample(24, null, 500, false, false, 'a:1').time).toBe(24);
    expect(clock.sample(3, null, 0, false, false, 'b:1').time).toBe(3);
  });
  it('freezes from the current rendered position and prunes expired projectile positions each frame', () => {
    const positions = new LanePositionCache();
    positions.beginFrame(); expect(positions.sample('unit', 100, 1, 1)).toBe(100); expect(positions.sample('projectile', 40, 1, 1)).toBe(40); positions.endFrame();
    positions.beginFrame(); expect(positions.sample('unit', 150, 0, 2)).toBe(100); positions.endFrame();
    positions.beginFrame(); expect(positions.sample('unit', 200, 1, 3)).toBe(200); positions.endFrame();
    positions.beginFrame(); expect(positions.sample('unit', 230, 0, 4)).toBe(200); positions.endFrame();
    positions.beginFrame(); positions.sample('unit', 230, 1, 5); positions.endFrame();
    expect(positions.has('projectile')).toBe(false);
  });
  it('applies half-speed movement once per simulation sample regardless of render count and catches up at normal speed', () => {
    const simulate = (rendersPerSample: number) => {
      const positions = new LanePositionCache(); let result: number;
      positions.beginFrame(); result = positions.sample('projectile', 100, 0, 0); positions.endFrame();
      for (let tick = 1; tick <= 5; tick += 1) {
        for (let frame = 0; frame < rendersPerSample; frame += 1) {
          positions.beginFrame(); result = positions.sample('projectile', 100 + tick * 20, 0.5, tick); positions.endFrame();
        }
      }
      return { positions, result };
    };
    const once = simulate(1), many = simulate(4);
    expect(once.result).toBe(150);
    expect(many.result).toBe(150);
    many.positions.beginFrame(); expect(many.positions.sample('projectile', 200, 0.5, 5)).toBe(150); many.positions.endFrame();
    many.positions.beginFrame(); expect(many.positions.sample('projectile', 220, 1, 6)).toBe(220); many.positions.endFrame();
  });
  it('uses small integer card dimensions throughout the card pop', () => {
    expect([0, 48, 96, 144, 192, 240, 1349].map(age => dropCardSize(age))).toEqual([48, 52, 60, 56, 48, 48, 48]);
    expect(LEGENDARY_VFX_SPECS.drop.layers.find(layer => layer.type === 'cardPop')).toMatchObject({ startMs: 180, params: { stepMs: 48, popMs: 240 } });
  });
});
