import { describe, expect, it } from 'vitest';
import { setV14Rules, ticksForSeconds } from '../src/config';
import { createState, step } from '../src/core/game';

describe('v1.4 rules sim smoke', () => {
  it('seed 1 clears stages and records gear drops in one hour', () => {
    setV14Rules(['chestChoice', 'farmChest', 'recruitPity', 'gearFortune', 'expeditionChests', 'offlineTickets']);
    const state = createState(1);
    step(state, ticksForSeconds(3600));
    expect(state.eventCounts.clear ?? 0).toBeGreaterThan(0);
    expect(state.eventCounts.gear ?? 0).toBeGreaterThan(0);
  });
});
