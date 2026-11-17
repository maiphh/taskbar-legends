export function idleFrameAt(elapsedMs: number, durationMs: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  return Math.floor(Math.max(0, elapsedMs) / Math.max(125, durationMs)) % frameCount;
}
export function shouldRunManagementAnimation(closed: boolean, hidden: boolean, reducedMotion: boolean, frozen: boolean): boolean {
  return !closed && !hidden && !reducedMotion && !frozen;
}
