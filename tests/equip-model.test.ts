import { describe, expect, it } from 'vitest';
import { createState } from '../src/core/game';
import { gearScore } from '../src/core/economy';
import { autoEquipBest, equipList } from '../src/management/equip-model';

describe('per-hero equip view model', () => {
  it('filters by slot, sorts by economy gearScore, and reports the current wearer', () => {
    const state = createState(71), inventory = [...state.inventory];
    const weapon = inventory.find(item => item.slot === 'weapon'); if (!weapon) throw new Error('seed has no weapon');
    const stronger = { ...structuredClone(weapon), id:`${weapon.id}-stronger` as typeof weapon.id, level:weapon.level+1, stats:{...weapon.stats,atk:weapon.stats.atk+80} };
    inventory.push(stronger);
    const other = state.roster[1]; if (!other) throw new Error('seed has no second hero'); other.equipment.weapon = stronger.id;
    const weapons = inventory.filter(item => item.slot === 'weapon');
    expect(weapons.length).toBeGreaterThan(1);
    const rows = equipList(inventory, state.roster, 'weapon');
    expect(rows.every(row => row.gear.slot === 'weapon')).toBe(true);
    expect(rows[0]!.gear.id).toBe(weapons.slice().sort((a,b) => gearScore(b)-gearScore(a))[0]!.id);
    expect(rows.find(row => row.gear.id === stronger.id)?.wornBy?.id).toBe(other.id);
  });

  it('chooses the highest-score item of each slot and excludes already-best equipment', () => {
    const state = createState(72), hero = state.roster[0]!;
    const picks = autoEquipBest(hero, state.inventory);
    const best = (['weapon','armor','charm'] as const).map(slot => state.inventory.filter(item => item.slot === slot).slice().sort((a,b) => gearScore(b)-gearScore(a))[0]).filter((item): item is NonNullable<typeof item> => item !== undefined);
    expect(picks.map(item => item.id)).toEqual(best.filter(item => item.id !== hero.equipment[item.slot]).map(item => item.id));
    for (const item of picks) expect(item.id).not.toBe(hero.equipment[item.slot]);
  });
});
