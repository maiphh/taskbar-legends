import { z } from 'zod';
import { CONFIG } from './config';
const rect = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), durationMs: z.number().positive() });
const animation = z.object({ frames: z.array(z.number().int().nonnegative()).nonempty(), durationMs: z.number().positive(), loop: z.boolean(), aliasOf: z.string().optional() });
const atlasSchema = z.object({ image: z.string(), anchor: z.object({ x: z.number(), y: z.number() }), frames: z.array(rect), animations: z.record(z.string(), animation) });
const assetSchema = z.object({ key: z.string(), path: z.string(), outlined: z.string(), atlasPath: z.string() });
const manifestSchema = z.object({ heroes: z.array(assetSchema), enemies: z.array(assetSchema) });
type Atlas = z.infer<typeof atlasSchema>;
export type AnimationName = 'idle' | 'run' | 'attack' | 'cast' | 'hit' | 'death';
interface LoadedAtlas { atlas: Atlas; image: HTMLImageElement; white: HTMLCanvasElement }
async function json(url: URL): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname}: ${response.status}`);
  return response.json();
}
export class AtlasLibrary {
  private readonly loaded = new Map<string, LoadedAtlas>();
  readonly errors: string[] = [];
  readonly ready: Promise<void>;
  constructor() { this.ready = this.load(); }
  private animation(key: string, name: AnimationName) {
    const animations = this.loaded.get(key)?.atlas.animations;
    if (!animations) return undefined;
    if (name === 'cast') return animations.attack2 ?? animations.attack ?? animations.idle;
    return animations[name];
  }
  private async load(): Promise<void> {
    const root = new URL(`${import.meta.env.BASE_URL}assets/`, window.location.href);
    try {
      const manifest = manifestSchema.parse(await json(new URL('manifest.json', root)));
      await Promise.all([...manifest.heroes, ...manifest.enemies].map(async asset => {
        try {
          const atlas = atlasSchema.parse(await json(new URL(asset.atlasPath, root)));
          const image = new Image();
          image.src = new URL(asset.outlined, root).href;
          await image.decode();
          const white = document.createElement('canvas'); white.width = image.naturalWidth; white.height = image.naturalHeight;
          const tint = white.getContext('2d'); if (!tint) throw new Error('Cannot cache hit flash');
          tint.imageSmoothingEnabled = false; tint.drawImage(image, 0, 0);
          tint.globalCompositeOperation = 'source-atop'; tint.fillStyle = CONFIG.view.hitFlashColor; tint.fillRect(0, 0, white.width, white.height);
          tint.globalCompositeOperation = 'source-over';
          this.loaded.set(asset.key, { atlas, image, white });
        } catch (error) { this.errors.push(`${asset.key}: ${String(error)}`); }
      }));
    } catch (error) { this.errors.push(`manifest: ${String(error)}`); }
  }
  /**
   * Menu portrait (ui/compact-menu.md §3): outlined sheet, idle frame 0, cropped to the opaque ink bbox (alpha ≥ 128) with a
   * 1 px pad. Native 1×; callers scale by whole numbers only (CSS pixelated). Null until the atlas has loaded.
   */
  portrait(key: string): HTMLCanvasElement | null {
    const loaded = this.loaded.get(key), index = loaded?.atlas.animations.idle?.frames[0], frame = index === undefined ? undefined : loaded?.atlas.frames[index];
    if (!loaded || !frame) return null;
    const source = document.createElement('canvas'); source.width = frame.w; source.height = frame.h;
    const sctx = source.getContext('2d'); if (!sctx) return null;
    sctx.drawImage(loaded.image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
    const data = sctx.getImageData(0, 0, frame.w, frame.h).data;
    let left = frame.w, top = frame.h, right = -1, bottom = -1;
    for (let y = 0; y < frame.h; y += 1) for (let x = 0; x < frame.w; x += 1) if ((data[(y * frame.w + x) * 4 + 3] ?? 0) >= 128) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    if (right < 0) return null;
    const out = document.createElement('canvas'); out.width = right - left + 3; out.height = bottom - top + 3;
    const octx = out.getContext('2d'); if (!octx) return null;
    octx.imageSmoothingEnabled = false; octx.drawImage(source, left, top, right - left + 1, bottom - top + 1, 1, 1, right - left + 1, bottom - top + 1);
    // Threshold to the ink: alpha < 128 → 0, else 255 (no soft edges in a pixel UI).
    const image = octx.getImageData(0, 0, out.width, out.height);
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = (image.data[i] ?? 0) >= 128 ? 255 : 0;
    octx.putImageData(image, 0, 0);
    return out;
  }
  durationMs(key: string, name: AnimationName): number | undefined {
    const tag = this.animation(key, name);
    return tag ? tag.frames.length * tag.durationMs : undefined;
  }
  draw(ctx: CanvasRenderingContext2D, key: string, name: AnimationName, ageMs: number, x: number, baseline: number, flip: boolean, zoom = 1, flash = false): boolean {
    const loaded = this.loaded.get(key);
    if (!loaded) return false;
    const { atlas, image } = loaded;
    const tag = this.animation(key, name) ?? atlas.animations.idle;
    if (!tag) return false;
    const framePosition = Math.floor(Math.max(0, ageMs) / tag.durationMs);
    const index = tag.frames[tag.loop ? framePosition % tag.frames.length : Math.min(framePosition, tag.frames.length - 1)];
    const frame = index === undefined ? undefined : atlas.frames[index];
    if (!frame) return false;
    ctx.save(); ctx.translate(Math.round(x), Math.round(baseline));
    ctx.scale(flip ? -zoom : zoom, zoom);
    // Atlas has already been scaled to its documented 44..52px body. Never scale the image again.
    ctx.drawImage(flash ? loaded.white : image, frame.x, frame.y, frame.w, frame.h, -atlas.anchor.x, -atlas.anchor.y, frame.w, frame.h);
    ctx.restore();
    return true;
  }
}
