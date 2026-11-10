import { describe, expect, it } from 'vitest';
import { CONFIG, stageConfig } from '../src/config';
import { createPartyState, load, snapshot } from '../src/core/game';
import { spawnWave } from '../src/core/combat';
import { step } from '../src/core/game';
import { getPartyEnemyDefinition, isPartyEnemyId, partyWaveKinds } from '../src/core/party-enemies';

describe('party-v2 enemy registry and wave overrides', () => {
  it('keeps party-only enemies out of the historical enemy enum and maps their approved visuals/rewards', () => {
    expect(isPartyEnemyId('assassin')).toBe(true); expect(isPartyEnemyId('bomber')).toBe(true);
    expect(isPartyEnemyId('legacy-unknown')).toBe(false);
    expect(getPartyEnemyDefinition('assassin')).toMatchObject({ hp: 65, atk: 60, def: 5, attackTicks: 24, range: 12, speed: 110, visualKind: 'grunt', rewardKind: 'grunt' });
    expect(getPartyEnemyDefinition('bomber')).toMatchObject({ hp: 90, atk: 45, def: 5, attackTicks: 30, range: 200, speed: 50, visualKind: 'brute', rewardKind: 'grunt' });
  });

  it('replaces one ordinary slot for the documented stages without changing wave sizes or bosses', () => {
    const waveAt = (stage: number, wave: number): string[] => {
      const definition = stageConfig(stage).waves[wave - 1]!;
      const kinds = 'enemies' in definition ? definition.enemies : [definition.boss, ...definition.adds];
      return partyWaveKinds(stage, wave, kinds, stageConfig(stage).isBoss);
    };
    expect(waveAt(11, 1).at(-1)).toBe('assassin');
    expect(waveAt(12, 1).at(-1)).toBe('assassin'); expect(waveAt(12, 2).at(-1)).toBe('bomber');
    for (let stage = 13; stage <= 19; stage += 1) {
      expect(waveAt(stage, 1)).toContain('assassin'); expect(waveAt(stage, 2)).toContain('bomber'); expect(waveAt(stage, 3)).toContain('bomber');
    }
    for (const stage of [11, 12, 13, 19]) for (let wave = 1; wave <= stageConfig(stage).waves.length; wave += 1) {
      const source = stageConfig(stage).waves[wave - 1]!;
      const original = 'enemies' in source ? source.enemies : [source.boss, ...source.adds];
      expect(waveAt(stage, wave)).toHaveLength(original.length);
    }
    for (const stage of CONFIG.stages.filter(value => value.isBoss)) {
      const wave = stageConfig(stage.index).waves[0]!;
      const original = 'enemies' in wave ? wave.enemies : [wave.boss, ...wave.adds];
      expect(partyWaveKinds(stage.index, 1, original, true)).toEqual(original);
    }
  });

  it('spawns and snapshots a scaled party-only assassin while leaving a legacy stage enemy-valid', () => {
    const state = createPartyState(251); state.highestCleared = 10; state.progress = { kind: 'PUSHING', stage: 11 }; state.wave = 1;
    spawnWave(state);
    const assassin = state.enemies.find(enemy => enemy.sourceId === 'assassin');
    expect(assassin).toMatchObject({ hp: Math.round(65 * CONFIG.enemies.scalingPerStage ** 10), maxHp: Math.round(65 * CONFIG.enemies.scalingPerStage ** 10), speed: 110, range: 12 });
    expect(assassin?.action).toEqual({ state: 'idle' });
    expect(load(snapshot(state)).enemies).toEqual(state.enemies);
  });

  it('keeps a healthy equal-progression starter support alive through the first real assassin response window', () => {
    const state = createPartyState(252); state.highestCleared = 10; state.progress = { kind: 'PUSHING', stage: 11 }; state.wave = 1; spawnWave(state);
    const assassin = state.enemies.find(enemy => enemy.sourceId === 'assassin')!, priest = state.party.find(unit => unit.sourceId === 'priest')!;
    expect(assassin.hp).toBe(Math.round(65 * CONFIG.enemies.scalingPerStage ** 10));
    const unguardedRaw = Math.max(1, Math.round(assassin.atk * 100 / (100 + priest.def)));
    expect(unguardedRaw).toBeLessThan(priest.hp);
    let response: 'intercepted' | 'defeated' | null = null;
    for (let tick = 0; tick < 1200 && state.phase.kind === 'battle' && !response; tick += 1) {
      step(state);
      if (state.events.some(event => event.data.type === 'guard' && event.data.fromTargetId === priest.id)) response = 'intercepted';
      else if (assassin.hp <= 0) response = 'defeated';
      expect(priest.hp).toBeGreaterThan(0);
    }
    expect(priest.hp).toBeGreaterThan(0);
    expect(response).not.toBeNull();
  });
});
