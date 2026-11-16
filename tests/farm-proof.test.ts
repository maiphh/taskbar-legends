import { describe, expect, it } from 'vitest';
import { CONFIG, ticksForSeconds } from '../src/config';
import { beginEncounter } from '../src/core/combat';
import { createState, input, load, snapshot, step } from '../src/core/game';
import { offlineFarmContext } from '../src/core/farm-proof';
import { getOwned } from '../src/core/economy';
import type { GameState } from '../src/core/model';
import { decodeSave, encodeSave, makeSave, offlineProjection } from '../src/core/save';
import { itemId } from '../src/core/model';

function progressedParty(seed = 1, level = 5): GameState {
  const state = createState(seed);
  for (const definition of CONFIG.heroes) {
    let hero = state.roster.find(value => value.id === definition.id);
    if (!hero) { hero = { id: definition.id, level, xp: 0, stars: 2, equipment: { weapon: null, armor: null, charm: null } }; state.roster.push(hero); }
    hero.level = level; hero.xp = 0; hero.stars = 2;
  }
  state.partyIds = ['hk1', 'wiz', 'priest'];
  state.progress = { kind: 'PUSHING', stage: 1 }; state.highestCleared = 0;
  beginEncounter(state);
  return state;
}
function until(state: GameState, condition: () => boolean, maxTicks = 20_000): void {
  for (let tick = 0; tick < maxTicks && !condition(); tick += 1) step(state);
  expect(condition()).toBe(true);
}

describe('formation-earned offline farm proofs', () => {
  it('records the actual starting party on a successful real push clear, not the changed selected team', () => {
    const state = progressedParty(41), started = structuredClone(state.encounterFarmContext);
    expect(started?.heroes).toEqual(state.party.map(unit => ({ id: unit.sourceId, maxHp: unit.maxHp, atk: unit.atk, def: unit.def, attackTicks: unit.attackTicks })));
    const pendingRoundtrip = load(snapshot(state)); expect(pendingRoundtrip.encounterFarmContext).toEqual(started);

    input(state, { type: 'party', heroIds: ['mw2', 'mw1', 'priest'] });
    expect(state.encounterFarmContext).toEqual(started);
    until(state, () => state.stats.clears === 1);
    const proof = state.farmProofs?.find(value => value.stage === 1);
    expect(proof?.heroes).toEqual(started?.heroes);
    expect(proof?.wallSeconds).toHaveLength(1); expect(state.encounterFarmContext).toBeUndefined();
    expect(offlineFarmContext(state)).toMatchObject({ stage: 1, earned: false, reason: 'formation-or-combat-changed' });

    input(state, { type: 'party', heroIds: ['hk1', 'wiz', 'priest'] });
    expect(offlineFarmContext(state).earned).toBe(true);
    getOwned(state, 'hk1').level += 1;
    expect(offlineFarmContext(state).earned).toBe(true); // Safe permanent growth retains the conservative measured rate.
    getOwned(state, 'hk1').level -= 2;
    expect(offlineFarmContext(state).earned).toBe(false); // Any component regression invalidates it.
    getOwned(state, 'hk1').level += 1;
    input(state, { type: 'party', heroIds: ['wiz', 'hk1', 'priest'] });
    expect(offlineFarmContext(state).earned).toBe(false); // Ordered formation is part of the proof.
  });

  it('does not certify a loss or an unsettled repeat pad, and appends only after farmPad settles', () => {
    const loss = progressedParty(42);
    for (const hero of loss.party) hero.hp = 0;
    step(loss);
    expect(loss.stats.losses).toBe(1); expect(loss.farmProofs).toBeUndefined(); expect(loss.encounterFarmContext).toBeUndefined();

    const state = progressedParty(43);
    until(state, () => state.stats.clears === 1);
    state.progress = { kind: 'FARMING', stage: 1, failedStage: 2, retryAtTick: state.tick + ticksForSeconds(1000), failedPower: state.attemptPower, failures: 1 };
    beginEncounter(state);
    until(state, () => state.phase.kind === 'farmPad');
    expect(state.stats.clears).toBe(1); expect(state.farmProofs?.[0]?.wallSeconds).toHaveLength(1);
    const pending = load(snapshot(state)); expect(pending.encounterFarmContext).toEqual(state.encounterFarmContext);
    step(state, Math.max(0, state.phase.kind === 'farmPad' ? state.phase.settleAtTick - state.tick - 1 : 0));
    expect(state.stats.clears).toBe(1); expect(state.farmProofs?.[0]?.wallSeconds).toHaveLength(1);
    step(state);
    expect(state.stats.clears).toBe(2); expect(state.farmProofs?.[0]?.wallSeconds).toHaveLength(2);
    expect(state.farmProofs?.[0]?.nativeSeconds).toHaveLength(2);
    expect(state.farmProofs?.[0]?.wallSeconds.at(-1)).toBe(state.metrics.farmClearSeconds.at(-1));
    expect(state.farmProofs?.[0]?.nativeSeconds.at(-1)).toBe(state.metrics.nativeFarmClearSeconds?.at(-1));
  });

  it('uses the highest compatible earned stage and rejects stale rule signatures or a weaker stat component', () => {
    const state = progressedParty(44);
    const heroes = state.encounterFarmContext!.heroes;
    state.highestCleared = 11; state.progress = { kind: 'PUSHING', stage: 12 };
    state.farmProofs = [
      { stage: 1, rulesSignature: state.encounterFarmContext!.rulesSignature, heroes: structuredClone(heroes), nativeSeconds: [30], wallSeconds: [40] },
      { stage: 9, rulesSignature: state.encounterFarmContext!.rulesSignature, heroes: structuredClone(heroes), nativeSeconds: [25], wallSeconds: [35] },
      { stage: 11, rulesSignature: 'old-combat-version', heroes: structuredClone(heroes), nativeSeconds: [10], wallSeconds: [20] },
    ];
    expect(offlineFarmContext(state)).toMatchObject({ stage: 9, nativeSeconds: 25, wallSeconds: 35, earned: true });
    getOwned(state, 'wiz').equipment.weapon = null;
    getOwned(state, 'wiz').level = 1;
    expect(offlineFarmContext(state).earned).toBe(false);
  });

  it('keeps proof metadata backward compatible and validates bounded proof records without trusting old metrics', () => {
    const old = createState(45); delete old.encounterFarmContext; old.metrics.farmClearSeconds = [1]; old.metrics.nativeFarmClearSeconds = [1];
    const oldCopy = decodeSave(JSON.parse(makeSave(old, 10_000))).state;
    expect(oldCopy.farmProofs).toBeUndefined();
    expect(offlineFarmContext(oldCopy)).toMatchObject({ stage: 1, nativeSeconds: CONFIG.idle.avgFarmClearSecDefault, earned: false });

    const state = progressedParty(46), context = state.encounterFarmContext!;
    state.highestCleared = 1; state.progress = { kind: 'PUSHING', stage: 2 };
    state.farmProofs = [{ stage: 1, rulesSignature: context.rulesSignature, heroes: structuredClone(context.heroes), nativeSeconds: [20], wallSeconds: [30] }];
    const copy = decodeSave(encodeSave({ state, savedAtMs: 0, remainderMs: 0 })).state;
    expect(copy.farmProofs).toEqual(state.farmProofs); expect(offlineProjection(copy).earned).toBe(true);
    const badStates = [
      { ...state, farmProofs: [state.farmProofs[0]!, { ...state.farmProofs[0]!, stage: 1 }] },
      { ...state, farmProofs: [{ ...state.farmProofs[0]!, heroes: state.farmProofs[0]!.heroes.map((hero, index) => index ? hero : { ...hero, id: 'unknown' }) }] },
      { ...state, farmProofs: [{ ...state.farmProofs[0]!, nativeSeconds: [0] }] },
      { ...state, farmProofs: [{ ...state.farmProofs[0]!, nativeSeconds: [20, 20], wallSeconds: [30] }] },
    ];
    for (const bad of badStates) expect(() => encodeSave({ state: bad, savedAtMs: 0, remainderMs: 0 })).toThrow();
  });

  it('ignores item identity and temporary combat state while requiring every permanent stat component', () => {
    const state = progressedParty(47), context = state.encounterFarmContext!;
    state.highestCleared = 1; state.progress = { kind: 'PUSHING', stage: 2 };
    state.farmProofs = [{ stage: 1, rulesSignature: context.rulesSignature, heroes: structuredClone(context.heroes), nativeSeconds: [20], wallSeconds: [25] }];
    const initial = offlineFarmContext(state); expect(initial.earned).toBe(true);
    state.party[0]!.hp = 1; state.party[0]!.mana = 0;
    expect(offlineFarmContext(state).earned).toBe(true);

    const hero = getOwned(state, 'priest'), oldId = hero.equipment.charm;
    if (!oldId) throw new Error('Expected the starter charm');
    const oldGear = state.inventory.find(item => item.id === oldId)!;
    const newId = itemId(state.seed, state.nextGearId++);
    state.inventory.push({ ...structuredClone(oldGear), id: newId }); hero.equipment.charm = newId;
    expect(offlineFarmContext(state).earned).toBe(true); // Same measured stats with a different item id.

    const base = state.farmProofs![0]!;
    for (const [field, delta] of [['maxHp', 1], ['atk', 1], ['def', 1], ['attackTicks', -1]] as const) {
      const altered = structuredClone(state);
      const stored = altered.farmProofs![0]!.heroes[0]!;
      stored[field] += delta;
      expect(offlineFarmContext(altered).earned, field).toBe(false);
    }
    expect(state.farmProofs?.[0]).toEqual(base);
  });
});
