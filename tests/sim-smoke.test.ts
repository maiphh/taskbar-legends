import { describe, expect, it } from 'vitest';
import { setV14Rules, ticksForSeconds } from '../src/config';
import { createState, step } from '../src/core/game';

describe('v1.4 rules sim smoke', () => {
  it('seed 1 clears stages and records gear drops in one hour', () => {
    setV14Rules(['chestChoice', 'farmChest', 'recruitPity', 'gearFortune', 'expeditionChests', 'offlineTickets']);
    const state = createState(1);
    let maxPresenting = 0;
    for (let tick = 0; tick < ticksForSeconds(3600); tick += 1) {
      step(state, 1);
      const presenting = [...state.party, ...state.enemies].filter(unit => unit.hp > 0
        && (unit.action?.state === 'windup' || unit.action?.state === 'recovery' || !!unit.specialAction)).length;
      maxPresenting = Math.max(maxPresenting, presenting);
    }
    expect(state.eventCounts.clear ?? 0).toBeGreaterThan(0);
    expect(state.metrics.firstClearTicks['1']).toBeDefined();
    expect(state.eventCounts.gear ?? 0).toBeGreaterThan(0);
    expect(maxPresenting).toBeLessThanOrEqual(1);
  });
});
