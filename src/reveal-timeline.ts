import { CONFIG } from './config';
import type { Rarity } from './config';

/**
 * Pure timing for the M3 gacha reveal (ui/gacha.md §4, §8) and the welcome-back count-up (ui/offline-rewards.md).
 * Everything is on the 40 ms frame clock and whole pixels; the renderer only maps a frame to pixels.
 */
const gacha = CONFIG.ui.gacha, STEP = gacha.frameStepMs;
const frames = (ms: number): number => Math.floor(ms / STEP);
type Span = readonly [number, number];
const tiers: Record<Rarity, { totalMs: number; silhouette: boolean; timelineMs: Partial<Record<string, readonly number[]>> }> = gacha.tiers;
const span = (tier: Rarity, beat: string): Span | undefined => { const value = tiers[tier].timelineMs[beat]; return value ? [value[0] ?? 0, value[1] ?? 0] : undefined; };

export type CardFace = 'back' | 'silhouette' | 'front';
export interface SingleFrame {
  /** Card back drop offset (px, negative = above rest). */ dropY: number;
  /** Card width in whole px, centred (flip). */ cardWidth: number;
  face: CardFace;
  /** 0..255 rim alpha (anticipation ramp; full from burst; legendary flash colour on its 2 flash frames). */ rimAlpha: number;
  flash: boolean;
  shakeX: number;
  motes: boolean;
  /** ms since burst start, or null before it (drives particles, the shape cue and the rare twinkle). */ burstAge: number | null;
  showName: boolean; showRarity: boolean; done: boolean;
}
export function tierTotalMs(tier: Rarity): number { return tiers[tier].totalMs; }
export function burstStartMs(tier: Rarity): number { return span(tier, 'burst')?.[0] ?? 0; }
/** Single reveal frame at `ms` from the click. A skip is `ms = Infinity`. */
export function singleFrame(tier: Rarity, ms: number, reducedMotion = false): SingleFrame {
  const total = tierTotalMs(tier), done = ms >= total;
  const t = Math.min(ms, total), card = gacha.single.cardRect[2] ?? 96;
  const pull = span(tier, 'pull') ?? [0, 120], anticipation = span(tier, 'anticipation') ?? [120, 360], flip = span(tier, 'flip') ?? [360, 520];
  const burst = span(tier, 'burst') ?? [520, 640], labels = span(tier, 'labels') ?? [640, total];
  const rimMax = CONFIG.ui.rarity[tier].rimAlphaMax;
  const dropOffsets = [-8, -4, 0];
  const dropY = reducedMotion || t >= pull[1] ? 0 : dropOffsets[Math.min(frames(t - pull[0]), dropOffsets.length - 1)] ?? 0;
  // Anticipation: monotonic 40 ms ramp 0 → rimAlphaMax; stays at max through flip/silhouette, full after.
  const rampSteps = Math.max(1, frames(anticipation[1] - anticipation[0]));
  const rimAlpha = t < anticipation[0] ? 0 : t < anticipation[1] ? Math.round(rimMax * Math.min(1, (frames(t - anticipation[0]) + 1) / rampSteps)) : rimMax;
  // Flip: widths 48 → 0 (back), 48 → 96 (front or silhouette); reduced motion swaps at flip start.
  let cardWidth = card, face: CardFace = 'back';
  const revealed: CardFace = tiers[tier].silhouette ? 'silhouette' : 'front';
  if (t >= flip[0]) {
    const f = frames(t - flip[0]), widths = [card / 2, 0, card / 2, card];
    if (reducedMotion || t >= flip[1]) face = revealed; else { cardWidth = widths[f] ?? card; face = f < 2 ? 'back' : revealed; }
  }
  if (t >= burst[0]) face = 'front';
  const burstAge = t >= burst[0] ? t - burst[0] : null;
  const legendary = CONFIG.ui.rarity[tier];
  const flash = !reducedMotion && !done && burstAge !== null && legendary.flash.count > 0 && burstAge < legendary.flash.durationMs;
  const pattern = legendary.shake.patternPx as number[];
  const shakeX = reducedMotion || done || burstAge === null ? 0 : pattern[frames(burstAge)] ?? 0;
  const motes = !reducedMotion && !done && 'motes' in legendary && t >= anticipation[0] && t < burst[0];
  return { dropY, cardWidth, face, rimAlpha, flash, shakeX, motes, burstAge: done ? null : burstAge, showName: t >= labels[0], showRarity: t >= labels[0] + gacha.labelRarityDelayMs, done };
}
export interface TenCard { index: number; rarity: Rarity }
/** Index of the highest-rarity card (ties: first), the card that plays the burst cue and gets the highlight hold. */
export function highestCard(rarities: readonly Rarity[]): number {
  const order = CONFIG.ui.rarity.order;
  let best = 0; rarities.forEach((rarity, index) => { if (order.indexOf(rarity) > order.indexOf(rarities[best] ?? 'common')) best = index; });
  return best;
}
export interface TenFrame { cards: { dropY: number; width: number; face: CardFace; burstAge: number | null; rimAlpha: number }[]; badges: boolean; done: boolean; flash: boolean; shakeX: number; highlight: number; burstCueAt: number }
/** 10-pull timeline (gacha.md §8): backs drop together, card i flips at 120 + i×120 (+400 ms hold after an Epic+ highest card). */
export function tenSchedule(rarities: readonly Rarity[]): { flipAt: number[]; highlight: number; hold: number; badgesAt: number } {
  const ten = gacha.tenPull, highlight = highestCard(rarities), epicPlus = ['epic', 'legendary'].includes(rarities[highlight] ?? 'common');
  const hold = epicPlus ? ten.highlightHoldMs : 0;
  const flipAt = rarities.map((_, index) => ten.backsInMs + index * ten.staggerMs + (index > highlight ? hold : 0));
  return { flipAt, highlight, hold, badgesAt: (flipAt.at(-1) ?? 0) + ten.flipMs };
}
export function tenFrame(rarities: readonly Rarity[], ms: number, reducedMotion = false): TenFrame {
  const ten = gacha.tenPull, schedule = tenSchedule(rarities), done = ms >= schedule.badgesAt;
  const dropOffsets = [-8, -4, 0];
  const cards = rarities.map((_, index) => {
    const at = schedule.flipAt[index] ?? 0, f = frames(ms - at), widths = [64, 0, 64, 128];
    const dropY = reducedMotion || ms >= ten.backsInMs ? 0 : dropOffsets[Math.min(frames(ms), 2)] ?? 0;
    let width = 128, face: CardFace = 'back';
    if (ms >= at) { if (reducedMotion || ms >= at + ten.flipMs) face = 'front'; else { width = widths[f] ?? 128; face = f < 2 ? 'back' : 'front'; } }
    const highlighted = index === schedule.highlight && schedule.hold > 0;
    if (highlighted && ms >= at + ten.flipMs / 2 && ms < at + ten.flipMs + 200 && !done) face = 'silhouette';
    const burstAge = !done && ms >= at + ten.flipMs ? ms - at - ten.flipMs : null;
    return { dropY, width, face, burstAge, rimAlpha: highlighted && ms >= at ? 255 : 0 };
  });
  const hiAt = (schedule.flipAt[schedule.highlight] ?? 0) + ten.flipMs, legendary = rarities[schedule.highlight] === 'legendary';
  const age = ms - hiAt, pattern = CONFIG.ui.rarity.legendary.shake.patternPx;
  return { cards, badges: done, done, highlight: schedule.highlight, burstCueAt: hiAt,
    flash: !reducedMotion && !done && legendary && age >= 0 && age < CONFIG.ui.rarity.legendary.flash.durationMs,
    shakeX: !reducedMotion && !done && legendary && age >= 0 ? pattern[frames(age)] ?? 0 : 0 };
}
/** Burst cue rule (gacha.md §7): legendary → sting; else pity → gacha_pity; else gacha_reveal_<rarity>. */
export function burstCue(rarity: Rarity, pity: boolean): string {
  if (rarity === 'legendary') return gacha.audio.legendarySting;
  return pity ? gacha.audio.pity : gacha.audio.reveal.replace('{rarity}', rarity);
}
/**
 * One global flash limiter shared by the gacha reveal and (PR 5) strip drops: a grant needs ≥ 400 ms since the last grant
 * and < 2 grants in the last 1000 ms. Denied = skipped, never queued.
 */
export class FlashLimiter {
  private readonly grants: number[] = [];
  request(now: number): boolean {
    const spec = gacha.flashLimiter, last = this.grants.at(-1);
    const recent = this.grants.filter(at => now - at < 1000).length;
    if ((last !== undefined && now - last < spec.minGapMs) || recent >= spec.maxPerSecond) return false;
    this.grants.push(now); if (this.grants.length > 8) this.grants.shift();
    return true;
  }
}
/** Seeded burst particles (gacha.particleSeed XOR pull index): positions relative to the card centre at `ageMs`. */
export function particles(tier: Rarity, seedIndex: number, ageMs: number, scale = 1): { x: number; y: number; size: number; color: string }[] {
  const spec = CONFIG.ui.rarity[tier].particles, count = Math.max(scale < 1 ? 2 : 0, Math.floor(spec.count * scale));
  if (ageMs < 0 || ageMs >= spec.lifeMs) return [];
  let seed = (gacha.particleSeed ^ seedIndex) >>> 0 || 1;
  const next = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const out: { x: number; y: number; size: number; color: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + next() * 0.5, speed = (spec.speedPxPerSec[0] ?? 40) + next() * ((spec.speedPxPerSec[1] ?? 70) - (spec.speedPxPerSec[0] ?? 40));
    const radius = spec.startRadiusPx + speed * (frames(ageMs) * STEP) / 1000;
    out.push({ x: Math.round(Math.cos(angle) * radius), y: Math.round(Math.sin(angle) * radius), size: ageMs < spec.lifeMs / 2 ? spec.sizePx[0] ?? 2 : spec.sizePx[1] ?? 1, color: spec.colors[i % spec.colors.length] ?? '#ffffff' });
  }
  return out;
}
/** Rising seeded motes (anticipation tell for Epic+): offsets inside a w×h stage area. */
export function motes(tier: Rarity, ms: number, width: number): { x: number; y: number; size: number }[] {
  const spec = CONFIG.ui.rarity[tier];
  if (!('motes' in spec)) return [];
  const m = spec.motes, out: { x: number; y: number; size: number }[] = [];
  for (let i = 0; i < m.count; i += 1) {
    const phase = (frames(ms) * STEP + i * Math.floor(m.periodMs / m.count)) % m.periodMs;
    out.push({ x: Math.round(((i * 37) % 100) / 100 * width), y: -Math.round(phase / m.periodMs * m.risePx), size: m.sizePx });
  }
  return out;
}
/** Welcome-back count-up (offline-rewards.md): ease-out cubic on a 40 ms step, integer values. */
export function countUp(total: number, ms: number, startMs: number, reducedMotion = false): number {
  const spec = CONFIG.ui.offlineRewards.countUp;
  if (reducedMotion || ms >= startMs + spec.durationMs) return total;
  if (ms < startMs) return 0;
  const p = (frames(ms - startMs) * STEP) / spec.durationMs, eased = 1 - (1 - p) ** 3;
  return Math.floor(total * eased);
}
/** Stagger between welcome-back chest pops. More than 16 chests use the shorter Over16 token (60 ms at 1.4.2). */
export function chestStaggerMs(chests: number): number {
  const spec = CONFIG.ui.offlineRewards.countUp;
  return chests > 16 ? spec.chestStaggerMsOver16 : spec.chestStaggerMs;
}
/** Dense 28-slot welcome grid (design.md §18.3 #10): 14 per row, 26 px, stride 29, last row ends at cy + 81. */
export function welcomeChestGrid(slots: number): { perRow: number; size: number; stride: number; originY: number } {
  if (slots > 16) return { perRow: 14, size: 26, stride: 29, originY: 26 };
  if (slots > 8) return { perRow: Math.min(slots, 8), size: 28, stride: 34, originY: 26 };
  return { perRow: Math.min(slots, 8), size: CONFIG.ui.offlineRewards.layout.chestSlot.size, stride: CONFIG.ui.offlineRewards.layout.chestSlot.stride, originY: 0 };
}
/** Chest slot i visible, and whether it is in its 1 px pop frame. */
export function chestSlot(index: number, ms: number, reducedMotion = false, chests = 0): { shown: boolean; pop: boolean } {
  const spec = CONFIG.ui.offlineRewards.countUp, at = spec.chestFirstMs + index * chestStaggerMs(chests);
  if (reducedMotion) return { shown: true, pop: false };
  return { shown: ms >= at, pop: ms >= at && ms < at + spec.chestPopMs };
}
export function welcomeDoneMs(chests: number): number {
  const spec = CONFIG.ui.offlineRewards.countUp;
  return Math.max(spec.xpStartMs + spec.durationMs, spec.chestFirstMs + Math.max(0, chests - 1) * chestStaggerMs(chests) + spec.chestPopMs);
}
/** Time-away label: < 1 h `42m`, < 24 h `3h 05m`, else `1d 4h`. */
export function awayLabel(rawSeconds: number): string {
  const minutes = Math.floor(rawSeconds / 60), hours = Math.floor(minutes / 60);
  if (hours < 1) return `${minutes}m`;
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
/** `+184,320` with en separators; ≥ 10 M as `12.3M` (K/M/B). */
export function rewardLabel(value: number): string {
  if (value >= 1e10) return `+${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e7) return `+${(value / 1e6).toFixed(1)}M`;
  return `+${value.toLocaleString('en-US')}`;
}
