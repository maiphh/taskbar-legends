import { CONFIG } from './config';

/** Locally bundled text faces. Noto Sans handles prose; Galmuri is a symbol-only fallback. */
export const FONT_FILES = [
  ['GameSans', 'NotoSans-Regular.ttf', '400'],
  ['GameSans', 'NotoSans-SemiBold.ttf', '600'],
  ['GamePixel', 'Galmuri11.ttf', '400'],
  ['GamePixel', 'Galmuri11-Bold.ttf', '700'],
  ['Galmuri11', 'Galmuri11.ttf', '400'],
  ['Galmuri11', 'Galmuri11-Bold.ttf', '700'],
  ['GameMeta', 'Galmuri9.ttf', '400'],
  ['GameSymbols', 'Galmuri11.ttf', '400'],
] as const;
export type FontName = string;
export const CSS_FONT_STACK = 'GameSans, GameSymbols, system-ui, sans-serif';
export const CSS_SEMIBOLD_STACK = 'GameSans, GameSymbols, system-ui, sans-serif';
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

export function fontFor(value: string, size: number, bold: boolean, pixel = false): FontName {
  void value; void size; void bold;
  return pixel ? 'GamePixel, GameSymbols, monospace' : CSS_FONT_STACK;
}
/** Noto's native metrics do not need the old Galmuri slot correction. */
export function slotOffsetY(size: number, bold: boolean): number { void size; void bold; return 0; }
export function fitSize(width: number, maxWidth: number, size: number): number {
  return size === BODY && width > maxWidth ? SMALL : size;
}
