import { describe, expect, it } from 'vitest';
import { CONFIG, ticksForSeconds } from '../src/config';
import { autoEquip, chest, upgrade } from '../src/core/economy';
import { createState, step } from '../src/core/game';
import type { GameState } from '../src/core/model';
import { referencePolicy } from '../src/core/policy';
import { affordability, betterUnequippedGear, stageCue, upgradeDelta, upgradePopups } from '../src/core/selectors';

function geared(): GameState {
  const state = createState(3);
  for (let index = 0; index < 6; index += 1) chest(state, 1);
  autoEquip(state); state.gold = 0; state.tickets = 0;
  return state;
}
function runUntil(state: GameState, done: (state: GameState) => boolean, limit = ticksForSeconds(4 * 3600)): void {
  const cursor = { revision: -1 };
  for (let tick = 0; tick < limit && !done(state); tick += 1) { referencePolicy(state, cursor); step(state); }
  if (!done(state)) throw new Error('condition not reached');
}

describe('affordability selector', () => {
  it('flags nothing when broke, and each button when its action becomes possible', () => {
    const state = geared();
    expect(betterUnequippedGear(state)).toBeUndefined();
    expect(affordability(state)).toEqual({ heroes: false, gear: false, recruit: false, boss: false });
    state.gold = 1_000_000;
    expect(affordability(state)).toMatchObject({ heroes: true, gear: true });
    state.tickets = CONFIG.gacha.costTickets;
    expect(affordability(state).recruit).toBe(true);
  });
  it('flags Gear for a better unequipped drop even without gold', () => {
    const state = createState(3); state.gold = 0; chest(state, 1);
    expect(betterUnequippedGear(state)).toBeDefined();
    expect(affordability(state)).toMatchObject({ gear: true, heroes: false });
  });
  it('is pure', () => {
    const state = geared(); state.gold = 1_000_000; const before = structuredClone(state);
    affordability(state); upgradeDelta(state, state.inventory[0]?.id ?? 1, 1); stageCue(state); upgradePopups(state);
    expect(state).toEqual(before);
  });
});

describe('upgrade feedback', () => {
  it('reports the equipped hero stat gain from the logged upgrade event, then expires', () => {
    const state = geared(); state.gold = 1_000_000;
    const weapon = state.inventory.find(item => item.slot === 'weapon' && state.roster.some(hero => hero.equipment.weapon === item.id));
    if (!weapon) throw new Error('no equipped weapon');
    upgrade(state, weapon.id);
    expect(state.events.at(-1)?.data).toMatchObject({ type: 'upgrade', gearId: weapon.id, level: 1 });
    const [popup] = upgradePopups(state);
    expect(popup?.delta.atk).toBeGreaterThan(0);
    expect(popup?.delta.label).toMatch(/^\+\d+ ATK/);
    expect(popup?.delta.heroId).toBe(state.roster.find(hero => hero.equipment.weapon === weapon.id)?.id);
    step(state, ticksForSeconds(CONFIG.view.upgradePopupSeconds));
    expect(upgradePopups(state)).toEqual([]);
  });
  it('falls back to a level label for unequipped gear', () => {
    const state = createState(3); chest(state, 1); state.gold = 1_000_000;
    const item = state.inventory[0]; if (!item) throw new Error('no item');
    upgrade(state, item.id);
    expect(upgradeDelta(state, item.id, 1)).toMatchObject({ heroId: null, label: '+1 LV (now +1)' });
  });
});

describe('stage cues', () => {
  it('shows a clear banner on a first clear for stageCueSeconds', () => {
    const state = createState(1);
    runUntil(state, s => s.highestCleared >= 1);
    expect(stageCue(state)).toMatchObject({ kind: 'clear', stage: 1 });
    step(state, ticksForSeconds(CONFIG.view.stageCueSeconds));
    expect(stageCue(state)?.kind === 'clear' && stageCue(state)?.stage === 1).toBe(false);
  });
  it('announces boss ready when the boss gate opens, and Boss is flagged until it is attempted', () => {
    const state = createState(1);
    runUntil(state, s => s.progress.kind === 'BOSS_READY');
    const cue = stageCue(state);
    expect(cue).toMatchObject({ kind: 'boss', clearedStage: state.highestCleared });
    expect(affordability(state).boss).toBe(true);
  });
});
