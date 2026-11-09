import { CONFIG } from './config';

/** Galmuri faces as registered with FontFace (see PixelUI.ready). */
export const FONT_FILES = [['Galmuri11', 'Galmuri11.ttf'], ['Galmuri11Bold', 'Galmuri11-Bold.ttf'], ['Galmuri9', 'Galmuri9.ttf']] as const;
export type FontName = (typeof FONT_FILES)[number][0];
/**
 * Galmuri11 Bold covers only Basic Latin + Latin-1 (+ a few punctuation/arrow/star glyphs), so Vietnamese, Cyrillic and
 * anything else falls back to Regular instead of a missing-glyph box. tests/font-coverage.test.ts checks this set against the TTF.
 */
export const BOLD_SAFE = /^[\u0020-\u007e\u00a0-\u00ff\u2010-\u2027\u2190-\u2193\u2605]*$/u;
export function fontFor(value: string, size: number, bold: boolean): FontName {
  if (size === CONFIG.ui.font.decorativeSize) return 'Galmuri9';
  return bold && BOLD_SAFE.test(value) ? 'Galmuri11Bold' : 'Galmuri11';
}
