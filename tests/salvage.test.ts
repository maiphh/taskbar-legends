// design.md §19.6: item lock and protected salvage.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, SALVAGE_DEFAULTS, SALVAGE_DESIGN, setSalvageRules, setV14Rules } from '../src/config';
import { addGear, autoEquip, blankEquipment, chooseChest, gearScore, lockedCount, setLocked } from '../src/core/economy';
import { createState, load, snapshot, step } from '../src/core/game';
import { gearTemplateId, itemId } from '../src/core/model';
import type { GameState, Gear } from '../src/core/model';
import { runReference } from '../src/core/policy';
import { applyOffline } from '../src/core/save';
import { runReferenceAggregate } from '../src/sim/aggregate';
import { salvageToast } from '../src/salvage-copy';

afterEach(() => { setV14Rules([]); setSalvageRules('default'); });

const V142_RULES_OFF_GOLDEN = '6b332874faa6e156d0ace6a428480fd98c7e730ebaf8030777060d7fa51bf8c1';
const V142_AGGREGATE_2x1 = '5c547248e4c2f5354af2e658be2ca4495cb3555531bc31dd7519c2e3d002f032';
// 1.4.3 (sim.stageGapSec 8 and nonBossFarmMinCycleSec 21 are top-level, so both protection-off references move with the config).
const V143_RULES_OFF_GOLDEN = '7e9ee45a8fdaf5e1400b561423d47774ed4609dc5aa77d9f9cd974180b3828ba';
const V143_AGGREGATE_2x1 = '85eee5f553929a1afb2d5e7467c621eed9ac92337abdf850fc92c9f24f613544';
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
const goldenRun = (): string => {
  setV14Rules([]); setSalvageRules('default');
  const run = runReference(3, 1); applyOffline(run.state, 9 * 3600 * 1000);
  return sha(snapshot(run.state));
};

function testItem(state: GameState, atk: number, extras: Partial<Gear> = {}): Gear {
  return {
    id: itemId(state.seed, state.nextGearId++), tradeable: false,
    acquiredAt: { tick: state.tick, source: 'drop' }, slot: 'weapon', rarity: 'common', dropStage: 1,
    level: 0, spent: 0, stats: { hp: 0, atk, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 }, ...extras,
    templateId: gearTemplateId((extras.slot ?? 'weapon'), (extras.rarity ?? 'common')),
  };
}
function grantRoster(state: GameState): void {
  for (const hero of CONFIG.heroes) {
    if (!state.roster.some(owned => owned.id === hero.id)) state.roster.push({ id: hero.id, level: 1, xp: 0, stars: 1, equipment: blankEquipment() });
  }
}
function fillBag(state: GameState, count = CONFIG.gear.inventoryCap): Gear[] {
  const items: Gear[] = [];
  for (let atk = 1; atk <= count; atk += 1) { const item = testItem(state, atk); addGear(state, item); items.push(item); }
  return items;
}
/** 18 weapon + 16 armor + 16 charm, each assigned to a roster hero so all 50 are equipped (and thus protected). */
function fillProtectedBag(state: GameState): void {
  grantRoster(state);
  const slots: Gear['slot'][] = [...Array(18).fill('weapon'), ...Array(16).fill('armor'), ...Array(16).fill('charm')];
  slots.forEach((slot, index) => addGear(state, testItem(state, index + 1, { slot })));
  for (const item of state.inventory) {
    const hero = state.roster.find(owned => owned.equipment[item.slot] === null);
    if (!hero) throw new Error('No free equipment slot');
    hero.equipment[item.slot] = item.id;
  }
}

describe('gear.salvage keys', () => {
  it('defaults to false/false/0 when the block is not applied, and the file carries true/true/30', () => {
    expect(CONFIG.gear.salvage).toEqual(SALVAGE_DEFAULTS);
    expect(SALVAGE_DESIGN).toEqual({ protectEquipped: true, protectLocked: true, lockMax: 30 });
    expect(setSalvageRules('design')).toEqual({ protectEquipped: true, protectLocked: true, lockMax: 30 });
  });
});

describe('§19.6 overflow protection', () => {
  it('1. a bag at 50 whose lowest-score item is equipped: adding an item salvages the lowest unequipped item', () => {
    setSalvageRules('design');
    const state = createState(1), items = fillBag(state);
    const lowest = items[0]!, next = items[1]!;
    expect(gearScore(lowest)).toBeLessThan(gearScore(next));
    const hero = state.roster[0]!; hero.equipment.weapon = lowest.id;
    const incoming = testItem(state, 999);
    addGear(state, incoming);
    expect(state.inventory).toHaveLength(50);
    expect(state.inventory.some(item => item.id === lowest.id)).toBe(true);
    expect(hero.equipment.weapon).toBe(lowest.id);
    expect(state.inventory.some(item => item.id === next.id)).toBe(false);
    expect(state.inventory.some(item => item.id === incoming.id)).toBe(true);
    expect(state.events.some(event => event.data.type === 'salvage' && event.data.reason === 'overflow' && event.data.gearId === next.id)).toBe(true);
  });

  it('2. the same with a locked item as the lowest-score piece', () => {
    setSalvageRules('design');
    const state = createState(1), items = fillBag(state);
    const lowest = items[0]!, next = items[1]!;
    setLocked(state, lowest.id, true);
    expect(lowest.locked).toBe(true);
    addGear(state, testItem(state, 999));
    expect(state.inventory.some(item => item.id === lowest.id && item.locked)).toBe(true);
    expect(state.inventory.some(item => item.id === next.id)).toBe(false);
  });

  it('3. all 50 protected: the incoming item is salvaged, bag and equipment are unchanged', () => {
    setSalvageRules('design');
    const state = createState(1);
    fillProtectedBag(state);
    expect(state.inventory).toHaveLength(50);
    expect(state.inventory.every(item => state.roster.some(hero => Object.values(hero.equipment).includes(item.id)))).toBe(true);
    const ids = state.inventory.map(item => item.id), equipment = state.roster.map(hero => ({ id: hero.id, equipment: { ...hero.equipment } })), gold = state.gold;
    const incoming = testItem(state, 999, { rarity: 'epic', slot: 'armor' });
    addGear(state, incoming);
    expect(state.inventory).toHaveLength(50);
    expect(state.inventory.map(item => item.id)).toEqual(ids);
    expect(state.roster.map(hero => ({ id: hero.id, equipment: { ...hero.equipment } }))).toEqual(equipment);
    const salvage = [...state.events].reverse().find(event => event.data.type === 'salvage')?.data;
    expect(salvage).toMatchObject({ type: 'salvage', gearId: incoming.id, reason: 'incoming', rarity: 'epic', slot: 'armor' });
    expect(state.gold).toBeGreaterThan(gold);
  });

  it('4. a pick-1-of-2 keep into an all-protected bag emits reason incoming; the other option still pays salvageBase × rarityMult', () => {
    setSalvageRules('design'); setV14Rules(['chestChoice']);
    const state = createState(1);
    fillProtectedBag(state);
    const kept = testItem(state, 50, { rarity: 'epic', slot: 'armor' }), other = testItem(state, 10, { rarity: 'rare', slot: 'charm' });
    state.pendingChoice = [[kept, other]];
    const gold = state.gold, bag = state.inventory.map(item => item.id);
    chooseChest(state, 0);
    expect(state.inventory.map(item => item.id)).toEqual(bag);
    const salvage = state.events.filter(event => event.data.type === 'salvage').at(-1)?.data;
    expect(salvage).toMatchObject({ type: 'salvage', gearId: kept.id, reason: 'incoming' });
    const incomingGold = salvage && salvage.type === 'salvage' ? salvage.gold : 0;
    expect(state.gold - gold).toBe(incomingGold + Math.round(CONFIG.runtime.salvageBase * CONFIG.gear.rarityMult.rare));
  });

  it('5. lockMax: the 31st lock is refused, and unlocking one allows another', () => {
    setSalvageRules('design');
    const state = createState(1), items = fillBag(state);
    for (const item of items.slice(0, 30)) setLocked(state, item.id, true);
    expect(lockedCount(state)).toBe(30);
    setLocked(state, items[30]!.id, true);
    expect(items[30]!.locked).toBeUndefined();
    expect(lockedCount(state)).toBe(30);
    setLocked(state, items[0]!.id, false);
    expect(items[0]!.locked).toBeUndefined();
    setLocked(state, items[30]!.id, true);
    expect(items[30]!.locked).toBe(true);
    expect(lockedCount(state)).toBe(30);
  });

  it('6. save round-trip with locked; a 1.4.1 save without locked loads and its snapshot is unchanged', () => {
    setSalvageRules('design');
    const state = createState(4); fillBag(state, 3);
    setLocked(state, state.inventory[0]!.id, true);
    const loaded = load(JSON.parse(snapshot(state)));
    expect(loaded.inventory[0]?.locked).toBe(true);
    expect(loaded.inventory[1]?.locked).toBeUndefined();
    const plain = createState(5);
    const raw = JSON.parse(snapshot(plain));
    expect(raw.inventory.every((item: { locked?: unknown }) => !('locked' in item))).toBe(true);
    const from141 = load({ ...raw, balance: '1.4.1' });
    expect(snapshot(from141)).toBe(snapshot(load(raw)));
    expect(JSON.parse(snapshot(from141)).inventory.every((item: { locked?: unknown }) => !('locked' in item))).toBe(true);
  });

  it('7. with both flags off, the rules-off golden and a 2-seed 1-day aggregate equal the protection-off 1.4.3 references', { timeout: 60_000 }, () => {
    const golden = goldenRun(); expect(golden).not.toBe(V142_RULES_OFF_GOLDEN); expect(golden).toBe(V143_RULES_OFF_GOLDEN);
    setV14Rules([]); setSalvageRules('default');
    const report = runReferenceAggregate({ firstSeed: 1, seeds: 2, days: 1, gachaSeeds: 32 });
    const aggregate = sha(JSON.stringify({ targets: report.targets, seedCount: report.seedCount, days: report.days }));
    expect(aggregate).not.toBe(V142_AGGREGATE_2x1); expect(aggregate).toBe(V143_AGGREGATE_2x1);
  });

  it('8. 8 h offline into a full bag (28 Expedition Chests) never removes an equipped item', () => {
    setSalvageRules('design'); setV14Rules(['expeditionChests']);
    const state = createState(9); step(state, 4000);
    while (state.inventory.length < CONFIG.gear.inventoryCap) addGear(state, testItem(state, 20 + state.inventory.length));
    autoEquip(state);
    const equipped = new Set(state.roster.flatMap(hero => Object.values(hero.equipment)).filter((id): id is NonNullable<typeof id> => id !== null));
    expect(equipped.size).toBeGreaterThan(0);
    const result = applyOffline(state, 8 * 3_600_000);
    expect(result.expeditionChests).toBe(28);
    for (const id of equipped) {
      expect(state.inventory.some(item => item.id === id)).toBe(true);
      expect(state.roster.some(hero => Object.values(hero.equipment).includes(id))).toBe(true);
    }
    expect(state.metrics.salvageEquippedRemoved ?? 0).toBe(0);
  });
});

describe('salvage toast copy (§19.4)', () => {
  it('uses the long form, then the mid fallback, then the short gold-only fallback', () => {
    expect(salvageToast({ rarity: 'rare', slot: 'charm', gold: 450, reason: 'overflow' })).toBe('Bag full: salvaged Rare Charm +450 G');
    expect(salvageToast({ rarity: 'legendary', slot: 'weapon', gold: 12_300, reason: 'overflow' })).toBe('Salvaged Legendary Weapon +12.3K G');
    expect(salvageToast({ rarity: 'epic', slot: 'armor', gold: 10, reason: 'incoming' })).toBe('Bag full: new Epic Armor salvaged');
  });
});

describe('§19 sim: protection on never removes equipped gear', () => {
  it('a 3-day reference run with the block on records zero equipped removals', { timeout: 60_000 }, () => {
    setV14Rules(['chestChoice', 'farmChest', 'recruitPity', 'gearFortune', 'expeditionChests', 'offlineTickets']);
    setSalvageRules('design');
    const run = runReference(1, 3);
    expect(run.state.metrics.salvageEquippedRemoved ?? 0).toBe(0);
  });
});
