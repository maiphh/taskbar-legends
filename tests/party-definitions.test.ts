import { describe, expect, it } from 'vitest';
import { CONFIG, heroConfig } from '../src/config';
import { heroStats } from '../src/core/economy';
import { createPartyState, createState } from '../src/core/game';
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

  it('uses family profiles for party-v2 stats and leaves legacy role-derived stats unchanged', () => {
    const legacy = createState(12), preview = createPartyState(12);
    const legacyHero = legacy.roster.find(hero => hero.id === 'wiz')!;
    const partyHero = preview.roster.find(hero => hero.id === 'wiz')!;
    const oldRole = CONFIG.roles[heroConfig('wiz').role], original = heroConfig('wiz');
    const legacyStats = heroStats(legacy, legacyHero), previewStats = heroStats(preview, partyHero);
    const legacyGrowth = CONFIG.rarity.statMult[original.rarity] * (1 + CONFIG.growth.perLevel * (legacyHero.level - 1)) * (1 + CONFIG.growth.perStar * (legacyHero.stars - 1));
    expect(legacyStats).toMatchObject({ maxHp: Math.round(oldRole.hp * (original.mod.hp ?? 1) * legacyGrowth), atk: Math.round(oldRole.atk * (original.mod.atk ?? 1) * legacyGrowth), def: Math.round(oldRole.def * (original.mod.def ?? 1) * legacyGrowth), attackTicks: oldRole.attackIntervalTicks, range: oldRole.rangePx });
    const profile = getPartyHeroDefinition('wiz').familyStats;
    expect(previewStats).toMatchObject({ maxHp: Math.round(profile.hp * (original.mod.hp ?? 1) * legacyGrowth), atk: Math.round(profile.atk * (original.mod.atk ?? 1) * legacyGrowth), def: Math.round(profile.def * (original.mod.def ?? 1) * legacyGrowth), attackTicks: profile.attackTicks, range: 260 });
    expect(heroStats(preview, { id: 'hu2', level: 1, xp: 0, stars: 1, equipment: { weapon: null, armor: null, charm: null } }).range).toBe(320);
  });

  it('accepts optional party preset and lock fields without adding them to legacy snapshots', () => {
    const legacy = createState(13), party = createPartyState(13);
    expect(legacy.roster.every(hero => hero.partyLocked === undefined)).toBe(true);
    const withOptions = structuredClone(party);
    withOptions.partyPreset = 'balanced'; withOptions.roster[0]!.partyLocked = true;
    expect(parseState(withOptions).partyPreset).toBe('balanced');
    expect(parseState(withOptions).roster[0]!.partyLocked).toBe(true);
  });
});
