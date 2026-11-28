import { CONFIG } from './config';
import type { Rarity } from './config';

const gacha = CONFIG.ui.gacha, STEP = gacha.frameStepMs;
const frames = (ms: number): number => Math.floor(ms / STEP);
export type CardFace = 'back' | 'silhouette' | 'front';
export type RevealPhase = 'charge' | 'leak' | 'open' | 'silhouette' | 'burst' | 'flight' | 'cards' | 'result';

interface RolledHero { heroId: string; rarity: Rarity }

/** All times are measured from the click, including the ten-card flight and individual flips. */
export function revealSchedule(pulls: readonly RolledHero[], firstPullIndex = 0) {
  if (!pulls.length) throw new Error('A reveal needs at least one rolled hero');
  const rarities = pulls.map(pull => pull.rarity);
  const order = CONFIG.ui.rarity.order;
  const highlight = rarities.reduce((best, rarity, i) => order.indexOf(rarity) > order.indexOf(rarities[best]!) ? i : best, 0);
  const best = rarities[highlight]!;
  let preview: 'rare' | 'epic' | null = null;
  if (best === 'legendary') {
    // Hash the ordered hero IDs, including boundaries between IDs. No game or cosmetic RNG draws.
    let hash = 2166136261 ^ firstPullIndex;
    for (const char of pulls.map(pull => pull.heroId).join('|')) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    if (hash % 3 === 0) preview = hash % 2 === 0 ? 'rare' : 'epic';
  }

  const leakAt = gacha.chargeMs + (preview ? gacha.fakeoutMs : 0);
  const openAt = leakAt + gacha.leakMs;
  const openedAt = openAt + gacha.openMs;
  const tier = gacha.tiers[best], ten = gacha.tenPull;
  const flipAt: number[] = [];
  let cueAt = openedAt + tier.silhouetteMs;
  let doneAt = cueAt + tier.burstMs;
  const landedAt = openedAt + ten.flightMs + (pulls.length - 1) * ten.launchStaggerMs;
  if (pulls.length > 1) {
    let next = landedAt + ten.faceDownMs;
    for (const rarity of rarities) {
      next += ten.pauseBeforeMs[rarity];
      flipAt.push(next);
      next += ten.flipMs + ten.readMs;
    }
    cueAt = flipAt[highlight]! + ten.flipMs;
    doneAt = next;
  }
  return { best, highlight, preview, leakAt, openAt, openedAt, landedAt, flipAt, cueAt, doneAt };
}
export type RevealSchedule = ReturnType<typeof revealSchedule>;

function progress(age: number, duration: number): number {
  return Math.max(0, Math.min(1, frames(age) * STEP / duration));
}
export interface FlyingCard { travel: number; width: number; face: CardFace; burstAge: number | null }
export function revealFrame(plan: RevealSchedule, elapsed: number, reducedMotion = false) {
  const ms = reducedMotion ? plan.doneAt : Math.max(0, Math.min(elapsed, plan.doneAt));
  const done = ms >= plan.doneAt, group = plan.flipAt.length > 0, ten = gacha.tenPull;
  let phase: RevealPhase;
  let amount = 1;
  let color: Rarity | null = plan.best;
  if (done) phase = 'result';
  else if (ms < gacha.chargeMs) {
    phase = 'charge'; color = null; amount = progress(ms, gacha.chargeMs);
  } else if (ms < plan.openAt) {
    phase = 'leak';
    if (ms < plan.leakAt) {
      color = plan.preview;
      amount = progress(ms - gacha.chargeMs, gacha.fakeoutMs);
    } else amount = progress(ms - plan.leakAt, gacha.leakMs);
  } else if (ms < plan.openedAt) {
    phase = 'open'; amount = progress(ms - plan.openAt, gacha.openMs);
  } else if (group) phase = ms < plan.landedAt ? 'flight' : 'cards';
  else phase = ms < plan.cueAt ? 'silhouette' : 'burst';

  const cards: FlyingCard[] = group && ms >= plan.openedAt ? plan.flipAt.map((at, i) => {
    const travel = progress(ms - plan.openedAt - i * ten.launchStaggerMs, ten.flightMs);
    const flip = progress(ms - at, ten.flipMs);
    return { travel, width: Math.abs(1 - 2 * flip), face: flip > 0.5 ? 'front' : 'back',
      burstAge: !done && ms >= at + ten.flipMs ? ms - at - ten.flipMs : null };
  }) : [];
  const burstAge = !done && ms >= plan.cueAt ? ms - plan.cueAt : null;
  const { flash, shake } = CONFIG.ui.rarity[plan.best];
  return { phase, amount, color, cards, done, burstAge,
    flash: burstAge !== null && flash.count > 0 && burstAge < flash.durationMs,
    shakeX: burstAge === null ? 0 : shake.patternPx[Math.floor(burstAge / shake.stepMs)] ?? 0 };
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
