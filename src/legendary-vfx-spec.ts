export type EffectLayerType = 'sheet' | 'flash' | 'rays' | 'particles' | 'banner' | 'beam' | 'cardPop' | 'borderPulse' | 'shake' | 'hitstop';
export interface EffectLayer { startMs: number; endMs: number; type: EffectLayerType; params: Record<string, number | string | boolean> }
export interface EffectSpec { kind: 'skill' | 'drop'; durationMs: number; layers: readonly EffectLayer[] }

const skill: EffectLayer[] = [
  { startMs: 0, endMs: 1800, type: 'banner', params: { holdMs: 1660, entranceMs: 240, stepMs: 48 } },
  { startMs: 0, endMs: 620, type: 'borderPulse', params: { intensity: 1 } },
  { startMs: 0, endMs: 400, type: 'hitstop', params: { holdMs: 140, slowFactor: 0.5 } },
  { startMs: 0, endMs: 360, type: 'flash', params: { intensity: 1 } },
  { startMs: 90, endMs: 980, type: 'particles', params: { count: 32 } },
  { startMs: 120, endMs: 1050, type: 'shake', params: { intensity: 1, cadenceMs: 45 } },
  { startMs: 0, endMs: 800, type: 'sheet', params: { frameMs: 80 } },
  { startMs: 0, endMs: 330, type: 'beam', params: { width: 18 } },
  { startMs: 100, endMs: 1080, type: 'rays', params: { count: 10 } },
];
const drop: EffectLayer[] = [
  { startMs: 0, endMs: 2100, type: 'banner', params: { holdMs: 1940, entranceMs: 240, stepMs: 48 } },
  { startMs: 0, endMs: 1150, type: 'borderPulse', params: { intensity: 1 } },
  { startMs: 0, endMs: 320, type: 'hitstop', params: { holdMs: 130, slowFactor: 0.5 } },
  { startMs: 0, endMs: 360, type: 'flash', params: { intensity: 0.9 } },
  { startMs: 120, endMs: 1250, type: 'particles', params: { count: 28 } },
  { startMs: 0, endMs: 1120, type: 'sheet', params: { frameMs: 62 } },
  { startMs: 0, endMs: 680, type: 'beam', params: { width: 24 } },
  { startMs: 180, endMs: 2100, type: 'cardPop', params: { popMs: 240, stepMs: 48, fadeStartMs: 1740, fadeStepMs: 90 } },
  { startMs: 120, endMs: 1200, type: 'rays', params: { count: 8 } },
];

/** Render-only choreography. All clocks and random values are presentation-local. */
export const LEGENDARY_VFX_SPECS: Readonly<Record<EffectSpec['kind'], EffectSpec>> = {
  skill: { kind: 'skill', durationMs: 1800, layers: skill },
  drop: { kind: 'drop', durationMs: 2100, layers: drop },
};
