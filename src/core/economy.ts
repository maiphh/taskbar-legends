import { CONFIG, heroConfig, raritySchema, slotSchema } from '../config';
import type { GearSlot, Rarity } from '../config';
import { emit, goldChange } from './events';
import { compareItemIds, gearTemplateId, itemId } from './model';
import type { GameState, Gear, ItemId, LevelChange, OwnedHero } from './model';
import { random } from './rng';
import type { RandomState } from './rng';

export function getOwned(state: GameState, id: string): OwnedHero {
  const hero = state.roster.find(hero => hero.id === id);
  if (!hero) throw new Error(`Hero not owned: ${id}`);
  return hero;
}
export function blankEquipment(): OwnedHero['equipment'] { return { weapon: null, armor: null, charm: null }; }
export function heroStats(state: GameState, hero: OwnedHero) {
  const definition = heroConfig(hero.id);
  const role = CONFIG.roles[definition.role];
  const growth = CONFIG.rarity.statMult[definition.rarity] * (1 + CONFIG.growth.perLevel * (hero.level - 1)) * (1 + CONFIG.growth.perStar * (hero.stars - 1));
  let hp = role.hp * (definition.mod.hp ?? 1) * growth;
  let atk = role.atk * (definition.mod.atk ?? 1) * growth;
  let def = role.def * (definition.mod.def ?? 1) * growth;
  let hpPct = 0, atkPct = 0, speedPct = 0;
  for (const id of Object.values(hero.equipment)) {
    const gear = state.inventory.find(item => item.id === id);
    if (!gear) continue;
    const mult = 1 + CONFIG.gear.upgrade.mainPerLevel * gear.level;
    hp += gear.stats.hp * mult; atk += gear.stats.atk * mult; def += gear.stats.def * mult;
    hpPct += gear.stats.hpPct * mult; atkPct += gear.stats.atkPct * mult; speedPct += gear.stats.speedPct * mult;
  }
  const baseAttackTicks = role.attackIntervalTicks + (definition.mod.attackIntervalTicks ?? 0);
  return { maxHp: Math.round(hp * (1 + hpPct)), atk: Math.round(atk * (1 + atkPct)), def: Math.round(def),
    attackTicks: Math.max(CONFIG.runtime.minAttackIntervalTicks, Math.round(baseAttackTicks / (1 + speedPct))), range: role.rangePx };
}
export function heroPower(state: GameState, hero: OwnedHero): number {
  const stats = heroStats(state, hero);
  return Math.round(stats.maxHp * CONFIG.runtime.hpPower + stats.atk * CONFIG.runtime.atkPower + stats.def * CONFIG.runtime.defPower);
}
export function partyPower(state: GameState): number { return state.partyIds.reduce((sum, id) => sum + heroPower(state, getOwned(state, id)), 0); }
/** Returns levelBefore/levelAfter for every hero that received XP (capped heroes included, unchanged). */
export function grantXp(state: GameState, amount: number, ids = state.party.filter(unit => unit.hp > 0).map(unit => unit.sourceId)): LevelChange[] {
  if (!amount || !ids.length) return [];
  const changes: LevelChange[] = [];
  for (const id of ids) {
    const hero = getOwned(state, id), levelBefore = hero.level;
    changes.push({ id, levelBefore, levelAfter: levelBefore });
    if (hero.level >= CONFIG.growth.levelCap) continue;
    hero.xp += amount;
    while (hero.level < CONFIG.growth.levelCap) {
      const cost = Math.round(CONFIG.growth.xpToNext.a * hero.level ** CONFIG.growth.xpToNext.p);
      if (hero.xp < cost) break;
      hero.xp -= cost; hero.level += 1;
    }
    if (hero.level === CONFIG.growth.levelCap) hero.xp = 0;
    const change = changes.at(-1); if (change) change.levelAfter = hero.level;
  }
  state.economyRevision += 1;
  const levels = changes.filter(change => change.levelAfter !== change.levelBefore);
  emit(state, { type: 'xp', amount, heroIds: ids, ...(levels.length ? { levels } : {}) });
  return changes;
}
export function weightedRarity(state: RandomState, rates: Record<Rarity, number>): Rarity {
  let roll = random(state);
  for (const rarity of raritySchema.options) { roll -= rates[rarity]; if (roll < 0) return rarity; }
  return 'legendary';
}
export function drawHero(state: RandomState, pityCounter: number, owned: ReadonlySet<string>) {
  const pity = pityCounter >= CONFIG.gacha.pity.guaranteeEpicPlusEvery - 1;
  const rarity = pity ? (random(state) < CONFIG.runtime.pityEpicChance ? 'epic' : 'legendary') : weightedRarity(state, CONFIG.gacha.rates);
  const candidates = CONFIG.heroes.filter(hero => hero.rarity === rarity);
  const missing = pity && CONFIG.gacha.pity.pityPrefersUnowned ? candidates.filter(hero => !owned.has(hero.id)) : [];
  const pool = missing.length ? missing : candidates;
  const hero = pool[Math.floor(random(state) * pool.length)];
  if (!hero) throw new Error('Empty gacha pool');
  return { hero, rarity, pity, nextPity: rarity === 'epic' || rarity === 'legendary' ? 0 : pityCounter + 1 };
}
export function pull(state: GameState): void {
  if (state.tickets < CONFIG.gacha.costTickets) return;
  state.tickets -= CONFIG.gacha.costTickets;
  const draw = drawHero(state, state.pity, new Set(state.roster.map(hero => hero.id)));
  state.pity = draw.nextPity;
  const existing = state.roster.find(hero => hero.id === draw.hero.id);
  if (existing) {
    if (existing.stars < CONFIG.growth.starMax) existing.stars += 1;
    else goldChange(state, Math.round(CONFIG.runtime.duplicateGold * CONFIG.rarity.statMult[draw.rarity]), 'duplicate');
  } else {
    const averageLevel = state.partyIds.reduce((sum, id) => sum + getOwned(state, id).level, 0) / state.partyIds.length;
    state.roster.push({ id: draw.hero.id, level: Math.max(1, Math.floor(averageLevel) + CONFIG.growth.newHeroLevelOffset), xp: 0, stars: 1, equipment: blankEquipment() });
  }
  state.stats.pulls += 1; state.economyRevision += 1;
  if (state.roster.length === CONFIG.heroes.length && state.metrics.fullRosterTick === null) state.metrics.fullRosterTick = state.tick;
  emit(state, { type: 'pull', heroId: draw.hero.id, rarity: draw.rarity, duplicate: !!existing, pity: draw.pity });
}
export function gearScore(item: Gear): number {
  const stats = item.stats;
  // Underspecified "score": power-equivalent flat stats plus 100 per 100% secondary stat.
  return (stats.hp * CONFIG.runtime.hpPower + stats.atk * CONFIG.runtime.atkPower + stats.def * CONFIG.runtime.defPower + (stats.hpPct + stats.atkPct + stats.speedPct) * CONFIG.runtime.gearSecondaryPower) * (1 + CONFIG.gear.upgrade.mainPerLevel * item.level);
}
function rollBetween(state: RandomState, bounds: number[]): number {
  const min = bounds[0], max = bounds[1];
  if (min === undefined || max === undefined) throw new Error('Missing roll bounds');
  return min + random(state) * (max - min);
}
export function chest(state: GameState, dropStage: number): void {
  const rarity = weightedRarity(state, CONFIG.gear.chestRarityOdds);
  const slot = slotSchema.options[Math.floor(random(state) * slotSchema.options.length)];
  if (!slot) throw new Error('Empty gear slot pool');
  const mult = CONFIG.enemies.scalingPerStage ** (dropStage - 1) * CONFIG.gear.rarityMult[rarity] * rollBetween(state, CONFIG.gear.mainRoll);
  const stats: Gear['stats'] = { hp: 0, atk: 0, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 };
  if (slot === 'weapon') stats.atk = Math.round(CONFIG.gear.slots.weapon.main.atk * mult);
  if (slot === 'armor') { stats.hp = Math.round(CONFIG.gear.slots.armor.main.hp * mult); stats.def = Math.round(CONFIG.gear.slots.armor.main.def * mult); }
  if (slot === 'charm') {
    const keys = ['atkPct', 'hpPct', 'speedPct'] satisfies (keyof typeof CONFIG.gear.slots.charm.oneOf)[];
    const key = keys[Math.floor(random(state) * keys.length)];
    if (!key) throw new Error('Empty charm pool');
    stats[key] = Math.round(rollBetween(state, CONFIG.gear.slots.charm.oneOf[key]) * CONFIG.gear.rarityMult[rarity] * CONFIG.runtime.percentPrecision) / CONFIG.runtime.percentPrecision;
  }
  const item: Gear = { id: itemId(state.seed, state.nextGearId++), templateId: gearTemplateId(slot, rarity), tradeable: false,
    acquiredAt: { tick: state.tick, source: 'drop' }, slot, rarity, dropStage, level: 0, spent: 0, stats };
  state.inventory.push(item); state.stats.chests += 1; state.economyRevision += 1;
  emit(state, { type: 'gear', gearId: item.id, slot, rarity });
  if (state.inventory.length > CONFIG.gear.inventoryCap) {
    const lowest = [...state.inventory].sort((a, b) => gearScore(a) - gearScore(b) || compareItemIds(a.id, b.id))[0];
    if (!lowest) return;
    state.inventory = state.inventory.filter(item => item.id !== lowest.id);
    for (const hero of state.roster) for (const slot of slotSchema.options) if (hero.equipment[slot] === lowest.id) hero.equipment[slot] = null;
    goldChange(state, Math.round(lowest.spent * CONFIG.runtime.salvageSpentPct + CONFIG.runtime.salvageBase * CONFIG.gear.rarityMult[lowest.rarity]), 'salvage');
  }
}
export function upgradeCost(item: Gear): number {
  return Math.round(CONFIG.gear.upgrade.costBase * CONFIG.enemies.scalingPerStage ** (item.dropStage - 1) * CONFIG.gear.rarityMult[item.rarity] * (item.level + 1) ** CONFIG.gear.upgrade.costExp);
}
export function upgrade(state: GameState, id: ItemId): void {
  const item = state.inventory.find(item => item.id === id);
  if (!item || item.level >= CONFIG.gear.upgrade.maxLevel) return;
  const cost = upgradeCost(item);
  if (state.gold < cost) return;
  goldChange(state, -cost, 'upgrade'); item.level += 1; item.spent += cost;
  emit(state, { type: 'upgrade', gearId: id, level: item.level, cost });
}
export function equip(state: GameState, heroId: string, gearId: ItemId): void {
  const hero = state.roster.find(hero => hero.id === heroId);
  const item = state.inventory.find(item => item.id === gearId);
  if (!hero || !item) return;
  for (const owned of state.roster) if (owned.equipment[item.slot] === gearId) owned.equipment[item.slot] = null;
  hero.equipment[item.slot] = gearId; state.economyRevision += 1;
}
export function setParty(state: GameState, ids: string[]): void {
  if (ids.length !== CONFIG.sim.partySize || new Set(ids).size !== ids.length || ids.some(id => !state.roster.some(hero => hero.id === id))) return;
  if (ids.every((id, i) => state.partyIds[i] === id)) return;
  state.partyIds = [...ids]; state.economyRevision += 1;
}
export function autoParty(state: GameState): void {
  const sorted = [...state.roster].sort((a, b) => heroPower(state, b) - heroPower(state, a) || a.id.localeCompare(b.id));
  const tank = sorted.find(hero => heroConfig(hero.id).role === 'tank');
  const support = sorted.find(hero => heroConfig(hero.id).role === 'support');
  const dps = sorted.filter(hero => hero.id !== tank?.id && hero.id !== support?.id && (!tank || heroConfig(hero.id).role !== 'tank'));
  const ids: string[] = [];
  if (tank) ids.push(tank.id);
  const freeSlots = CONFIG.sim.partySize - ids.length - (support ? 1 : 0);
  ids.push(...dps.slice(0, freeSlots).map(hero => hero.id));
  if (support) ids.push(support.id);
  setParty(state, ids);
}
export function autoEquip(state: GameState): void {
  const heroes = state.partyIds.map(id => getOwned(state, id)).sort((a, b) => heroPower(state, b) - heroPower(state, a) || a.id.localeCompare(b.id));
  for (const slot of slotSchema.options) {
    const gear = state.inventory.filter(item => item.slot === slot).sort((a, b) => gearScore(b) - gearScore(a) || compareItemIds(a.id, b.id));
    // Stable allocation: best item to strongest party hero, then the next. No mid-fight stat mutation.
    for (const [index, hero] of heroes.entries()) {
      const item = gear[index];
      if (item && hero.equipment[slot] !== item.id) equip(state, hero.id, item.id);
    }
  }
}
export function cheapestEquippedUpgrade(state: GameState): Gear | undefined {
  const ids = new Set(state.partyIds.flatMap(id => Object.values(getOwned(state, id).equipment)));
  return state.inventory.filter(item => ids.has(item.id) && item.level < CONFIG.gear.upgrade.maxLevel)
    .sort((a, b) => upgradeCost(a) - upgradeCost(b) || compareItemIds(a.id, b.id))[0];
}
export function equippedGear(state: GameState, id: string, slot: GearSlot): Gear | undefined {
  return state.inventory.find(item => item.id === getOwned(state, id).equipment[slot]);
}
