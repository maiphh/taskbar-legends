/** Combat/catalog role → the three class icons shown in management and recruit. */
export const ROLE_ICON: Readonly<Record<string, 'tank' | 'dps' | 'support'>> = {
  tank: 'tank', dps: 'dps', support: 'support', warrior: 'tank', ranger: 'dps', mage: 'support', heal: 'support', healer: 'support',
};

export type RoleIconKind = 'tank' | 'dps' | 'support';

export function roleIconName(role: string): RoleIconKind {
  return ROLE_ICON[role.toLowerCase()] ?? 'support';
}

/**
 * Crisp 16×16 pixel art (authored in-repo). `.` empty, `#` fill, `o` ink outline.
 * Sword = DPS, shield = Tank, plus = Heal/Support. Integer-pixel aligned at 1× and 2×.
 */
export const ROLE_ICON_PIXELS: Readonly<Record<RoleIconKind, readonly string[]>> = {
  dps: [
    '.......oo.......',
    '......o##o......',
    '......o##o......',
    '......o##o......',
    '......o##o......',
    '......o##o......',
    '......o##o......',
    '....ooo##ooo....',
    '...o########o...',
    '....ooo##ooo....',
    '......o##o......',
    '......o##o......',
    '.......oo.......',
    '.....o####o.....',
    '......o##o......',
    '.......oo.......',
  ],
  tank: [
    '....oooooooo....',
    '...o########o...',
    '..o##########o..',
    '..o##oooooo##o..',
    '..o##o....o##o..',
    '..o##o.#..o##o..',
    '..o##o.##.o##o..',
    '..o##o.#..o##o..',
    '..o##o....o##o..',
    '..o##oooooo##o..',
    '...o########o...',
    '...o########o...',
    '....o######o....',
    '.....o####o.....',
    '......o##o......',
    '.......oo.......',
  ],
  support: [
    '................',
    '......oooo......',
    '.....o####o.....',
    '.....o####o.....',
    '.....o####o.....',
    '...ooo####ooo...',
    '..o##########o..',
    '..o##########o..',
    '..o##########o..',
    '...ooo####ooo...',
    '.....o####o.....',
    '.....o####o.....',
    '.....o####o.....',
    '......oooo......',
    '................',
    '................',
  ],
};

export const ROLE_ICON_FILL: Readonly<Record<RoleIconKind, string>> = {
  tank: '#78bde0',
  dps: '#ee8c75',
  support: '#9ed49b',
};

const ROLE_ICON_INK = '#101820';

/** Draw a role icon at integer (x,y). `scale` is 1 or 2 (detail panels use 2×). */
export function drawRoleIcon(
  ctx: CanvasRenderingContext2D,
  role: string,
  x: number,
  y: number,
  scale = 1,
): void {
  const kind = roleIconName(role);
  const pixels = ROLE_ICON_PIXELS[kind];
  const fill = ROLE_ICON_FILL[kind];
  const left = Math.round(x);
  const top = Math.round(y);
  const s = Math.max(1, Math.round(scale));
  ctx.imageSmoothingEnabled = false;
  for (let row = 0; row < pixels.length; row += 1) {
    const line = pixels[row]!;
    for (let col = 0; col < line.length; col += 1) {
      const ch = line[col]!;
      if (ch === '.') continue;
      ctx.fillStyle = ch === 'o' ? ROLE_ICON_INK : fill;
      ctx.fillRect(left + col * s, top + row * s, s, s);
    }
  }
}
