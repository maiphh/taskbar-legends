import { describe, expect, it } from 'vitest';
import { CONFIG, raritySchema } from '../src/config';
import type { OfflineRewardsTokens, RarityTokens } from '../src/config';
import { grantXp } from '../src/core/economy';
import { createState, step } from '../src/core/game';
import type { GameState } from '../src/core/model';
import { applyOffline, decodeSave, makeSave } from '../src/core/save';

const HOUR = 3_600_000, CAP = CONFIG.idle.offlineCapHours * 3600;
const offlineEvent = (state: GameState) => {
  const data = state.events.at(-1)?.data;
  if (data?.type !== 'offline') throw new Error('expected offline event last');
  return data;
};
function farmer(): GameState { const state = createState(9); step(state, 4000); return state; }

describe('offline rawSeconds', () => {
  it('equals the applied seconds under the cap', () => {
    const state = farmer(), result = applyOffline(state, 2.5 * HOUR);
    expect(result).toMatchObject({ seconds: 9000, rawSeconds: 9000, capped: false });
    expect(offlineEvent(state)).toMatchObject({ seconds: 9000, rawSeconds: 9000 });
  });
  it('keeps the uncapped time away while applied seconds stay at the cap', () => {
    const state = farmer(), result = applyOffline(state, 12 * HOUR + 40 * 60_000);
    expect(result).toMatchObject({ seconds: CAP, rawSeconds: 45_600, capped: true });
    expect(offlineEvent(state)).toMatchObject({ seconds: CAP, rawSeconds: 45_600 });
  });
  it('is deterministic and never negative', () => {
    const a = farmer(), b = farmer();
    expect(applyOffline(a, 20 * HOUR)).toEqual(applyOffline(b, 20 * HOUR));
    expect(a).toEqual(b);
    expect(applyOffline(farmer(), -5000)).toMatchObject({ seconds: 0, rawSeconds: 0 });
  });
});

describe('levelBefore / levelAfter', () => {
  it('lists every party hero in the offline summary with its level before and after', () => {
    const state = farmer(), before = state.partyIds.map(id => state.roster.find(hero => hero.id === id)?.level);
    const result = applyOffline(state, 8 * HOUR);
    expect(result.heroes.map(hero => hero.id)).toEqual(state.partyIds);
    expect(result.heroes.map(hero => hero.levelBefore)).toEqual(before);
    expect(result.heroes.map(hero => hero.levelAfter)).toEqual(state.partyIds.map(id => state.roster.find(hero => hero.id === id)?.level));
    expect(result.heroes.some(hero => hero.levelAfter > hero.levelBefore)).toBe(true);
    expect(offlineEvent(state).heroes).toEqual(result.heroes);
  });
  it('reports unchanged levels when nothing was farmed', () => {
    const state = farmer(), result = applyOffline(state, 1000);
    expect(result.xp).toBe(0);
    expect(result.heroes.every(hero => hero.levelBefore === hero.levelAfter)).toBe(true);
  });
  it('level-up summary on xp events: levels lists only heroes that levelled; omitted otherwise', () => {
    const state = createState(2), [first] = state.partyIds;
    if (!first) throw new Error('party');
    const small = grantXp(state, 1, state.partyIds);
    expect(small.every(change => change.levelBefore === change.levelAfter)).toBe(true);
    const quiet = state.events.at(-1)?.data;
    expect(quiet?.type === 'xp' && 'levels' in quiet).toBe(false);
    const big = grantXp(state, 10_000, [first]);
    expect(big).toEqual([{ id: first, levelBefore: 1, levelAfter: state.roster.find(hero => hero.id === first)?.level }]);
    expect(big[0]?.levelAfter).toBeGreaterThan(1);
    expect(state.events.at(-1)?.data).toMatchObject({ type: 'xp', levels: big });
  });
});

describe('older event logs still load', () => {
  it('fills rawSeconds = seconds and heroes = [] on offline events saved before these fields', () => {
    const state = farmer(); applyOffline(state, 12 * HOUR);
    const save = JSON.parse(makeSave(state, 1)) as { state: { events: { data: Record<string, unknown> }[] } };
    for (const event of save.state.events) if (event.data.type === 'offline') { delete event.data.rawSeconds; delete event.data.heroes; }
    const loaded = offlineEvent(decodeSave(save).state);
    expect(loaded).toMatchObject({ seconds: CAP, rawSeconds: CAP, heroes: [] });
  });
});

describe('M3 ui-tokens', () => {
  it('compile as types and agree with the game config', () => {
    const rarity: RarityTokens = CONFIG.ui.rarity, offline: OfflineRewardsTokens = CONFIG.ui.offlineRewards;
    expect(rarity.order).toEqual(raritySchema.options);
    expect(offline.capHours).toBe(CONFIG.idle.offlineCapHours);
    expect(Object.keys(CONFIG.ui.badges)).toEqual(expect.arrayContaining(['new', 'duplicateStar', 'duplicateGold', 'pity']));
  });
});
