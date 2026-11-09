import { CONFIG } from './config';

/** Pure timing for core-loop feedback (ui.md §10, ui-tokens coreLoopFeedback). Timings are specified on a 40 ms clock. */
const spec = CONFIG.ui.coreLoopFeedback;
const steps = (ms: number): number => Math.floor(ms / spec.stepMs);
function stepAlpha(ms: number, at: readonly number[], alphas: readonly number[]): number {
  let alpha = 255; for (const [index, start] of at.entries()) if (ms >= start) alpha = alphas[index] ?? alpha; return alpha / 255;
}
/** Extra px on each side of the pip: 1 during the first 200 ms of each of 3 1000 ms cycles, else 0. */
export function pulseGrowPx(ageMs: number): number {
  const pulse = spec.badgePulse;
  return ageMs >= 0 && ageMs < pulse.cycleMs * pulse.cycles && ageMs % pulse.cycleMs < pulse.grownMs ? (pulse.grownSizePx - spec.badge.sizePx) / 2 : 0;
}
/** Banner plate window y and alpha at `ms` after its trigger, or null once hidden. */
export function bannerFrame(ms: number, reducedMotion = false): { y: number; alpha: number } | null {
  const banner = spec.stageBanner;
  if (ms >= banner.hideAtMs) return null;
  if (reducedMotion) return { y: banner.windowY, alpha: 1 };
  return { y: Math.max(banner.windowY, banner.enterFromY - steps(ms) * banner.enterStepPx), alpha: stepAlpha(ms, banner.fadeStepsMs, banner.fadeAlpha) };
}
/** Upgrade popup rise (px above its start) and alpha; `risePx`/`riseMs` = 16 px over 640 ms for the strip, 12 px for the panel chip. */
export function popupFrame(ms: number, chip: boolean, reducedMotion = false): { rise: number; alpha: number } | null {
  const popup = spec.upgradePopup;
  if (ms >= popup.lifeMs) return null;
  if (reducedMotion) return { rise: 0, alpha: 1 };
  const total = chip ? popup.panelChip.risePx : popup.risePx;
  return { rise: Math.min(total, Math.floor(steps(ms) * popup.risePx / (popup.riseMs / spec.stepMs))), alpha: stepAlpha(ms, popup.fadeStepsMs, popup.fadeAlpha) };
}
