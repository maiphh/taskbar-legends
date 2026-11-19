export interface LaneClockSample { time: number; debtTicks: number; rate: number }

/**
 * A catch-up frame that already jumped past the hit-stop hold must not pin the
 * lane. Realtime frames (jump shorter than the hold) still slow.
 */
export function presentationHitstop(hitstop: { holdMs: number; slowFactor: number } | null, simulationJumpTicks: number, tickMs: number): { holdMs: number; slowFactor: number } | null {
  if (!hitstop || !Number.isFinite(hitstop.holdMs)) return null;
  const jumpMs = (Number.isFinite(simulationJumpTicks) ? Math.max(0, simulationJumpTicks) : 0) * (Number.isFinite(tickMs) ? tickMs : 0);
  if (!Number.isFinite(jumpMs) || jumpMs > hitstop.holdMs) return null;
  return hitstop;
}

/** Monotonic render clock. Slowdown applies only to advancing simulation time. */
export class PresentationLaneClock {
  private time: number | null = null;
  private priorSimulationTime: number | null = null;
  private identity = '';
  sample(simulationTime: number, hitstop: { holdMs: number; slowFactor: number } | null, effectAgeMs: number, paused: boolean, reducedMotion: boolean, identity: string): LaneClockSample {
    if (this.identity !== identity || this.time === null || simulationTime < (this.priorSimulationTime ?? simulationTime)) this.reset(simulationTime, identity);
    const prior = this.priorSimulationTime ?? simulationTime;
    const rate = reducedMotion || !hitstop ? 1 : effectAgeMs < hitstop.holdMs ? 0 : Math.max(0, Math.min(1, hitstop.slowFactor));
    if (!paused) this.time = Math.max(this.time!, this.time! + Math.max(0, simulationTime - prior) * rate);
    this.priorSimulationTime = simulationTime;
    if (!hitstop && !paused) this.time = Math.max(this.time!, simulationTime);
    return { time: this.time!, debtTicks: Math.max(0, simulationTime - this.time!), rate };
  }
  reset(simulationTime = 0, identity = ''): void { this.time = simulationTime; this.priorSimulationTime = simulationTime; this.identity = identity; }
}

/** Last rendered integer positions; each completed frame replaces and prunes the previous snapshot. */
export class LanePositionCache {
  private prior = new Map<string, { target: number; value: number; sample: number }>();
  private current = new Map<string, { target: number; value: number; sample: number }>();
  beginFrame(): void { this.current.clear(); }
  sample(id: string, target: number, rate: number, sample = 0): number {
    const prior = this.prior.get(id);
    let value = target;
    if (prior && sample === prior.sample) value = prior.value;
    else if (prior && rate < 1) value = Math.round(prior.value + (target - prior.target) * rate);
    this.current.set(id, { target, value, sample }); return value;
  }
  endFrame(): void { this.prior = this.current; this.current = new Map(); }
  reset(): void { this.prior.clear(); this.current.clear(); }
  has(id: string): boolean { return this.prior.has(id); }
}

/** Integer card dimensions avoid resampling the icon, border, and lane. */
export function dropCardSize(ageMs: number, stepMs = 48, popMs = 240): number {
  return ageMs < popMs ? [48, 52, 60, 56, 48][Math.min(4, Math.max(0, Math.floor(ageMs / stepMs)))]! : 48;
}
