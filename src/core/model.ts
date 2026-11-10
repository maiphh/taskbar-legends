import { z } from 'zod';
import { CONFIG, V14_DESIGN, enemyKindSchema, heroConfig, raritySchema, slotSchema, stageConfig } from '../config';
import { isPartyEnemyId } from './party-enemies';

const natural = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const stageNumber = positive.max(CONFIG.stages.length);
const finite = z.number().finite();
const statsSchema = z.object({ hp: natural, atk: natural, def: natural, atkPct: finite.nonnegative(), hpPct: finite.nonnegative(), speedPct: finite.nonnegative() }).strict();
/** Stable item id: itm_<seed namespace>_<serial>, both 8 hex digits, so ids sort in acquisition order. */
export const itemIdSchema = z.string().regex(/^itm_[0-9a-f]{8}_[0-9a-f]{8}$/).brand<'ItemId'>();
export type ItemId = z.infer<typeof itemIdSchema>;
export const itemSourceSchema = z.enum(['drop', 'gacha', 'starter', 'migration']);
const equipmentSchema = z.object({ weapon: itemIdSchema.nullable(), armor: itemIdSchema.nullable(), charm: itemIdSchema.nullable() }).strict();
export const ownedHeroSchema = z.object({ id: z.string(), level: positive.max(CONFIG.growth.levelCap), xp: natural, stars: positive.max(CONFIG.growth.starMax), equipment: equipmentSchema, partyLocked: z.boolean().optional() }).strict();
export type OwnedHero = z.infer<typeof ownedHeroSchema>;
const gearFields = { slot: slotSchema, rarity: raritySchema, dropStage: stageNumber,
  level: natural.max(CONFIG.gear.upgrade.maxLevel), spent: natural, stats: statsSchema };
export const gearSchema = z.object({ id: itemIdSchema, templateId: z.string().min(1), tradeable: z.boolean(),
  acquiredAt: z.object({ tick: natural, source: itemSourceSchema }).strict(), ...gearFields }).strict();
/** Save v1 gear: a per-save numeric id and no provenance. Only used to migrate old saves. */
export const gearV1Schema = z.object({ id: positive, ...gearFields }).strict();
export type Gear = z.infer<typeof gearSchema>;
const unitSchema = z.object({
  id: z.string(), sourceId: z.string(), side: z.enum(['hero', 'enemy']),
  hp: natural, maxHp: positive, atk: positive, def: natural, cooldown: natural, attackTicks: positive,
  range: finite.nonnegative(), x: finite, slot: natural, boss: z.boolean(), attacks: natural,
  shield: natural, shieldUntilTick: natural, shieldProviderId: z.string().optional(), bornTick: natural, nativeBornTick: natural.optional(),
  radius: finite.nonnegative().optional(), speed: finite.nonnegative().optional(), facing: z.union([z.literal(-1), z.literal(1)]).optional(),
  targetId: z.string().nullable().optional(), moving: z.boolean().optional(),
  partyCooldowns: z.record(z.string(), natural).optional(), procCounters: z.record(z.string(), finite.nonnegative()).optional(),
  guardReadyTick: natural.optional(), lastBasicTargetId: z.string().nullable().optional(), lastBasicRamp: finite.nonnegative().optional(),
  specialAction: z.discriminatedUnion('state', [
    z.object({ state: z.literal('assassinMark'), targetId: z.string(), startTick: natural, impactTick: natural }).strict(),
    z.object({ state: z.literal('assassinDash'), targetId: z.string(), targetX: finite, startX: finite, startTick: natural, impactTick: natural }).strict(),
    z.object({ state: z.literal('areaMark'), targetId: z.string(), centerX: finite, radius: finite.nonnegative(), startTick: natural, impactTick: natural, abilityId: z.string(), global: z.boolean().optional() }).strict(),
  ]).optional(),
  action: z.discriminatedUnion('state', [
    z.object({ state: z.literal('idle') }).strict(),
    z.object({ state: z.literal('windup'), kind: z.enum(['attack', 'heal']), targetId: z.string(), startTick: natural, impactTick: natural, abilityId: z.string().optional(), centerX: finite.optional(), radius: finite.nonnegative().optional(), interceptable: z.boolean().optional() }).strict(),
    z.object({ state: z.literal('recovery'), kind: z.enum(['attack', 'heal']), targetId: z.string(), startTick: natural, impactTick: natural, readyTick: natural, abilityId: z.string().optional() }).strict(),
  ]).optional(),
}).strict().refine(unit => unit.hp <= unit.maxHp, 'HP exceeds maximum');
export type Unit = z.infer<typeof unitSchema>;
const effectSchema = z.object({ id: z.string().min(1), sourceId: z.string().min(1), targetId: z.string().min(1), group: z.string().min(1), kind: z.enum(['atkBonus', 'atkReduction', 'defReduction', 'damageReduction']), magnitude: finite.nonnegative(), appliedAtTick: natural, expiresAtTick: natural, stackPolicy: z.enum(['strongestRefresh', 'sourceAura']) }).strict();
export type PartyEffect = z.infer<typeof effectSchema>;
const projectileSchema = z.object({ id: z.string().min(1), sourceId: z.string().min(1), sourceSide: z.enum(['hero', 'enemy']), targetId: z.string().min(1), targetSide: z.enum(['hero', 'enemy']), abilityId: z.string().min(1), delivery: z.enum(['homing', 'ground']), basic: z.boolean().optional(), x: finite, speed: finite.positive(), atk: finite.nonnegative(), coefficient: finite.nonnegative(), splashCoefficient: finite.nonnegative().optional(), radius: finite.nonnegative().optional(), centerX: finite.optional(), releasedAtTick: natural, impactNotBeforeTick: natural, expiresAtTick: natural }).strict();
export type PartyProjectile = z.infer<typeof projectileSchema>;
const progressSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PUSHING'), stage: stageNumber }).strict(),
  z.object({ kind: z.literal('BOSS_FIGHT'), stage: stageNumber, failedPower: natural, bossLosses: natural }).strict(),
  z.object({ kind: z.literal('FARMING'), stage: stageNumber, failedStage: stageNumber, retryAtTick: natural, failTick: natural.optional(), failedPower: natural, failures: positive }).strict(),
  z.object({ kind: z.literal('BOSS_READY'), stage: stageNumber, bossStage: stageNumber, failedPower: natural, bossLosses: natural }).strict(),
  z.object({ kind: z.literal('COMPLETE'), stage: stageNumber }).strict(),
]);
export type Progress = z.infer<typeof progressSchema>;
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('retry') }).strict(),
  z.object({ type: z.literal('pull') }).strict(),
  z.object({ type: z.literal('autoEquip') }).strict(),
  z.object({ type: z.literal('autoParty'), preset: z.enum(['balanced', 'fastFarm', 'bossSustain']).optional() }).strict(),
  z.object({ type: z.literal('upgrade'), gearId: itemIdSchema }).strict(),
  z.object({ type: z.literal('equip'), heroId: z.string(), gearId: itemIdSchema }).strict(),
  // CR-14-08: keep option 0 or 1 of the oldest pending chest choice; the other is salvaged.
  z.object({ type: z.literal('chooseChest'), keep: z.number().int().min(0).max(1) }).strict(),
  z.object({ type: z.literal('party'), heroIds: z.array(z.string()).length(CONFIG.sim.partySize) }).strict(),
  z.object({ type: z.literal('lockHero'), heroId: z.string(), locked: z.boolean() }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
export const levelChangeSchema = z.object({ id: z.string(), levelBefore: positive.max(CONFIG.growth.levelCap), levelAfter: positive.max(CONFIG.growth.levelCap) }).strict();
export type LevelChange = z.infer<typeof levelChangeSchema>;
const eventDataSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('spawn'), unitId: z.string(), side: z.enum(['hero', 'enemy']), stage: stageNumber, wave: positive }),
  z.object({ type: z.literal('hit'), attackerId: z.string(), targetId: z.string(), damage: positive, side: z.enum(['hero', 'enemy']) }),
  z.object({ type: z.literal('actionStart'), unitId: z.string(), targetId: z.string(), kind: z.enum(['attack', 'heal']), startTick: natural, impactTick: natural }),
  z.object({ type: z.literal('miss'), unitId: z.string(), targetId: z.string(), kind: z.enum(['attack', 'heal']), reason: z.enum(['target', 'range', 'facing', 'unneeded']) }),
  z.object({ type: z.literal('heal'), sourceId: z.string(), targetId: z.string(), amount: natural }),
  z.object({ type: z.literal('shieldAbsorb'), attackerId: z.string(), targetId: z.string(), providerId: z.string().optional(), amount: positive }),
  z.object({ type: z.literal('guard'), guardianId: z.string(), fromTargetId: z.string(), toTargetId: z.string() }),
  z.object({ type: z.literal('effect'), sourceId: z.string(), targetId: z.string(), effectId: z.string(), group: z.string(), expiresAtTick: natural }),
  z.object({ type: z.literal('projectile'), projectileId: z.string(), sourceId: z.string(), action: z.enum(['release', 'impact', 'expire']) }),
  z.object({ type: z.literal('skill'), unitId: z.string(), skill: z.string() }),
  z.object({ type: z.literal('death'), unitId: z.string(), side: z.enum(['hero', 'enemy']) }),
  z.object({ type: z.literal('gold'), amount: finite.int(), total: natural, reason: z.string() }),
  // levels lists only heroes whose level changed; omitted when nobody levelled up.
  z.object({ type: z.literal('xp'), amount: natural, heroIds: z.array(z.string()), levels: z.array(levelChangeSchema).optional() }),
  z.object({ type: z.literal('stage'), stage: stageNumber, mode: z.string() }),
  z.object({ type: z.literal('clear'), stage: stageNumber, first: z.boolean(), durationSeconds: finite.nonnegative() }),
  z.object({ type: z.literal('wave'), stage: stageNumber, wave: positive }),
  z.object({ type: z.literal('loss'), stage: stageNumber, boss: z.boolean() }),
  z.object({ type: z.literal('retry'), stage: stageNumber, manual: z.boolean() }),
  z.object({ type: z.literal('pull'), heroId: z.string(), rarity: raritySchema, duplicate: z.boolean(), pity: z.union([z.boolean(), z.enum(['legend', 'epic', 'newHero']), z.null()]) }),
  z.object({ type: z.literal('gear'), gearId: itemIdSchema, slot: slotSchema, rarity: raritySchema }),
  // CR-14-08: emitted when a pick-1-of-2 chest resolves (by the player, or auto-picked by score when the queue overflows).
  z.object({ type: z.literal('chestChoice'), options: z.tuple([itemIdSchema, itemIdSchema]), kept: itemIdSchema, rarities: z.tuple([raritySchema, raritySchema]).optional() }),
  z.object({ type: z.literal('upgrade'), gearId: itemIdSchema, level: positive, cost: positive }),
  z.object({ type: z.literal('tickets'), amount: positive, total: natural }),
  // seconds = applied (capped) time; rawSeconds = uncapped time away; heroes = every hero that received offline XP.
  z.object({ type: z.literal('offline'), seconds: finite.nonnegative(), rawSeconds: finite.nonnegative(), clears: natural, gold: natural, xp: natural, chests: natural, heroes: z.array(levelChangeSchema),
    // v1.4 CR-14-04/05 (only when their rules are on): Expedition Chests granted and whole offline tickets granted.
    expeditionChests: natural.optional(), tickets: natural.optional() }),
]);
export type EventData = z.infer<typeof eventDataSchema>;
const eventSchema = z.object({ seq: positive, tick: natural, combatTick: natural.optional(), combatEncounter: natural.optional(), data: eventDataSchema }).strict();
export type GameEvent = z.infer<typeof eventSchema>;
export const stateSchema = z.object({
  // Saves from earlier balance passes load under the current config (same rule as balance-v1.2).
  version: z.literal(2), balance: z.union([z.literal(CONFIG.version), z.literal('1.1.0'), z.literal('1.2.0'), z.literal('1.4.0')]).transform(() => CONFIG.version), tick: natural,
  combatRules: z.literal('party-v2').optional(),
  partyPreset: z.enum(['balanced', 'fastFarm', 'bossSustain']).optional(),
  rng: natural.max(0xffffffff), seed: natural.max(0xffffffff),
  gold: natural, tickets: natural, pity: natural.max(CONFIG.gacha.pity.guaranteeEpicPlusEvery - 1),
  highestCleared: natural.max(CONFIG.stages.length), progress: progressSchema,
  phase: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('battle') }).strict(),
    z.object({ kind: z.literal('farmPad'), settleAtTick: natural, nativeDurationTicks: natural, presentationStartedAtTick: natural.optional() }).strict(),
    z.object({ kind: z.literal('rest'), remainingTicks: natural, next: z.enum(['encounter', 'wave']) }).strict(),
  ]),
  farmClock: z.object({ scale: positive.max(4), minCycleTicks: natural, elapsedTicks: natural, remainder: natural.max(3) }).strict().refine(clock => clock.remainder < clock.scale, 'Invalid unused substep budget').optional(),
  wave: positive.max(CONFIG.runtime.maxCampaignWaves), encounter: positive, stageStartedTick: natural, attemptPower: natural,
  roster: z.array(ownedHeroSchema).max(CONFIG.heroes.length), partyIds: z.array(z.string()).length(CONFIG.sim.partySize),
  inventory: z.array(gearSchema).max(CONFIG.gear.inventoryCap), nextGearId: positive,
  party: z.array(unitSchema).length(CONFIG.sim.partySize), enemies: z.array(unitSchema).max(CONFIG.runtime.maxEnemiesPerWave),
  partyEffects: z.array(effectSchema).max(512).optional(), projectiles: z.array(projectileSchema).max(256).optional(), nextProjectileId: natural.optional(),
  retryFailures: natural, economyRevision: natural,
  stats: z.object({ clears: natural, losses: natural, retries: natural, bossFailures: natural,
    goldEarned: natural, pulls: natural, chests: natural, offlineClears: natural, offlineSeconds: natural }).strict(),
  metrics: z.object({
    firstAttemptTicks: z.record(z.string(), natural), firstClearTicks: z.record(z.string(), natural),
    fullRosterTick: natural.nullable(), nativeFarmClearSeconds: z.array(finite.nonnegative()).max(CONFIG.idle.avgFarmClearSecWindow).optional(), farmClearSeconds: z.array(finite.nonnegative()).max(CONFIG.idle.avgFarmClearSecWindow),
    farmMinSeconds: finite.nonnegative().nullable(), farmMaxSeconds: finite.nonnegative().nullable(), farmSamples: natural,
    maxNonBossStallSeconds: finite.nonnegative(),
  }).strict(),
  // v1.4 (CR-14-08/09), optional so 1.3.0 saves load unchanged: unresolved pick-1-of-2 chests (oldest first, ≤ 3)
  // and repeat farm clears since the last farm chest at stage ≥ farmChest.fromStage.
  pendingChoice: z.array(z.tuple([gearSchema, gearSchema])).max(CONFIG.runtime.chestChoiceQueueMax).optional(),
  farmChestDry: natural.optional(),
  // v1.4 CR-14-01/02/03, optional: pulls since the last Legendary, consecutive pulls without a new hero,
  // chest Fortune rolls since the last Legendary gear, and whether a Legendary has dropped yet.
  pityLegendary: natural.max(V14_DESIGN.gacha.legendaryPityEvery - 1).optional(),
  pityNewHero: natural.max(V14_DESIGN.gacha.newHeroGuaranteeEvery - 1).optional(),
  gearSinceLegendary: natural.max(V14_DESIGN.gearPity.legendaryEvery - 1).optional(),
  gearLegendaryFound: z.boolean().optional(),
  // v1.4 CR-14-05, optional: the owed fraction of an offline ticket carried to the next absence (0 ≤ x < 1).
  offlineTicketFrac: finite.nonnegative().lt(1).optional(),
  eventSeq: natural, eventCounts: z.record(z.string(), natural), events: z.array(eventSchema).max(CONFIG.runtime.eventLogLimit),
}).strict().superRefine((state, context) => {
  const invalid = (message: string): void => context.addIssue({ code: 'custom', message });
  const owned = new Set(state.roster.map(hero => hero.id));
  if (owned.size !== state.roster.length || state.roster.some(hero => !CONFIG.heroes.some(def => def.id === hero.id))) invalid('Invalid roster');
  if (new Set(state.partyIds).size !== CONFIG.sim.partySize || state.partyIds.some(id => !owned.has(id))) invalid('Invalid party');
  if (state.party.some(unit => unit.side !== 'hero') || state.enemies.some(unit => unit.side !== 'enemy')) invalid('Invalid unit side');
  if (state.combatRules === 'party-v2') {
    for (const unit of [...state.party, ...state.enemies]) if (unit.hp > 0 && (unit.radius === undefined || unit.speed === undefined || unit.facing === undefined
      || unit.targetId === undefined || unit.moving === undefined || unit.action === undefined)) invalid(`Party v2 unit ${unit.id} is missing combat state`);
  }
  if (state.enemies.some(unit => !(state.combatRules === 'party-v2' ? isPartyEnemyId(unit.sourceId) : enemyKindSchema.safeParse(unit.sourceId).success))) invalid('Invalid enemy');
  if (state.party.some(unit => !owned.has(unit.sourceId))) invalid('Invalid combat party');
  const gearIds = new Set(state.inventory.map(item => item.id));
  if (gearIds.size !== state.inventory.length || state.inventory.some(item => item.id >= itemId(state.seed, state.nextGearId) || !item.id.startsWith(itemId(state.seed, 0).slice(0, 13))
    || item.templateId !== gearTemplateId(item.slot, item.rarity))) invalid('Invalid gear IDs');
  const pendingIds = (state.pendingChoice ?? []).flat().map(item => item.id);
  if (new Set(pendingIds).size !== pendingIds.length || pendingIds.some(id => gearIds.has(id) || id >= itemId(state.seed, state.nextGearId) || !id.startsWith(itemId(state.seed, 0).slice(0, 13)))
    || (state.pendingChoice ?? []).flat().some(item => item.templateId !== gearTemplateId(item.slot, item.rarity))) invalid('Invalid pending chest choice');
  if (state.gearLegendaryFound !== true && state.gearSinceLegendary !== undefined && state.gearSinceLegendary >= V14_DESIGN.gearPity.firstLegendaryBy) invalid('Fortune counter past the first-Legendary guarantee');
  if (state.farmChestDry !== undefined && CONFIG.v14.farmChest && state.farmChestDry >= CONFIG.v14.farmChest.guaranteeEvery) invalid('Farm chest dry run beyond its guarantee');
  const equipped = new Set<string>();
  for (const hero of state.roster) for (const slot of slotSchema.options) {
    const id = hero.equipment[slot];
    if (id !== null) {
      if (equipped.has(id) || !state.inventory.some(item => item.id === id && item.slot === slot)) invalid('Invalid equipment assignment');
      equipped.add(id);
    }
  }
  const progress = state.progress;
  if ((progress.kind === 'PUSHING' || progress.kind === 'BOSS_FIGHT') && progress.stage !== state.highestCleared + 1) invalid('Push must target next uncleared stage');
  if (progress.kind === 'PUSHING' && stageConfig(progress.stage).isBoss) invalid('Boss must be explicitly started');
  if (progress.kind === 'BOSS_FIGHT' && !stageConfig(progress.stage).isBoss) invalid('Not a boss');
  if (progress.kind === 'FARMING' && (progress.stage !== Math.max(1, state.highestCleared) || progress.failedStage !== state.highestCleared + 1 || stageConfig(progress.failedStage).isBoss)) invalid('Invalid frontier');
  if (progress.kind === 'BOSS_READY' && (progress.stage !== state.highestCleared || progress.bossStage !== state.highestCleared + 1 || !stageConfig(progress.bossStage).isBoss)) invalid('Invalid boss gate');
  if (progress.kind === 'COMPLETE' && state.highestCleared !== CONFIG.stages.length) invalid('Campaign incomplete');
  if (progress.kind === 'FARMING' && progress.failTick !== undefined && progress.failTick > state.tick) invalid('Failure tick cannot be in the future');
  if (state.phase.kind === 'farmPad' && !state.farmClock) invalid('Padding needs a native encounter clock');
  if (state.farmClock && (!(progress.kind === 'FARMING' || progress.kind === 'BOSS_READY' || progress.kind === 'COMPLETE') || progress.stage > state.highestCleared || stageConfig(progress.stage).isBoss)) invalid('Tempo clock is only valid for cleared non-boss repeats');
  for (const hero of state.roster) heroConfig(hero.id);
});
export type GameState = z.infer<typeof stateSchema>;
/** Seed-derived namespace (pure hash; never draws from the gameplay RNG, so balance sims are unchanged). */
export function itemNamespace(seed: number): string {
  let value = (seed ^ 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b) >>> 0;
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0).toString(16).padStart(8, '0');
}
export function itemId(seed: number, serial: number): ItemId {
  return itemIdSchema.parse(`itm_${itemNamespace(seed)}_${serial.toString(16).padStart(8, '0')}`);
}
/** Fixed-width hex serials make string order equal acquisition order. */
export function compareItemIds(a: ItemId, b: ItemId): number { return a < b ? -1 : a > b ? 1 : 0; }
export function gearTemplateId(slot: Gear['slot'], rarity: Gear['rarity']): string { return `gear.${slot}.${rarity}`; }
/**
 * Event-log fields added after a save format shipped. Older logs get the most faithful values available:
 * an old offline event's raw time away is unknown, so it is its applied seconds; its per-hero levels were never recorded.
 */
export function upgradeEventLog(state: unknown): unknown {
  if (typeof state !== 'object' || state === null || !('events' in state) || !Array.isArray(state.events)) return state;
  const events: unknown[] = state.events.map((event: unknown) => {
    if (typeof event !== 'object' || event === null || !('data' in event) || typeof event.data !== 'object' || event.data === null) return event;
    const data: Record<string, unknown> = { ...event.data };
    if (data.type !== 'offline') return event;
    data.rawSeconds ??= data.seconds; data.heroes ??= [];
    return { ...event, data };
  });
  return { ...state, events };
}
export function parseState(value: unknown): GameState { return stateSchema.parse(upgradeEventLog(value)); }
export function cloneState(state: GameState): GameState { return structuredClone(state); }
export function parseAction(value: unknown): Action { return actionSchema.parse(value); }
