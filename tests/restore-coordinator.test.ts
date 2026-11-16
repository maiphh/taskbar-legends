import { describe, expect, it } from 'vitest';
import { createState } from '../src/core/game';
import { makeSave, decodeSave } from '../src/core/save';
import { RestoreCoordinator } from '../src/core/restore-coordinator';
import type { RestorePhaseError } from '../src/core/restore-coordinator';
import type { SaveData } from '../src/core/save';
import type { SaveStore } from '../src/core/save-store';
import { memorySaveStore } from '../src/core/save-store';

function controlledStore(initial: SaveData | null, options: { delayFirst?: boolean; failSave?: boolean } = {}) {
  let data = initial ? structuredClone(initial) : null, loads = 0, writes = 0, releaseFirst: (() => void) | undefined;
  const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
  const raw = initial ? makeSave(initial.state, initial.savedAtMs, initial.remainderMs) : null;
  const store: SaveStore = {
    async load() { loads += 1; if (options.delayFirst && loads === 1) await firstGate; return data ? structuredClone(data) : null; },
    async save(next) { writes += 1; if (options.failSave) throw new Error('quota'); data = structuredClone(next); },
    async clear() { data = null; }, failedRaw: () => raw, async discardFailed() { data = null; },
  };
  return { store, release: () => releaseFirst?.(), counts: () => ({ loads, writes }), read: () => data ? structuredClone(data) : null, raw: () => raw };
}

describe('offline restore coordinator', () => {
  it('checkpoints a consumed interval before returning it and does not pay it twice', async () => {
    const state = createState(87), store = memorySaveStore();
    await store.save({ state, savedAtMs: 1000, remainderMs: 12 });
    const first = await new RestoreCoordinator(store, () => 11_000).restore(() => true);
    expect(first.kind).toBe('restored'); if (first.kind !== 'restored' || !first.saved) throw new Error('restore failed');
    expect(first.saved.gold).toBeGreaterThan(0);
    const checkpoint = await store.load(); expect(checkpoint?.savedAtMs).toBe(11_000);
    expect(checkpoint?.remainderMs).toBe(12);
    const next = await new RestoreCoordinator(store, () => 11_000).restore(() => true);
    expect(next.kind).toBe('restored'); if (next.kind !== 'restored' || !next.saved) throw new Error('second restore failed');
    expect(next.saved.gold).toBe(0); expect(next.saved.state.eventSeq).toBe(first.saved.state.eventSeq);
    expect(next.saved.state.offlineAccrual).toEqual(first.saved.state.offlineAccrual);
  });

  it('cancels a stale hidden load and retries the latest visible generation without exposing stale state', async () => {
    const store = controlledStore({ state: createState(88), savedAtMs: 0, remainderMs: 0 }, { delayFirst: true });
    const coordinator = new RestoreCoordinator(store.store, () => 1000); let visible = true;
    const first = coordinator.restore(() => visible);
    visible = false; coordinator.invalidate();
    visible = true; const latest = coordinator.restore(() => visible);
    store.release();
    const result = await latest; await first;
    expect(result.kind).toBe('restored'); expect(store.counts()).toMatchObject({ loads: 2, writes: 1 });
    expect(store.read()?.savedAtMs).toBe(1000);
  });

  it('does not expose credited progress or replace original data if its checkpoint write fails', async () => {
    const original: SaveData = { state: createState(89), savedAtMs: 0, remainderMs: 0 }, store = controlledStore(original, { failSave: true });
    await expect(new RestoreCoordinator(store.store, () => 1000).restore(() => true))
      .rejects.toMatchObject({ phase: 'checkpoint' } satisfies Partial<RestorePhaseError>);
    expect(store.read()).toEqual(original); expect(store.raw()).toBe(makeSave(original.state, 0, 0));
  });

  it('accepts old saves without idle banks as zero-bank state', () => {
    const old = createState(90); const encoded = JSON.parse(makeSave(old, 0)) as Record<string, unknown>;
    const state = decodeSave(encoded).state;
    expect(state.offlineAccrual).toBeUndefined();
  });
});
