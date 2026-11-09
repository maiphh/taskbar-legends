import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { beginEncounter } from '../src/core/combat';
import { autoEquip, chest } from '../src/core/economy';
import { createState, step } from '../src/core/game';
import type { GameState } from '../src/core/model';
import { decodeSave, encodeSave, migrateV1 } from '../src/core/save';

/** A v1-format copy (numeric item ids, no item provenance) of a current state, as balance-v1.2 wrote before save v2. */
function asV1(state: GameState) {
  const serial = (id: string): number => Number.parseInt(id.slice(-8), 16);
  return { format: 'taskbar-legends-save-v1', savedAtMs: 0, remainderMs: 0, state: { ...structuredClone(state), version: 1,
    inventory: state.inventory.map(item => ({ id: serial(item.id), slot: item.slot, rarity: item.rarity, dropStage: item.dropStage, level: item.level, spent: item.spent, stats: item.stats })),
    roster: state.roster.map(hero => ({ ...hero, equipment: Object.fromEntries(Object.entries(hero.equipment).map(([slot, id]) => [slot, id === null ? null : serial(id)])) })),
    events: state.events.map(event => event.data.type === 'gear' || event.data.type === 'upgrade' ? { ...event, data: { ...event.data, gearId: serial(event.data.gearId) } } : event) } };
}
const sameButProvenance = (a: GameState, b: GameState): void => {
  expect({ ...a, inventory: a.inventory.map(item => ({ ...item, acquiredAt: null })) }).toEqual({ ...b, inventory: b.inventory.map(item => ({ ...item, acquiredAt: null })) });
};
function tempoFarmer(): GameState {
  // Same construction as farm-tempo.test.ts: a cleared non-boss repeat after a failed push, with gear equipped.
  const state = createState(7); state.highestCleared = 1;
  state.progress = { kind: 'FARMING', stage: 1, failedStage: 2, retryAtTick: 1e9, failTick: 0, failedPower: 1e9, failures: 1 };
  for (const hero of state.roster) hero.level = CONFIG.growth.levelCap;
  for (let index = 0; index < 4; index += 1) chest(state, 1);
  autoEquip(state); beginEncounter(state);
  for (let tick = 0; tick < 20_000; tick += 1) {
    step(state);
    if (state.farmClock && state.metrics.nativeFarmClearSeconds?.length && state.phase.kind === 'farmPad') return state;
  }
  throw new Error('no tempo farming state reached');
}
describe('save v2 with farm tempo fields', () => {
  const state = tempoFarmer();
  it('round-trips failTick, farmClock, the farmPad phase and native clear samples through v2', () => {
    const decoded = decodeSave(JSON.parse(JSON.stringify(encodeSave({ state, savedAtMs: 5, remainderMs: 0 })))).state;
    expect(decoded).toEqual(state);
    expect(decoded.progress).toMatchObject({ kind: 'FARMING', failTick: expect.any(Number) as number });
    expect(decoded.farmClock).toEqual(state.farmClock); expect(decoded.phase.kind).toBe('farmPad');
  });
  it('keeps them when migrating a balance-v1.2 v1 save', () => {
    sameButProvenance(migrateV1(asV1(state)).state, state);
  });
  it('migrates v1 saves written before these fields existed', () => {
    const old = asV1(state);
    const legacy = old.state as Record<string, unknown> & { progress: Record<string, unknown>; metrics: Record<string, unknown>; phase: { kind: string } };
    delete legacy.progress.failTick; delete legacy.farmClock; delete legacy.metrics.nativeFarmClearSeconds;
    legacy.phase = { kind: 'battle' };
    for (const unit of [...(legacy.party as Record<string, unknown>[]), ...(legacy.enemies as Record<string, unknown>[])]) delete unit.nativeBornTick;
    const migrated = migrateV1(old).state;
    expect(migrated.progress.kind === 'FARMING' && migrated.progress.failTick).toBeUndefined();
    expect(migrated.farmClock).toBeUndefined();
    expect(() => decodeSave(encodeSave({ state: migrated, savedAtMs: 0, remainderMs: 0 }))).not.toThrow();
  });
  it('zod still rejects an impossible failTick from the future', () => {
    const bad = JSON.parse(JSON.stringify(encodeSave({ state, savedAtMs: 0, remainderMs: 0 }))) as { state: { progress: { failTick: number }; tick: number } };
    bad.state.progress.failTick = bad.state.tick + 1;
    expect(() => decodeSave(bad)).toThrow();
  });
});
