import { CONFIG } from './config';

/** Galmuri faces as registered with FontFace (see PixelUI.load). */
export const FONT_FILES = [['Galmuri11', 'Galmuri11.ttf'], ['Galmuri11Bold', 'Galmuri11-Bold.ttf'], ['Galmuri9', 'Galmuri9.ttf']] as const;
export type FontName = (typeof FONT_FILES)[number][0];
const font = CONFIG.ui.font;
/**
 * Native canvas sizes (ui-tokens `font.*.cssPx`): Galmuri11 is pixel-exact only at 12/24 px, Galmuri9 only at 10 px.
 * The "11/22/9" names are cap heights; 11 px or 9 px font-size is off the glyph grid and antialiases.
 */
export const BODY = font.body.cssPx, HEADING = font.heading.cssPx, SMALL = font.small.cssPx;
/** Line box for 12 px text (14 px); buttons centre this box. */
export const LINE_BOX = font.body.lineBoxPx;
/**
 * Galmuri11 Bold covers only Basic Latin + Latin-1 (+ a few punctuation/arrow/star glyphs), so Vietnamese, Cyrillic and
 * anything else falls back to Regular instead of a missing-glyph box. tests/font-coverage.test.ts checks this set against the TTF.
 */
export const BOLD_SAFE = /^[\u0020-\u007e\u00a0-\u00ff\u2010-\u2027\u2190-\u2193\u2605]*$/u;
export function fontFor(value: string, size: number, bold: boolean): FontName {
  if (size === SMALL) return 'Galmuri9';
  return bold && BOLD_SAFE.test(value) ? 'Galmuri11Bold' : 'Galmuri11';
}
/**
 * Text y values written for the Pixel Operator layout are slots; Galmuri draws at slot + `font.slotOffsetY`
 * (+2 at 12 px, -1 at 24 px, 0 at 10 px) to keep the same optical cap centre. Specs from 2026-11-09 give real draw y.
 */
export function slotOffsetY(size: number, bold: boolean): number {
  const offset = font.slotOffsetY;
  return size === HEADING ? offset.heading : size === SMALL ? offset.small : bold ? offset.bodyBold : offset.body;
}
/**
 * General overflow rule (Game Lead, 2026-11-09): body text wider than the box it is given (e.g. an 80 px roster card label)
 * drops to Galmuri9 at its native 10 px instead of clipping. Headings and small text keep their size and clip.
 */
export function fitSize(width: number, maxWidth: number, size: number): number {
  return size === BODY && width > maxWidth ? SMALL : size;
}
