import { describe, expect, it } from 'vitest';
import { idleFrameAt, shouldRunManagementAnimation } from '../src/management/animation';
import { roleIconName } from '../src/management/role-icons';

describe('management role icon mapping', () => {
  it('maps combat and catalog roles to the three class icons', () => {
    expect(['tank', 'warrior'].map(roleIconName)).toEqual(['tank', 'tank']);
    expect(['dps', 'ranger'].map(roleIconName)).toEqual(['dps', 'dps']);
    expect(['support', 'mage'].map(roleIconName)).toEqual(['support', 'support']);
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
