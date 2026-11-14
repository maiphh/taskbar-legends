import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createState, step } from '../src/core/game';
import { itemId, itemNamespace } from '../src/core/model';
import type { GameState } from '../src/core/model';
import { referencePolicy } from '../src/core/policy';
import { decodeSave, encodeSave, makeSave, migrateV1, restoreSave } from '../src/core/save';
import { memorySaveStore, TextSaveStore } from '../src/core/save-store';
import type { SaveStore } from '../src/core/save-store';

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
interface V1Fixture { state: { tick: number; gold: number; tickets: number; highestCleared: number; seed: number; inventory: { id: number }[];
  roster: { id: string; level: number; equipment: Record<string, number | null> }[]; stats: unknown; progress: unknown; eventSeq: number } }
const v1 = (name: string): V1Fixture => fixture(name) as V1Fixture;
function referenceRun(seed: number, ticks: number): GameState {
  const state = createState(seed), cursor = { revision: -1 };
  for (let tick = 0; tick < ticks; tick += 1) { referencePolicy(state, cursor); step(state); }
  return state;
}

describe('save v1 -> v2 migration', () => {
  it('keeps all progress and gives existing items deterministic ids with source migration', () => {
    const old = v1('save-v1-geared.json'), { state } = migrateV1(old);
    expect(state.version).toBe(2);
    expect({ tick: state.tick, gold: state.gold, tickets: state.tickets, highest: state.highestCleared, stats: state.stats, progress: state.progress, seq: state.eventSeq })
      .toEqual({ tick: old.state.tick, gold: old.state.gold, tickets: old.state.tickets, highest: old.state.highestCleared, stats: old.state.stats, progress: old.state.progress, seq: old.state.eventSeq });
    expect(state.inventory.map(item => item.id)).toEqual(old.state.inventory.map(item => itemId(old.state.seed, item.id)));
    for (const item of state.inventory) {
      expect(item).toMatchObject({ tradeable: false, acquiredAt: { tick: old.state.tick, source: 'migration' }, templateId: `gear.${item.slot}.${item.rarity}` });
    }
    const equipped = old.state.roster.flatMap(hero => Object.values(hero.equipment)).filter(id => id !== null).length;
    expect(equipped).toBeGreaterThan(0);
    old.state.roster.forEach((hero, index) => {
      for (const [slot, id] of Object.entries(hero.equipment)) expect(state.roster[index]?.equipment[slot as 'weapon']).toBe(id === null ? null : itemId(old.state.seed, id));
      expect(state.roster[index]?.level).toBe(hero.level);
    });
    expect(migrateV1(fixture('save-v1-geared.json'))).toEqual(migrateV1(fixture('save-v1-geared.json')));
  });
  it('matches what v2 itself produces for the same seed and inputs (ids line up; only provenance differs)', () => {
    // Rebuild a v1-format save from a run under the current balance, so this holds across balance passes.
    const fresh = referenceRun(11, 20 * 3600 * 2);
    const serial = (id: string): number => Number.parseInt(id.slice(-8), 16);
    const v1State = { ...structuredClone(fresh), version: 1,
      inventory: fresh.inventory.map(item => ({ id: serial(item.id), slot: item.slot, rarity: item.rarity, dropStage: item.dropStage, level: item.level, spent: item.spent, stats: item.stats })),
      roster: fresh.roster.map(hero => ({ ...hero, equipment: Object.fromEntries(Object.entries(hero.equipment).map(([slot, id]) => [slot, id === null ? null : serial(id)])) })),
      events: fresh.events.map(event => event.data.type === 'gear' || event.data.type === 'upgrade' ? { ...event, data: { ...event.data, gearId: serial(event.data.gearId) } } : event) };
    expect(fresh.inventory.length).toBeGreaterThan(10);
    const migrated = migrateV1({ format: 'taskbar-legends-save-v1', savedAtMs: 0, remainderMs: 0, state: v1State }).state;
    const withoutProvenance = (items: GameState['inventory']) => items.map(item => ({ ...item, acquiredAt: null }));
    expect(withoutProvenance(migrated.inventory)).toEqual(withoutProvenance(fresh.inventory));
    expect(migrated.roster).toEqual(fresh.roster);
    expect(migrated.events).toEqual(fresh.events);
    expect({ ...migrated, inventory: [] }).toEqual({ ...fresh, inventory: [] });
  });
  it('loads v1 fixtures saved under an earlier balance version and restamps them to the current one', () => {
    expect((fixture('save-v1-geared.json') as { state: { balance: string } }).state.balance).toBe('1.1.0');
    expect(migrateV1(fixture('save-v1-geared.json')).state.balance).toBe(CONFIG.version);
  });
  it('loads a fresh v1 save through restoreSave, and resaves as v2 with wallet and inventory split out', () => {
    const raw = JSON.stringify(fixture('save-v1-fresh.json'));
    const restored = restoreSave(raw, 1_700_000_000_000);
    expect(restored.state.tick).toBe(200);
    const v2 = encodeSave({ state: restored.state, savedAtMs: 1, remainderMs: 0 });
    expect(v2.format).toBe('taskbar-legends-save-v2');
    expect(v2.wallet).toEqual({ gold: restored.state.gold, tickets: restored.state.tickets });
    expect(Object.keys(v2.state)).not.toContain('gold');
    expect(Object.keys(v2.state)).not.toContain('inventory');
    expect(decodeSave(JSON.parse(JSON.stringify(v2))).state).toEqual(restored.state);
  });
});

describe('stable item ids', () => {
  const run = referenceRun(4, 20 * 3600 * 2);
  it('are identical across runs with the same seed and inputs', () => {
    expect(run.inventory.length).toBeGreaterThan(10);
    expect(referenceRun(4, 20 * 3600 * 2).inventory).toEqual(run.inventory);
  });
  it('are unique, ordered by acquisition, and namespaced by seed', () => {
    const ids = run.inventory.map(item => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
    expect(ids.every(id => id.startsWith(`itm_${itemNamespace(4)}_`))).toBe(true);
    const other = referenceRun(5, 20 * 3600).inventory.map(item => item.id);
    expect(other.some(id => ids.includes(id))).toBe(false);
    expect(new Set([1, 2, 3, 4, 5, 0xffffffff].map(itemNamespace)).size).toBe(6);
  });
  it('record drop provenance and default to untradeable', () => {
    for (const item of run.inventory) expect(item).toMatchObject({ tradeable: false, acquiredAt: { source: 'drop' } });
    expect(run.inventory.every(item => item.acquiredAt.tick <= run.tick)).toBe(true);
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
