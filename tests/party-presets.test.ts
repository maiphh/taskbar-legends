import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { autoEquip, autoParty, equip, heroStats, partyBasicDpsForStats, partyGearUtilityGain, realizedBasicCycleTicks, togglePartyLock } from '../src/core/economy';
import { createPartyState, createState, input } from '../src/core/game';
import { getPartyHeroDefinition } from '../src/core/party-definitions';
import type { GameState, Gear, ItemId } from '../src/core/model';
import { ManagementAuthority } from '../src/management/authority';

function allHeroes(state: GameState): void {
  for (const hero of CONFIG.heroes) if (!state.roster.some(value => value.id === hero.id)) state.roster.push({ id: hero.id, level: 1, xp: 0, stars: 1, equipment: { weapon: null, armor: null, charm: null } });
}
function gear(state: GameState, slot: Gear['slot'], stats: Gear['stats']): Gear {
  const serial = state.nextGearId++;
  const id = `itm_${state.seed.toString(16).padStart(8, '0')}_${serial.toString(16).padStart(8, '0')}` as ItemId;
  return { id, templateId: `starter-${slot}`, tradeable: false,
    acquiredAt: { tick: state.tick, source: 'starter' }, slot, rarity: 'common', dropStage: 1, level: 0, spent: 0, stats };
}

describe('party-v2 presets, locks, and wearer-aware equipment', () => {
  it('selects balanced tank, damage, and healer coverage without duplicate IDs', () => {
    const state = createPartyState(799); allHeroes(state);
    autoParty(state, 'balanced');
    expect(new Set(state.partyIds).size).toBe(3);
    expect(getPartyHeroDefinition(state.partyIds[0]!).role).toBe('tank');
    expect(state.partyIds.some(id => getPartyHeroDefinition(id).tags.includes('healer'))).toBe(true);
    expect(state.partyPreset).toBe('balanced');
  });
  it('chooses requested roles using derived stats and puts the unlocked tank in front', () => {
    const state = createPartyState(800); allHeroes(state);
    const weakTank = state.roster.find(hero => hero.id === 'mw2')!; weakTank.level = 1;
    const strongTank = state.roster.find(hero => hero.id === 'hk1')!; strongTank.level = CONFIG.growth.levelCap; strongTank.stars = CONFIG.growth.starMax;
    const mage = state.roster.find(hero => hero.id === 'wiz')!; mage.level = 4;
    const ranged = state.roster.find(hero => hero.id === 'hu1')!; ranged.level = 2;
    autoParty(state, 'fastFarm');
    expect(state.partyIds).toHaveLength(3);
    expect(getPartyHeroDefinition(state.partyIds[0]!).role).toBe('tank');
    expect(getPartyHeroDefinition(state.partyIds[1]!).tags).toContain('melee');
    expect(getPartyHeroDefinition(state.partyIds[1]!).role).toBe('dps');
    expect(getPartyHeroDefinition(state.partyIds[2]!).tags).toContain('aoe');
    expect(state.partyIds).toContain('hk1');
  });

  it('keeps deployed locked slots fixed while filling the remaining slots in front-to-rear order', () => {
    const state = createPartyState(801); allHeroes(state);
    togglePartyLock(state, 'priest', true);
    autoParty(state, 'fastFarm');
    expect(state.partyIds[2]).toBe('priest');
    expect(getPartyHeroDefinition(state.partyIds[0]!).role).toBe('dps');
    expect(state.roster.find(hero => hero.id === 'priest')?.partyLocked).toBe(true);
    const snapshot = structuredClone(state); input(snapshot, { type: 'lockHero', heroId: 'priest', locked: false });
    expect(snapshot.roster.find(hero => hero.id === 'priest')?.partyLocked).toBeUndefined();
  });

  it('uses wearer-specific marginal utility so a damage weapon goes to DPS and armor to tank', () => {
    const state = createPartyState(802);
    state.partyIds = ['mw2', 'mw1', 'hu1'];
    state.inventory.push(gear(state, 'weapon', { hp: 0, atk: 70, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 }));
    state.inventory.push(gear(state, 'armor', { hp: 150, atk: 0, def: 45, hpPct: 0, atkPct: 0, speedPct: 0 }));
    expect(partyGearUtilityGain(state, 'mw1', state.inventory.find(item => item.slot === 'weapon')!.id)).toBeGreaterThan(0);
    autoEquip(state);
    const weapon = state.inventory.find(item => item.slot === 'weapon')!, armor = state.inventory.find(item => item.slot === 'armor')!;
    expect(state.roster.find(hero => hero.equipment.weapon === weapon.id)?.id).toMatch(/^(mw1|hu1)$/);
    expect(state.roster.find(hero => hero.equipment.armor === armor.id)?.id).toBe('mw2');
  });

  it('keeps bench donor utility continuous when its last zero-stat item is added and transfers a weapon without consuming RNG', () => {
    const state = createPartyState(805); allHeroes(state); state.partyIds = ['mw2', 'mw1', 'priest'];
    const weapon = gear(state, 'weapon', { hp: 0, atk: 10, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 }); state.inventory.push(weapon);
    const wiz = state.roster.find(hero => hero.id === 'wiz')!;
    wiz.equipment.weapon = weapon.id;
    const gainWithoutLastCharm = partyGearUtilityGain(state, 'mw1', weapon.id);
    const charm = gear(state, 'charm', { hp: 0, atk: 0, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 }); state.inventory.push(charm); wiz.equipment.charm = charm.id;
    expect(partyGearUtilityGain(state, 'mw1', weapon.id)).toBeCloseTo(gainWithoutLastCharm, 12);
    const authority = new ManagementAuthority(state), comparison = authority.compareGear('mw1', weapon.id)!;
    expect(comparison.partyUtilityGain).toBeCloseTo(gainWithoutLastCharm, 12);
    expect(comparison.delta.basicDps).toBeCloseTo(partyBasicDpsForStats('mw1', comparison.after) - partyBasicDpsForStats('mw1', comparison.before), 10);
    const rngBefore = state.rng; autoEquip(state);
    expect(state.rng).toBe(rngBefore);
    expect(state.roster.find(hero => hero.equipment.weapon === weapon.id)?.id).not.toBe('wiz');
  });

  it('keeps actual attack intervals clamped and uses the six-tick action floor for synthetic intervals', () => {
    const state = createPartyState(803), hero = state.roster.find(value => value.id === 'mw1')!;
    const charm = gear(state, 'charm', { hp: 0, atk: 0, def: 0, hpPct: 0, atkPct: 0, speedPct: 5 });
    state.inventory.push(charm); equip(state, hero.id, charm.id);
    expect(heroStats(state, hero).attackTicks).toBe(CONFIG.runtime.minAttackIntervalTicks);
    expect(realizedBasicCycleTicks({ attackTicks: 4 })).toBe(6);
    expect(realizedBasicCycleTicks({ attackTicks: 2 })).toBe(6);
    const slower = createPartyState(804), slowerHero = slower.roster.find(value => value.id === 'mw1')!;
    const slowerCharm = gear(slower, 'charm', { hp: 0, atk: 0, def: 0, hpPct: 0, atkPct: 0, speedPct: 2 });
    slower.inventory.push(slowerCharm); equip(slower, slowerHero.id, slowerCharm.id);
    expect(heroStats(slower, slowerHero).attackTicks).toBe(CONFIG.runtime.minAttackIntervalTicks);
    expect(realizedBasicCycleTicks(heroStats(slower, slowerHero))).toBe(realizedBasicCycleTicks(heroStats(state, hero)));
    const authority = new ManagementAuthority(state);
    const dps = authority.snapshot().heroStats[hero.id]!.atk * CONFIG.sim.ticksPerSecond / realizedBasicCycleTicks(authority.snapshot().heroStats[hero.id]!);
    expect(dps).toBeLessThanOrEqual(authority.snapshot().heroStats[hero.id]!.atk * CONFIG.sim.ticksPerSecond / 6);
  });

  it('leaves legacy preset calculations on the old path', () => {
    const state = createState(804), before = [...state.partyIds]; autoParty(state);
    expect(state.combatRules).toBeUndefined(); expect(state.partyIds).toHaveLength(before.length);
    expect(state.partyPreset).toBeUndefined();
  });
});
