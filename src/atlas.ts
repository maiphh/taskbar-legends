import { z } from 'zod';
import { CONFIG } from './config';
const rect = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), durationMs: z.number().positive() });
const animation = z.object({ frames: z.array(z.number().int().nonnegative()).nonempty(), durationMs: z.number().positive(), loop: z.boolean(), aliasOf: z.string().optional() });
const atlasSchema = z.object({ image: z.string(), anchor: z.object({ x: z.number(), y: z.number() }), frames: z.array(rect), animations: z.record(z.string(), animation) });
const assetSchema = z.object({ key: z.string(), path: z.string(), outlined: z.string(), atlasPath: z.string() });
const manifestSchema = z.object({ heroes: z.array(assetSchema), enemies: z.array(assetSchema) });
type Atlas = z.infer<typeof atlasSchema>;
export type AnimationName = 'idle' | 'run' | 'attack' | 'hit' | 'death';
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
  durationMs(key: string, name: AnimationName): number | undefined {
    const tag = this.loaded.get(key)?.atlas.animations[name];
    return tag ? tag.frames.length * tag.durationMs : undefined;
  }
  draw(ctx: CanvasRenderingContext2D, key: string, name: AnimationName, ageMs: number, x: number, baseline: number, flip: boolean, zoom = 1, flash = false): boolean {
    const loaded = this.loaded.get(key);
    if (!loaded) return false;
    const { atlas, image } = loaded;
    const tag = atlas.animations[name] ?? atlas.animations.idle;
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
