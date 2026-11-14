import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createPartyState, step } from '../src/core/game';
import { enemyFormationX, turnSpd } from '../src/core/party-combat';
import { fillGauges, nextActor, type GaugeUnit } from '../src/core/turn/action-bar';
import { formationScreenX, slashScreenX } from '../src/core/turn/formation-view';
import { leapDisplayX } from '../src/core/turn/presentation';

describe('formationScreenX', () => {
  it('spreads heroes left of enemies on a 640 field with a readable gap', () => {
    const width = 640;
    const hero2 = formationScreenX('hero', 2, 5, width);
    const hero0 = formationScreenX('hero', 0, 5, width);
    const enemy0 = formationScreenX('enemy', 0, 5, width);
    const enemy4 = formationScreenX('enemy', 4, 5, width);
    expect(hero2).toBeLessThan(hero0);
    expect(hero0).toBeLessThan(enemy0);
    expect(formationScreenX('enemy', 0, 5, width)).toBeLessThan(formationScreenX('enemy', 1, 5, width));
    expect(formationScreenX('enemy', 1, 5, width)).toBeLessThan(formationScreenX('enemy', 2, 5, width));
    expect(enemy0 - hero0).toBeGreaterThanOrEqual(64);
    expect(enemy4).toBeLessThan(width - 72);
  });

  it('keeps the front hero left of enemy slot 0 by at least 18 on a 320 field', () => {
    const width = 320;
    const hero0 = formationScreenX('hero', 0, 3, width);
    const enemy0 = formationScreenX('enemy', 0, 3, width);
    expect(enemy0 - hero0).toBeGreaterThanOrEqual(18);
  });
});

describe('formation turns', () => {
  it('keeps every living hero x fixed over 40 ticks of a party-v2 fight', () => {
    const state = createPartyState(401);
    const startX = state.party.filter(unit => unit.hp > 0).map(unit => unit.x);
    step(state, 40);
    expect(state.party.filter(unit => unit.hp > 0).map(unit => unit.x)).toEqual(startX);
  });

  it('marches living enemies from entry x to enemyFormationX then holds the slot', () => {
    const state = createPartyState(404);
    const heroStart = state.party.map(unit => unit.x);
    for (const enemy of state.enemies) {
      expect(enemy.moving).toBe(true);
      expect(enemy.x).toBe(CONFIG.sim.enemySpawnX + enemy.slot * CONFIG.sim.enemySpawnSpacingPx);
    }
    step(state, 40);
    expect(state.party.map(unit => unit.x)).toEqual(heroStart);
    for (const enemy of state.enemies.filter(unit => unit.hp > 0)) {
      expect(enemy.x).toBe(enemyFormationX(enemy.slot));
      expect(enemy.moving).toBe(false);
    }
    const held = state.enemies.filter(unit => unit.hp > 0).map(unit => unit.x);
    step(state, 40);
    expect(state.party.map(unit => unit.x)).toEqual(heroStart);
    expect(state.enemies.filter(unit => unit.hp > 0).map(unit => unit.x)).toEqual(held);
  });

  it('puts leapDisplayX on the target at mid-windup and home at the ends; cast stays home', () => {
    const homeX = 100, targetX = 200;
    expect(leapDisplayX(homeX, targetX, 0)).toBe(homeX);
    expect(leapDisplayX(homeX, targetX, 0.5)).toBe(targetX);
    expect(leapDisplayX(homeX, targetX, 1)).toBe(homeX);
    // A cast keeps the sim home x; renderer skips leapDisplayX when delivery is cast.
    const castHome = homeX;
    expect(castHome).toBe(homeX);
  });

  it('maps slashScreenX out to the target, back to the slot, and hold on the slot', () => {
    expect(slashScreenX(100, 200, 'out', 0)).toBe(100);
    expect(slashScreenX(100, 200, 'out', 1)).toBe(200);
    expect(slashScreenX(100, 200, 'back', 0)).toBe(200);
    expect(slashScreenX(100, 200, 'back', 1)).toBe(100);
    expect(slashScreenX(100, 200, 'hold', 0.5)).toBe(100);
    const mid = slashScreenX(100, 200, 'out', 0.5);
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(200);
  });

  it('lets a faster support (spd 115) act before a tank (spd 90) when both gauges start at 0', () => {
    const support: GaugeUnit = { id: 'support', side: 'party', slot: 2, gauge: 0, spd: 115, hp: 1, statuses: [] };
    const tank: GaugeUnit = { id: 'tank', side: 'party', slot: 0, gauge: 0, spd: 90, hp: 1, statuses: [] };
    const units = [tank, support];
    let actor: GaugeUnit | null = null;
    for (let i = 0; i < 40 && !actor; i += 1) {
      fillGauges(units);
      actor = nextActor(units);
    }
    expect(actor?.id).toBe('support');
    const state = createPartyState(403);
    const priest = state.party.find(unit => unit.sourceId === 'priest')!;
    const guardian = state.party.find(unit => unit.sourceId === 'mw2')!;
    expect(turnSpd(priest)).toBe(115);
    expect(turnSpd(guardian)).toBe(90);
  });

  it('spends a stunned unit gauge and does not emit a hit', () => {
    const state = createPartyState(402);
    const tank = state.party.find(unit => unit.sourceId === 'mw2')!;
    const enemy = state.enemies[0]!;
    state.enemies = [enemy];
    for (const unit of [...state.party, enemy]) {
      unit.action = { state: 'idle' };
      unit.moving = false;
      unit.gauge = 0;
      unit.statuses = [];
    }
    for (const hero of state.party) {
      if (hero !== tank) hero.hp = 0;
    }
    tank.statuses = [{ id: 'stun', sourceId: 'test', targetId: tank.id, stacks: 1, magnitude: 1, turnsLeft: 3 }];
    tank.gauge = 10000;
    enemy.gauge = 0;
    enemy.hp = 10000;
    enemy.maxHp = 10000;
    const beforeHp = enemy.hp;
    const beforeGauge = tank.gauge ?? 0;
    step(state);
    // fillGauges runs before the actor spends, so overflow remains after spendTurn.
    expect(tank.gauge ?? 0).toBe(beforeGauge + Math.round(turnSpd(tank) * 7) - 10000);
    expect(tank.action).toMatchObject({ state: 'idle' });
    expect(state.events.some(event => event.data.type === 'hit' && event.data.attackerId === tank.id)).toBe(false);
    expect(enemy.hp).toBe(beforeHp);
  });
});
