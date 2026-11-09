import { z } from 'zod';
import { CONFIG, enemyKindSchema, heroConfig, raritySchema, slotSchema, stageConfig } from '../config';

const natural = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const stageNumber = positive.max(CONFIG.stages.length);
const finite = z.number().finite();
const statsSchema = z.object({ hp: natural, atk: natural, def: natural, atkPct: finite.nonnegative(), hpPct: finite.nonnegative(), speedPct: finite.nonnegative() }).strict();
const equipmentSchema = z.object({ weapon: natural.nullable(), armor: natural.nullable(), charm: natural.nullable() }).strict();
export const ownedHeroSchema = z.object({ id: z.string(), level: positive.max(CONFIG.growth.levelCap), xp: natural, stars: positive.max(CONFIG.growth.starMax), equipment: equipmentSchema }).strict();
export type OwnedHero = z.infer<typeof ownedHeroSchema>;
export const gearSchema = z.object({ id: positive, slot: slotSchema, rarity: raritySchema, dropStage: stageNumber,
  level: natural.max(CONFIG.gear.upgrade.maxLevel), spent: natural, stats: statsSchema }).strict();
export type Gear = z.infer<typeof gearSchema>;
const unitSchema = z.object({
  id: z.string(), sourceId: z.string(), side: z.enum(['hero', 'enemy']),
  hp: natural, maxHp: positive, atk: positive, def: natural, cooldown: natural, attackTicks: positive,
  range: finite.nonnegative(), x: finite, slot: natural, boss: z.boolean(), attacks: natural,
  shield: natural, shieldUntilTick: natural, bornTick: natural,
}).strict().refine(unit => unit.hp <= unit.maxHp, 'HP exceeds maximum');
export type Unit = z.infer<typeof unitSchema>;
const progressSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PUSHING'), stage: stageNumber }).strict(),
  z.object({ kind: z.literal('BOSS_FIGHT'), stage: stageNumber, failedPower: natural, bossLosses: natural }).strict(),
  z.object({ kind: z.literal('FARMING'), stage: stageNumber, failedStage: stageNumber, retryAtTick: natural, failedPower: natural, failures: positive }).strict(),
  z.object({ kind: z.literal('BOSS_READY'), stage: stageNumber, bossStage: stageNumber, failedPower: natural, bossLosses: natural }).strict(),
  z.object({ kind: z.literal('COMPLETE'), stage: stageNumber }).strict(),
]);
export type Progress = z.infer<typeof progressSchema>;
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('retry') }).strict(),
  z.object({ type: z.literal('pull') }).strict(),
  z.object({ type: z.literal('autoEquip') }).strict(),
  z.object({ type: z.literal('autoParty') }).strict(),
  z.object({ type: z.literal('upgrade'), gearId: positive }).strict(),
  z.object({ type: z.literal('equip'), heroId: z.string(), gearId: positive }).strict(),
  z.object({ type: z.literal('party'), heroIds: z.array(z.string()).length(CONFIG.sim.partySize) }).strict(),
]);
export type Action = z.infer<typeof actionSchema>;
const eventDataSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('spawn'), unitId: z.string(), side: z.enum(['hero', 'enemy']), stage: stageNumber, wave: positive }),
  z.object({ type: z.literal('hit'), attackerId: z.string(), targetId: z.string(), damage: positive, side: z.enum(['hero', 'enemy']) }),
  z.object({ type: z.literal('heal'), sourceId: z.string(), targetId: z.string(), amount: natural }),
  z.object({ type: z.literal('skill'), unitId: z.string(), skill: z.string() }),
  z.object({ type: z.literal('death'), unitId: z.string(), side: z.enum(['hero', 'enemy']) }),
  z.object({ type: z.literal('gold'), amount: finite.int(), total: natural, reason: z.string() }),
  z.object({ type: z.literal('xp'), amount: natural, heroIds: z.array(z.string()) }),
  z.object({ type: z.literal('stage'), stage: stageNumber, mode: z.string() }),
  z.object({ type: z.literal('clear'), stage: stageNumber, first: z.boolean(), durationSeconds: finite.nonnegative() }),
  z.object({ type: z.literal('wave'), stage: stageNumber, wave: positive }),
  z.object({ type: z.literal('loss'), stage: stageNumber, boss: z.boolean() }),
  z.object({ type: z.literal('retry'), stage: stageNumber, manual: z.boolean() }),
  z.object({ type: z.literal('pull'), heroId: z.string(), rarity: raritySchema, duplicate: z.boolean(), pity: z.boolean() }),
  z.object({ type: z.literal('gear'), gearId: positive, slot: slotSchema, rarity: raritySchema }),
  z.object({ type: z.literal('upgrade'), gearId: positive, level: positive, cost: positive }),
  z.object({ type: z.literal('tickets'), amount: positive, total: natural }),
  z.object({ type: z.literal('offline'), seconds: finite.nonnegative(), clears: natural, gold: natural, xp: natural, chests: natural }),
]);
export type EventData = z.infer<typeof eventDataSchema>;
const eventSchema = z.object({ seq: positive, tick: natural, data: eventDataSchema }).strict();
export type GameEvent = z.infer<typeof eventSchema>;
export const stateSchema = z.object({
  version: z.literal(1), balance: z.literal(CONFIG.version), tick: natural,
  rng: natural.max(0xffffffff), seed: natural.max(0xffffffff),
  gold: natural, tickets: natural, pity: natural.max(CONFIG.gacha.pity.guaranteeEpicPlusEvery - 1),
  highestCleared: natural.max(CONFIG.stages.length), progress: progressSchema,
  phase: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('battle') }).strict(),
    z.object({ kind: z.literal('rest'), remainingTicks: natural, next: z.enum(['encounter', 'wave']) }).strict(),
  ]),
  wave: positive.max(CONFIG.runtime.maxCampaignWaves), encounter: positive, stageStartedTick: natural, attemptPower: natural,
  roster: z.array(ownedHeroSchema).max(CONFIG.heroes.length), partyIds: z.array(z.string()).length(CONFIG.sim.partySize),
  inventory: z.array(gearSchema).max(CONFIG.gear.inventoryCap), nextGearId: positive,
  party: z.array(unitSchema).length(CONFIG.sim.partySize), enemies: z.array(unitSchema).max(CONFIG.runtime.maxEnemiesPerWave),
  retryFailures: natural, economyRevision: natural,
  stats: z.object({ clears: natural, losses: natural, retries: natural, bossFailures: natural,
    goldEarned: natural, pulls: natural, chests: natural, offlineClears: natural, offlineSeconds: natural }).strict(),
  metrics: z.object({
    firstAttemptTicks: z.record(z.string(), natural), firstClearTicks: z.record(z.string(), natural),
    fullRosterTick: natural.nullable(), farmClearSeconds: z.array(finite.nonnegative()).max(CONFIG.idle.avgFarmClearSecWindow),
    farmMinSeconds: finite.nonnegative().nullable(), farmMaxSeconds: finite.nonnegative().nullable(), farmSamples: natural,
    maxNonBossStallSeconds: finite.nonnegative(),
  }).strict(),
  eventSeq: natural, eventCounts: z.record(z.string(), natural), events: z.array(eventSchema).max(CONFIG.runtime.eventLogLimit),
}).strict().superRefine((state, context) => {
  const invalid = (message: string): void => context.addIssue({ code: 'custom', message });
  const owned = new Set(state.roster.map(hero => hero.id));
  if (owned.size !== state.roster.length || state.roster.some(hero => !CONFIG.heroes.some(def => def.id === hero.id))) invalid('Invalid roster');
  if (new Set(state.partyIds).size !== CONFIG.sim.partySize || state.partyIds.some(id => !owned.has(id))) invalid('Invalid party');
  if (state.party.some(unit => unit.side !== 'hero') || state.enemies.some(unit => unit.side !== 'enemy')) invalid('Invalid unit side');
  if (state.enemies.some(unit => !enemyKindSchema.safeParse(unit.sourceId).success)) invalid('Invalid enemy');
  if (state.party.some(unit => !owned.has(unit.sourceId))) invalid('Invalid combat party');
  const gearIds = new Set(state.inventory.map(item => item.id));
  if (gearIds.size !== state.inventory.length || state.inventory.some(item => item.id >= state.nextGearId)) invalid('Invalid gear IDs');
  const equipped = new Set<number>();
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
  for (const hero of state.roster) heroConfig(hero.id);
});
export type GameState = z.infer<typeof stateSchema>;
export function parseState(value: unknown): GameState { return stateSchema.parse(value); }
export function cloneState(state: GameState): GameState { return structuredClone(state); }
export function parseAction(value: unknown): Action { return actionSchema.parse(value); }
