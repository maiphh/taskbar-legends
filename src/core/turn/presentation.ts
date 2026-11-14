/** Smooth return curve; 0 is at contact and 1 is fully home. */
export function easeReturn(u: number): number {
  const t = Math.max(0, Math.min(1, u));
  return t * t * (3 - 2 * t);
}

/** Display x for a leap: home at phase 0 and 1, at the target at mid-windup (0.5). Cast always stays home. */
export function leapDisplayX(homeX: number, targetX: number, phase: number): number {
  if (phase === 0 || phase === 1) return homeX;
  if (phase === 0.5) return targetX;
  if (phase < 0.5) {
    const t = phase / 0.5;
    return homeX + (targetX - homeX) * t;
  }
  const t = (phase - 0.5) / 0.5;
  return targetX + (homeX - targetX) * t;
}
