// gear.salvage.slotRelative: overflow ranks candidates by gearScore ÷ the best gearScore in the same slot (design.md §19.7 follow-up).
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, SALVAGE_DEFAULTS, SALVAGE_DESIGN, salvageSchema, setSalvageRules, setV14Rules } from '../src/config';
import type { SalvageRules } from '../src/config';
import { addGear, blankEquipment, gearScore, overflowScores, setLocked } from '../src/core/economy';
import { createState, load, snapshot } from '../src/core/game';
import { gearTemplateId, itemId } from '../src/core/model';
import type { GameState, Gear } from '../src/core/model';
import { runReference } from '../src/core/policy';
import { applyOffline } from '../src/core/save';
import { runReferenceAggregate } from '../src/sim/aggregate';

afterEach(() => { setV14Rules([]); setSalvageRules('default'); });
const V144_RULES_OFF_GOLDEN = 'b70e3c561f785d36bf489bcbf7da085f24c12d167c2954ce878a424dfd07a07d';
const V144_AGGREGATE_2x1 = '04de8e49182b187b751570a13f9704d07cbb412f893cb89d0698261bef5bdf05';
// 1.4.5: balance '1.4.5' moves the rules-off golden (the aggregate has no balance string and keeps its 1.4.4 value); the §21 keys are not applied with the rules off.
const V145_RULES_OFF_GOLDEN = '2512106f91a82c87211c0eeecc20aadb03287f5e17efa1e701a6306798516c0e';
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const ON: SalvageRules = { protectEquipped: true, protectLocked: true, lockMax: 30, slotRelative: true };
const OFF: SalvageRules = { protectEquipped: true, protectLocked: true, lockMax: 30 };

function item(state: GameState, slot: Gear['slot'], power: number, rarity: Gear['rarity'] = 'common'): Gear {
  const stats: Gear['stats'] = { hp: 0, atk: 0, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 };
  if (slot === 'weapon') stats.atk = power; else if (slot === 'armor') stats.hp = power; else stats.atkPct = power;
  return { id: itemId(state.seed, state.nextGearId++), templateId: gearTemplateId(slot, rarity), tradeable: false,
    acquiredAt: { tick: state.tick, source: 'drop' }, slot, rarity, dropStage: 1, level: 0, spent: 0, stats };
}
/** 50 weapons with atk 100..149: raw scores far above any charm, so the global rule always salvages an incoming charm first. */
function weaponBag(state: GameState): Gear[] {
  const items: Gear[] = [];
  for (let index = 0; index < CONFIG.gear.inventoryCap; index += 1) { const gear = item(state, 'weapon', 100 + index); addGear(state, gear); items.push(gear); }
  return items;
}
const has = (state: GameState, gear: Gear): boolean => state.inventory.some(entry => entry.id === gear.id);
const count = (state: GameState, slot: Gear['slot']): number => state.inventory.filter(entry => entry.slot === slot).length;

describe('gear.salvage.slotRelative', () => {
  it('is optional: the 1.4.4 defaults carry no slotRelative; 1.4.5 ships it on (with §21 legendaryFloor)', () => {
    expect(SALVAGE_DEFAULTS.slotRelative).toBeUndefined();
    expect(SALVAGE_DESIGN).toEqual({ protectEquipped: true, protectLocked: true, lockMax: 30, slotRelative: true, legendaryFloor: true });
    expect(salvageSchema.parse(ON)).toEqual(ON); expect(() => salvageSchema.parse({ ...ON, slotRelative: 1 })).toThrow();
    expect(setSalvageRules('design').slotRelative).toBe(true);
  });
  it('keys absent: rules-off golden and the 2-seed aggregate are the 1.4.5 protection-off references; slotRelative false equals absent', { timeout: 120_000 }, () => {
    setV14Rules([]); setSalvageRules('default');
    const run = runReference(3, 1); applyOffline(run.state, 9 * 3600 * 1000);
    expect(sha(snapshot(run.state))).toBe(V145_RULES_OFF_GOLDEN); expect(sha(snapshot(run.state))).not.toBe(V144_RULES_OFF_GOLDEN);
    setV14Rules([]); setSalvageRules('default');
    const report = runReferenceAggregate({ firstSeed: 1, seeds: 2, days: 1, gachaSeeds: 32 });
    expect(sha(JSON.stringify({ targets: report.targets, seedCount: report.seedCount, days: report.days }))).toBe(V144_AGGREGATE_2x1);
    // With the §19 block on, slotRelative false is the same game as slotRelative absent.
    const play = (rules: SalvageRules) => { setV14Rules(['chestChoice', 'farmChest', 'gearFortune', 'expeditionChests']); setSalvageRules(rules); const r = runReference(5, 1); applyOffline(r.state, 8 * 3600 * 1000); return snapshot(r.state); };
    expect(play({ ...OFF, slotRelative: false })).toBe(play(OFF));
  });
  it('scores each item against the best item of its slot', () => {
    const state = createState(1), w1 = item(state, 'weapon', 100), w2 = item(state, 'weapon', 50), c1 = item(state, 'charm', 0.2), c2 = item(state, 'charm', 0.1);
    const rank = overflowScores([w1, w2, c1, c2], true);
    expect(rank.get(w1.id)).toBe(1); expect(rank.get(c1.id)).toBe(1); expect(rank.get(w2.id)).toBeCloseTo(0.5); expect(rank.get(c2.id)).toBeCloseTo(0.5);
    expect(overflowScores([w1, c1], false).get(c1.id)).toBe(gearScore(c1));
  });
  it('a Legendary charm or armor arriving into a weapon-full bag is kept (global salvages it on arrival)', () => {
    for (const slot of ['charm', 'armor'] as const) {
      for (const rules of [OFF, ON]) {
        setSalvageRules(rules); const state = createState(2), weapons = weaponBag(state);
        const legendary = item(state, slot, slot === 'charm' ? 0.3 : 20, 'legendary'); addGear(state, legendary);
        expect(state.inventory).toHaveLength(CONFIG.gear.inventoryCap);
        const salvage = state.events.filter(event => event.data.type === 'salvage').map(event => event.data);
        if (rules.slotRelative) {
          expect(has(state, legendary)).toBe(true); expect(has(state, weapons[0]!)).toBe(false);
          expect(salvage).toEqual([expect.objectContaining({ gearId: weapons[0]!.id, slot: 'weapon', reason: 'overflow' })]);
        } else {
          expect(has(state, legendary)).toBe(false); expect(salvage).toEqual([expect.objectContaining({ gearId: legendary.id, reason: 'incoming' })]);
        }
      }
    }
  });
  it('per-slot retention: each slot keeps its best items under a stream of stronger weapons (global empties armor and charms)', () => {
    for (const rules of [OFF, ON]) {
      setSalvageRules(rules); const state = createState(3), armor: Gear[] = [], charms: Gear[] = [];
      for (let index = 0; index < 10; index += 1) { armor.push(item(state, 'armor', 5 + index)); charms.push(item(state, 'charm', 0.05 + index / 100)); }
      for (const gear of [...armor, ...charms]) addGear(state, gear);
      for (let index = 0; index < 230; index += 1) addGear(state, item(state, 'weapon', 100 + index * 3));
      if (!rules.slotRelative) { expect(count(state, 'armor') + count(state, 'charm')).toBe(0); continue; }
      // The best armor and best charm score 1 and are never the overflow pick; within a slot, removals go weakest first.
      expect(has(state, armor[9]!)).toBe(true); expect(has(state, charms[9]!)).toBe(true);
      for (const [slot, list] of [['armor', armor], ['charm', charms]] as const) {
        const kept = list.filter(gear => has(state, gear)); expect(kept).toEqual(list.slice(list.length - count(state, slot)));
      }
      // The strongest weapon is kept, and the weapons kept are the strongest ones.
      const weapons = state.inventory.filter(entry => entry.slot === 'weapon').map(gearScore).sort((a, b) => b - a);
      expect(weapons[0]).toBe(gearScore(item(state, 'weapon', 100 + 229 * 3)));
      expect(weapons).toEqual(Array.from({ length: weapons.length }, (_, index) => gearScore(item(state, 'weapon', 100 + (229 - index) * 3))));
    }
  });
  it('never removes an equipped or locked item, however low its slot-relative score; lock cap stays 30', () => {
    setSalvageRules(ON); const state = createState(4);
    for (const hero of CONFIG.heroes) if (!state.roster.some(owned => owned.id === hero.id)) state.roster.push({ id: hero.id, level: 1, xp: 0, stars: 1, equipment: blankEquipment() });
    const worst = item(state, 'armor', 1), weakCharm = item(state, 'charm', 0.01); addGear(state, worst); addGear(state, weakCharm);
    state.roster[0]!.equipment.armor = worst.id; setLocked(state, weakCharm.id, true);
    for (let index = 0; index < 48; index += 1) addGear(state, item(state, index % 2 ? 'armor' : 'charm', index % 2 ? 50 + index : 0.5 + index / 100));
    for (let index = 0; index < 100; index += 1) addGear(state, item(state, index % 3 === 0 ? 'weapon' : index % 3 === 1 ? 'armor' : 'charm', index % 3 === 0 ? 10 + index : index % 3 === 1 ? 60 + index : 0.6 + index / 100));
    expect(has(state, worst)).toBe(true); expect(state.roster[0]!.equipment.armor).toBe(worst.id); expect(has(state, weakCharm)).toBe(true);
    expect(state.metrics.salvageEquippedRemoved ?? 0).toBe(0); expect(state.inventory).toHaveLength(CONFIG.gear.inventoryCap);
    const unlocked = state.inventory.filter(entry => !entry.locked);
    for (const entry of unlocked.slice(0, 40)) setLocked(state, entry.id, true);
    expect(state.inventory.filter(entry => entry.locked)).toHaveLength(30);
    // Round-trip keeps the rule-independent state intact.
    expect(snapshot(load(snapshot(state)))).toBe(snapshot(state));
  });
  it('all 50 protected: the incoming item is the only candidate and is salvaged, as in §19', () => {
    setSalvageRules(ON); const state = createState(6);
    for (const hero of CONFIG.heroes) if (!state.roster.some(owned => owned.id === hero.id)) state.roster.push({ id: hero.id, level: 1, xp: 0, stars: 1, equipment: blankEquipment() });
    const items: Gear[] = [];
    for (let index = 0; index < 48; index += 1) { const gear = item(state, 'weapon', 1 + index); addGear(state, gear); items.push(gear); }
    for (let index = 0; index < 2; index += 1) { const gear = item(state, 'charm', 0.01); addGear(state, gear); items.push(gear); }
    items.slice(0, 30).forEach(gear => setLocked(state, gear.id, true));
    items.slice(30, 48).forEach((gear, index) => { state.roster[index]!.equipment.weapon = gear.id; });
    items.slice(48).forEach((gear, index) => { state.roster[index]!.equipment.charm = gear.id; });
    const incoming = item(state, 'charm', 0.5, 'legendary'); addGear(state, incoming);
    expect(has(state, incoming)).toBe(false); expect(items.every(gear => has(state, gear))).toBe(true);
    expect(state.events.at(-1)?.data).toMatchObject({ type: 'salvage', gearId: incoming.id, reason: 'incoming' });
  });
});
