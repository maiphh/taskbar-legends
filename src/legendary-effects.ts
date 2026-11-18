import { LEGENDARY_VFX_SPECS, type EffectLayer, type EffectSpec } from './legendary-vfx-spec';
export type ShowcaseEffect = { kind: 'skill' | 'drop'; startedAt: number; label: string; seed: number };
export type ActiveShowcaseEffect = ShowcaseEffect & { age: number; spec: EffectSpec; layers: readonly EffectLayer[] };
/** Render-only showcase clock. It has no reference to game state or random sources. */
export class LegendaryEffects {
  private active: ShowcaseEffect | null = null;
  private frozenAge: number | null = null;
  onStart: ((effect: ShowcaseEffect) => void) | null = null;
  onEnd: ((effect: ShowcaseEffect) => void) | null = null;
  trigger(kind: ShowcaseEffect['kind'], now: number, label: string): void {
    if (this.active) this.onEnd?.(this.active);
    const seed = hash(`${Math.floor(now)}:${kind}:${label}`);
    this.active = { kind, startedAt: now, label, seed }; this.frozenAge = null; this.onStart?.(this.active);
  }
  current(now: number, reducedMotion = false): ActiveShowcaseEffect | null {
    if (!this.active) return null;
    const effect = this.active, spec = LEGENDARY_VFX_SPECS[effect.kind], age = this.frozenAge ?? now - effect.startedAt;
    if (age < 0 || age >= spec.durationMs) { this.active = null; this.frozenAge = null; this.onEnd?.(effect); return null; }
    return { ...effect, age, spec, layers: activeEffectLayers(spec, age, reducedMotion) };
  }
  isActive(): boolean { return this.active !== null; }
  seek(ageMs: number): void { if (this.active) this.frozenAge = Math.max(0, ageMs); }
  clear(): void { if (this.active) this.onEnd?.(this.active); this.active = null; this.frozenAge = null; }
}
function hash(value: string): number { let h = 2166136261; for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i)!, 16777619); return h >>> 0; }
export function activeEffectLayers(spec: EffectSpec, age: number, reducedMotion = false): readonly EffectLayer[] {
  return spec.layers.filter(layer => age >= layer.startMs && age < layer.endMs && !(reducedMotion && ['shake', 'hitstop', 'flash', 'particles', 'rays'].includes(layer.type)));
}
/** Stateless per-particle random value, independent of draw order and simulation RNG. */
export function effectRandom(seed: number, index: number): number { let x = (seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 0x1_0000_0000; }
