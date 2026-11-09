import { describe, expect, it } from 'vitest';
import { bannerFrame, popupFrame, pulseGrowPx } from '../src/motion';

/** Timing tables from review-core-loop-feedback.md Q1–Q3 (40 ms clock). */
describe('core-loop feedback motion', () => {
  it('pulses the pip 1 px larger for 200 ms in each of three 1000 ms cycles', () => {
    expect([0, 160, 200, 999, 1000, 1199, 1200, 2000, 2199, 2200, 3000].map(pulseGrowPx)).toEqual([1, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0]);
  });
  it('slides the banner in from y 12 to 8, holds, steps its alpha down and hides at 1920 ms', () => {
    expect([0, 40, 80, 1000].map(ms => bannerFrame(ms)?.y)).toEqual([12, 10, 8, 8]);
    expect([1599, 1600, 1680, 1760, 1840].map(ms => Math.round((bannerFrame(ms)?.alpha ?? 0) * 255))).toEqual([255, 204, 153, 102, 51]);
    expect(bannerFrame(1920)).toBeNull();
    expect(bannerFrame(40, true)).toEqual({ y: 8, alpha: 1 });
  });
  it('raises the popup 16 px over 640 ms (chip 12 px), fades 192/128/64 and ends at 1200 ms', () => {
    expect([0, 40, 320, 640, 900].map(ms => popupFrame(ms, false)?.rise)).toEqual([0, 1, 8, 16, 16]);
    expect(popupFrame(900, true)?.rise).toBe(12);
    expect([959, 960, 1040, 1120].map(ms => Math.round((popupFrame(ms, false)?.alpha ?? 0) * 255))).toEqual([255, 192, 128, 64]);
    expect(popupFrame(1200, false)).toBeNull();
    expect(popupFrame(500, false, true)).toEqual({ rise: 0, alpha: 1 });
  });
});
