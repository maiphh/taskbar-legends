import { describe, expect, it } from 'vitest';
import { compactLaneLayout } from '../src/compact-lane-layout';

describe('compact lane layout full-bleed field', () => {
  it('gives the whole width to the field at 480 and 640 with zero-width islands', () => {
    for (const width of [480, 640]) {
      const { progress, field, actions } = compactLaneLayout(width);
      expect(field.x).toBe(0);
      expect(field.width).toBe(width);
      expect(progress.width).toBe(0);
      expect(actions.width).toBe(0);
    }
  });
});
