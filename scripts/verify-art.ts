import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { PNG } from 'pngjs';
import { CONFIG } from '../src/config';
const bounds = z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable();
const assetSchema = z.object({ key: z.string(), outlined: z.string(), atlasPath: z.string() });
const manifestSchema = z.object({ heroes: z.array(assetSchema), enemies: z.array(assetSchema) });
const atlasSchema = z.object({ meta: z.object({ bakedHitFlash: z.literal(false) }), anchor: z.object({ x: z.number(), y: z.number() }), frames: z.array(z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), outlinedContentBounds: bounds })) });
export function verifyArt(root = resolve('public')) {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(resolve(root, 'assets/manifest.json'), 'utf8')));
  let frames = 0, maxAbove = 0, maxBelow = 0;
  for (const asset of [...manifest.heroes, ...manifest.enemies]) {
    const image = PNG.sync.read(readFileSync(resolve(root, 'assets', asset.outlined)));
    const atlas = atlasSchema.parse(JSON.parse(readFileSync(resolve(root, 'assets', asset.atlasPath), 'utf8')));
    for (const frame of atlas.frames) {
      frames += 1; let left = frame.w, top = frame.h, right = 0, bottom = 0;
      for (let y = 0; y < frame.h; y += 1) for (let x = 0; x < frame.w; x += 1) {
        const alpha = image.data[((frame.y + y) * image.width + frame.x + x) * 4 + 3] ?? 0;
        if (!alpha) continue;
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x + 1); bottom = Math.max(bottom, y + 1);
      }
      const actual = right > left ? [left, top, right, bottom] : null;
      if (JSON.stringify(actual) !== JSON.stringify(frame.outlinedContentBounds)) throw new Error(`${asset.key}: outlined bounds do not match real PNG pixels`);
      if (actual) {
        const above = atlas.anchor.y - top, below = bottom - atlas.anchor.y;
        maxAbove = Math.max(maxAbove, above); maxBelow = Math.max(maxBelow, below);
        if (above > CONFIG.ui.spriteInkEnvelope.aboveBaselineMax || below > CONFIG.ui.spriteInkEnvelope.belowBaselineMax) throw new Error(`${asset.key}: future art exceeds fixed 160px envelope`);
      }
    }
  }
  const forbidden: string[] = [];
  function walk(path: string): void { for (const entry of readdirSync(path, { withFileTypes: true })) { const full = resolve(path, entry.name); if (entry.isDirectory()) { if (['ref', 'vendor', 'mockups', 'raw'].includes(entry.name)) forbidden.push(full); walk(full); } else if (/\.(zip|jpg|html)$/.test(entry.name) || /^(mockup|preview|contact-sheet)/i.test(entry.name)) forbidden.push(full); } }
  walk(root); if (forbidden.length) throw new Error(`Research/vendor material shipped: ${forbidden.join(', ')}`);
  return { characters: manifest.heroes.length + manifest.enemies.length, heroes: manifest.heroes.length, enemies: manifest.enemies.length, frames,
    maxAbove, maxBelow, baseline: CONFIG.ui.closed.baselineY, minY: CONFIG.ui.closed.baselineY - maxAbove,
    maxYExclusive: CONFIG.ui.closed.baselineY + maxBelow, forbiddenRuntimeFiles: forbidden };
}
