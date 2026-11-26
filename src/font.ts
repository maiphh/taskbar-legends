import { CONFIG } from './config';

/** The strip, management window and desktop controls share the bundled pixel face. */
export const FONT_FILES = [
  ['Galmuri11', 'Galmuri11.ttf', '400'],
  ['Galmuri11', 'Galmuri11-Bold.ttf', '700'],
  ['GameFallback', 'NotoSans-Regular.ttf', '400'],
  ['GameFallback', 'NotoSans-SemiBold.ttf', '600'],
] as const;
export const CSS_FONT_STACK = 'Galmuri11, GameFallback, monospace';
export const CSS_SEMIBOLD_STACK = CSS_FONT_STACK;
const font = CONFIG.ui.font;
export const BODY = font.body.cssPx, HEADING = 22, SMALL = 11;
export const LINE_BOX = 16;
let loading: Promise<void> | null = null;

/** Shared cached loader for canvas, browser management, and the native control window. */
export function loadFonts(): Promise<void> {
  loading ??= Promise.all(FONT_FILES.map(async ([family, file, weight]) => {
    const url = new URL(`${import.meta.env.BASE_URL}fonts/${file}`, window.location.href);
    const face = new FontFace(family, `url(${url.href})`, { weight });
    await face.load(); document.fonts.add(face);
  })).then(() => document.fonts.ready.then(() => undefined));
  return loading;
}

export function slotOffsetY(size: number, bold: boolean): number { void size; void bold; return 0; }
export function fitSize(width: number, maxWidth: number, size: number): number {
  return size === BODY && width > maxWidth ? SMALL : size;
}
