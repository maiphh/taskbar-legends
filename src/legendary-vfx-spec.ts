export type EffectLayerType = 'sheet' | 'flash' | 'rays' | 'particles' | 'banner' | 'beam' | 'cardPop' | 'borderPulse' | 'shake' | 'hitstop';
export interface EffectLayer { startMs: number; endMs: number; type: EffectLayerType; params: Record<string, number | string | boolean> }
export interface EffectSpec { kind: 'skill' | 'drop'; durationMs: number; layers: readonly EffectLayer[] }
const shared = (durationMs: number): EffectLayer[] => [
  { startMs: 0, endMs: durationMs, type: 'banner', params: {} },
  { startMs: 0, endMs: durationMs, type: 'borderPulse', params: { intensity: 0.8 } },
  { startMs: 0, endMs: 160, type: 'hitstop', params: { holdMs: 45, slowFactor: 0.35 } },
  { startMs: 0, endMs: 220, type: 'flash', params: { intensity: 0.18 } },
  { startMs: 0, endMs: durationMs, type: 'particles', params: { count: 12 } },
  { startMs: 0, endMs: 650, type: 'shake', params: { intensity: 1 } },
];
/** Placeholder timings and intensity data. Retune this module when the final art direction arrives. */
export const LEGENDARY_VFX_SPECS: Readonly<Record<EffectSpec['kind'], EffectSpec>> = {
  skill: { kind: 'skill', durationMs: 1100, layers: shared(1100).concat([{ startMs: 0, endMs: 880, type: 'sheet', params: { frameMs: 80 } }, { startMs: 0, endMs: 750, type: 'beam', params: {} }, { startMs: 160, endMs: 900, type: 'rays', params: { count: 12 } }]) },
  drop: { kind: 'drop', durationMs: 1000, layers: shared(1000).concat([{ startMs: 0, endMs: 1000, type: 'sheet', params: { frameMs: 62 } }, { startMs: 0, endMs: 700, type: 'cardPop', params: {} }, { startMs: 80, endMs: 880, type: 'rays', params: { count: 8 } }]) },
};
