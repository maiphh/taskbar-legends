// v1.4 offline (design.md §14.3, §18): CR-14-04 Expedition Chests, CR-14-05 offline tickets; plus designer answer 2/5 on Fortune units.
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, setV14Rules } from '../src/config';
import { chestRarity, fortuneRoll } from '../src/core/economy';
import { createState, load, snapshot, step } from '../src/core/game';
import type { GameState } from '../src/core/model';
import { applyOffline, makeSave, restoreSave } from '../src/core/save';

afterEach(() => { setV14Rules([]); });
const HOUR = 3_600_000;
function farmer(seed = 9): GameState { const state = createState(seed); step(state, 4000); return state; }
const lastOffline = (state: GameState) => { const data = state.events.at(-1)?.data; if (data?.type !== 'offline') throw new Error('offline event last'); return data; };

describe('CR-14-04 Expedition Chests', () => {
  it('1 h → 2 chests; 12 h equals 8 h → 16 (cap); the event and result carry expeditionChests', () => {
    setV14Rules(['expeditionChests']);
    expect(applyOffline(farmer(), 1 * HOUR)).toMatchObject({ chests: 2, expeditionChests: 2 });
    expect(applyOffline(farmer(), 30 * 60_000)).toMatchObject({ chests: 1 });
    const a = farmer(), b = farmer();
    expect(applyOffline(a, 12 * HOUR).chests).toBe(16); applyOffline(b, 8 * HOUR);
    expect(snapshot(a)).toBe(snapshot(b).replace(/"rawSeconds":28800/g, '"rawSeconds":43200'));
    expect(lastOffline(a)).toMatchObject({ chests: 16, expeditionChests: 16 });
  });
  it('best of 4 chest rolls: Legendary share 3.94% ± 0.2 over 1M (Rare+ 87%, Epic+ 34.4%)', { timeout: 60_000 }, () => {
    const rng = { rng: 12345 }, count = { common: 0, rare: 0, epic: 0, legendary: 0 }, n = 1_000_000;
    for (let i = 0; i < n; i += 1) count[chestRarity(rng, 4)] += 1;
    expect(Math.abs(count.legendary / n - 0.0394)).toBeLessThan(0.002);
    expect(Math.abs(1 - count.common / n - 0.87)).toBeLessThan(0.005);
    expect(Math.abs((count.epic + count.legendary) / n - 0.344)).toBeLessThan(0.005);
  });
  it('each Expedition Chest advances Fortune by 4 (rollUnits.expeditionChest); a normal chest stays 1', () => {
    setV14Rules(['expeditionChests', 'gearFortune']);
    const state = farmer(); state.gearLegendaryFound = true; state.gearSinceLegendary = 0;
    const before = state.inventory.length;
    applyOffline(state, 1 * HOUR);
    const legendary = state.inventory.slice(before).some(item => item.rarity === 'legendary');
    if (!legendary) expect(state.gearSinceLegendary).toBe(8);
    setV14Rules(['gearFortune']);
    const plain = farmer(); plain.gearLegendaryFound = true; plain.gearSinceLegendary = 0;
    applyOffline(plain, 4 * HOUR);
    expect(plain.gearSinceLegendary).toBe(2);
  });
  it('with pick-1-of-2 each Expedition Chest shows 2 items in the queue (≤ 3, oldest auto-resolved by score)', () => {
    setV14Rules(['expeditionChests', 'chestChoice']);
    const state = farmer(), kept = state.stats.chests, seq = state.eventSeq, queued = state.pendingChoice?.length ?? 0;
    applyOffline(state, 8 * HOUR);
    expect(state.stats.chests - kept).toBe(16);
    expect(state.pendingChoice?.length).toBe(CONFIG.runtime.chestChoiceQueueMax);
    expect(state.events.filter(event => event.seq > seq && event.data.type === 'chestChoice').length).toBe(16 + queued - CONFIG.runtime.chestChoiceQueueMax);
  });
  it('rule off: 1.3.0 offline chests (1 per 2 h, max 4) and no new event fields', () => {
    const state = farmer(), result = applyOffline(state, 12 * HOUR);
    expect(result.chests).toBe(4); expect(result).not.toHaveProperty('expeditionChests'); expect(lastOffline(state)).not.toHaveProperty('tickets');
  });
});

describe('Fortune units (designer answers 2 and 5)', () => {
  it('a 0-unit Legendary neither counts nor resets; a counted Legendary resets; Expedition counts 4', () => {
    setV14Rules(['gearFortune']);
    expect(fortuneRoll(37, true, 'legendary', 0)).toEqual({ rarity: 'legendary', since: 37, found: true, forced: false });
    expect(fortuneRoll(12, false, 'legendary', 0)).toEqual({ rarity: 'legendary', since: 12, found: false, forced: false });
    expect(fortuneRoll(37, true, 'legendary', 1)).toMatchObject({ since: 0, found: true });
    expect(fortuneRoll(96, true, 'rare', 4)).toMatchObject({ rarity: 'legendary', forced: true, since: 0 });
    expect(fortuneRoll(95, true, 'rare', 4)).toMatchObject({ rarity: 'rare', since: 99 });
  });
});

describe('CR-14-05 offline tickets', () => {
  const withChance = <T>(chance: number, run: () => T): T => { const old = CONFIG.rewards.farmTicketChance; CONFIG.rewards.farmTicketChance = chance; try { return run(); } finally { CONFIG.rewards.farmTicketChance = old; } };
  it('8 h at 20.6 s and 0.0042 → 2.93: grants 2, carries 0.93; the next absence adds the fraction', () => withChance(0.0042, () => {
    setV14Rules(['offlineTickets']);
    const state = farmer(); state.metrics.farmClearSeconds = [20.6]; const tickets = state.tickets;
    const result = applyOffline(state, 8 * HOUR);
    expect(result.tickets).toBe(2); expect(state.tickets).toBe(tickets + 2);
    expect(state.offlineTicketFrac).toBeCloseTo(28_800 / 20.6 * 0.0042 * 0.5 - 2, 9);
    expect(state.events.some(event => event.data.type === 'tickets' && event.data.amount === 2)).toBe(true);
    expect(lastOffline(state)).toMatchObject({ tickets: 2 });
    applyOffline(state, 8 * HOUR);
    expect(state.tickets).toBe(tickets + 5); expect(state.offlineTicketFrac).toBeCloseTo(2 * 28_800 / 20.6 * 0.0042 * 0.5 - 5, 9);
  }));
  it('emits no zero-amount tickets event and is deterministic', () => {
    setV14Rules(['offlineTickets']);
    const state = farmer(), seq = state.eventSeq;
    const result = applyOffline(state, 60_000);
    expect(result.tickets).toBe(0);
    expect(state.events.filter(event => event.seq > seq && event.data.type === 'tickets')).toHaveLength(0);
    expect(state.offlineTicketFrac).toBeGreaterThan(0); expect(state.offlineTicketFrac).toBeLessThan(1);
    const a = farmer(), b = farmer(); applyOffline(a, 5 * HOUR); applyOffline(b, 5 * HOUR); expect(snapshot(a)).toBe(snapshot(b));
  });
  it('offlineTicketFrac is optional, round-trips the save, and is rejected outside [0, 1)', () => {
    setV14Rules(['offlineTickets']);
    const state = farmer(); applyOffline(state, 3 * HOUR);
    const restored = restoreSave(makeSave(state, 1000), 1000).state;
    expect(restored.offlineTicketFrac).toBe(state.offlineTicketFrac);
    expect(load(snapshot(farmer())).offlineTicketFrac).toBeUndefined();
    for (const bad of [1, -0.1, 1.5]) expect(() => load(JSON.stringify({ ...JSON.parse(snapshot(state)), offlineTicketFrac: bad }))).toThrow();
  });
});
