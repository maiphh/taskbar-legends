import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { BODY, BOLD_SAFE, FONT_FILES, HEADING, SMALL, fontFor, slotOffsetY } from '../src/font';

/** Minimal TrueType cmap reader (formats 4 and 12) — enough to ask "does this face have a glyph for U+xxxx?". */
function cmap(path: string): Set<number> {
  const view = new DataView(readFileSync(path).buffer.slice(0));
  const tables = view.getUint16(4);
  let base = -1;
  for (let i = 0; i < tables; i += 1) {
    const record = 12 + i * 16;
    if (String.fromCharCode(...[0, 1, 2, 3].map(k => view.getUint8(record + k))) === 'cmap') base = view.getUint32(record + 8);
  }
  if (base < 0) throw new Error(`${path}: no cmap`);
  const codes = new Set<number>();
  for (let i = 0; i < view.getUint16(base + 2); i += 1) {
    const sub = base + view.getUint32(base + 4 + i * 8 + 4), format = view.getUint16(sub);
    if (format === 4) {
      const segments = view.getUint16(sub + 6) / 2, ends = sub + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, offsets = deltas + segments * 2;
      for (let s = 0; s < segments; s += 1) {
        const end = view.getUint16(ends + s * 2), start = view.getUint16(starts + s * 2), delta = view.getInt16(deltas + s * 2), offset = view.getUint16(offsets + s * 2);
        for (let code = start; code <= end && code !== 0xffff; code += 1) {
          const glyph = offset === 0 ? (code + delta) & 0xffff : view.getUint16(offsets + s * 2 + offset + (code - start) * 2);
          if (glyph !== 0) codes.add(code);
        }
      }
    } else if (format === 12) {
      for (let g = 0; g < view.getUint32(sub + 12); g += 1) {
        const group = sub + 16 + g * 12;
        for (let code = view.getUint32(group); code <= view.getUint32(group + 4); code += 1) codes.add(code);
      }
    }
  }
  return codes;
}

const fonts = Object.fromEntries(FONT_FILES.map(([name, file]) => [name, cmap(join('public/fonts', file))]));
const missing = (face: string, text: string): string[] => [...new Set(text)].filter(ch => !/\s/u.test(ch) || ch === ' ').filter(ch => !fonts[face]?.has(ch.codePointAt(0) ?? 0)).map(ch => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')} ${ch}`);

/** Every string literal the UI can draw comes from src/ (labels, templates) or config/token data (hero/stage/gear names). */
const sourceFiles = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : /\.(ts|json)$/.test(entry.name) ? [join(dir, entry.name)] : []);
const literals = sourceFiles('src').flatMap(file => [...readFileSync(file, 'utf8').matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)].map(match => match[1] ?? match[2] ?? match[3] ?? '')).join('');
const printableAscii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const VIETNAMESE = 'Tiếng Việt: Anh hùng đã hạ gục trùm! Vàng, vé, trang bị — Ắ Ằ Ẳ Ẵ Ặ ơ ư Ơ Ư đ Đ ỹ Ỹ ỵ Ỵ ữ ự ậ ẩ';
const CYRILLIC = 'Русский: Герои победили босса! Золото, билеты, снаряжение. Ёё Йй Щщ Ъъ Ыы Ээ Юю Яя; Українська: Ґґ Єє Іі Її';

describe('Galmuri glyph coverage', () => {
  it('Regular covers every character in rendered UI strings', () => {
    expect(missing('Galmuri11', printableAscii + literals.replace(/[^\u0020-\uffff]/gu, ''))).toEqual([]);
  });
  it('Regular and Galmuri9 cover Vietnamese and Cyrillic samples', () => {
    for (const face of ['Galmuri11', 'Galmuri9']) expect(missing(face, VIETNAMESE + CYRILLIC + printableAscii), face).toEqual([]);
  });
  it('Bold is only chosen for strings it can draw', () => {
    const bold = fonts.Galmuri11Bold ?? new Set<number>();
    const unsafe = Array.from({ length: 0x3000 - 0x20 }, (_, i) => i + 0x20).filter(code => BOLD_SAFE.test(String.fromCodePoint(code)) && !bold.has(code));
    expect(unsafe.map(code => code.toString(16))).toEqual([]);
    expect(missing('Galmuri11Bold', VIETNAMESE).length).toBeGreaterThan(0); // why the fallback exists
    expect(missing('Galmuri11Bold', CYRILLIC).length).toBeGreaterThan(0);
  });
  it('Vietnamese and Cyrillic bold text falls back to Regular, Latin stays Bold', () => {
    expect(fontFor('PARTY CAMP', HEADING, true)).toBe('Galmuri11Bold');
    expect(fontFor('Trại đội', HEADING, true)).toBe('Galmuri11');
    expect(fontFor('Лагерь', BODY, true)).toBe('Galmuri11');
    expect(fontFor('Farming 1-7 ★', BODY, false)).toBe('Galmuri11');
    expect(fontFor('Hero Knight 2', SMALL, false)).toBe('Galmuri9');
  });
  it('uses only native grid sizes and the designer slot offsets', () => {
    expect([BODY, HEADING, SMALL]).toEqual([12, 24, 10]);
    expect(CONFIG.ui.font.licence).toBe('OFL-1.1');
    expect([slotOffsetY(BODY, false), slotOffsetY(BODY, true), slotOffsetY(HEADING, true), slotOffsetY(SMALL, false)]).toEqual([2, 2, -1, 0]);
  });
});
