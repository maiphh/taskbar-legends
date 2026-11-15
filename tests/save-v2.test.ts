import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createState, snapshot, step } from '../src/core/game';
import type { GameState } from '../src/core/model';
import { referencePolicy } from '../src/core/policy';
import { decodeSave, encodeSave, makeSave, restoreSave } from '../src/core/save';
import { memorySaveStore, TextSaveStore } from '../src/core/save-store';
import type { SaveStore } from '../src/core/save-store';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
function referenceRun(seed: number, ticks: number): GameState {
  const state = createState(seed), cursor = { revision: -1 };
  for (let tick = 0; tick < ticks; tick += 1) { referencePolicy(state, cursor); step(state); }
  return state;
}

describe('current party save format', () => {
  it('round-trips current party progress and its stable starter inventory', () => {
    const state = referenceRun(11, 600);
    expect(state.combatRules).toBe('party-v2');
    const raw = makeSave(state, 1_700_000_000_000);
    const restored = decodeSave(JSON.parse(raw));
    expect(restored.state).toEqual(state);
    expect(restored.state.partyIds).toEqual(state.partyIds);
    expect(restored.state.partyIds).toHaveLength(3);
    expect(restored.state.inventory).toEqual(state.inventory);
  });
  it('rejects incompatible legacy v1 gameplay with export-preserved guidance', () => {
    const raw = fixture('save-v1-fresh.json');
    expect(() => decodeSave(raw)).toThrow(/legacy gameplay save is incompatible.*raw data was preserved/i);
    expect(() => restoreSave(JSON.stringify(raw), 1_700_000_000_000)).toThrow(/export the account from the previous version/i);
  });
  it('accepts same-seed current runs and current saves byte-identically', () => {
    const a = referenceRun(4, 1200), b = referenceRun(4, 1200);
    expect(snapshot(a)).toBe(snapshot(b));
    expect(encodeSave({ state: a, savedAtMs: 123, remainderMs: 10 })).toEqual(encodeSave({ state: b, savedAtMs: 123, remainderMs: 10 }));
  });
});
describe('save validation', () => {
  const good = (): Record<string, unknown> => JSON.parse(makeSave(referenceRun(4, 20 * 600), 1000)) as Record<string, unknown>;
  const reject = (mutate: (save: Record<string, any>) => void): void => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const save = good(); mutate(save); expect(() => decodeSave(save)).toThrow();
  };
  it('accepts the canonical encoding and rejects bad data', () => {
    expect(() => decodeSave(good())).not.toThrow();
    reject(save => { save.format = 'taskbar-legends-save-v3'; });
    reject(save => { save.wallet.gold = -1; });
    reject(save => { save.state.gold = 5; });
    reject(save => { save.inventory[1].id = save.inventory[0].id; });
    reject(save => { save.inventory[0].id = 7; });
    reject(save => { delete save.inventory[0].tradeable; });
    reject(save => { save.inventory[0].templateId = 'gear.weapon.mythic'; });
    reject(save => { save.inventory[0].acquiredAt.source = 'market'; });
    expect(() => decodeSave({ format: 'taskbar-legends-save-v1', savedAtMs: 0, remainderMs: 0, state: { version: 1 } })).toThrow();
  });
});

describe('SaveStore', () => {
  async function roundTrip(store: SaveStore): Promise<void> {
    expect(await store.load()).toBeNull();
    const state = referenceRun(9, 600);
    await store.save({ state, savedAtMs: 42, remainderMs: 10 });
    expect(await store.load()).toEqual({ state, savedAtMs: 42, remainderMs: 10 });
    await store.clear();
    expect(await store.load()).toBeNull();
  }
  it('memory and key-value implementations are interchangeable', async () => {
    await roundTrip(memorySaveStore());
    const map = new Map<string, string>();
    await roundTrip(new TextSaveStore({ getItem: key => map.get(key) ?? null, setItem: (key, value) => { map.set(key, value); }, removeItem: key => { map.delete(key); } }, 'k'));
  });
  it('surfaces an invalid stored save as an error instead of an empty slot', async () => {
    const store = new TextSaveStore({ getItem: () => '{"format":"nope"}', setItem: () => undefined, removeItem: () => undefined }, 'k');
    await expect(store.load()).rejects.toThrow();
  });
  it('quarantines corrupt raw data across reloads, blocks autosave, and allows explicit discard then restore', async () => {
    const map = new Map<string, string>([['k', '{"format":"broken-save","owned":"keep me"}']]);
    const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
    const first = new TextSaveStore(storage, 'k');
    await expect(first.load()).rejects.toThrow();
    const raw = '{"format":"broken-save","owned":"keep me"}';
    expect(first.failedRaw()).toBe(raw);
    expect(map.get('k')).toBe(raw);
    await expect(first.save({ state: referenceRun(3, 0), savedAtMs: 1, remainderMs: 0 })).rejects.toThrow(/quarantined/);

    const afterReload = new TextSaveStore(storage, 'k');
    await expect(afterReload.load()).rejects.toThrow(/quarantined/);
    expect(afterReload.failedRaw()).toBe(raw); // UI export source survives reload.
    await expect(afterReload.save({ state: referenceRun(3, 0), savedAtMs: 2, remainderMs: 0 })).rejects.toThrow(/quarantined/);

    await afterReload.discardFailed();
    const state = referenceRun(7, 600);
    await afterReload.save({ state, savedAtMs: 3, remainderMs: 0 });
    expect(await afterReload.load()).toEqual({ state, savedAtMs: 3, remainderMs: 0 });
  });
  it('keeps the primary raw save and blocks writes when writing the quarantine copy fails', async () => {
    const raw = '{not json'; let primary = raw;
    const storage = { getItem: (key: string) => key === 'k' ? primary : null, setItem: () => { throw new Error('quota'); }, removeItem: () => { primary = ''; } };
    const store = new TextSaveStore(storage, 'k');
    await expect(store.load()).rejects.toThrow('quota');
    expect(store.failedRaw()).toBe(raw);
    await expect(store.save({ state: referenceRun(3, 0), savedAtMs: 1, remainderMs: 0 })).rejects.toThrow(/quarantined/);
    expect(primary).toBe(raw);
  });
  it('exports preserved primary bytes after a transient storage read failure', async () => {
    const raw = '{"format":"corrupt-but-preserved"}'; let failRead = true;
    const storage = {
      getItem: (key: string) => { if (key === 'k' && failRead) { failRead = false; throw new Error('temporary read failure'); } return key === 'k' ? raw : null; },
      setItem: () => undefined, removeItem: () => undefined,
    };
    const store = new TextSaveStore(storage, 'k');
    await expect(store.load()).rejects.toThrow('temporary read failure');
    expect(store.failedRaw()).toBe(raw);
    await expect(store.save({ state: referenceRun(3, 0), savedAtMs: 1, remainderMs: 0 })).rejects.toThrow(/quarantined/);
  });
  it('retries a valid primary after transient read failure and resumes normal writes only after successful decode', async () => {
    const state = referenceRun(12, 600), raw = makeSave(state, Date.now()); let failRead = true;
    const map = new Map<string, string>([['k', raw]]);
    const storage = {
      getItem: (key: string) => { if (key === 'k' && failRead) { failRead = false; throw new Error('temporary read failure'); } return map.get(key) ?? null; },
      setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); },
    };
    const store = new TextSaveStore(storage, 'k');
    await expect(store.load()).rejects.toThrow('temporary read failure');
    await expect(store.save({ state, savedAtMs: 10, remainderMs: 0 })).rejects.toThrow(/quarantined/);
    const recovered = await store.load();
    expect(recovered?.state.roster).toEqual(state.roster);
    expect(recovered?.state.gold).toBe(state.gold);
    await store.save({ state: recovered!.state, savedAtMs: 20, remainderMs: 0 });
    expect(JSON.parse(map.get('k') ?? 'null').format).toBe('taskbar-legends-save-v2');
  });
});
