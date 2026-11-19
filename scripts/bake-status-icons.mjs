/* global console */
/**
 * Bake public/ui/status-icons.png — horizontal strip of 12×9px cells
 * (11 glyphs + overflow placeholder). Run: node --import tsx scripts/bake-status-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  DIGITS_3X5,
  STATUS_FRAME,
  STATUS_GLYPH_IDS,
  STATUS_GLYPHS,
  STATUS_LIGHT,
  statusFrameFor,
} from '../src/core/status-icons.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../public/ui/status-icons.png');

const CELL = 9;
const GLYPH_COUNT = STATUS_GLYPH_IDS.length; // 11
const CELLS = GLYPH_COUNT + 1; // + overflow placeholder
const WIDTH = CELLS * CELL; // 108
const HEIGHT = CELL; // 9

const INK = {
  '#': STATUS_LIGHT,
  g: '#90c99b',
  b: '#8dbfe3',
  r: '#de7c80',
  y: '#e9bd68',
  m: '#b0bcc8',
};

function parseHex(hex) {
  const h = hex.replace('#', '');
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
    a: 255,
  };
}

function setPixel(png, x, y, rgba) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) return;
  const i = (png.width * y + x) << 2;
  png.data[i] = rgba.r;
  png.data[i + 1] = rgba.g;
  png.data[i + 2] = rgba.b;
  png.data[i + 3] = rgba.a;
}

function fillRect(png, x, y, w, h, hex) {
  const rgba = parseHex(hex);
  for (let row = 0; row < h; row += 1) {
    for (let col = 0; col < w; col += 1) setPixel(png, x + col, y + row, rgba);
  }
}

function blitPattern(png, rows, x, y, colorOf) {
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row];
    for (let col = 0; col < line.length; col += 1) {
      const ch = line[col];
      if (ch === '.') continue;
      const hex = colorOf(ch);
      if (!hex) continue;
      setPixel(png, x + col, y + row, parseHex(hex));
    }
  }
}

function drawGlyphCell(png, id, originX) {
  const { frame, fill } = statusFrameFor(id);
  fillRect(png, originX, 0, CELL, CELL, frame);
  fillRect(png, originX + 1, 1, 7, 7, fill);
  blitPattern(png, STATUS_GLYPHS[id], originX + 1, 1, ch => INK[ch]);
}

function drawOverflowCell(png, originX) {
  const { frame, fill } = STATUS_FRAME.overflow;
  fillRect(png, originX, 0, CELL, CELL, frame);
  fillRect(png, originX + 1, 1, 7, 7, fill);
  // Narrow 7×9 chip centred in the 9×9 cell: offset +1 on x.
  const x = originX + 1;
  fillRect(png, x, 0, 7, 9, frame);
  fillRect(png, x + 1, 1, 5, 7, fill);
  const light = STATUS_LIGHT;
  fillRect(png, x + 3, 1, 1, 1, light);
  fillRect(png, x + 2, 2, 3, 1, light);
  blitPattern(png, DIGITS_3X5['3'], x + 2, 3, ch => (ch === '#' ? light : undefined));
}

const png = new PNG({ width: WIDTH, height: HEIGHT, colorType: 6 });
png.data.fill(0);

for (let i = 0; i < GLYPH_COUNT; i += 1) {
  drawGlyphCell(png, STATUS_GLYPH_IDS[i], i * CELL);
}
drawOverflowCell(png, GLYPH_COUNT * CELL);

await mkdir(dirname(outPath), { recursive: true });
const buffer = PNG.sync.write(png);
await writeFile(outPath, buffer);
console.log(`Wrote ${outPath} (${WIDTH}×${HEIGHT}, ${CELLS} cells)`);
