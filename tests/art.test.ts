import { expect, it } from 'vitest';
import { verifyArt } from '../scripts/verify-art';
it('all actual outlined sprite pixels and extra animations fit the fixed baseline envelope; research is excluded', () => {
  const result = verifyArt();
  expect(result.heroes).toBe(18); expect(result.enemies).toBe(9); expect(result.frames).toBeGreaterThan(1000);
  expect(result.baseline).toBe(136); expect(result.minY).toBe(8); expect(result.maxYExclusive).toBe(154);
  expect(result.forbiddenRuntimeFiles).toEqual([]);
});
