import { z } from 'zod';
import { CONFIG } from './config';
import { idleFrameAt } from './management/animation';
const rect = z.object({ outlinedContentBounds: z.tuple([z.number(), z.number(), z.number(), z.number()]), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive(), durationMs: z.number().positive() });
const animation = z.object({ frames: z.array(z.number().int().nonnegative()).nonempty(), durationMs: z.number().positive(), loop: z.boolean(), aliasOf: z.string().optional() });
const atlasSchema = z.object({ image: z.string(), anchor: z.object({ x: z.number(), y: z.number() }), frames: z.array(rect), animations: z.record(z.string(), animation) });
const assetSchema = z.object({ key: z.string(), path: z.string(), outlined: z.string(), atlasPath: z.string() });
const manifestSchema = z.object({ heroes: z.array(assetSchema), enemies: z.array(assetSchema) });
type Atlas = z.infer<typeof atlasSchema>;
export type AnimationName = 'idle' | 'run' | 'attack' | 'cast' | 'hit' | 'death';
interface LoadedAtlas { atlas: Atlas; image: HTMLImageElement; white: HTMLCanvasElement; inkTop: number; inkBottom: number }
async function json(url: URL): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url.pathname}: ${response.status}`);
  return response.json();
}
export class AtlasLibrary {
  private readonly variants = new Map<string, HTMLCanvasElement>();
  private readonly loaded = new Map<string, LoadedAtlas>();
  private readonly portraitCache = new Map<string, Map<number, HTMLCanvasElement | null>>();
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
          const frames = atlas.frames;
          this.loaded.set(asset.key, { atlas, image, white,
            inkTop: Math.min(...frames.map(f => f.outlinedContentBounds[1])),
            inkBottom: Math.max(...frames.map(f => f.outlinedContentBounds[3])),
          });
        } catch (error) { this.errors.push(`${asset.key}: ${String(error)}`); }
      }));
    } catch (error) { this.errors.push(`manifest: ${String(error)}`); }
  }
  /**
   * Menu portrait (ui/compact-menu.md §3): outlined sheet, idle frame 0, cropped to the opaque ink bbox (alpha ≥ 128) with a
   * 1 px pad. Native 1×; callers scale by whole numbers only (CSS pixelated). Null until the atlas has loaded.
   */
  portrait(key: string): HTMLCanvasElement | null {
    const loaded = this.loaded.get(key), index = loaded?.atlas.animations.idle?.frames[0];
    return index === undefined ? null : this.portraitFrame(key, index);
  }
  private idlePortraits(key: string): Map<number, HTMLCanvasElement | null> {
    const cached = this.portraitCache.get(key); if (cached) return cached;
    const loaded = this.loaded.get(key), idle = loaded?.atlas.animations.idle;
    const result = new Map<number, HTMLCanvasElement | null>();
    if (!loaded || !idle?.frames.length) { this.portraitCache.set(key, result); return result; }
    const boxes = idle.frames.map(index => {
      const frame = loaded.atlas.frames[index]; if (!frame) return null;
      const ctx = document.createElement('canvas').getContext('2d'); if (!ctx) return null;
      ctx.canvas.width = frame.w; ctx.canvas.height = frame.h;
      ctx.drawImage(loaded.image, frame.x, frame.y, frame.w, frame.h, 0, 0, frame.w, frame.h);
      const data = ctx.getImageData(0, 0, frame.w, frame.h).data; let left = frame.w, top = frame.h, right = -1, bottom = -1;
      for (let y = 0; y < frame.h; y += 1) for (let x = 0; x < frame.w; x += 1) if ((data[(y * frame.w + x) * 4 + 3] ?? 0) >= 128) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
      return right < 0 ? null : { index, frame, left, top, right, bottom };
    }).filter((box): box is NonNullable<typeof box> => box !== null);
    if (!boxes.length) { this.portraitCache.set(key, result); return result; }
    const minX = Math.min(...boxes.map(box => box.left - loaded.atlas.anchor.x)), maxX = Math.max(...boxes.map(box => box.right - loaded.atlas.anchor.x));
    const minY = Math.min(...boxes.map(box => box.top - loaded.atlas.anchor.y)), maxY = Math.max(...boxes.map(box => box.bottom - loaded.atlas.anchor.y));
    for (const box of boxes) {
      const out = document.createElement('canvas'); out.width = maxX - minX + 3; out.height = maxY - minY + 3;
      const ctx = out.getContext('2d'); if (!ctx) { result.set(box.index, null); continue; }
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(loaded.image, box.frame.x + box.left, box.frame.y + box.top, box.right - box.left + 1, box.bottom - box.top + 1,
        box.left - loaded.atlas.anchor.x - minX + 1, box.top - loaded.atlas.anchor.y - minY + 1, box.right - box.left + 1, box.bottom - box.top + 1);
      const image = ctx.getImageData(0, 0, out.width, out.height);
      for (let i = 3; i < image.data.length; i += 4) image.data[i] = (image.data[i] ?? 0) >= 128 ? 255 : 0;
      ctx.putImageData(image, 0, 0); result.set(box.index, out);
    }
    this.portraitCache.set(key, result); return result;
  }
  idleFrameCount(key: string): number { return this.loaded.get(key)?.atlas.animations.idle?.frames.length ?? 0; }
  idleFrameDuration(key: string): number { return Math.max(125, this.loaded.get(key)?.atlas.animations.idle?.durationMs ?? 125); }
  idleFrameIndex(key: string, elapsedMs: number): number {
    const idle = this.loaded.get(key)?.atlas.animations.idle;
    if (!idle?.frames.length) return 0;
    return idle.frames[idleFrameAt(elapsedMs, idle.durationMs, idle.frames.length)] ?? idle.frames[0] ?? 0;
  }
  portraitFrame(key: string, index: number): HTMLCanvasElement | null {
    const loaded = this.loaded.get(key), idle = loaded?.atlas.animations.idle;
    if (idle?.frames.includes(index)) return this.idlePortraits(key).get(index) ?? null;
    const frame = loaded?.atlas.frames[index];
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
  draw(ctx: CanvasRenderingContext2D, key: string, name: AnimationName, ageMs: number, x: number, baseline: number, flip: boolean, zoom = 1, flash = false, tint?: string, outline?: string, lane?: { top: number; bottom: number }): boolean {
    const loaded = this.loaded.get(key);
    if (!loaded) return false;
    const { atlas, image } = loaded;
    const tag = this.animation(key, name) ?? atlas.animations.idle;
    if (!tag) return false;
    const framePosition = Math.floor(Math.max(0, ageMs) / tag.durationMs);
    const index = tag.frames[tag.loop ? framePosition % tag.frames.length : Math.min(framePosition, tag.frames.length - 1)];
    const frame = index === undefined ? undefined : atlas.frames[index];
    if (!frame) return false;
    const source = flash ? loaded.white : image;
    const pad = outline ? 1 : 0;
    // Bosses use a single scale and foot anchor across their entire animation set.
    // A particularly tall atlas gets a nearest-neighbor compact raster before screen zoom.
    let scale = zoom;
    if (lane) {
      const top = (outline ? loaded.inkTop : frame.outlinedContentBounds[1]) - atlas.anchor.y - pad;
      const bottom = (outline ? loaded.inkBottom : frame.outlinedContentBounds[3]) - atlas.anchor.y + pad;
      const fit = (lane.bottom - lane.top) / Math.max(1, bottom - top);
      scale = Math.min(scale, fit >= 1 ? Math.floor(fit) : fit);
      baseline = Math.min(lane.bottom - Math.round(bottom * scale), Math.max(baseline, lane.top - Math.round(top * scale)));
    }
    ctx.save(); ctx.translate(Math.round(x), Math.round(baseline));
    ctx.scale(flip ? -1 : 1, 1);
    const left = -Math.round((atlas.anchor.x + pad) * scale), top = -Math.round((atlas.anchor.y + pad) * scale);
    if (!tint && !outline && scale >= 1) {
      ctx.drawImage(source, frame.x, frame.y, frame.w, frame.h, left, top, frame.w * scale, frame.h * scale);
    } else {
      const variantKey = `${key}|${index}|${tint}|${outline}|${flash}|${scale}`;
      let variant = this.variants.get(variantKey);
      if (!variant) {
        variant = this.variant(source, frame, pad, scale, tint, outline);
        if (this.variants.size >= 128) this.variants.delete(this.variants.keys().next().value!);
        this.variants.set(variantKey, variant);
      }
      ctx.drawImage(variant, left, top);
    }
    ctx.restore();
    return true;
  }
  private variant(source: CanvasImageSource, frame: Atlas['frames'][number], pad: number, scale: number, tint?: string, outline?: string): HTMLCanvasElement {
    const buffer = document.createElement('canvas');
    buffer.width = frame.w + pad * 2;
    buffer.height = frame.h + pad * 2;
    const bctx = buffer.getContext('2d')!;
    bctx.drawImage(source, frame.x, frame.y, frame.w, frame.h, pad, pad, frame.w, frame.h);
    if (tint) {
      bctx.globalCompositeOperation = 'source-atop';
      bctx.fillStyle = tint;
      bctx.globalAlpha = 0.45;
      bctx.fillRect(0, 0, buffer.width, buffer.height);
      bctx.globalAlpha = 1;
      bctx.globalCompositeOperation = 'source-over';
    }
    if (outline) {
      const tinted = bctx.getImageData(0, 0, buffer.width, buffer.height);
      const out = bctx.createImageData(buffer.width, buffer.height);
      const parse = /^#?([0-9a-f]{6})$/i.exec(outline.trim());
      const cr = parse ? Number.parseInt(parse[1]!.slice(0, 2), 16) : 0;
      const cg = parse ? Number.parseInt(parse[1]!.slice(2, 4), 16) : 0;
      const cb = parse ? Number.parseInt(parse[1]!.slice(4, 6), 16) : 0;
      const w = buffer.width, h = buffer.height, src = tinted.data, dst = out.data;
      const alphaAt = (px: number, py: number): number => {
        if (px < 0 || py < 0 || px >= w || py >= h) return 0;
        return src[(py * w + px) * 4 + 3] ?? 0;
      };
      for (let py = 0; py < h; py += 1) for (let px = 0; px < w; px += 1) {
        const i = (py * w + px) * 4;
        const a = src[i + 3] ?? 0;
        if (a >= 128) {
          dst[i] = src[i]!; dst[i + 1] = src[i + 1]!; dst[i + 2] = src[i + 2]!; dst[i + 3] = a;
          continue;
        }
        if (alphaAt(px - 1, py) < 128 && alphaAt(px + 1, py) < 128 && alphaAt(px, py - 1) < 128 && alphaAt(px, py + 1) < 128) continue;
        dst[i] = cr; dst[i + 1] = cg; dst[i + 2] = cb; dst[i + 3] = 255;
      }
      bctx.putImageData(out, 0, 0);
    }
    if (scale === 1) return buffer;
    const compact = document.createElement('canvas');
    compact.width = Math.round(buffer.width * scale); compact.height = Math.round(buffer.height * scale);
    const ctx = compact.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buffer, 0, 0, compact.width, compact.height);
    return compact;
  }
}
