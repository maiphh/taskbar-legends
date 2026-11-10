import { describe, expect, it } from 'vitest';
import { shouldIgnoreCursor } from '../src/platform/desktop/compact-runtime';

describe('compact native pointer routing policy', () => {
  it('captures an already-visible recovery panel at startup and when edit mode exits', () => {
    expect(shouldIgnoreCursor(true, true, false)).toBe(false);
    expect(shouldIgnoreCursor(true, true, true)).toBe(false);
    expect(shouldIgnoreCursor(true, false, true)).toBe(false);
    expect(shouldIgnoreCursor(true, false, false)).toBe(true);
    expect(shouldIgnoreCursor(false, false, false)).toBe(false);
  });
});
