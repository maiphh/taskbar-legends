import { describe, expect, it } from 'vitest';
import { CONFIG, TICK_MS, ticksForSeconds } from '../src/config';
import { createState } from '../src/core/game';
import { resumeSave } from '../src/core/save';
import { SaveTimestamp } from '../src/core/save-timestamp';
import { frameBudget, settleVisibleFrame, simulatedWallMs } from '../src/frame-budget';

describe('visible frame budget', () => {
  it('caps a hitch at maxFrameDeltaSeconds and leaves the rest unsimulated', () => {
    const capMs = CONFIG.runtime.maxFrameDeltaSeconds * 1000;
    const budget = frameBudget(90_000, 0, false);
    expect(capMs).toBe(250);
    expect(budget.steppedMs).toBe(capMs);
    expect(budget.ticks).toBe(Math.floor(capMs / TICK_MS));
    expect(budget.ticks).toBeLessThan(20);
    expect(budget.unsimulatedMs).toBe(90_000 - capMs);
    expect(simulatedWallMs(1_000_000, budget.unsimulatedMs)).toBe(1_000_000 - (90_000 - capMs));
  });

  it('does not simulate while paused, and a normal frame is unchanged', () => {
    expect(frameBudget(16, 10, true)).toMatchObject({ steppedMs: 0, unsimulatedMs: 16, ticks: 0, accumulatorMs: 10 });
    const frame = frameBudget(50, 0, false);
    expect(frame.steppedMs).toBe(50);
    expect(frame.ticks).toBe(1);
    expect(frame.unsimulatedMs).toBe(0);
    expect(frameBudget(Number.NaN, 4, false)).toMatchObject({ steppedMs: 0, ticks: 0, accumulatorMs: 4 });
  });
});

describe('visible hitch stays payable', () => {
  it('advances a live wave by at most 0.25s and lets resumeSave grant the unsimulated remainder', () => {
    const state = createState(1);
    // A live opening wave. An uncapped 90s frame must not be simulated; only the 0.25s cap runs.
    expect(state.phase.kind).toBe('battle');
    expect(state.wave).toBe(1);
    expect(state.stats.losses).toBe(0);
    const tickBefore = state.tick;
    const wall = 5_000_000;
    const clock = new SaveTimestamp();
    clock.next(wall);

    const capMs = CONFIG.runtime.maxFrameDeltaSeconds * 1000;
    const hitch = settleVisibleFrame(state, { accumulatorMs: 0, unsimulatedDebtMs: 0 }, 90_000, wall + 90_000, false);
    expect(state.tick - tickBefore).toBe(ticksForSeconds(0.25));
    expect(state.tick - tickBefore).toBeLessThanOrEqual(ticksForSeconds(CONFIG.runtime.maxFrameDeltaSeconds));
    expect(state.stats.losses).toBe(0);
    expect(state.phase.kind).toBe('battle');
    expect(state.wave).toBe(1);
    expect(state.progress).toMatchObject({ kind: 'PUSHING', stage: 1 });
    expect(hitch.unsimulatedDebtMs).toBe(90_000 - capMs);
    expect(hitch.savedAtMs).toBe(wall + capMs);
    // The hitch is longer than the autosave interval, so this frame persists the payable stamp.
    expect(clock.next(hitch.savedAtMs)).toBe(wall + capMs);

    const follow = settleVisibleFrame(state, hitch, 16, wall + 90_016, false);
    expect(follow.unsimulatedDebtMs).toBe(hitch.unsimulatedDebtMs);
    expect(follow.savedAtMs).toBe(wall + capMs + 16);
    expect(state.stats.losses).toBe(0);
    const savedAtMs = clock.next(follow.savedAtMs);
    expect(savedAtMs).toBe(wall + capMs + 16);

    const resumed = resumeSave({ state, savedAtMs, remainderMs: follow.accumulatorMs }, wall + 90_016);
    expect(resumed.rawSeconds * 1000).toBe(90_000 - capMs);
    expect(resumed.gold).toBeGreaterThan(0);
    expect(resumed.state.stats.losses).toBe(0);
    expect(resumed.state.phase.kind).toBe('battle');
    expect(resumed.state.wave).toBe(1);
  });

  it('keeps owed time across a pause and adds the next hitch to the same debt', () => {
    const state = createState(1);
    const tick = state.tick;
    const paused = settleVisibleFrame(state, { accumulatorMs: 10, unsimulatedDebtMs: 1_500 }, 90_000, 200_000, true);
    expect(state.tick).toBe(tick);
    expect(paused).toMatchObject({ accumulatorMs: 10, unsimulatedDebtMs: 1_500, ticks: 0, savedAtMs: 198_500 });
    const capMs = CONFIG.runtime.maxFrameDeltaSeconds * 1000;
    const again = settleVisibleFrame(state, paused, 90_000, 300_000, false);
    expect(again.unsimulatedDebtMs).toBe(1_500 + 90_000 - capMs);
    expect(again.savedAtMs).toBe(300_000 - again.unsimulatedDebtMs);
    expect(state.tick - tick).toBeLessThanOrEqual(ticksForSeconds(0.25));
    expect(state.stats.losses).toBe(0);
    const resumed = resumeSave({ state, savedAtMs: again.savedAtMs, remainderMs: again.accumulatorMs }, 300_000);
    expect(resumed.rawSeconds * 1000).toBe(again.unsimulatedDebtMs);
    expect(resumed.gold).toBeGreaterThan(0);
  });
});
