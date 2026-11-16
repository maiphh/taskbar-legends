import type { SaveData } from './save';
import { resumeSave } from './save';
import type { SaveStore } from './save-store';

export type RestoreOutcome =
  | { kind: 'restored'; data: SaveData | null; saved: ReturnType<typeof resumeSave> | null; timestamp: number }
  | { kind: 'canceled' };
export class RestorePhaseError extends Error {
  constructor(readonly phase: 'load' | 'checkpoint', cause: unknown) { super(String(cause)); this.name = 'RestorePhaseError'; }
}

/** Serializes catch-up and its durable timestamp checkpoint; invalidation prevents stale restores from taking ownership. */
export class RestoreCoordinator {
  private generation = 0;
  private requested = false;
  private flight: Promise<RestoreOutcome> | null = null;
  constructor(private readonly store: SaveStore, private readonly clock: () => number = Date.now) {}
  invalidate(): void { this.generation += 1; this.requested = false; }
  restore(isCurrent: () => boolean): Promise<RestoreOutcome> {
    this.requested = true;
    if (this.flight) return this.flight;
    const flight = this.drive(isCurrent);
    this.flight = flight;
    void flight.then(() => { if (this.flight === flight) this.flight = null; }, () => { if (this.flight === flight) this.flight = null; });
    return flight;
  }
  private async drive(isCurrent: () => boolean): Promise<RestoreOutcome> {
    while (this.requested) {
      this.requested = false;
      const generation = this.generation;
      let data: SaveData | null;
      try { data = await this.store.load(); }
      catch (error) { if (generation !== this.generation) continue; throw new RestorePhaseError('load', error); }
      if (generation !== this.generation || !isCurrent()) continue;
      // A saved timestamp is already-consumed time. If the wall clock moves back,
      // never lower that checkpoint and make part of the old interval payable again.
      const timestamp = Math.max(this.clock(), data?.savedAtMs ?? 0);
      const saved = data ? resumeSave(data, timestamp) : null;
      if (data && saved) {
        try { await this.store.save({ state: saved.state, savedAtMs: timestamp, remainderMs: saved.remainderMs }); }
        catch (error) { if (generation !== this.generation) continue; throw new RestorePhaseError('checkpoint', error); }
      }
      if (generation !== this.generation || !isCurrent()) continue;
      return { kind: 'restored', data, saved, timestamp };
    }
    return { kind: 'canceled' };
  }
}
