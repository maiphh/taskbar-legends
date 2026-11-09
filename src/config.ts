import design from './design-config.json';
import uiTokens from './ui-tokens.json';
import { z } from 'zod';

export const roleSchema = z.enum(['tank', 'warrior', 'ranger', 'mage', 'support']);
export const raritySchema = z.enum(['common', 'rare', 'epic', 'legendary']);
export const enemyKindSchema = z.enum(['grunt', 'archer', 'brute', 'boss_ch1', 'boss_ch2']);
export const slotSchema = z.enum(['weapon', 'armor', 'charm']);
export type Role = z.infer<typeof roleSchema>;
export type Rarity = z.infer<typeof raritySchema>;
export type EnemyKind = z.infer<typeof enemyKindSchema>;
export type GearSlot = z.infer<typeof slotSchema>;
const heroDefinition = z.object({
  id: z.string(), name: z.string(), role: roleSchema, rarity: raritySchema, starter: z.boolean(),
  mod: z.object({ hp: z.number().optional(), atk: z.number().optional(), def: z.number().optional(),
    attackIntervalTicks: z.number().optional(), splashRadiusPx: z.number().optional() }),
});
const wave = z.union([
  z.object({ enemies: z.array(enemyKindSchema).nonempty() }),
  z.object({ boss: enemyKindSchema, adds: z.array(enemyKindSchema) }),
]);
const stageDefinition = z.object({ id: z.string(), index: z.number().int().positive(), chapter: z.number().int().positive(),
  isBoss: z.boolean(), timeoutSec: z.number().positive(), firstClearTickets: z.number().int().nonnegative(), waves: z.array(wave).nonempty() });
// Replace design-config.json with the designer's next delivery; config.json wins over prose.
// Only underspecified implementation/presentation constants are added here.
export const farmTempoSchema = z.object({ nonBossFarmTimeScale: z.number().int().min(1).max(4).default(1), nonBossFarmMinCycleSec: z.number().finite().nonnegative().default(0) });
/**
 * v1.4 code requests (design.md §18). config.json → `v14` carries the designer's *target* values; the game reads them only
 * for rules switched on with setV14Rules(). With no rules on, every rule takes its §18 default and the game is 1.3.0.
 * Implemented here: CR-14-08 chestChoice, CR-14-09 farmChest, CR-14-01/02 recruitPity, CR-14-03 gearFortune,
 * CR-14-04 expeditionChests, CR-14-05 offlineTickets.
 * Other v14 keys are parsed loosely and stay inert.
 */
const v14Schema = z.looseObject({
  chestChoice: z.looseObject({ options: z.number().int().min(1).max(2), fromStage: z.number().int().positive() }),
  farmChest: z.looseObject({ baseChance: z.number().min(0).max(1), guaranteeEvery: z.number().int().positive(), fromStage: z.number().int().positive() }),
  gacha: z.looseObject({ legendaryPityEvery: z.number().int().min(2), legendaryPityPrefersUnowned: z.boolean(), newHeroGuaranteeEvery: z.number().int().min(2) }),
  gearPity: z.looseObject({ legendaryEvery: z.number().int().min(2), firstLegendaryBy: z.number().int().min(2), rollUnits: z.looseObject({ chest: z.number().int().positive(), expeditionChest: z.number().int().positive() }) }),
  offline: z.looseObject({ expeditionChestsPerHour: z.number().positive(), expeditionBestOf: z.number().int().positive(), expeditionChestMax: z.number().int().positive(), ticketRateVsOnline: z.number().min(0).max(1) }),
});
export const V14_DESIGN = v14Schema.parse(design.v14);
export const v14RuleSchema = z.enum(['chestChoice', 'farmChest', 'recruitPity', 'gearFortune', 'expeditionChests', 'offlineTickets']);
export type V14Rule = z.infer<typeof v14RuleSchema>;
export interface V14Live {
  chestChoice: { options: number; fromStage: number };
  farmChest: { baseChance: number; guaranteeEvery: number; fromStage: number } | null;
  /** CR-14-01 legendaryPityEvery / CR-14-02 newHeroGuaranteeEvery; 0 = off. */
  recruit: { legendaryPityEvery: number; legendaryPityPrefersUnowned: boolean; newHeroGuaranteeEvery: number };
  /** CR-14-03; 0 = off. chestUnits = Fortune roll units per normal chest. */
  fortune: { legendaryEvery: number; firstLegendaryBy: number; chestUnits: number; expeditionUnits: number };
  /** CR-14-04 (expeditionChestsPerHour 0 = the 1.3.0 1 per offlineChestEveryHours, max offlineChestMax) and CR-14-05 (ticketRateVsOnline 0 = no offline tickets). */
  offline: { expeditionChestsPerHour: number; expeditionBestOf: number; expeditionChestMax: number; ticketRateVsOnline: number };
}
// §18 defaults: options 1 (off), farmChest null (→ rewards.farmChestChance everywhere), pity and Fortune 0 (off).
const v14Defaults = (): V14Live => ({ chestChoice: { options: 1, fromStage: 1 }, farmChest: null,
  recruit: { legendaryPityEvery: 0, legendaryPityPrefersUnowned: true, newHeroGuaranteeEvery: 0 },
  fortune: { legendaryEvery: 0, firstLegendaryBy: 0, chestUnits: 1, expeditionUnits: 1 },
  offline: { expeditionChestsPerHour: 0, expeditionBestOf: 1, expeditionChestMax: 0, ticketRateVsOnline: 0 } });
export const CONFIG = {
  ...design,
  v14: v14Defaults(),
  combat: { ...design.combat, ...farmTempoSchema.parse(design.combat) },
  progression: { ...design.progression, ...z.object({ powerGainRetryMinSec: z.number().finite().nonnegative().default(0) }).parse(design.progression) },
  ui: uiTokens,
  heroes: z.array(heroDefinition).parse(design.heroes),
  stages: z.array(stageDefinition).parse(design.stages),
  runtime: {
    eventLogLimit: 600, saveKey: 'taskbar-legends:v1', autosaveSeconds: 5, maxFrameDeltaSeconds: 0.25,
    maxStepTicks: 20_000_000, damageFloatSeconds: 0.8, minAttackIntervalTicks: 8,
    hpPower: 0.2, atkPower: 4, defPower: 2, salvageSpentPct: 0.1, salvageBase: 5, chestChoiceQueueMax: 3,
    duplicateGold: 100, pityEpicChance: 0.765, pityLegendaryChance: 0.235,
    percentPrecision: 1000, rewardRounding: 'nearest',
    gearSecondaryPower: 100, maxCampaignWaves: Math.max(...design.stages.map(stage => stage.waves.length)),
    maxEnemiesPerWave: 10,
    textCacheLimit: 512, damageLabelMaxPerTarget: 3, damageCoalesceSeconds: 0.25, damageLabelSeconds: 0.65, damageRisePx: 32,
  },
  desktop: { closedLogicalHeight: uiTokens.closed.height, expandedLogicalHeight: uiTokens.expanded.height, cursorPollMs: 16, monitorPollMs: 500, errorLimit: 30 },
  view: {
    canvasHeight: uiTokens.closed.height, stripHeight: uiTokens.closed.coreHeight, defaultWidth: 1280, minWidth: 320, maxDpr: 2,
    baselineY: uiTokens.closed.baselineY, bossCountdownWarnSec: 5, hitFlashMs: 90, hitFlashColor: '#ffffff', hurtFallbackMs: 200, attackFallbackMs: 500, heroWidth: 18, heroHeight: 23, enemyWidth: 18, enemyHeight: 21,
    bossWidth: 27, bossHeight: 31, hpWidth: 26, hpHeight: 3,
    // Core-loop feedback (renderer-only; ages derive from event ticks so pause/step can land on any frame).
    upgradePopupSeconds: 1.2, stageCueSeconds: 2,
    background: '#101c27', floor: '#253b43', line: '#355253', text: '#e8eee5', muted: '#8babb0', gold: '#f0cf7f',
    heroAssets: { mw2: 'medieval-warrior-pack-2', hu1: 'huntress', wiz: 'wizard-pack', mw1: 'medieval-warrior-pack', mw3: 'medieval-warrior-pack-3', mh1: 'martial-hero', hk1: 'hero-knight', mh2: 'martial-hero-2', hu2: 'huntress-2', ew1: 'evil-wizard', priest: 'priest', hk2: 'hero-knight-2', mk1: 'medieval-king-pack', fw: 'fantasy-warrior', ew2: 'evil-wizard-2', mk2: 'medieval-king-pack-2', mh3: 'martial-hero-3', ew3: 'evil-wizard-3' } satisfies Record<string, string>,
    enemyAssets: { grunt: 'goblin', archer: 'skeleton', brute: 'mushroom', boss_ch1: 'fire-worm', boss_ch2: 'mimic' },
    roleColors: { tank: '#74baf4', warrior: '#e9b678', ranger: '#9cdea5', mage: '#c3a0f0', support: '#83dccc' },
    enemyColors: { grunt: '#e39a79', archer: '#e6b76e', brute: '#c97a91', boss_ch1: '#e0806c', boss_ch2: '#d383d4' },
  },
};
/** UI tokens (M3 adds rarity, badges, gacha, offlineRewards); typed from the JSON, no UI consumes the M3 blocks yet. */
export type UiTokens = typeof uiTokens;
export type RarityTokens = UiTokens['rarity'];
export type BadgeTokens = UiTokens['badges'];
export type GachaTokens = UiTokens['gacha'];
export type OfflineRewardsTokens = UiTokens['offlineRewards'];
export type CoreLoopFeedbackTokens = UiTokens['coreLoopFeedback'];
export type RarityDropTokens = UiTokens['rarityDrop'];
export type FontTokens = UiTokens['font'];
/** Switches v1.4 rules on (designer values) or back to their 1.3.0 defaults. Rules are not saved; sims and the preview opt in. */
export function setV14Rules(rules: readonly V14Rule[]): void {
  const on = new Set(rules.map(rule => v14RuleSchema.parse(rule)));
  CONFIG.v14.chestChoice = on.has('chestChoice') ? { options: V14_DESIGN.chestChoice.options, fromStage: V14_DESIGN.chestChoice.fromStage } : v14Defaults().chestChoice;
  CONFIG.v14.farmChest = on.has('farmChest') ? { baseChance: V14_DESIGN.farmChest.baseChance, guaranteeEvery: V14_DESIGN.farmChest.guaranteeEvery, fromStage: V14_DESIGN.farmChest.fromStage } : null;
  const gacha = V14_DESIGN.gacha, gear = V14_DESIGN.gearPity;
  CONFIG.v14.recruit = on.has('recruitPity') ? { legendaryPityEvery: gacha.legendaryPityEvery, legendaryPityPrefersUnowned: gacha.legendaryPityPrefersUnowned, newHeroGuaranteeEvery: gacha.newHeroGuaranteeEvery } : v14Defaults().recruit;
  // Expedition Chests count rollUnits.expeditionChest (4) toward Fortune; with expeditionChests off, offline chests are normal chests (1).
  CONFIG.v14.fortune = on.has('gearFortune') ? { legendaryEvery: gear.legendaryEvery, firstLegendaryBy: gear.firstLegendaryBy, chestUnits: gear.rollUnits.chest,
    expeditionUnits: on.has('expeditionChests') ? gear.rollUnits.expeditionChest : gear.rollUnits.chest } : v14Defaults().fortune;
  const away = V14_DESIGN.offline, legacy = v14Defaults().offline;
  CONFIG.v14.offline = { ...(on.has('expeditionChests') ? { expeditionChestsPerHour: away.expeditionChestsPerHour, expeditionBestOf: away.expeditionBestOf, expeditionChestMax: away.expeditionChestMax } : legacy),
    ticketRateVsOnline: on.has('offlineTickets') ? away.ticketRateVsOnline : 0 };
}
export function activeV14Rules(): V14Rule[] {
  const on: Record<V14Rule, boolean> = { chestChoice: CONFIG.v14.chestChoice.options > 1, farmChest: CONFIG.v14.farmChest !== null,
    recruitPity: CONFIG.v14.recruit.legendaryPityEvery > 0 || CONFIG.v14.recruit.newHeroGuaranteeEvery > 0, gearFortune: CONFIG.v14.fortune.legendaryEvery > 0,
    expeditionChests: CONFIG.v14.offline.expeditionChestsPerHour > 0, offlineTickets: CONFIG.v14.offline.ticketRateVsOnline > 0 };
  return v14RuleSchema.options.filter(rule => on[rule]);
}
export const TICK_MS = 1000 / CONFIG.sim.ticksPerSecond;
export const ticksForSeconds = (seconds: number): number => Math.round(seconds * CONFIG.sim.ticksPerSecond);
export function stageConfig(stage: number) {
  const value = CONFIG.stages[stage - 1];
  if (!value) throw new Error(`Unknown stage: ${stage}`);
  return value;
}
export function heroConfig(id: string) {
  const value = CONFIG.heroes.find(hero => hero.id === id);
  if (!value) throw new Error(`Unknown hero: ${id}`);
  return value;
}
