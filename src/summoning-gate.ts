import { CONFIG } from './config';
import type { Rarity } from './config';
import type { RevealPhase } from './reveal-timeline';

/** Stepped four-point glint. Every band is an integer number of source pixels. */
export function spark(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  ctx.fillStyle = color;
  for (let dy = -radius; dy <= radius; dy += 2) {
    const half = Math.max(1, Math.floor((radius - Math.abs(dy)) ** 3 / (radius * radius)));
    ctx.fillRect(x - half, y + dy, half * 2, 2);
  }
}

const runes = [
  ['111', '010', '010', '010'], ['100', '110', '101', '100'],
  ['010', '101', '010', '010'], ['101', '101', '111', '010'],
];

/** Draw at the astrolabe's centre in two-pixel increments, including the two sliding door leaves. */
export function drawGate(ctx: CanvasRenderingContext2D, phase: RevealPhase, rarity: Rarity | null, amount: number, ms: number): void {
  const tier = rarity ? CONFIG.ui.rarity[rarity] : null;
  const light = tier?.frame ?? '#efe2c8', shadow = tier?.floor ?? '#796b63';
  const charge = phase === 'charge', open = phase === 'open';
  const step = Math.floor(ms / CONFIG.ui.gacha.frameStepMs);
  const radius = 76, split = open ? 2 * Math.floor(amount * 36) : 0;
  ctx.save();
  ctx.translate(448, 186);
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * split, 0);
    // Stepped stone voussoirs, recessed panels and the central seam of the closed gate.
    for (let y = -radius; y < radius; y += 2) {
      const half = Math.min(radius, radius * 2 - Math.abs(y) - 44);
      const band = (inset: number, color: string) => {
        if (Math.abs(y) >= radius - inset) return;
        const w = half - inset;
        ctx.fillStyle = color;
        ctx.fillRect(side < 0 ? -w : 0, y, w, 2);
      };
      band(0, '#242031'); band(2, shadow); band(6, '#403849'); band(10, light);
      band(12, '#211e30'); band(18, '#353044'); band(22, '#2b273a');
    }
    ctx.fillStyle = shadow;
    ctx.fillRect(side < 0 ? -4 : 2, -62, 2, 124);
    for (const y of [-36, 36]) {
      ctx.fillStyle = '#494050'; ctx.fillRect(side < 0 ? -54 : 6, y, 48, 4);
      ctx.fillStyle = '#867169'; ctx.fillRect(side * 44, y, 4, 2);
    }
    ctx.restore();
  }

  const lit = charge ? Math.floor(amount * 12) + 1 : 12;
  for (let i = 0; i < 12; i++) {
    const angle = i * Math.PI / 6 - Math.PI / 2;
    const x = 2 * Math.round(46 * Math.cos(angle)), y = 2 * Math.round(46 * Math.sin(angle));
    const rune = runes[i % runes.length]!;
    ctx.fillStyle = '#282335'; ctx.fillRect(x - 6, y - 7, 12, 14);
    ctx.fillStyle = i < lit ? light : '#665761';
    rune.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) if (row[dx] === '1') ctx.fillRect(x - 3 + dx * 2, y - 4 + dy * 2, 2, 2);
    });
  }

  if (charge) {
    spark(ctx, 0, 0, 4 + 2 * Math.floor(amount * 6), light);
  } else if (tier) {
    const strength = open ? 1 - amount : 0.72 + 0.28 * Math.min(1, amount * 5);
    const size = 2 * Math.ceil((rarity === 'common' ? 12 : 23) * strength);
    // The slit shines through the doors. Dark bands give the beam a hard, luminous edge.
    ctx.fillStyle = shadow; ctx.fillRect(-6, -72, 12, 144);
    ctx.fillStyle = light; ctx.fillRect(-2, -68, 4, 136);
    spark(ctx, 0, 0, size + 12, shadow);
    spark(ctx, 0, 0, size, light);
    spark(ctx, 0, 0, Math.max(2, Math.floor(size / 2)), rarity === 'common' ? light : '#fff0d0');
    for (let i = 0; i < tier.particles.count; i++) {
      const angle = i * 2.4, distance = 28 + (i * 17 + step * 2) % 82;
      const x = 2 * Math.round(Math.cos(angle) * distance * 0.72);
      const y = 2 * Math.round(Math.sin(angle) * distance / 2);
      spark(ctx, x, y, i % 4 === 0 ? 5 : 2, i % 3 === 0 ? shadow : light);
    }
  }
  ctx.restore();
}
