import { z } from 'zod';
import { CONFIG, ticksForSeconds } from '../config';

export const partyRoleSchema = z.enum(['tank', 'dps', 'support']);
const familySchema = z.enum(['guardian', 'bruiser', 'meleeDps', 'rangedDps', 'aoeDps', 'healer', 'bufferDebuffer']);
const attackStyleSchema = z.enum(['melee', 'magic', 'projectile', 'heal']);
const family = {
  guardian: { hp: 300, atk: 14, def: 40, attackTicks: 24 },
  bruiser: { hp: 260, atk: 18, def: 30, attackTicks: 22 },
  meleeDps: { hp: 200, atk: 22, def: 20, attackTicks: 12 },
  rangedDps: { hp: 140, atk: 18, def: 10, attackTicks: 16 },
  aoeDps: { hp: 120, atk: 30, def: 5, attackTicks: 24 },
  healer: { hp: 150, atk: 12, def: 10, attackTicks: 30 },
  bufferDebuffer: { hp: 150, atk: 14, def: 10, attackTicks: 24 },
} as const;

const abilitySchema = z.object({
  id: z.string().min(1), kind: z.enum(['shield', 'selfHeal', 'cleave', 'projectile', 'burstHeal', 'weaken', 'buff', 'fireball', 'singleBurst', 'selfSustain', 'intercept']), manaCost: z.number().int().positive().max(100).optional(),
  cooldownTicks: z.number().int().nonnegative(), durationTicks: z.number().int().nonnegative().optional(),
  coefficient: z.number().nonnegative().optional(), secondaryCoefficient: z.number().nonnegative().optional(), radius: z.number().nonnegative().optional(), range: z.number().nonnegative().optional(),
  hpThreshold: z.number().min(0).max(1).optional(), healCoefficient: z.number().nonnegative().optional(), shieldFraction: z.number().nonnegative().optional(), atkReduction: z.number().nonnegative().optional(), defReduction: z.number().nonnegative().optional(),
  atkBonus: z.number().nonnegative().optional(), allyTarget: z.boolean().optional(), emergency: z.boolean().optional(),
  maxSecondaryTargets: z.number().int().positive().optional(),
}).strict();
const passiveSchema = z.object({
  id: z.string().min(1), kind: z.enum(['intercept', 'fourthSelfHeal', 'sameTargetRamp', 'fourthBonus', 'healGuard', 'firstWeakenShield', 'livingAura', 'thirdSplash', 'fourthGuard']),
  group: z.string().min(1).optional(), durationTicks: z.number().int().nonnegative().optional(), coefficient: z.number().nonnegative().optional(), secondaryCoefficient: z.number().nonnegative().optional(),
  cap: z.number().nonnegative().optional(), radius: z.number().nonnegative().optional(), range: z.number().nonnegative().optional(), cooldownTicks: z.number().int().nonnegative().optional(), atkReduction: z.number().nonnegative().optional(), defReduction: z.number().nonnegative().optional(), atkBonus: z.number().nonnegative().optional(), shieldFraction: z.number().nonnegative().optional(),
}).strict();
const definitionSchema = z.object({
  id: z.string().min(1), family: familySchema, role: partyRoleSchema, tags: z.array(z.string().min(1)).nonempty(),
  basic: z.object({ id: z.string().min(1), style: attackStyleSchema, coefficient: z.number().positive(), fallbackCoefficient: z.number().positive().optional(), range: z.number().nonnegative() }).strict(),
  active: abilitySchema, passive: passiveSchema, strength: z.string().min(1), weakness: z.string().min(1),
}).strict();
export type PartyHeroDefinition = z.infer<typeof definitionSchema>;

const sec = ticksForSeconds;
const ranged = 260;
const intercept = (range: number, cooldown: number): PartyHeroDefinition['passive'] => ({ id: 'intercept', kind: 'intercept', range, cooldownTicks: sec(cooldown), group: 'guardian-intercept' });
const cleaveBase = { id: 'cleave', kind: 'cleave' as const, cooldownTicks: sec(6), coefficient: 1.5, secondaryCoefficient: 0.6, radius: 48, maxSecondaryTargets: 1 };
const mhBase = { id: 'focused-burst', kind: 'singleBurst' as const, cooldownTicks: sec(6), coefficient: 2 };
const rangedBase = { id: 'ranged-burst', kind: 'projectile' as const, cooldownTicks: sec(6), coefficient: 1.8 };
const weakenBase = { id: 'weaken', kind: 'weaken' as const, cooldownTicks: sec(7), durationTicks: sec(4), atkReduction: 0.2, defReduction: 0.25 };

const definitions: PartyHeroDefinition[] = [
  { id: 'mw2', family: 'guardian', role: 'tank', tags: ['guardian', 'melee'], basic: { id: 'guardian-strike', style: 'melee', coefficient: 1, range: 12 },
    active: { id: 'guardian-shield', kind: 'shield', cooldownTicks: sec(6), durationTicks: sec(5), shieldFraction: 0.15, hpThreshold: 0.9, emergency: true },
    passive: intercept(260, 8), strength: 'Raises a self-shield when threatened or hurt', weakness: 'Slow, low sustained damage' },
  { id: 'hk1', family: 'bruiser', role: 'tank', tags: ['bruiser', 'melee'], basic: { id: 'bruiser-strike', style: 'melee', coefficient: 1, range: 12 },
    active: { id: 'bruiser-heal', kind: 'selfHeal', cooldownTicks: sec(8), healCoefficient: 0.15, hpThreshold: 0.65, emergency: true },
    passive: { id: 'bruiser-fourth-heal', kind: 'fourthSelfHeal', coefficient: 0.3, group: 'bruiser-fourth-heal' }, strength: 'Self-sustaining frontline', weakness: 'Less ally protection' },
  { id: 'mw1', family: 'meleeDps', role: 'dps', tags: ['melee', 'cleave'], basic: { id: 'melee-cleave-strike', style: 'melee', coefficient: 1, range: 12 }, active: { ...cleaveBase },
    passive: { id: 'same-target-ramp', kind: 'sameTargetRamp', coefficient: 0.05, cap: 0.15, group: 'same-target-ramp' }, strength: 'Reliable cleave and sustained focus', weakness: 'Must reach the frontline' },
  { id: 'hu1', family: 'rangedDps', role: 'dps', tags: ['ranged', 'single-target'], basic: { id: 'ranger-shot', style: 'projectile', coefficient: 1, range: ranged }, active: { ...rangedBase },
    passive: { id: 'ranger-fourth-shot', kind: 'fourthBonus', coefficient: 0.2, group: 'ranger-fourth-shot' }, strength: 'Strong single-target burst', weakness: 'Limited area damage' },
  { id: 'priest', family: 'healer', role: 'support', tags: ['healer', 'ranged'], basic: { id: 'priest-heal-or-bolt', style: 'heal', coefficient: 1.2, fallbackCoefficient: 0.7, range: ranged },
    active: { id: 'priest-burst-heal', kind: 'burstHeal', cooldownTicks: sec(5), durationTicks: 0, healCoefficient: 1.8, hpThreshold: 0.8, emergency: true },
    passive: { id: 'priest-heal-guard', kind: 'healGuard', durationTicks: sec(2), coefficient: 0.1, group: 'healing-guard' }, strength: 'Repeatable healing plus emergency burst', weakness: 'Low damage when the party is healthy' },
  { id: 'ew1', family: 'bufferDebuffer', role: 'support', tags: ['debuffer', 'ranged'], basic: { id: 'hex-bolt', style: 'magic', coefficient: 0.7, range: ranged }, active: { ...weakenBase },
    passive: { id: 'first-weaken-shield', kind: 'firstWeakenShield', durationTicks: sec(3), shieldFraction: 0.06, group: 'first-weaken-shield' }, strength: 'Reduces enemy attack and defense', weakness: 'Needs time to establish debuffs' },
  { id: 'mk1', family: 'bufferDebuffer', role: 'support', tags: ['buffer', 'ranged'], basic: { id: 'banner-bolt', style: 'magic', coefficient: 0.7, range: ranged },
    active: { id: 'banner-buff', kind: 'buff', cooldownTicks: sec(7), durationTicks: sec(4), atkBonus: 0.15, allyTarget: true },
    passive: { id: 'living-banner', kind: 'livingAura', durationTicks: 0, atkReduction: 0.05, group: 'party-guard-aura' }, strength: 'Boosts the strongest ally’s attack', weakness: 'Limited damage contribution' },
  { id: 'wiz', family: 'aoeDps', role: 'dps', tags: ['ranged', 'aoe'], basic: { id: 'arcane-bolt', style: 'magic', coefficient: 1, range: ranged },
    active: { id: 'fireball', kind: 'fireball', cooldownTicks: sec(6), coefficient: 1.4, secondaryCoefficient: 0.6, radius: 48 },
    passive: { id: 'third-shot-splash', kind: 'thirdSplash', coefficient: 0.35, radius: 32, group: 'third-shot-splash' }, strength: 'Cluster clearing', weakness: 'Lower single-target rate and low defense' },
  { id: 'mw3', family: 'meleeDps', role: 'dps', tags: ['melee', 'cleave'], basic: { id: 'wide-cleave-strike', style: 'melee', coefficient: 0.9, range: 12 },
    active: { id: 'wide-cleave', kind: 'cleave', cooldownTicks: sec(7), coefficient: 1.3, secondaryCoefficient: 0.75, radius: 64, maxSecondaryTargets: 1 },
    passive: { id: 'same-target-ramp', kind: 'sameTargetRamp', coefficient: 0.05, cap: 0.15, group: 'same-target-ramp' }, strength: 'Wider cleave', weakness: 'Less focused damage' },
  { id: 'mh1', family: 'meleeDps', role: 'dps', tags: ['melee', 'single-target'], basic: { id: 'duelist-strike', style: 'melee', coefficient: 1, range: 12 }, active: { ...mhBase },
    passive: { id: 'same-target-ramp', kind: 'sameTargetRamp', coefficient: 0.05, cap: 0.2, group: 'same-target-ramp' }, strength: 'Boss dueling', weakness: 'No multi-target active' },
  { id: 'mh2', family: 'meleeDps', role: 'dps', tags: ['melee', 'single-target'], basic: { id: 'duelist-strike', style: 'melee', coefficient: 1, range: 12 },
    active: { id: 'quick-burst', kind: 'singleBurst', cooldownTicks: sec(4), coefficient: 1.6 },
    passive: { id: 'same-target-ramp', kind: 'sameTargetRamp', coefficient: 0.05, cap: 0.1, group: 'same-target-ramp' }, strength: 'Frequent short bursts', weakness: 'Lower peak and long-ramp damage' },
  { id: 'hu2', family: 'rangedDps', role: 'dps', tags: ['ranged', 'single-target'], basic: { id: 'long-range-shot', style: 'projectile', coefficient: 0.85, range: 320 },
    active: { id: 'long-range-burst', kind: 'projectile', cooldownTicks: sec(7), coefficient: 1.7 },
    passive: { id: 'ranger-fourth-shot', kind: 'fourthBonus', coefficient: 0.2, group: 'ranger-fourth-shot' }, strength: 'Long basic-attack range with a strong shot', weakness: 'Limited area damage and lower throughput' },
  { id: 'hk2', family: 'guardian', role: 'tank', tags: ['guardian', 'melee'], basic: { id: 'guardian-strike', style: 'melee', coefficient: 1, range: 12 },
    active: { id: 'wide-guardian-shield', kind: 'shield', cooldownTicks: sec(8), durationTicks: sec(5), shieldFraction: 0.2, hpThreshold: 0.9, emergency: true },
    passive: intercept(320, 10), strength: 'Self-shields when threatened or hurt', weakness: 'Longer skill charge than basic fighters' },
  { id: 'fw', family: 'bruiser', role: 'dps', tags: ['bruiser', 'melee', 'self-sustain'], basic: { id: 'bruiser-strike', style: 'melee', coefficient: 1, range: 12 },
    active: { id: 'bruiser-burst-heal', kind: 'selfSustain', cooldownTicks: sec(8), coefficient: 1.2, healCoefficient: 0.08 },
    passive: { id: 'fourth-basic-guard', kind: 'fourthGuard', durationTicks: sec(2), atkReduction: 0.1, group: 'bruiser-guard' }, strength: 'Self-sustaining frontline DPS', weakness: 'Lower damage and ally protection' },
  { id: 'ew2', family: 'aoeDps', role: 'dps', tags: ['ranged', 'aoe'], basic: { id: 'arcane-bolt', style: 'magic', coefficient: 0.8, range: ranged },
    active: { id: 'wide-fireball', kind: 'fireball', cooldownTicks: sec(7), coefficient: 1.2, secondaryCoefficient: 0.75, radius: 72 },
    passive: { id: 'third-shot-splash', kind: 'thirdSplash', coefficient: 0.35, radius: 32, group: 'third-shot-splash' }, strength: 'Large clustered waves', weakness: 'Weak isolated-target burst' },
  { id: 'mk2', family: 'guardian', role: 'tank', tags: ['guardian', 'melee'], basic: { id: 'guardian-strike', style: 'melee', coefficient: 1, range: 12 },
    active: { id: 'heavy-guardian-shield', kind: 'shield', cooldownTicks: sec(10), durationTicks: sec(5), shieldFraction: 0.25, hpThreshold: 0.9, emergency: true },
    passive: intercept(260, 6), strength: 'Large self-shield', weakness: 'Slow attack and limited damage' },
  { id: 'mh3', family: 'meleeDps', role: 'dps', tags: ['melee', 'single-target'], basic: { id: 'duelist-strike', style: 'melee', coefficient: 1, range: 12 },
    active: { id: 'heavy-single-burst', kind: 'singleBurst', cooldownTicks: sec(8), coefficient: 2.2 },
    passive: { id: 'same-target-ramp', kind: 'sameTargetRamp', coefficient: 0.05, cap: 0.2, group: 'same-target-ramp' }, strength: 'Large single-target burst', weakness: 'Long active downtime, no cleave' },
  { id: 'ew3', family: 'bufferDebuffer', role: 'support', tags: ['debuffer', 'ranged'], basic: { id: 'hex-bolt', style: 'magic', coefficient: 0.65, range: ranged },
    active: { id: 'defense-break', kind: 'weaken', cooldownTicks: sec(8), durationTicks: sec(3), atkReduction: 0.2, defReduction: 0.4 },
    passive: { id: 'first-weaken-shield', kind: 'firstWeakenShield', durationTicks: sec(3), shieldFraction: 0.06, group: 'first-weaken-shield' }, strength: 'Defense-breaking burst windows', weakness: 'Lower prevention uptime' },
];

const abilityIds = new Set<string>();
const manaCosts: Record<string, number> = { mh2: 40, wiz: 80, mw3: 80, ew2: 80, mk2: 80, mh3: 80 };
const validated = definitions.map(value => {
  const result = definitionSchema.parse(value);
  abilityIds.add(result.active.id); abilityIds.add(result.basic.id);
  return Object.freeze({ ...result, active: Object.freeze({ ...result.active, manaCost: manaCosts[result.id] ?? 60 }), familyStats: family[result.family] });
});
const byId = new Map(validated.map(value => [value.id, value]));
if (byId.size !== CONFIG.heroes.length || CONFIG.heroes.some(hero => !byId.has(hero.id))) throw new Error('Party hero definitions must cover every configured hero exactly once');

export function getPartyHeroDefinition(id: string) {
  const definition = byId.get(id);
  if (!definition) throw new Error(`Unknown party hero: ${id}`);
  return definition;
}
export function getPartyHeroDefinitions() { return validated; }
export function isPartyAbilityId(id: string): boolean { return abilityIds.has(id); }
export function partyAbilityTicks(seconds: number): number { return sec(seconds); }
/** Damage coefficient used by the hero's repeatable basic action (healers use their healthy-target fallback). */
export function partyBasicDamageCoefficient(definition: PartyHeroDefinition): number {
  return definition.basic.style === 'heal' ? definition.basic.fallbackCoefficient ?? definition.basic.coefficient : definition.basic.coefficient;
}
