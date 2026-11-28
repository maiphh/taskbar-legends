import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createState } from '../src/core/game';
import { gearTemplateId, itemId } from '../src/core/model';
import type { Gear } from '../src/core/model';
import { ManagementAuthority } from '../src/management/authority';

const request = (revision: number, requestId: string, action: unknown, clientId = 'view-a') => ({ clientId, requestId, expectedRevision: revision, action });
function sampleGear(state: ReturnType<typeof createState>): Gear {
  const serial = state.nextGearId++;
  return { id: itemId(state.seed, serial), templateId: gearTemplateId('weapon', 'common'), tradeable: false, acquiredAt: { tick: 0, source: 'starter' },
    slot: 'weapon', rarity: 'common', dropStage: 1, level: 0, spent: 0, stats: { hp: 0, atk: 3, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 } };
}
describe('management authority', () => {
  it('deduplicates identical requests and rejects request-id payload collisions', () => {
    const state = createState(31); state.tickets = 3;
    const authority = new ManagementAuthority(state), beforePulls = state.stats.pulls;
    const first = authority.execute(request(0, 'client-a:1', { type: 'pull' }));
    const replay = authority.execute(request(0, 'client-a:1', { type: 'pull' }));
    expect(first.accepted).toBe(true); expect(first).toEqual(replay); expect(first.snapshot.stats.pulls).toBe(beforePulls + 1);
    const collision = authority.execute(request(0, 'client-a:1', { type: 'autoParty' }));
    expect(collision).toMatchObject({ accepted: false, revision: 1, reason: expect.stringContaining('different action') });
    expect(authority.getState().stats.pulls).toBe(beforePulls + 1);
  });
  it('starts a ready boss only through one explicit retry command and replays it idempotently', () => {
    const state = createState(311);
    state.highestCleared = 9;
    state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
    const authority = new ManagementAuthority(state), beforeRetryEvents = state.events.filter(event => event.data.type === 'retry').length;
    const first = authority.execute(request(0, 'boss:1', { type: 'retry' }));
    const replay = authority.execute(request(0, 'boss:1', { type: 'retry' }));
    expect(first.accepted).toBe(true); expect(replay).toEqual(first);
    expect(authority.getState().progress).toMatchObject({ kind: 'BOSS_FIGHT', stage: 10 });
    expect(authority.getState().stats.retries).toBe(1);
    expect(authority.getState().events.filter(event => event.data.type === 'retry')).toHaveLength(beforeRetryEvents + 1);
    expect(authority.getState().events.filter(event => event.data.type === 'spawn' && event.data.side === 'enemy').length).toBeGreaterThan(0);
    expect(authority.execute(request(1, 'boss:2', { type: 'retry' })).accepted).toBe(false);
  });
  it('snapshots and invalid retry requests never start a boss', () => {
    const authority = new ManagementAuthority(createState(312));
    for (let i = 0; i < 10; i += 1) authority.snapshot();
    expect(authority.execute(request(0, 'no-boss:1', { type: 'retry' })).accepted).toBe(false);
    expect(authority.getState().progress.kind).toBe('PUSHING');
    expect(authority.getState().events.some(event => event.data.type === 'retry')).toBe(false);
  });
  it('rejects stale revisions without mutation while simulation ticks do not stale a current view', () => {
    const state = createState(32); state.tickets = 3;
    const authority = new ManagementAuthority(state);
    const tick = state.tick; state.tick += 1000;
    const accepted = authority.execute(request(0, 'a:1', { type: 'pull' }));
    expect(accepted.accepted).toBe(true);
    const unchanged = JSON.stringify(authority.getState());
    expect(authority.execute(request(0, 'a:2', { type: 'autoParty' })).accepted).toBe(false);
    expect(JSON.stringify(authority.getState())).toBe(unchanged);
    expect(authority.getState().tick).toBe(tick + 1000);
  });
  it('atomically rejects insufficient x10 funds and repeated insufficient requests grant nothing', () => {
    const state = createState(33); state.tickets = CONFIG.gacha.costTickets * 9;
    const authority = new ManagementAuthority(state), before = JSON.stringify(state);
    const result = authority.executeManyPulls({ clientId: 'a', requestId: 'a:1', expectedRevision: 0, count: 10 });
    expect(result.accepted).toBe(false);
    expect(JSON.stringify(authority.getState())).toBe(before);
    expect(authority.executeManyPulls({ clientId: 'a', requestId: 'a:1', expectedRevision: 0, count: 10 })).toEqual(result);
  });
  it('validates current ownership and funds and commits real equip/upgrade changes', () => {
    const state = createState(34), gear = sampleGear(state); state.inventory.push(gear); state.gold = 100_000;
    const authority = new ManagementAuthority(state);
    const equipped = authority.execute(request(0, 'a:1', { type: 'equip', heroId: 'mw2', gearId: gear.id }));
    expect(equipped.accepted).toBe(true); expect(authority.getState().roster.find(hero => hero.id === 'mw2')?.equipment.weapon).toBe(gear.id);
    const upgraded = authority.execute(request(1, 'a:2', { type: 'upgrade', gearId: gear.id }));
    expect(upgraded.accepted).toBe(true); expect(authority.getState().inventory.find(item => item.id === gear.id)?.level).toBe(1);
    const before = JSON.stringify(authority.getState());
    const invalidOwner = authority.execute(request(2, 'a:3', { type: 'equip', heroId: 'not-owned', gearId: gear.id }));
    expect(invalidOwner.accepted).toBe(false); expect(JSON.stringify(authority.getState())).toBe(before);
  });
  it('rejects malformed actions and clones snapshots so views cannot mutate the authority', () => {
    const authority = new ManagementAuthority(createState(35));
    expect(authority.snapshot().lockMax).toBe(CONFIG.gear.salvage.lockMax);
    const baseline = JSON.stringify(authority.getState());
    expect(authority.execute(request(0, 'a:1', { type: 'unknown' }))).toMatchObject({ accepted: false, requestId: 'a:1', revision: 0 });
    const snapshot = authority.snapshot(); snapshot.partyIds[0] = 'forged'; snapshot.gold = 1e9;
    expect(JSON.stringify(authority.getState())).toBe(baseline);
    expect(authority.snapshot().partyIds).not.toContain('forged');
  });
  it('increments management revision for pause, accepted commands, and account replacement but not elapsed ticks', () => {
    const state = createState(36), authority = new ManagementAuthority(state);
    expect(authority.snapshot().revision).toBe(0);
    state.tick += 1; expect(authority.snapshot().revision).toBe(0);
    authority.setPaused(true); expect(authority.snapshot().revision).toBe(1);
    authority.replaceState(createState(37)); expect(authority.snapshot().revision).toBe(2);
  });
  it('keeps the main runtime owner synchronized through management commits and later combat ticks', () => {
    const initial = createState(38), gear = sampleGear(initial); initial.inventory.push(gear);
    let mainOwner = initial;
    const authority = new ManagementAuthority(initial, false, next => { mainOwner = next; });
    expect(authority.execute(request(0, 'owner:1', { type: 'equip', heroId: 'mw2', gearId: gear.id })).accepted).toBe(true);
    expect(mainOwner.roster.find(hero => hero.id === 'mw2')?.equipment.weapon).toBe(gear.id);
    mainOwner.tick += 25;
    expect(authority.snapshot().tick).toBe(mainOwner.tick);
    authority.replaceState(createState(39));
    expect(mainOwner.seed).toBe(39);
  });
  it('validates and commits preset locks through the management authority', () => {
    const state = createState(40), authority = new ManagementAuthority(state);
    const locked = authority.execute(request(0, 'locks:1', { type: 'lockHero', heroId: 'priest', locked: true }));
    expect(locked.accepted).toBe(true); expect(locked.snapshot.roster.find(hero => hero.id === 'priest')?.partyLocked).toBe(true);
    expect(authority.execute(request(1, 'locks:2', { type: 'lockHero', heroId: 'missing', locked: true })).accepted).toBe(false);
    expect(authority.execute(request(1, 'locks:3', { type: 'lockHero', heroId: 'priest', locked: true })).accepted).toBe(false);
  });
});

it('requires the exact wearer for removal and salvages a free unlocked item once', () => {
  const state = createState(71);
  const item = sampleGear(state);
  item.spent = 100;
  const protectedItem = sampleGear(state);
  protectedItem.locked = true;
  state.inventory.push(protectedItem);
  const hero = state.roster[0]!;
  state.inventory.push(item);
  hero.equipment.weapon = item.id;
  const authority = new ManagementAuthority(state);
  const salvage = { type: 'salvage', gearId: item.id };
  expect(authority.execute(request(0, 'worn', salvage)).accepted).toBe(false);
  expect(authority.execute(request(0, 'other', { type: 'unequip', heroId: state.roster[1]!.id, gearId: item.id })).accepted).toBe(false);
  const removed = authority.execute(request(0, 'remove', { type: 'unequip', heroId: hero.id, gearId: item.id }));
  expect(removed.snapshot.roster[0]!.equipment.weapon).toBeNull();
  expect(removed.snapshot.inventory).toContainEqual(item);
  expect(authority.execute(request(1, 'protected', { ...salvage, gearId: protectedItem.id })).accepted).toBe(false);
  expect(authority.execute(request(0, 'stale', salvage)).accepted).toBe(false);
  const sold = authority.execute(request(1, 'confirm', salvage));
  expect(sold.accepted).toBe(true);
  expect(sold.snapshot.inventory.some(value => value.id === item.id)).toBe(false);
  const gold = Math.round(item.spent * CONFIG.runtime.salvageSpentPct + CONFIG.runtime.salvageBase * CONFIG.gear.rarityMult[item.rarity]);
  expect(sold.snapshot.gold).toBe(state.gold + gold);
  expect(authority.execute(request(1, 'confirm', salvage))).toEqual(sold);
});
