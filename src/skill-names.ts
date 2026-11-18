/** Short combat skill labels shared by the lane callout and the management hero sheet. */

/** Basic ability id → one-line name drawn above a windup actor. */
export const BASIC_SKILL_NAMES: Readonly<Record<string, string>> = {
  'guardian-strike': 'Guardian Strike',
  'bruiser-strike': 'Brute Strike',
  'melee-cleave-strike': 'Cleave',
  'ranger-shot': 'Ranger Shot',
  'priest-heal-or-bolt': 'Prayer',
  'hex-bolt': 'Hex Bolt',
  'banner-bolt': 'Banner Bolt',
  'arcane-bolt': 'Arcane Bolt',
  'wide-cleave-strike': 'Wide Cleave',
  'duelist-strike': 'Duelist Strike',
  'long-range-shot': 'Long Shot',
};

/** Signature active ability id → short name (same strings as the hero sheet). */
export const ACTIVE_SKILL_NAMES: Readonly<Record<string, string>> = {
  'guardian-shield': 'Guardian Shield',
  'bruiser-heal': 'Second Wind',
  cleave: 'Cleave',
  'ranged-burst': 'Piercing Shot',
  'priest-burst-heal': 'Restoration',
  weaken: 'Withering Hex',
  'banner-buff': 'Rally',
  fireball: 'Fireball',
  'wide-cleave': 'Wide Cleave',
  'focused-burst': 'Focused Burst',
  'quick-burst': 'Quick Burst',
  'long-range-burst': 'Long Shot',
  'wide-guardian-shield': 'Bulwark',
  'bruiser-burst-heal': 'Blood Strike',
  'wide-fireball': 'Inferno',
  'heavy-guardian-shield': 'Iron Wall',
  'heavy-single-burst': 'Execution',
  'defense-break': 'Armor Break',
};

/** Hero id → signature name for the management sheet (howto / skills card). */
export const ACTIVE_SKILL_NAMES_BY_HERO: Readonly<Record<string, string>> = {
  mw2: 'Guardian Shield',
  hk1: 'Second Wind',
  mw1: 'Cleave',
  hu1: 'Piercing Shot',
  priest: 'Restoration',
  ew1: 'Withering Hex',
  mk1: 'Rally',
  wiz: 'Fireball',
  mw3: 'Wide Cleave',
  mh1: 'Focused Burst',
  mh2: 'Quick Burst',
  hu2: 'Long Shot',
  hk2: 'Bulwark',
  fw: 'Blood Strike',
  ew2: 'Inferno',
  mk2: 'Iron Wall',
  mh3: 'Execution',
  ew3: 'Armor Break',
};

/** Signature label for a hero roster id (management UI). */
export function activeSkillName(heroId: string): string {
  return ACTIVE_SKILL_NAMES_BY_HERO[heroId] ?? 'Signature Skill';
}

/** Lane callout for a committed ability id; undefined when the id is unknown (enemies, missing). */
export function skillShortName(abilityId: string | undefined): string | undefined {
  if (!abilityId) return undefined;
  return BASIC_SKILL_NAMES[abilityId] ?? ACTIVE_SKILL_NAMES[abilityId];
}
