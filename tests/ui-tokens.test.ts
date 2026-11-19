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
    expect([font.body.cssPx, font.heading.cssPx, font.small.cssPx]).toEqual([12, 22, 11]);
    expect(feedback.stepMs).toBe(40);
    expect(drop).toBeTypeOf('object');
  });
  it('defines the UI layout v2 window and hit-target presets', () => {
    expect(CONFIG.ui.managementV2).toMatchObject({ preset1280: [1280, 720], preset960: [960, 640], min: [960, 600], topbarHeight: 56, navRailWidth: 80, navBottomHeight: 64 });
    expect(CONFIG.ui.managementV2.hit).toEqual({ primary: 48, default: 40, min: 32 });
  });
});
