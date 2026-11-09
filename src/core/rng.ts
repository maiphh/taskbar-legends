export interface RandomState { rng: number }
export function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) throw new Error('Seed must be finite');
  return Math.trunc(seed) >>> 0;
}
export function random(state: RandomState): number {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let value = state.rng;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}
