import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import type { CoreLoopFeedbackTokens, FontTokens, GachaTokens, RarityDropTokens } from '../src/config';

/** The designer's runtime/ui-tokens.json is imported verbatim; these typed reads fail to compile if a field we rely on moves. */
describe('ui tokens', () => {
  it('types the newer gacha fields (shape cue, legendary beam, audio pity)', () => {
    const gacha: GachaTokens = CONFIG.ui.gacha;
    expect(typeof gacha.legendaryBeam.growMs).toBe('string'); // prose spec for now ("burst [1360,1520], 18 px per 40 ms")
    expect(Object.keys(gacha.shapeCue)).toEqual(expect.arrayContaining(['common', 'rare', 'epic', 'legendary']));
    expect(gacha.single.beamRect).toBeDefined(); expect(gacha.audio.pity).toBeDefined();
  });
  it('types the font, core-loop feedback and rarity-drop blocks', () => {
    const font: FontTokens = CONFIG.ui.font, feedback: CoreLoopFeedbackTokens = CONFIG.ui.coreLoopFeedback, drop: RarityDropTokens = CONFIG.ui.rarityDrop;
    expect([font.body.cssPx, font.heading.cssPx, font.small.cssPx]).toEqual([12, 24, 10]);
    expect(feedback.stepMs).toBe(40);
    expect(drop).toBeTypeOf('object');
  });
});
