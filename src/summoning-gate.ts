import { CONFIG } from './config';
import type { Rarity } from './config';

/** Stepped four-point glint. Every band is an integer number of source pixels. */
export function spark(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  ctx.fillStyle = color;
  for (let dy = -radius; dy <= radius; dy += 2) {
    const half = Math.max(1, Math.floor((radius - Math.abs(dy)) ** 3 / (radius * radius)));
    ctx.fillRect(x - half, y + dy, half * 2, 2);
  }
}

/** Two counter-rotating rings gather around the brass astrolabe and collapse into the hero. */
export function drawGate(ctx: CanvasRenderingContext2D, x: number, y: number, rarity: Rarity, ms: number, progress: number): void {
  const tier = CONFIG.ui.rarity[rarity], rank = CONFIG.ui.rarity.order.indexOf(rarity) + 1;
  const step = Math.floor(ms / CONFIG.ui.gacha.frameStepMs);
  const radius = 30 + 2 * Math.floor(progress * 17);
  // Build the dark aperture in two-pixel scan lines with a stepped inner rim.
  for (let dy = -radius; dy < radius; dy += 2) {
    const half = 2 * Math.floor(Math.sqrt(radius * radius - dy * dy) / 2);
    ctx.fillStyle = tier.frame; ctx.fillRect(x - half, y + dy, half * 2, 2);
    ctx.fillStyle = '#211e32'; ctx.fillRect(x - half + 4, y + dy, Math.max(0, half * 2 - 8), 2);
  }
  for (let ring = 0; ring < 2; ring++) {
    const count = ring ? 8 : 4 * rank, orbit = ring ? radius - 12 : 92;
    for (let i = 0; i < count; i++) {
      const angle = 2 * Math.PI * i / count + step * (ring ? -0.07 : 0.045);
      const px = x + 2 * Math.round(Math.cos(angle) * orbit / 2);
      const py = y + 2 * Math.round(Math.sin(angle) * orbit / 2);
      spark(ctx, px, py, ring ? 3 : 5, ring ? tier.frame : tier.label);
    }
  }
  spark(ctx, x, y, 12 + 2 * Math.floor(progress * 8), tier.frame);
  spark(ctx, x, y, 6 + 2 * Math.floor(progress * 4), '#fff0c4');
}
