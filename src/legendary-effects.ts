/** Render-only showcase clock. It has no reference to game state or random sources. */
export type ShowcaseEffect = { kind: 'skill' | 'drop'; startedAt: number; label: string };
export class LegendaryEffects {
  private active: ShowcaseEffect | null = null;
  trigger(kind: ShowcaseEffect['kind'], now: number, label: string): void { this.active = { kind, startedAt: now, label }; }
  current(now: number): (ShowcaseEffect & { age: number }) | null {
    if (!this.active) return null;
    const age = now - this.active.startedAt, duration = this.active.kind === 'skill' ? 1100 : 1000;
    if (age < 0 || age >= duration) { if (age >= duration) this.active = null; return null; }
    return { ...this.active, age };
  }
  clear(): void { this.active = null; }
}
