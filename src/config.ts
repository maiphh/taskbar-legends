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
export const CONFIG = {
  ...design,
  ui: uiTokens,
  heroes: z.array(heroDefinition).parse(design.heroes),
  stages: z.array(stageDefinition).parse(design.stages),
  runtime: {
    eventLogLimit: 600, saveKey: 'taskbar-legends:v1', autosaveSeconds: 5, maxFrameDeltaSeconds: 0.25,
    maxStepTicks: 20_000_000, damageFloatSeconds: 0.8, minAttackIntervalTicks: 8,
    hpPower: 0.2, atkPower: 4, defPower: 2, salvageSpentPct: 0.1, salvageBase: 5,
    duplicateGold: 100, pityEpicChance: 0.765, pityLegendaryChance: 0.235,
    percentPrecision: 1000, rewardRounding: 'nearest',
    gearSecondaryPower: 100, maxCampaignWaves: Math.max(...design.stages.map(stage => stage.waves.length)),
    maxEnemiesPerWave: 10,
    textCacheLimit: 512, damageLabelMaxPerTarget: 3, damageCoalesceSeconds: 0.25, damageLabelSeconds: 0.65, damageRisePx: 32,
  },
  desktop: { closedLogicalHeight: uiTokens.closed.height, expandedLogicalHeight: uiTokens.expanded.height, cursorPollMs: 16, monitorPollMs: 500, errorLimit: 30 },
  view: {
    canvasHeight: uiTokens.closed.height, stripHeight: uiTokens.closed.coreHeight, defaultWidth: 1280, minWidth: 320, maxDpr: 2,
    baselineY: uiTokens.closed.baselineY, hitFlashMs: 90, hitFlashColor: '#ffffff', hurtFallbackMs: 200, attackFallbackMs: 500, heroWidth: 18, heroHeight: 23, enemyWidth: 18, enemyHeight: 21,
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
