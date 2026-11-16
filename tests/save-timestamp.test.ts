import { describe, expect, it } from 'vitest';
import { createState } from '../src/core/game';
import { RestoreCoordinator } from '../src/core/restore-coordinator';
import { SaveTimestamp } from '../src/core/save-timestamp';
import { memorySaveStore } from '../src/core/save-store';

describe('monotonic save timestamps', () => {
  it('keeps a consumed future checkpoint through restore, regular save, hide save and clock recovery', async () => {
    const state = createState(301), store = memorySaveStore();
    await store.save({ state, savedAtMs: 100_000, remainderMs: 7 });

    const first = await new RestoreCoordinator(store, () => 110_000).restore(() => true);
    expect(first.kind).toBe('restored');
    if (first.kind !== 'restored' || !first.saved) throw new Error('initial restore failed');
    const paidGold = first.saved.gold;
    expect(paidGold).toBeGreaterThan(0);
    expect((await store.load())?.savedAtMs).toBe(110_000);

    const rollback = await new RestoreCoordinator(store, () => 90_000).restore(() => true);
    expect(rollback.kind).toBe('restored');
    if (rollback.kind !== 'restored' || !rollback.saved) throw new Error('rollback restore failed');
    expect(rollback.saved.seconds).toBe(0);
    expect(rollback.saved.gold).toBe(0);
    expect((await store.load())?.savedAtMs).toBe(110_000);

    // Exercise the same high-water policy main uses for autosave and hide checkpoint.
    const clock = new SaveTimestamp();
    clock.observe(rollback.timestamp, rollback.data?.savedAtMs ?? 0);
    const regularTimestamp = clock.next(90_000);
    await store.save({ state: rollback.saved.state, savedAtMs: regularTimestamp, remainderMs: rollback.saved.remainderMs });
    const hideTimestamp = clock.next(95_000);
    await store.save({ state: rollback.saved.state, savedAtMs: hideTimestamp, remainderMs: rollback.saved.remainderMs });
    expect((await store.load())?.savedAtMs).toBe(110_000);

    const recovered = await new RestoreCoordinator(store, () => 110_000).restore(() => true);
    expect(recovered.kind).toBe('restored');
    if (recovered.kind !== 'restored' || !recovered.saved) throw new Error('recovered restore failed');
    expect(recovered.saved.gold).toBe(0);
    expect(recovered.saved.state.gold).toBe(first.saved.state.gold);
    expect(recovered.saved.state.offlineAccrual).toEqual(first.saved.state.offlineAccrual);
    expect((await store.load())?.savedAtMs).toBe(110_000);
  });
});
