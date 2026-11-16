import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_FILES } from '../src/font';

/** Minimal TrueType cmap reader (formats 4 and 12) — enough to ask "does this face have a glyph for U+xxxx?". */
function cmapGlyphs(path: string): Map<number, number> {
  const bytes = readFileSync(path); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = view.getUint16(4);
  let base = -1;
  for (let i = 0; i < tables; i += 1) {
    const record = 12 + i * 16;
    if (String.fromCharCode(...[0, 1, 2, 3].map(k => view.getUint8(record + k))) === 'cmap') base = view.getUint32(record + 8);
  }
  if (base < 0) throw new Error(`${path}: no cmap`);
  const codes = new Map<number, number>();
  for (let i = 0; i < view.getUint16(base + 2); i += 1) {
    const sub = base + view.getUint32(base + 4 + i * 8 + 4), format = view.getUint16(sub);
    if (format === 4) {
      const segments = view.getUint16(sub + 6) / 2, ends = sub + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, offsets = deltas + segments * 2;
      for (let s = 0; s < segments; s += 1) {
        const end = view.getUint16(ends + s * 2), start = view.getUint16(starts + s * 2), delta = view.getInt16(deltas + s * 2), offset = view.getUint16(offsets + s * 2);
        for (let code = start; code <= end && code !== 0xffff; code += 1) {
          const glyph = offset === 0 ? (code + delta) & 0xffff : view.getUint16(offsets + s * 2 + offset + (code - start) * 2);
          if (glyph !== 0) codes.set(code, glyph);
        }
      }
    } else if (format === 12) {
      for (let g = 0; g < view.getUint32(sub + 12); g += 1) {
        const group = sub + 16 + g * 12;
        const start = view.getUint32(group), startGlyph = view.getUint32(group + 8);
        for (let code = start; code <= view.getUint32(group + 4); code += 1) codes.set(code, startGlyph + code - start);
      }
    }
  }
  return codes;
}

const fonts = Object.fromEntries(FONT_FILES.map(([, file]) => [file, new Set(cmapGlyphs(join('public/fonts', file)).keys())]));
const missing = (face: string, text: string): string[] => [...new Set(text)].filter(ch => !/\s/u.test(ch) || ch === ' ').filter(ch => !fonts[face]?.has(ch.codePointAt(0) ?? 0)).map(ch => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')} ${ch}`);

/** Every string literal the UI can draw comes from src/ (labels, templates) or config/token data (hero/stage/gear names). */
const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.(ts|json)$/.test(entry.name) ? [join(dir, entry.name)] : []);
const literals = sourceFiles('src').flatMap(file => [...readFileSync(file, 'utf8').matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map(match => match[1] ?? match[2] ?? match[3] ?? '')).join('');
const printableAscii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const VIETNAMESE = 'Tiếng Việt: Anh hùng đã hạ gục trùm! Vàng, vé, trang bị — Ắ Ằ Ẳ Ẵ Ặ ơ ư Ơ Ư đ Đ ỹ Ỹ ỵ Ỵ ữ ự ậ ẩ';
const CYRILLIC = 'Русский: Герои победили босса! Золото, билеты, снаряжение. Ёё Йй Щщ Ъъ Ыы Ээ Юю Яя; Українська: Ґґ Єє Іі Її';

describe('bundled font glyph coverage', () => {
  it('both Noto weights cover printable ASCII and the current Vietnamese and Cyrillic samples', () => {
    for (const file of ['NotoSans-Regular.ttf', 'NotoSans-SemiBold.ttf'])
      expect(missing(file, printableAscii + VIETNAMESE + CYRILLIC), file).toEqual([]);
  });
  it('keeps current UI symbols available in the explicit local Galmuri fallback', () => {
    expect(missing('Galmuri11.ttf', '★ ☆ · → ← ×')).toEqual([]);
  });
  it('keeps active UI source strings covered by the primary text face', () => {
    const text = literals.replace(/[^\u0020-\uffff]/gu, ''), symbols = fonts['Galmuri11.ttf'] ?? new Set<number>();
    expect(missing('NotoSans-Regular.ttf', text).filter(ch => !symbols.has(Number.parseInt(ch.slice(2, 6), 16)))).toEqual([]);
  });
});

