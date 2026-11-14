import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createPartyState } from '../src/core/game';
import { gearTemplateId, itemId } from '../src/core/model';
import type { Gear } from '../src/core/model';
import { ManagementAuthority } from '../src/management/authority';

const request = (revision: number, requestId: string, action: unknown, clientId = 'view-a') => ({ clientId, requestId, expectedRevision: revision, action });
function sampleGear(seed: number): Gear {
  return { id: itemId(seed, 1), templateId: gearTemplateId('weapon', 'common'), tradeable: false, acquiredAt: { tick: 0, source: 'starter' },
    slot: 'weapon', rarity: 'common', dropStage: 1, level: 0, spent: 0, stats: { hp: 0, atk: 3, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 } };
}
describe('management authority', () => {
  it('deduplicates identical requests and rejects request-id payload collisions', () => {
    const state = createPartyState(31); state.tickets = 3;
    const authority = new ManagementAuthority(state), beforePulls = state.stats.pulls;
    const first = authority.execute(request(0, 'client-a:1', { type: 'pull' }));
    const replay = authority.execute(request(0, 'client-a:1', { type: 'pull' }));
    expect(first.accepted).toBe(true); expect(first).toEqual(replay); expect(first.snapshot.stats.pulls).toBe(beforePulls + 1);
    const collision = authority.execute(request(0, 'client-a:1', { type: 'autoParty' }));
    expect(collision).toMatchObject({ accepted: false, revision: 1, reason: expect.stringContaining('different action') });
    expect(authority.getState().stats.pulls).toBe(beforePulls + 1);
  });
  it('rejects stale revisions without mutation while simulation ticks do not stale a current view', () => {
    const state = createPartyState(32); state.tickets = 3;
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
    const state = createPartyState(33); state.tickets = CONFIG.gacha.costTickets * 9;
    const authority = new ManagementAuthority(state), before = JSON.stringify(state);
    const result = authority.executeManyPulls({ clientId: 'a', requestId: 'a:1', expectedRevision: 0, count: 10 });
    expect(result.accepted).toBe(false);
    expect(JSON.stringify(authority.getState())).toBe(before);
    expect(authority.executeManyPulls({ clientId: 'a', requestId: 'a:1', expectedRevision: 0, count: 10 })).toEqual(result);
  });
  it('validates current ownership and funds and commits real equip/upgrade changes', () => {
    const state = createPartyState(34), gear = sampleGear(state.seed); state.inventory.push(gear); state.nextGearId = 2; state.gold = 100_000;
    const authority = new ManagementAuthority(state);
    const equipped = authority.execute(request(0, 'a:1', { type: 'equip', heroId: 'mw2', gearId: gear.id }));
    expect(equipped.accepted).toBe(true); expect(authority.getState().roster.find(hero => hero.id === 'mw2')?.equipment.weapon).toBe(gear.id);
    const upgraded = authority.execute(request(1, 'a:2', { type: 'upgrade', gearId: gear.id }));
    expect(upgraded.accepted).toBe(true); expect(authority.getState().inventory[0]?.level).toBe(1);
    const before = JSON.stringify(authority.getState());
    const invalidOwner = authority.execute(request(2, 'a:3', { type: 'equip', heroId: 'not-owned', gearId: gear.id }));
    expect(invalidOwner.accepted).toBe(false); expect(JSON.stringify(authority.getState())).toBe(before);
  });
  it('rejects malformed actions and clones snapshots so views cannot mutate the authority', () => {
    const authority = new ManagementAuthority(createPartyState(35));
    expect(authority.snapshot().lockMax).toBe(CONFIG.gear.salvage.lockMax);
    const baseline = JSON.stringify(authority.getState());
    expect(authority.execute(request(0, 'a:1', { type: 'unknown' }))).toMatchObject({ accepted: false, requestId: 'a:1', revision: 0 });
    const snapshot = authority.snapshot(); snapshot.partyIds[0] = 'forged'; snapshot.gold = 1e9;
    expect(JSON.stringify(authority.getState())).toBe(baseline);
    expect(authority.snapshot().partyIds).not.toContain('forged');
  });
  it('increments management revision for pause, accepted commands, and account replacement but not elapsed ticks', () => {
    const state = createPartyState(36), authority = new ManagementAuthority(state);
    expect(authority.snapshot().revision).toBe(0);
    state.tick += 1; expect(authority.snapshot().revision).toBe(0);
    authority.setPaused(true); expect(authority.snapshot().revision).toBe(1);
    authority.replaceState(createPartyState(37)); expect(authority.snapshot().revision).toBe(2);
  });
  it('keeps the main runtime owner synchronized through management commits and later combat ticks', () => {
    const initial = createPartyState(38), gear = sampleGear(initial.seed); initial.inventory.push(gear); initial.nextGearId = 2;
    let mainOwner = initial;
    const authority = new ManagementAuthority(initial, false, next => { mainOwner = next; });
    expect(authority.execute(request(0, 'owner:1', { type: 'equip', heroId: 'mw2', gearId: gear.id })).accepted).toBe(true);
    expect(mainOwner.roster.find(hero => hero.id === 'mw2')?.equipment.weapon).toBe(gear.id);
    mainOwner.tick += 25;
    expect(authority.snapshot().tick).toBe(mainOwner.tick);
    authority.replaceState(createPartyState(39));
    expect(mainOwner.seed).toBe(39);
  });
  it('validates and commits preset locks through the management authority', () => {
    const state = createPartyState(40), authority = new ManagementAuthority(state);
    const locked = authority.execute(request(0, 'locks:1', { type: 'lockHero', heroId: 'priest', locked: true }));
    expect(locked.accepted).toBe(true); expect(locked.snapshot.roster.find(hero => hero.id === 'priest')?.partyLocked).toBe(true);
    expect(authority.execute(request(1, 'locks:2', { type: 'lockHero', heroId: 'missing', locked: true })).accepted).toBe(false);
    expect(authority.execute(request(1, 'locks:3', { type: 'lockHero', heroId: 'priest', locked: true })).accepted).toBe(false);
  });
});
