// §21 Legendary-safe overflow: gear.salvage.legendaryFloor (design.md §21).
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, SALVAGE_DESIGN, salvageSchema, setSalvageRules, setV14Rules } from '../src/config';
import type { SalvageRules } from '../src/config';
import { addGear, bestChoice, blankEquipment, chest, chooseChest, gearScore, isSpareLegendary, overflowCandidates, setLocked } from '../src/core/economy';
import { createState, load, snapshot } from '../src/core/game';
import { gearTemplateId, itemId } from '../src/core/model';
import type { GameState, Gear } from '../src/core/model';
import { runReference } from '../src/core/policy';
import { applyOffline } from '../src/core/save';
import { salvageToast } from '../src/salvage-copy';

afterEach(() => { setV14Rules([]); setSalvageRules('default'); });
const BASE: SalvageRules = { protectEquipped: true, protectLocked: true, lockMax: 30, slotRelative: true };
const FLOOR: SalvageRules = { ...BASE, legendaryFloor: true };

function item(state: GameState, slot: Gear['slot'], power: number, rarity: Gear['rarity'] = 'common'): Gear {
  const stats: Gear['stats'] = { hp: 0, atk: 0, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 };
  if (slot === 'weapon') stats.atk = power; else if (slot === 'armor') stats.hp = power; else stats.atkPct = power;
  return { id: itemId(state.seed, state.nextGearId++), templateId: gearTemplateId(slot, rarity), tradeable: false,
    acquiredAt: { tick: state.tick, source: 'drop' }, slot, rarity, dropStage: 1, level: 0, spent: 0, stats };
}
const has = (state: GameState, gear: Gear): boolean => state.inventory.some(entry => entry.id === gear.id);
const salvages = (state: GameState) => state.events.flatMap(event => event.data.type === 'salvage' ? [event.data] : []);
function fullRoster(state: GameState): void {
  for (const hero of CONFIG.heroes) if (!state.roster.some(owned => owned.id === hero.id)) state.roster.push({ id: hero.id, level: 1, xp: 0, stars: 1, equipment: blankEquipment() });
}

describe('§21 keys', () => {
  it('are optional and strict: absent = 1.4.4, wrong types are rejected', () => {
    expect(salvageSchema.parse(FLOOR)).toEqual(FLOOR);
    expect(() => salvageSchema.parse({ ...FLOOR, legendaryFloor: 1 })).toThrow();
    expect(() => salvageSchema.parse({ ...FLOOR, minPerSlot: 4 })).toThrow();
    expect(() => salvageSchema.parse({ ...FLOOR, legendaryStash: 5 })).toThrow();
    expect(SALVAGE_DESIGN).toEqual({ protectEquipped: true, protectLocked: true, lockMax: 30, slotRelative: true, legendaryFloor: true });
  });
  it('legendaryFloor false plays identically to absent', { timeout: 120_000 }, () => {
    const play = (rules: SalvageRules) => { setV14Rules(['chestChoice', 'farmChest', 'gearFortune', 'expeditionChests']); setSalvageRules(rules); const r = runReference(5, 1); applyOffline(r.state, 8 * 3600 * 1000); return snapshot(r.state); };
    expect(play({ ...BASE, legendaryFloor: false })).toBe(play(BASE));
  });
});

describe('§21 rarity floor', () => {
  it('a weak incoming Legendary is kept and the lowest non-Legendary candidate leaves instead (without the floor it is salvaged)', () => {
    for (const rules of [BASE, FLOOR]) {
      setSalvageRules(rules); const state = createState(2), bag: Gear[] = [];
      for (let index = 0; index < CONFIG.gear.inventoryCap; index += 1) { const gear = item(state, 'weapon', 1000 + index, 'epic'); addGear(state, gear); bag.push(gear); }
      const legendary = item(state, 'weapon', 1, 'legendary'); addGear(state, legendary);
      expect(state.inventory).toHaveLength(CONFIG.gear.inventoryCap);
      if (rules.legendaryFloor) { expect(has(state, legendary)).toBe(true); expect(has(state, bag[0]!)).toBe(false); expect(salvages(state)).toEqual([expect.objectContaining({ gearId: bag[0]!.id, reason: 'overflow' })]); }
      else expect(salvages(state)).toEqual([expect.objectContaining({ gearId: legendary.id, rarity: 'legendary', reason: 'incoming' })]);
    }
  });
  it('never picks a Legendary while any unequipped, unlocked non-Legendary exists, in any slot', () => {
    setSalvageRules(FLOOR); const state = createState(3);
    for (let index = 0; index < 49; index += 1) addGear(state, item(state, (['weapon', 'armor', 'charm'] as const)[index % 3]!, 1 + index, 'legendary'));
    const common = item(state, 'charm', 9999); addGear(state, common);
    const incoming = item(state, 'weapon', 0.5, 'legendary'); addGear(state, incoming);
    expect(has(state, incoming)).toBe(true); expect(has(state, common)).toBe(false);
    expect(state.inventory.every(entry => entry.rarity === 'legendary')).toBe(true);
  });
  it('the pick-1-of-2 auto-pick keeps the Legendary option; two non-Legendaries or two Legendaries still go by score', () => {
    const state = createState(4), legendary = item(state, 'charm', 0.05, 'legendary'), strong = item(state, 'weapon', 500, 'common'), weak = item(state, 'weapon', 5, 'legendary');
    setSalvageRules(BASE); expect(bestChoice([legendary, strong])).toBe(1);
    setSalvageRules(FLOOR); expect(bestChoice([legendary, strong])).toBe(0); expect(bestChoice([strong, legendary])).toBe(1);
    expect(bestChoice([strong, item(state, 'weapon', 600)])).toBe(1); expect(bestChoice([weak, legendary])).toBe(gearScore(legendary) > gearScore(weak) ? 1 : 0);
    setV14Rules(['chestChoice']); const queue = createState(5);
    for (let index = 0; index < 6; index += 1) chest(queue, 12);
    for (const options of [...(queue.pendingChoice ?? [])]) { void options; chooseChest(queue, bestChoice(queue.pendingChoice?.[0])); }
    expect(queue.pendingChoice).toBeUndefined();
  });
});

describe('§21 last resort', () => {
  it('every candidate Legendary: a spare one (same-slot Legendary scores at least as high) leaves, never the slot best', () => {
    setSalvageRules(FLOOR); const state = createState(6); fullRoster(state);
    const best = item(state, 'armor', 300, 'legendary'), spare = item(state, 'armor', 100, 'legendary'); addGear(state, best); addGear(state, spare);
    for (let index = 0; index < 48; index += 1) { const gear = item(state, 'weapon', 10 + index); addGear(state, gear); if (index < 30) setLocked(state, gear.id, true); else state.roster[index - 30]!.equipment.weapon = gear.id; }
    expect(isSpareLegendary(state, spare)).toBe(true); expect(isSpareLegendary(state, best)).toBe(false);
    const incoming = item(state, 'charm', 0.4, 'legendary');
    state.inventory.push(incoming); expect(overflowCandidates(state, incoming, FLOOR).map(entry => entry.id)).toEqual([spare.id]); state.inventory.pop();
    addGear(state, incoming);
    expect(has(state, incoming)).toBe(true); expect(has(state, best)).toBe(true); expect(has(state, spare)).toBe(false);
    expect(salvages(state).at(-1)).toMatchObject({ gearId: spare.id, rarity: 'legendary', reason: 'spareLegendary' });
    expect(state.metrics.salvageEquippedRemoved ?? 0).toBe(0);
  });
  it('all protected but the incoming Legendary, and it is not spare: it is salvaged as incoming (§19 edge, unchanged)', () => {
    setSalvageRules(FLOOR); const state = createState(7); fullRoster(state); const bag: Gear[] = [];
    for (let index = 0; index < 50; index += 1) { const gear = item(state, index < 48 ? 'weapon' : 'armor', 1 + index); addGear(state, gear); bag.push(gear); }
    bag.slice(0, 30).forEach(gear => setLocked(state, gear.id, true));
    bag.slice(30, 48).forEach((gear, index) => { state.roster[index]!.equipment.weapon = gear.id; }); bag.slice(48).forEach((gear, index) => { state.roster[index]!.equipment.armor = gear.id; });
    const incoming = item(state, 'charm', 0.5, 'legendary'); addGear(state, incoming);
    expect(has(state, incoming)).toBe(false); expect(bag.every(gear => has(state, gear))).toBe(true);
    expect(salvages(state).at(-1)).toMatchObject({ gearId: incoming.id, reason: 'incoming' });
  });
  it('save round-trip and toast copy', () => {
    setSalvageRules(FLOOR); const state = createState(9);
    for (let index = 0; index < 52; index += 1) addGear(state, item(state, 'armor', 1 + index, index % 7 ? 'rare' : 'legendary'));
    expect(snapshot(load(snapshot(state)))).toBe(snapshot(state));
    for (const slot of ['weapon', 'armor', 'charm']) {
      const toast = salvageToast({ rarity: 'legendary', slot, gold: 7, reason: 'spareLegendary' });
      expect(toast.length).toBeLessThanOrEqual(40); expect(toast).toMatch(/^(Bag full: spare|Spare) Legendary /);
    }
  });
});
