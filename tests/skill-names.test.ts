import { describe, expect, it } from 'vitest';
import {
  ACTIVE_SKILL_NAMES,
  ACTIVE_SKILL_NAMES_BY_HERO,
  BASIC_SKILL_NAMES,
  activeSkillName,
  skillShortName,
} from '../src/skill-names';
import { getPartyHeroDefinition, getPartyHeroDefinitions } from '../src/core/party-definitions';

describe('skill short names', () => {
  it('maps priest basics and signatures the lane callout uses', () => {
    expect(skillShortName('priest-heal-or-bolt')).toBe('Prayer');
    expect(skillShortName('priest-burst-heal')).toBe('Restoration');
    expect(activeSkillName('priest')).toBe('Restoration');
  });

  it('maps tank and cleave names for windup callouts', () => {
    expect(skillShortName('guardian-strike')).toBe('Guardian Strike');
    expect(skillShortName('guardian-shield')).toBe('Guardian Shield');
    expect(skillShortName('melee-cleave-strike')).toBe('Cleave');
    expect(skillShortName('cleave')).toBe('Cleave');
    expect(activeSkillName('mw1')).toBe('Cleave');
    expect(activeSkillName('mw2')).toBe('Guardian Shield');
  });

  it('covers every party hero basic and active ability id', () => {
    for (const definition of getPartyHeroDefinitions()) {
      expect(BASIC_SKILL_NAMES[definition.basic.id], definition.basic.id).toBeTruthy();
      expect(ACTIVE_SKILL_NAMES[definition.active.id], definition.active.id).toBeTruthy();
      expect(activeSkillName(definition.id)).toBe(ACTIVE_SKILL_NAMES_BY_HERO[definition.id]);
      expect(skillShortName(definition.basic.id)).toBe(BASIC_SKILL_NAMES[definition.basic.id]);
      expect(skillShortName(definition.active.id)).toBe(ACTIVE_SKILL_NAMES[definition.active.id]);
    }
  });

  it('returns undefined for unknown or missing ability ids', () => {
    expect(skillShortName(undefined)).toBeUndefined();
    expect(skillShortName('enemy-basic')).toBeUndefined();
    expect(activeSkillName('nope')).toBe('Signature Skill');
  });

  it('keeps hero-sheet signature labels aligned with ability ids', () => {
    expect(activeSkillName('priest')).toBe(skillShortName(getPartyHeroDefinition('priest').active.id));
    expect(activeSkillName('mw1')).toBe(skillShortName(getPartyHeroDefinition('mw1').active.id));
  });
});
