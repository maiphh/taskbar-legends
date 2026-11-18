import { describe, expect, it } from 'vitest';
import { idleFrameAt, shouldRunManagementAnimation } from '../src/management/animation';
import { ROLE_ICON_PIXELS, drawRoleIcon, roleIconName } from '../src/management/role-icons';

describe('management role icon mapping', () => {
  it('maps combat and catalog roles to the three class icons', () => {
    expect(['tank', 'warrior'].map(roleIconName)).toEqual(['tank', 'tank']);
    expect(['dps', 'ranger'].map(roleIconName)).toEqual(['dps', 'dps']);
    expect(['support', 'mage', 'heal'].map(roleIconName)).toEqual(['support', 'support', 'support']);
  });

  it('keeps authored 16×16 sword / shield / plus glyphs integer-aligned', () => {
    for (const kind of ['tank', 'dps', 'support'] as const) {
      expect(ROLE_ICON_PIXELS[kind]).toHaveLength(16);
      expect(ROLE_ICON_PIXELS[kind].every(row => row.length === 16)).toBe(true);
      expect(ROLE_ICON_PIXELS[kind].some(row => row.includes('#') || row.includes('o'))).toBe(true);
    }
    const canvas = { width: 32, height: 32 } as HTMLCanvasElement;
    // Node tests have no Canvas; assert the draw helper is callable with a stub that records fillRect calls.
    const fills: Array<{ x: number; y: number; w: number; h: number; style: string }> = [];
    const ctx = {
      imageSmoothingEnabled: true,
      fillStyle: '#000',
      fillRect(x: number, y: number, w: number, h: number) {
        fills.push({ x, y, w, h, style: String(this.fillStyle) });
      },
    } as unknown as CanvasRenderingContext2D;
    drawRoleIcon(ctx, 'dps', 3.2, 4.8, 1);
    expect(ctx.imageSmoothingEnabled).toBe(false);
    expect(fills.length).toBeGreaterThan(10);
    expect(fills.every(pixel => Number.isInteger(pixel.x) && Number.isInteger(pixel.y) && pixel.w === 1 && pixel.h === 1)).toBe(true);
    expect(fills[0]?.x).toBeGreaterThanOrEqual(3);
    void canvas;
  });
});

describe('management idle animation clock', () => {
  it('advances by the slower of 8 fps and atlas frame duration', () => {
    expect([0, 124, 125, 250, 375, 500].map(time => idleFrameAt(time, 100, 4))).toEqual([0, 0, 1, 2, 3, 0]);
    expect(idleFrameAt(450, 300, 3)).toBe(1);
  });
  it('pauses while hidden, closed, reduced, or frozen', () => {
    expect(shouldRunManagementAnimation(false, false, false, false)).toBe(true);
    expect(shouldRunManagementAnimation(false, true, false, false)).toBe(false);
    expect(shouldRunManagementAnimation(true, false, false, false)).toBe(false);
    expect(shouldRunManagementAnimation(false, false, true, false)).toBe(false);
    expect(shouldRunManagementAnimation(false, false, false, true)).toBe(false);
  });
});
