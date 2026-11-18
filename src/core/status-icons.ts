/** 9×9 status effect icons: 1px frame + 7×7 glyph. `.` empty, `#` light, letters = tinted ink. */

export const STATUS_LIGHT = '#f2e9cf';
export const STATUS_GREEN = '#90c99b';
export const STATUS_BLUE = '#8dbfe3';
export const STATUS_RED = '#de7c80';
export const STATUS_GOLD = '#e9bd68';
export const STATUS_MUTED = '#b0bcc8';

export const STATUS_FRAME = {
  buff: { frame: '#8dbfe3', fill: '#182a38' },
  debuff: { frame: '#de7c80', fill: '#3a1d24' },
  control: { frame: '#e9bd68', fill: '#3a1d24' },
  boss: { frame: '#c19cd9', fill: '#3a1d24' },
  overflow: { frame: '#536276', fill: '#0d121b' },
} as const;

export type StatusFrameKind = keyof typeof STATUS_FRAME;

/** Glyph ids baked into the atlas (order = strip cells 0..10). */
export const STATUS_GLYPH_IDS = [
  'atkUp',
  'dmgReduction',
  'hot',
  'shield',
  'atkDown',
  'defDown',
  'crushed',
  'spdDown',
  'dot',
  'stun',
  'steadfast',
] as const;

export type StatusGlyphId = (typeof STATUS_GLYPH_IDS)[number];

const GLYPH_INK: Readonly<Record<string, string>> = {
  '#': STATUS_LIGHT,
  g: STATUS_GREEN,
  b: STATUS_BLUE,
  r: STATUS_RED,
  y: STATUS_GOLD,
  m: STATUS_MUTED,
};

/**
 * 7×7 patterns. Descriptions match the buff/debuff display spec.
 * atkUp: upward sword, 1px blade, 3px crossguard, up-arrow tip notch
 * dmgReduction: kite shield outline + centre line
 * hot: green plus + light droplet top-right
 * shield: filled blue buckler + light rim
 * atkDown: downward broken sword, 1px gap, down-arrow tip
 * defDown: breastplate outline + diagonal crack
 * crushed: armor-break body + 2px hammer head
 * spdDown: light-blue hourglass
 * dot: red teardrop + light highlight
 * stun: three gold stars in an arc
 * steadfast: planted anchor/boot in muted grey
 */
export const STATUS_GLYPHS: Readonly<Record<StatusGlyphId, readonly string[]>> = {
  atkUp: [
    '...#...',
    '..#.#..',
    '...#...',
    '..###..',
    '...#...',
    '...#...',
    '...#...',
  ],
  dmgReduction: [
    '.#####.',
    '.#...#.',
    '.#.#.#.',
    '.#.#.#.',
    '.#.#.#.',
    '..#.#..',
    '...#...',
  ],
  hot: [
    '.....#.',
    '...g...',
    '...g...',
    '.ggggg.',
    '...g...',
    '...g...',
    '.......',
  ],
  shield: [
    '..bbb..',
    '.b##bb.',
    'bbbbbbb',
    'bbbbbbb',
    '.bbbbb.',
    '..bbb..',
    '.......',
  ],
  atkDown: [
    '...#...',
    '...#...',
    '..###..',
    '...#...',
    '.......',
    '..###..',
    '...#...',
  ],
  defDown: [
    '.#####.',
    '.#...#.',
    '.#..##.',
    '.##..#.',
    '.#.#.#.',
    '.#...#.',
    '.#####.',
  ],
  crushed: [
    '.#####.',
    '..###..',
    '.#...#.',
    '.#..##.',
    '.##..#.',
    '.#...#.',
    '.#####.',
  ],
  spdDown: [
    '.bbbbb.',
    '.b...b.',
    '..b.b..',
    '...b...',
    '..b.b..',
    '.b...b.',
    '.bbbbb.',
  ],
  dot: [
    '...r...',
    '..rrr..',
    '.rr#rr.',
    '.rrrrr.',
    '.rrrrr.',
    '..rrr..',
    '...r...',
  ],
  stun: [
    '.y...y.',
    'y.y.y.y',
    '.......',
    '...y...',
    '..y.y..',
    '...y...',
    '.......',
  ],
  steadfast: [
    '...m...',
    '..mmm..',
    '...m...',
    '.mmmmm.',
    '...m...',
    '..m.m..',
    '.m...m.',
  ],
};

/** 3×5 digit bitmaps (and `+`). */
export const DIGITS_3X5: Readonly<Record<string, readonly string[]>> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['##.', '.#.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '###', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '..#', '..#', '..#'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  '+': ['.#.', '###', '.#.', '...', '...'],
};

export type StatusFrameColors = { frame: string; fill: string };

export function statusFrameFor(id: string): StatusFrameColors {
  if (id === 'stun') return STATUS_FRAME.control;
  if (id === 'crushed') return STATUS_FRAME.boss;
  if (id === 'overflow') return STATUS_FRAME.overflow;
  if (
    id === 'atkDown' ||
    id === 'defDown' ||
    id === 'spdDown' ||
    id === 'dot'
  ) {
    return STATUS_FRAME.debuff;
  }
  return STATUS_FRAME.buff;
}

function paintPattern(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  x: number,
  y: number,
  colorOf: (ch: string) => string | undefined,
): void {
  const left = Math.round(x);
  const top = Math.round(y);
  for (let row = 0; row < rows.length; row += 1) {
    const line = rows[row]!;
    for (let col = 0; col < line.length; col += 1) {
      const ch = line[col]!;
      if (ch === '.') continue;
      const color = colorOf(ch);
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(left + col, top + row, 1, 1);
    }
  }
}

/** Draw a 9×9 status icon at integer (x, y): 1px frame, fill, then 7×7 glyph. */
export function drawStatusGlyph(
  ctx: CanvasRenderingContext2D,
  id: StatusGlyphId,
  x: number,
  y: number,
  colors: StatusFrameColors,
  glyphColor?: string,
): void {
  const left = Math.round(x);
  const top = Math.round(y);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = colors.frame;
  ctx.fillRect(left, top, 9, 9);
  ctx.fillStyle = colors.fill;
  ctx.fillRect(left + 1, top + 1, 7, 7);
  const glyph = STATUS_GLYPHS[id];
  paintPattern(ctx, glyph, left + 1, top + 1, ch => (glyphColor ? glyphColor : GLYPH_INK[ch]));
}

/** Draw a 3×5 digit (0-9 or `+`) in `color` at integer (x, y). */
export function drawDigit3x5(
  ctx: CanvasRenderingContext2D,
  digit: string | number,
  x: number,
  y: number,
  color: string,
): void {
  const key = String(digit);
  const rows = DIGITS_3X5[key];
  if (!rows) return;
  ctx.imageSmoothingEnabled = false;
  paintPattern(ctx, rows, x, y, ch => (ch === '#' ? color : undefined));
}

/**
 * 7×9 overflow +N chip. Frame/fill from overflow tokens; compact `+` above a 3×5 digit
 * (n clamped to 0..9 for the single glyph slot).
 */
export function drawOverflowChip(
  ctx: CanvasRenderingContext2D,
  n: number,
  x: number,
  y: number,
): void {
  const left = Math.round(x);
  const top = Math.round(y);
  const { frame, fill } = STATUS_FRAME.overflow;
  const shown = Math.max(0, Math.min(9, Math.floor(n)));
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = frame;
  ctx.fillRect(left, top, 7, 9);
  ctx.fillStyle = fill;
  ctx.fillRect(left + 1, top + 1, 5, 7);
  // Compact plus (top stem + bar) then 3×5 digit; fits the 5×7 inner without overlap.
  ctx.fillStyle = STATUS_LIGHT;
  ctx.fillRect(left + 3, top + 1, 1, 1);
  ctx.fillRect(left + 2, top + 2, 3, 1);
  drawDigit3x5(ctx, shown, left + 2, top + 3, STATUS_LIGHT);
}

export type StatusDisplaySortable = {
  id: string;
  turnsLeft: number;
  appliedAtTick: number;
};

/** Display sort: stun → bleed → other debuffs → shield → other buffs; then lowest turnsLeft, then oldest appliedAtTick. */
export function compareStatusDisplay(a: StatusDisplaySortable, b: StatusDisplaySortable): number {
  const rank = (id: string): number => {
    if (id === 'stun') return 0;
    if (id === 'dot') return 1;
    if (id === 'defDown' || id === 'spdDown' || id === 'atkDown' || id === 'crushed') return 2;
    if (id === 'shield') return 3;
    return 4;
  };
  const byRank = rank(a.id) - rank(b.id);
  if (byRank !== 0) return byRank;
  const byTurns = a.turnsLeft - b.turnsLeft;
  if (byTurns !== 0) return byTurns;
  return a.appliedAtTick - b.appliedAtTick;
}
