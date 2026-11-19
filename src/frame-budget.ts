import type { GameState } from './core/model';
import { step } from './core/game';
import { CONFIG, TICK_MS } from './config';

export interface FrameBudget {
  steppedMs: number;
  unsimulatedMs: number;
  ticks: number;
  accumulatorMs: number;
}

/** Visible-session clock. `unsimulatedDebtMs` is wall time this session did not simulate. */
export interface VisibleFrameSession {
  accumulatorMs: number;
  unsimulatedDebtMs: number;
}

export interface SettledVisibleFrame extends VisibleFrameSession {
  ticks: number;
  /** Persist this instead of the raw wall clock. Equals `nowMs` minus the session debt. */
  savedAtMs: number;
}

/**
 * Visible frames simulate at most maxFrameDeltaSeconds. The rest is not combat
 * time: a hitch or a stalled animation frame must not run the wave clock out.
 */
export function frameBudget(elapsedMs: number, accumulatorMs: number, paused: boolean): FrameBudget {
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  const stored = Number.isFinite(accumulatorMs) ? Math.max(0, accumulatorMs) : 0;
  const capMs = CONFIG.runtime.maxFrameDeltaSeconds * 1000;
  const steppedMs = paused ? 0 : Math.min(elapsed, capMs);
  const next = stored + steppedMs;
  const ticks = Math.floor(next / TICK_MS);
  return { steppedMs, unsimulatedMs: elapsed - steppedMs, ticks, accumulatorMs: next - ticks * TICK_MS };
}

/** Wall time of the last simulated instant. The unsimulated debt stays payable as offline time. */
export function simulatedWallMs(nowMs: number, unsimulatedMs: number): number {
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  const gap = Number.isFinite(unsimulatedMs) ? Math.max(0, unsimulatedMs) : 0;
  return now - gap;
}

/**
 * Apply one visible animation frame. Combat advances by at most maxFrameDeltaSeconds.
 * Time beyond the cap joins the session debt. A later save stamps `nowMs - debt`, so
 * `resumeSave` still grants it. Paused frames do not simulate and do not change the debt.
 */
export function settleVisibleFrame(state: GameState, session: VisibleFrameSession, elapsedMs: number, nowMs: number, paused: boolean): SettledVisibleFrame {
  const budget = frameBudget(elapsedMs, session.accumulatorMs, paused);
  const previousDebt = Number.isFinite(session.unsimulatedDebtMs) ? Math.max(0, session.unsimulatedDebtMs) : 0;
  const unsimulatedDebtMs = paused ? previousDebt : previousDebt + budget.unsimulatedMs;
  if (!paused && budget.ticks > 0) step(state, budget.ticks);
  return {
    accumulatorMs: paused ? session.accumulatorMs : budget.accumulatorMs,
    unsimulatedDebtMs,
    ticks: paused ? 0 : budget.ticks,
    savedAtMs: simulatedWallMs(nowMs, unsimulatedDebtMs),
  };
}
