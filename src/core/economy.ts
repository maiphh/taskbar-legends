import { CONFIG, heroConfig, raritySchema, slotSchema } from '../config';
import type { GearSlot, Rarity } from '../config';
import { emit, goldChange } from './events';
import { compareItemIds, gearTemplateId, itemId } from './model';
import type { GameState, Gear, ItemId, LevelChange, OwnedHero } from './model';
import { random } from './rng';
import type { RandomState } from './rng';
import { getPartyHeroDefinition, partyBasicDamageCoefficient } from './party-definitions';

export function getOwned(state: GameState, id: string): OwnedHero {
  const hero = state.roster.find(hero => hero.id === id);
  if (!hero) throw new Error(`Hero not owned: ${id}`);
  return hero;
}
export function blankEquipment(): OwnedHero['equipment'] { return { weapon: null, armor: null, charm: null }; }
export function heroStats(state: GameState, hero: OwnedHero) {
  const definition = heroConfig(hero.id);
  const legacyRole = CONFIG.roles[definition.role];
  const partyDefinition = state.combatRules === 'party-v2' ? getPartyHeroDefinition(hero.id) : undefined;
  const profile = partyDefinition?.familyStats ?? legacyRole;
  const growth = CONFIG.rarity.statMult[definition.rarity] * (1 + CONFIG.growth.perLevel * (hero.level - 1)) * (1 + CONFIG.growth.perStar * (hero.stars - 1));
  let hp = profile.hp * (definition.mod.hp ?? 1) * growth;
  let atk = profile.atk * (definition.mod.atk ?? 1) * growth;
  let def = profile.def * (definition.mod.def ?? 1) * growth;
  let hpPct = 0, atkPct = 0, speedPct = 0;
  for (const id of Object.values(hero.equipment)) {
    const gear = state.inventory.find(item => item.id === id);
    if (!gear) continue;
    const mult = 1 + CONFIG.gear.upgrade.mainPerLevel * gear.level;
    hp += gear.stats.hp * mult; atk += gear.stats.atk * mult; def += gear.stats.def * mult;
    hpPct += gear.stats.hpPct * mult; atkPct += gear.stats.atkPct * mult; speedPct += gear.stats.speedPct * mult;
  }
  const baseAttackTicks = ('attackTicks' in profile ? profile.attackTicks : profile.attackIntervalTicks) + (definition.mod.attackIntervalTicks ?? 0);
  return { maxHp: Math.round(hp * (1 + hpPct)), atk: Math.round(atk * (1 + atkPct)), def: Math.round(def),
    attackTicks: Math.max(CONFIG.runtime.minAttackIntervalTicks, Math.round(baseAttackTicks / (1 + speedPct))), range: partyDefinition?.basic.range ?? legacyRole.rangePx };
}
export function realizedBasicCycleTicks(stats: Pick<ReturnType<typeof heroStats>, 'attackTicks'>): number {
  return Math.max(stats.attackTicks, 4 + 2);
}
export function partyBasicDps(state: GameState, hero: OwnedHero): number {
  return partyBasicDpsForStats(hero.id, heroStats(state, hero));
}
export function partyBasicDpsForStats(heroId: string, stats: Pick<ReturnType<typeof heroStats>, 'atk' | 'attackTicks'>): number {
  return stats.atk * partyBasicDamageCoefficient(getPartyHeroDefinition(heroId)) * CONFIG.sim.ticksPerSecond / realizedBasicCycleTicks(stats);
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
/** v1.4 recruit counters (CR-14-01/02): pulls since the last Legendary, consecutive pulls without a new hero. */
export interface RecruitLuck { legendary: number; newHero: number | null }
/** Which guarantee shaped a pull (designer answer 4, 2026-11-09); null = a normal roll. Only logged when recruitPity is on. */
export type PityKind = 'legend' | 'epic' | 'newHero' | null;
/**
 * One recruit draw. Without `luck` this is the 1.3.0 draw. With `luck` (recruitPity on): Legendary pity, then Epic+ pity,
 * then the normal roll. Legendary pity is always Legendary, even when every Legendary is owned (the duplicate stars up).
 * The new-hero guarantee runs on its own counter and only changes the pick; it may fall back to the most common rarity
 * that still has an unowned hero, except on a Legendary-pity pull (always Legendary). Legendary pity draws no rarity roll, so it uses one
 * random number fewer than a normal pull. `luck.newHero` null = that counter is frozen (full roster).
 */
export function drawHero(state: RandomState, pityCounter: number, owned: ReadonlySet<string>, luck?: RecruitLuck) {
  const rule = CONFIG.v14.recruit;
  const legendaryPity = !!luck && rule.legendaryPityEvery > 0 && luck.legendary >= rule.legendaryPityEvery - 1;
  const pity = legendaryPity || pityCounter >= CONFIG.gacha.pity.guaranteeEpicPlusEvery - 1;
  let rarity: Rarity = legendaryPity ? 'legendary' : pity ? (random(state) < CONFIG.runtime.pityEpicChance ? 'epic' : 'legendary') : weightedRarity(state, CONFIG.gacha.rates);
  const fresh = !!luck && luck.newHero !== null && rule.newHeroGuaranteeEvery > 0 && luck.newHero >= rule.newHeroGuaranteeEvery - 1;
  if (fresh && !legendaryPity && CONFIG.heroes.filter(hero => hero.rarity === rarity).every(hero => owned.has(hero.id)))
    rarity = raritySchema.options.find(tier => CONFIG.heroes.some(hero => hero.rarity === tier && !owned.has(hero.id))) ?? rarity;
  const candidates = CONFIG.heroes.filter(hero => hero.rarity === rarity);
  const prefersUnowned = fresh || (pity && (legendaryPity ? rule.legendaryPityPrefersUnowned : CONFIG.gacha.pity.pityPrefersUnowned));
  const missing = prefersUnowned ? candidates.filter(hero => !owned.has(hero.id)) : [];
  const pool = missing.length ? missing : candidates;
  const hero = pool[Math.floor(random(state) * pool.length)];
  if (!hero) throw new Error('Empty gacha pool');
  const nextLuck: RecruitLuck | undefined = luck ? { legendary: rarity === 'legendary' ? 0 : luck.legendary + 1, newHero: luck.newHero === null ? null : owned.has(hero.id) ? luck.newHero + 1 : 0 } : undefined;
  const kind: PityKind = legendaryPity ? 'legend' : pity ? 'epic' : fresh && !owned.has(hero.id) ? 'newHero' : null;
  return { hero, rarity, pity, legendaryPity, fresh, kind, nextPity: rarity === 'epic' || rarity === 'legendary' ? 0 : pityCounter + 1, nextLuck };
}
export const recruitPityOn = (): boolean => CONFIG.v14.recruit.legendaryPityEvery > 0 || CONFIG.v14.recruit.newHeroGuaranteeEvery > 0;
/** Pulls left until each guarantee (1 = this pull), or null when the rule is off. With a full roster only the new-hero meter hides. */
export function recruitMeters(state: GameState): { epicPlus: number; legendary: number | null; newHero: number | null } | null {
  if (!recruitPityOn()) return null;
  const rule = CONFIG.v14.recruit, complete = state.roster.length >= CONFIG.heroes.length;
  return { epicPlus: CONFIG.gacha.pity.guaranteeEpicPlusEvery - state.pity,
    legendary: rule.legendaryPityEvery > 0 ? rule.legendaryPityEvery - (state.pityLegendary ?? 0) : null,
    newHero: rule.newHeroGuaranteeEvery > 0 && !complete ? rule.newHeroGuaranteeEvery - (state.pityNewHero ?? 0) : null };
}
export function pull(state: GameState): void {
  if (state.tickets < CONFIG.gacha.costTickets) return;
  state.tickets -= CONFIG.gacha.costTickets;
  // recruitPity: once the roster is complete only the new-hero counter freezes; Epic+ and Legendary pity keep running (designer answer 3).
  const luckOn = recruitPityOn(), complete = state.roster.length >= CONFIG.heroes.length;
  const luck = luckOn ? { legendary: state.pityLegendary ?? 0, newHero: complete ? null : state.pityNewHero ?? 0 } : undefined;
  const draw = drawHero(state, state.pity, new Set(state.roster.map(hero => hero.id)), luck);
  state.pity = draw.nextPity;
  if (draw.nextLuck) { state.pityLegendary = draw.nextLuck.legendary; if (draw.nextLuck.newHero !== null) state.pityNewHero = draw.nextLuck.newHero; }
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
  // 1.3.0 logs pity as a boolean; with recruitPity on it names the guarantee (designer answer 4).
  emit(state, { type: 'pull', heroId: draw.hero.id, rarity: draw.rarity, duplicate: !!existing, pity: luckOn ? draw.kind : draw.pity });
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
/** Rolls one chest item (rarity, slot, main roll, charm stat: the 1.3.0 RNG order) and assigns the next item id. */
/**
 * CR-14-03 Fortune: the roll that brings the counter to firstLegendaryBy (before any Legendary) or legendaryEvery is
 * Legendary. `units` is the roll's Fortune weight (normal chest 1; the second pick-1-of-2 option 0, so a chest counts once).
 * A Legendary from a counted roll resets the counter and sets the flag; a 0-unit roll changes nothing. Pure.
 */
export function fortuneRoll(since: number, found: boolean, rolled: Rarity, units: number): { rarity: Rarity; since: number; found: boolean; forced: boolean } {
  const rule = CONFIG.v14.fortune, limit = found ? rule.legendaryEvery : rule.firstLegendaryBy;
  // Designer answer 2: gear outside a counted chest roll (units 0) neither counts nor resets.
  if (units <= 0) return { rarity: rolled, since, found, forced: false };
  const forced = rolled !== 'legendary' && since + units >= limit;
  const rarity: Rarity = forced ? 'legendary' : rolled;
  return rarity === 'legendary' ? { rarity, since: 0, found: true, forced } : { rarity, since: since + units, found, forced };
}
export const gearFortuneOn = (): boolean => CONFIG.v14.fortune.legendaryEvery > 0;
/** Fortune meter: `Legend in n` before the first Legendary, then `Fortune c/100`. Null when the rule is off. */
export function fortuneMeter(state: GameState): { found: boolean; since: number; limit: number; left: number } | null {
  if (!gearFortuneOn()) return null;
  const found = state.gearLegendaryFound ?? false, since = state.gearSinceLegendary ?? 0, limit = found ? CONFIG.v14.fortune.legendaryEvery : CONFIG.v14.fortune.firstLegendaryBy;
  return { found, since, limit, left: limit - since };
}
/** Best of `bestOf` chest rarity rolls (CR-14-04 Expedition Chest: 4); bestOf 1 is the 1.3.0 single roll. */
export function chestRarity(state: RandomState, bestOf = 1): Rarity {
  let best = weightedRarity(state, CONFIG.gear.chestRarityOdds);
  for (let roll = 1; roll < bestOf; roll += 1) { const next = weightedRarity(state, CONFIG.gear.chestRarityOdds); if (raritySchema.options.indexOf(next) > raritySchema.options.indexOf(best)) best = next; }
  return best;
}
function rollGear(state: GameState, dropStage: number, units = CONFIG.v14.fortune.chestUnits, bestOf = 1): Gear {
  let rarity = chestRarity(state, bestOf);
  if (gearFortuneOn()) {
    const fortune = fortuneRoll(state.gearSinceLegendary ?? 0, state.gearLegendaryFound ?? false, rarity, units);
    rarity = fortune.rarity; state.gearSinceLegendary = fortune.since; state.gearLegendaryFound = fortune.found;
  }
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
  return { id: itemId(state.seed, state.nextGearId++), templateId: gearTemplateId(slot, rarity), tradeable: false,
    acquiredAt: { tick: state.tick, source: 'drop' }, slot, rarity, dropStage, level: 0, spent: 0, stats };
}
/** Adds an item to the inventory; over the cap the lowest-score item is salvaged (1.3.0 rule). */
function addGear(state: GameState, item: Gear): void {
  state.inventory.push(item); state.economyRevision += 1;
  emit(state, { type: 'gear', gearId: item.id, slot: item.slot, rarity: item.rarity });
  if (state.inventory.length > CONFIG.gear.inventoryCap) {
    const lowest = [...state.inventory].sort((a, b) => gearScore(a) - gearScore(b) || compareItemIds(a.id, b.id))[0];
    if (!lowest) return;
    state.inventory = state.inventory.filter(item => item.id !== lowest.id);
    for (const hero of state.roster) for (const slot of slotSchema.options) if (hero.equipment[slot] === lowest.id) hero.equipment[slot] = null;
    goldChange(state, Math.round(lowest.spent * CONFIG.runtime.salvageSpentPct + CONFIG.runtime.salvageBase * CONFIG.gear.rarityMult[lowest.rarity]), 'salvage');
  }
}
/**
 * One chest. With v14.chestChoice.options 2 (CR-14-08) at dropStage ≥ fromStage it rolls two items into
 * state.pendingChoice instead; a 4th unresolved choice auto-resolves the oldest by score. With options 1 this is 1.3.0.
 */
export function chest(state: GameState, dropStage: number, kind: 'chest' | 'expedition' = 'chest'): void {
  const rule = CONFIG.v14.chestChoice;
  // CR-14-04: an Expedition Chest is best-of-expeditionBestOf and weighs expeditionUnits on Fortune; both options of a choice use best-of.
  const units = kind === 'expedition' ? CONFIG.v14.fortune.expeditionUnits : CONFIG.v14.fortune.chestUnits, bestOf = kind === 'expedition' ? CONFIG.v14.offline.expeditionBestOf : 1;
  state.stats.chests += 1;
  if (rule.options < 2 || dropStage < rule.fromStage) { addGear(state, rollGear(state, dropStage, units, bestOf)); return; }
  const first = rollGear(state, dropStage, units, bestOf), second = rollGear(state, dropStage, 0, bestOf);
  (state.pendingChoice ??= []).push([first, second]); state.economyRevision += 1;
  while (state.pendingChoice.length > CONFIG.runtime.chestChoiceQueueMax) chooseChest(state, bestChoice(state.pendingChoice[0]));
}
/** Index the score rule keeps: the higher gearScore, ties keep the first option. */
export function bestChoice(options: readonly [Gear, Gear] | undefined): 0 | 1 {
  return options && gearScore(options[1]) > gearScore(options[0]) ? 1 : 0;
}
/** Resolves the oldest pending choice: keep one, salvage the other for salvageBase × rarityMult gold. */
export function chooseChest(state: GameState, keep: number): void {
  const options = state.pendingChoice?.[0];
  if (!options || !state.pendingChoice || (keep !== 0 && keep !== 1)) return;
  state.pendingChoice.shift();
  if (!state.pendingChoice.length) delete state.pendingChoice;
  const kept = options[keep], other = options[keep === 0 ? 1 : 0];
  addGear(state, kept);
  goldChange(state, Math.round(CONFIG.runtime.salvageBase * CONFIG.gear.rarityMult[other.rarity]), 'salvage');
  emit(state, { type: 'chestChoice', options: [options[0].id, options[1].id], kept: kept.id, rarities: [options[0].rarity, options[1].rarity] });
}
/** Repeat farm clear chest roll. CR-14-09 from farmChest.fromStage: baseChance plus a guaranteed chest on the guaranteeEvery-th dry clear. */
export function farmChestRoll(state: GameState, stage: number): void {
  const rule = CONFIG.v14.farmChest;
  if (!rule || stage < rule.fromStage) { if (random(state) < CONFIG.rewards.farmChestChance) chest(state, stage); return; }
  const dry = (state.farmChestDry ?? 0) + 1;
  if (random(state) < rule.baseChance || dry >= rule.guaranteeEvery) { state.farmChestDry = 0; chest(state, stage); }
  else state.farmChestDry = dry;
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
export function autoParty(state: GameState, requestedPreset?: 'balanced' | 'fastFarm' | 'bossSustain'): void {
  if (state.combatRules === 'party-v2') { autoPartyV2(state, requestedPreset ?? state.partyPreset ?? 'balanced'); return; }
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
function autoPartyV2(state: GameState, preset: 'balanced' | 'fastFarm' | 'bossSustain'): void {
  const roster = state.roster;
  const byId = new Map(roster.map(hero => [hero.id, hero]));
  const lockedSlots = state.partyIds.map((id, index) => ({ id, index, hero: byId.get(id) })).filter(slot => slot.hero?.partyLocked);
  const selected = new Set(lockedSlots.map(slot => slot.id));
  const tags = (hero: OwnedHero) => getPartyHeroDefinition(hero.id).tags;
  const def = (hero: OwnedHero) => getPartyHeroDefinition(hero.id);
  const stats = (hero: OwnedHero) => heroStats(state, hero);
  const ehp = (hero: OwnedHero) => { const value = stats(hero); return value.maxHp * (1 + value.def / 100); };
  const cycle = (hero: OwnedHero) => realizedBasicCycleTicks(stats(hero));
  const dps = (hero: OwnedHero) => stats(hero).atk * partyBasicDamageCoefficient(def(hero)) / cycle(hero);
  const support = (hero: OwnedHero) => supportOutput(def(hero), stats(hero));
  const stable = (a: OwnedHero, b: OwnedHero) => a.id.localeCompare(b.id);
  const requested: { key: string; matches: (hero: OwnedHero) => boolean; score: (hero: OwnedHero) => number }[] = preset === 'fastFarm' ? [
    { key: 'aoe', matches: hero => tags(hero).includes('aoe'), score: hero => dps(hero) * 1.2 },
    { key: 'singleDps', matches: hero => def(hero).role === 'dps' && !tags(hero).includes('aoe'), score: dps },
    { key: 'tank', matches: hero => def(hero).role === 'tank', score: hero => ehp(hero) * (tags(hero).includes('guardian') ? 1.08 : 1) },
  ] : preset === 'bossSustain' ? [
    { key: 'tank', matches: hero => def(hero).role === 'tank', score: hero => ehp(hero) * (tags(hero).includes('guardian') ? 1.12 : 1) },
    { key: 'singleDps', matches: hero => def(hero).role === 'dps' && !tags(hero).includes('aoe'), score: dps },
    { key: 'healer', matches: hero => def(hero).role === 'support', score: hero => (tags(hero).includes('healer') ? 1e9 : 0) + support(hero) },
  ] : [
    { key: 'tank', matches: hero => def(hero).role === 'tank', score: hero => ehp(hero) * (tags(hero).includes('guardian') ? 1.08 : 1) },
    { key: 'dps', matches: hero => def(hero).role === 'dps', score: dps },
    { key: 'support', matches: hero => def(hero).role === 'support', score: hero => (tags(hero).includes('healer') ? 1e9 : 0) + support(hero) },
  ];
  const chosen = [...selected];
  for (const category of requested) {
    if (chosen.length >= CONFIG.sim.partySize) break;
    // A locked deployed member satisfies the first compatible category; selected units never satisfy a second DPS slot.
    if ([...selected].some(id => { const hero = byId.get(id); return hero && category.matches(hero); })) continue;
    const candidate = roster.filter(hero => !selected.has(hero.id) && category.matches(hero)).sort((a, b) => category.score(b) - category.score(a) || stable(a, b))[0];
    if (candidate) { chosen.push(candidate.id); selected.add(candidate.id); }
  }
  const useful = roster.filter(hero => !selected.has(hero.id)).sort((a, b) => heroPower(state, b) - heroPower(state, a) || stable(a, b));
  chosen.push(...useful.slice(0, CONFIG.sim.partySize - chosen.length).map(hero => hero.id));
  const lockedPositions = new Map(lockedSlots.map(slot => [slot.index, slot.id]));
  const unlocked = chosen.filter(id => !lockedPositions.has(state.partyIds.indexOf(id))).map(id => byId.get(id)!).sort((a, b) => placement(a) - placement(b) || stable(a, b)).map(hero => hero.id);
  const result: string[] = Array(CONFIG.sim.partySize).fill('');
  for (const [index, id] of lockedPositions) result[index] = id;
  let next = 0;
  for (let i = 0; i < result.length; i += 1) if (!result[i]) result[i] = unlocked[next++] ?? chosen.find(id => !result.includes(id)) ?? '';
  state.partyPreset = preset;
  setParty(state, result);
}
function placement(hero: OwnedHero): number {
  const definition = getPartyHeroDefinition(hero.id);
  if (definition.role === 'tank') return 0;
  if (definition.role === 'support') return 4;
  if (definition.tags.includes('melee')) return 1;
  if (definition.tags.includes('aoe')) return 3;
  return 2;
}
/** Support output per tick = heal ATK output + effect uptime×ATK + shield maxHP output + intercept range×maxHP/cooldown. */
function supportOutput(definition: ReturnType<typeof getPartyHeroDefinition>, stats: ReturnType<typeof heroStats>): number {
  const active = definition.active, passive = definition.passive;
  const uptime = active.cooldownTicks > 0 ? Math.max(active.durationTicks ?? 0, 1) / active.cooldownTicks : 0;
  const heal = ((active.healCoefficient ?? 0) / Math.max(active.cooldownTicks, 1) + (definition.basic.style === 'heal' ? definition.basic.coefficient / Math.max(stats.attackTicks, 6) : 0)) * stats.atk;
  const effect = (((active.atkBonus ?? 0) + (active.atkReduction ?? 0) + (active.defReduction ?? 0)) * uptime
    + (passive.atkReduction ?? 0) + (passive.atkBonus ?? 0)) * stats.atk;
  const shields = ((active.shieldFraction ?? 0) / Math.max(active.cooldownTicks, 1) + (passive.shieldFraction ?? 0) / Math.max(passive.durationTicks ?? 1, 1)) * stats.maxHp;
  const guard = passive.kind === 'intercept' ? (passive.range ?? 0) / Math.max(passive.cooldownTicks ?? 1, 1) * stats.maxHp / 100 : 0;
  return heal + effect + shields + guard;
}
export function togglePartyLock(state: GameState, heroId: string, locked: boolean): void {
  if (state.combatRules !== 'party-v2') return;
  const hero = state.roster.find(value => value.id === heroId); if (!hero || hero.partyLocked === locked) return;
  if (locked) hero.partyLocked = true; else delete hero.partyLocked;
  state.economyRevision += 1;
}
export function autoEquip(state: GameState): void {
  if (state.combatRules === 'party-v2') { autoEquipV2(state); return; }
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
function gearUtility(state: GameState): number {
  const baselineRoster = state.roster.map(hero => ({ ...hero, equipment: { weapon: null, armor: null, charm: null } }));
  const baselineState = { ...state, roster: baselineRoster } as GameState;
  let total = 0;
  // Keep every owned contributor stable across before/after projections so a
  // bench donor's base utility cannot disappear when its last item moves.
  const relevantIds = state.roster.map(hero => hero.id);
  for (const id of relevantIds) {
    const hero = state.roster.find(value => value.id === id); const baselineHero = baselineRoster.find(value => value.id === id);
    if (!hero || !baselineHero) continue;
    const definition = getPartyHeroDefinition(id), current = heroStats(state, hero), base = heroStats(baselineState, baselineHero);
    const coefficient = partyBasicDamageCoefficient(definition);
    const throughput = current.atk * coefficient / realizedBasicCycleTicks(current), baseThroughput = base.atk * coefficient / realizedBasicCycleTicks(base);
    const ehp = current.maxHp * (1 + current.def / 100), baseEhp = base.maxHp * (1 + base.def / 100);
    const supportValue = supportOutput(definition, current), baseSupport = supportOutput(definition, base);
    const supportRatio = baseSupport > 0 ? supportValue / baseSupport : 1;
    const weights = definition.role === 'tank' ? [0.2, 1, 0.7] : definition.role === 'support' ? [0.25, 0.5, 1.2] : [1, 0.25, 0.1];
    total += weights[0]! * (throughput / Math.max(baseThroughput, 1e-9)) + weights[1]! * (ehp / Math.max(baseEhp, 1e-9)) + weights[2]! * supportRatio;
  }
  return total;
}
function autoEquipV2(state: GameState): void {
  const stableHeroes = [...state.partyIds].sort((a, b) => a.localeCompare(b));
  for (const slot of slotSchema.options) {
    for (let pass = 0; pass < 128; pass += 1) {
      const baseScore = gearUtility(state);
      let best: { heroId: string; itemId: ItemId; gain: number } | undefined;
      const items = state.inventory.filter(item => item.slot === slot).sort((a, b) => compareItemIds(a.id, b.id));
      for (const heroId of stableHeroes) for (const item of items) {
        const currentOwner = state.roster.find(hero => hero.equipment[slot] === item.id);
        if (currentOwner?.id === heroId) continue;
        const candidateRoster = state.roster.map(hero => ({ ...hero, equipment: { ...hero.equipment } }));
        for (const hero of candidateRoster) if (hero.equipment[slot] === item.id) hero.equipment[slot] = null;
        const wearer = candidateRoster.find(hero => hero.id === heroId)!; wearer.equipment[slot] = item.id;
        const candidate = { ...state, roster: candidateRoster } as GameState;
        const gain = gearUtility(candidate) - baseScore;
        if (gain > 1e-9 && (!best || gain > best.gain + 1e-9 || Math.abs(gain - best.gain) <= 1e-9 && (heroId.localeCompare(best.heroId) < 0 || heroId === best.heroId && compareItemIds(item.id, best.itemId) < 0)))
          best = { heroId, itemId: item.id, gain };
      }
      if (!best) break;
      //
      equip(state, best.heroId, best.itemId);
    }
  }
}
export function partyGearUtilityGain(state: GameState, heroId: string, gearId: ItemId): number {
  if (state.combatRules !== 'party-v2') return 0;
  const item = state.inventory.find(value => value.id === gearId), hero = state.roster.find(value => value.id === heroId);
  if (!item || !hero || !state.partyIds.includes(heroId)) return 0;
  const roster = state.roster.map(value => ({ ...value, equipment: { ...value.equipment } }));
  for (const owned of roster) if (owned.equipment[item.slot] === item.id) owned.equipment[item.slot] = null;
  roster.find(value => value.id === heroId)!.equipment[item.slot] = item.id;
  return gearUtility({ ...state, roster } as GameState) - gearUtility(state);
}
export function cheapestEquippedUpgrade(state: GameState): Gear | undefined {
  const ids = new Set(state.partyIds.flatMap(id => Object.values(getOwned(state, id).equipment)));
  return state.inventory.filter(item => ids.has(item.id) && item.level < CONFIG.gear.upgrade.maxLevel)
    .sort((a, b) => upgradeCost(a) - upgradeCost(b) || compareItemIds(a.id, b.id))[0];
}
export function equippedGear(state: GameState, id: string, slot: GearSlot): Gear | undefined {
  return state.inventory.find(item => item.id === getOwned(state, id).equipment[slot]);
}
