import { describe, expect, it } from 'vitest';
import { CONFIG, heroConfig } from '../src/config';
import { heroStats } from '../src/core/economy';
import { createState } from '../src/core/game';
import { getPartyHeroDefinition, getPartyHeroDefinitions, isPartyAbilityId } from '../src/core/party-definitions';
import { parseState } from '../src/core/model';

describe('versioned party hero definitions', () => {
  it('covers the configured roster exactly once and resolves each basic, active, and passive ID', () => {
    const definitions = getPartyHeroDefinitions();
    expect(definitions.map(value => value.id).sort()).toEqual(CONFIG.heroes.map(value => value.id).sort());
    expect(new Set(definitions.map(value => value.id)).size).toBe(18);
    for (const definition of definitions) {
      expect(isPartyAbilityId(definition.basic.id)).toBe(true);
      expect(isPartyAbilityId(definition.active.id)).toBe(true);
      expect(definition.active.manaCost).toBeGreaterThan(0);
      expect(isPartyAbilityId(definition.passive.id)).toBe(false);
      expect(definition.strength.length).toBeGreaterThan(0);
      expect(definition.weakness.length).toBeGreaterThan(0);
      if (['shield', 'weaken', 'buff'].includes(definition.active.kind)) expect(definition.active.durationTicks).toBeGreaterThan(0);
      if (['healGuard', 'firstWeakenShield', 'livingAura', 'fourthGuard'].includes(definition.passive.kind)) {
        expect(definition.passive.group).toBeTruthy();
        expect(definition.passive.durationTicks).toBeDefined();
      }
    }
  });

  it('uses family profiles for the current root party stats', () => {
    const current = createState(12);
    const hero = current.roster.find(value => value.id === 'wiz')!;
    const original = heroConfig('wiz'), currentStats = heroStats(current, hero);
    const growth = CONFIG.rarity.statMult[original.rarity] * (1 + CONFIG.growth.perLevel * (hero.level - 1)) * (1 + CONFIG.growth.perStar * (hero.stars - 1));
    const profile = getPartyHeroDefinition('wiz').familyStats;
    expect(currentStats).toMatchObject({ maxHp: Math.round(profile.hp * (original.mod.hp ?? 1) * growth), atk: Math.round(profile.atk * (original.mod.atk ?? 1) * growth), def: Math.round(profile.def * (original.mod.def ?? 1) * growth), attackTicks: profile.attackTicks, range: 260 });
    expect(heroStats(current, { id: 'hu2', level: 1, xp: 0, stars: 1, equipment: { weapon: null, armor: null, charm: null } }).range).toBe(320);
  });

  it('round-trips the current party preset and lock fields', () => {
    const withOptions = structuredClone(createState(13));
    withOptions.partyPreset = 'balanced'; withOptions.roster[0]!.partyLocked = true;
    expect(parseState(withOptions).partyPreset).toBe('balanced');
    expect(parseState(withOptions).roster[0]!.partyLocked).toBe(true);
  });
});
