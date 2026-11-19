export const ANIMATION_TICK_MS = 50;
export const ANIMATION_FRAME_MS = 90;
/** Compressed simulation frame duration; the renderer scales age to show every atlas frame. */
export const PRESENTATION_FRAME_MS = 50;
// Keep the turn lane responsive: animation frames are about 50 ms, while a
// leap's approach, return, and settle fit inside a compact visual beat.
export const APPROACH_TICKS = 2;
export const RETURN_TICKS = 3;
export const SETTLE_TICKS = 1;

export interface ClipTiming { asset: string; attackFrames: number; castFrames: number; frameMs: number }
export const PARTY_CLIPS: Readonly<Record<string, ClipTiming>> = Object.freeze({
  mw2: { asset: 'medieval-warrior-pack-2', attackFrames: 4, castFrames: 4, frameMs: 90 },
  hu1: { asset: 'huntress', attackFrames: 5, castFrames: 5, frameMs: 90 },
  wiz: { asset: 'wizard-pack', attackFrames: 8, castFrames: 8, frameMs: 90 },
  mw1: { asset: 'medieval-warrior-pack', attackFrames: 4, castFrames: 4, frameMs: 90 },
  mw3: { asset: 'medieval-warrior-pack-3', attackFrames: 4, castFrames: 4, frameMs: 90 },
  mh1: { asset: 'martial-hero', attackFrames: 6, castFrames: 6, frameMs: 90 },
  hk1: { asset: 'hero-knight', attackFrames: 7, castFrames: 7, frameMs: 90 },
  mh2: { asset: 'martial-hero-2', attackFrames: 4, castFrames: 4, frameMs: 90 },
  hu2: { asset: 'huntress-2', attackFrames: 6, castFrames: 6, frameMs: 90 },
  ew1: { asset: 'evil-wizard', attackFrames: 8, castFrames: 8, frameMs: 90 },
  priest: { asset: 'priest', attackFrames: 8, castFrames: 8, frameMs: 90 },
  hk2: { asset: 'hero-knight-2', attackFrames: 6, castFrames: 6, frameMs: 90 },
  mk1: { asset: 'medieval-king-pack', attackFrames: 6, castFrames: 6, frameMs: 90 },
  fw: { asset: 'fantasy-warrior', attackFrames: 7, castFrames: 7, frameMs: 90 },
  ew2: { asset: 'evil-wizard-2', attackFrames: 8, castFrames: 8, frameMs: 90 },
  mk2: { asset: 'medieval-king-pack-2', attackFrames: 4, castFrames: 4, frameMs: 90 },
  mh3: { asset: 'martial-hero-3', attackFrames: 7, castFrames: 6, frameMs: 90 },
  ew3: { asset: 'evil-wizard-3', attackFrames: 13, castFrames: 13, frameMs: 90 },
  grunt: { asset: 'goblin', attackFrames: 8, castFrames: 8, frameMs: 90 },
  assassin: { asset: 'goblin', attackFrames: 8, castFrames: 8, frameMs: 90 },
  archer: { asset: 'skeleton', attackFrames: 8, castFrames: 8, frameMs: 90 },
  brute: { asset: 'mushroom', attackFrames: 8, castFrames: 8, frameMs: 90 },
  bomber: { asset: 'mushroom', attackFrames: 8, castFrames: 8, frameMs: 90 },
  // Hero-as-boss: reuse menacing hero clip lengths (fantasy-warrior / evil-wizard-2).
  boss_ch1: { asset: 'fantasy-warrior', attackFrames: 7, castFrames: 7, frameMs: 90 },
  boss_ch2: { asset: 'evil-wizard-2', attackFrames: 8, castFrames: 8, frameMs: 90 },
});

export type ActionDelivery = 'leap' | 'cast';
export interface ActionTimeline {
  startTick: number; contactTick: number; impactTick: number; attackEndTick: number; returnEndTick: number; readyTick: number;
}
export type PresentationPhase = 'approach' | 'attack' | 'return' | 'settle' | 'done';
export interface PresentationSample { phase: PresentationPhase; animation: 'run' | 'attack' | 'cast' | 'idle'; ageMs: number; progress: number }

export function clipFor(sourceId: string, delivery: ActionDelivery): { animation: 'attack' | 'cast'; frames: number; frameMs: number; ticks: number; impactOffsetTicks: number } {
  const clip = PARTY_CLIPS[sourceId] ?? PARTY_CLIPS.grunt!;
  const animation = delivery === 'cast' ? 'cast' : 'attack';
  const frames = animation === 'cast' ? clip.castFrames : clip.attackFrames;
  const fullMs = frames * PRESENTATION_FRAME_MS;
  // Every atlas frame still plays, at 50 ms per frame instead of 90 ms.
  const ticks = Math.max(Math.ceil(fullMs / ANIMATION_TICK_MS), Math.ceil((frames - 1) * PRESENTATION_FRAME_MS / ANIMATION_TICK_MS) + Math.ceil(PRESENTATION_FRAME_MS / ANIMATION_TICK_MS));
  const impactFrame = Math.floor(frames / 2);
  return { animation, frames, frameMs: clip.frameMs, ticks, impactOffsetTicks: Math.ceil(impactFrame * PRESENTATION_FRAME_MS / ANIMATION_TICK_MS) };
}

export function createActionTimeline(sourceId: string, delivery: ActionDelivery, startTick: number): ActionTimeline {
  const clip = clipFor(sourceId, delivery), contactTick = startTick + (delivery === 'leap' ? APPROACH_TICKS : 0);
  const attackEndTick = contactTick + clip.ticks;
  const returnEndTick = attackEndTick + (delivery === 'leap' ? RETURN_TICKS : 0);
  return { startTick, contactTick, impactTick: contactTick + clip.impactOffsetTicks, attackEndTick, returnEndTick, readyTick: returnEndTick + SETTLE_TICKS };
}

export function actionBoundaries(sourceId: string, delivery: ActionDelivery, action: { startTick: number; impactTick: number; contactTick?: number; attackEndTick?: number; returnEndTick?: number; readyTick?: number; state?: 'windup' | 'recovery' }): ActionTimeline {
  if (action.contactTick !== undefined && action.attackEndTick !== undefined && action.returnEndTick !== undefined && action.readyTick !== undefined)
    return { startTick: action.startTick, contactTick: action.contactTick, impactTick: action.impactTick, attackEndTick: action.attackEndTick, returnEndTick: action.returnEndTick, readyTick: action.readyTick };
  if (action.state === 'recovery') {
    // Old saves already committed their effect. Resume their existing recovery without replaying an attack.
    const readyTick = action.readyTick ?? action.impactTick + 22;
    return { startTick: action.startTick, contactTick: action.impactTick, impactTick: action.impactTick, attackEndTick: action.impactTick,
      returnEndTick: Math.max(action.impactTick, readyTick - SETTLE_TICKS), readyTick };
  }
  const clip = clipFor(sourceId, delivery), contactTick = action.impactTick;
  const attackEndTick = contactTick + clip.ticks;
  const returnEndTick = attackEndTick + (delivery === 'leap' ? RETURN_TICKS : 0);
  // Legacy windups committed at their stored impact. Begin the visual attack there so animation and save state agree.
  return { startTick: action.startTick, contactTick, impactTick: action.impactTick, attackEndTick, returnEndTick, readyTick: returnEndTick + SETTLE_TICKS };
}

export function sampleActionPresentation(delivery: ActionDelivery, timeline: ActionTimeline, now: number): PresentationSample {
  if (now < timeline.contactTick) {
    const approachTicks = Math.max(1, timeline.contactTick - timeline.startTick);
    return { phase: 'approach', animation: 'run', ageMs: Math.max(0, now - timeline.startTick) * ANIMATION_TICK_MS,
      progress: Math.max(0, Math.min(1, (now - timeline.startTick) / approachTicks)) };
  }
  if (now < timeline.attackEndTick) return { phase: 'attack', animation: delivery === 'cast' ? 'cast' : 'attack',
    ageMs: (now - timeline.contactTick) * ANIMATION_TICK_MS * ANIMATION_FRAME_MS / PRESENTATION_FRAME_MS, progress: 1 };
  if (now < timeline.returnEndTick) return { phase: 'return', animation: 'run', ageMs: (now - timeline.attackEndTick) * ANIMATION_TICK_MS, progress: Math.max(0, Math.min(1, (now - timeline.attackEndTick) / Math.max(1, timeline.returnEndTick - timeline.attackEndTick))) };
  if (now < timeline.readyTick) return { phase: 'settle', animation: 'idle', ageMs: (now - timeline.returnEndTick) * ANIMATION_TICK_MS, progress: 1 };
  return { phase: 'done', animation: 'idle', ageMs: 0, progress: 1 };
}

export function hasUnfinishedPresentation(sourceId: string, action: { state: 'windup' | 'recovery'; delivery?: ActionDelivery; startTick: number; impactTick: number; contactTick?: number; attackEndTick?: number; returnEndTick?: number; readyTick?: number }, now: number): boolean {
  return sampleActionPresentation(action.delivery ?? 'leap', actionBoundaries(sourceId, action.delivery ?? 'leap', action), now).phase !== 'done';
}

export function referencedPartyClipAsset(sourceId: string): string { return PARTY_CLIPS[sourceId]?.asset ?? PARTY_CLIPS.grunt!.asset; }

