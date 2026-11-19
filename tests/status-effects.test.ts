import { describe, expect, it } from 'vitest';
import { CONFIG, statusEffectsEnabled } from '../src/config';
import { createState, load, snapshot, step } from '../src/core/game';
import { beginEncounter, spawnParty } from '../src/core/combat';
import { applyPartyShield, partyCombatTick } from '../src/core/party-combat';
import { effectiveAttack, effectiveDefense, effectiveDamageReduction } from '../src/core/party-effects';
import {
  addUnitStatus, beginStatusTurn, cleanseUnit, clearUnitStatuses, endStatusTurn, isStatusBoss, unitHasStatus,
} from '../src/core/status-effects';
import {
  STATUS_CATALOG, applyStatus, cleanseOne, turnEndStatuses, turnStartPhases, type RunningStatus,
} from '../src/core/turn/statuses';
import { compareStatusDisplay } from '../src/core/status-icons';
import type { Unit } from '../src/core/model';

function hold(unit: Unit): void {
  unit.action = { state: 'idle' };
  unit.moving = false;
  unit.gauge = 0;
  unit.statuses = [{ id: 'petrification', sourceId: 'hold', targetId: unit.id, stacks: 1, magnitude: 1, turnsLeft: 9999 }];
  unit.cooldown = Number.MAX_SAFE_INTEGER;
}

describe('statusEffects config', () => {
  it('enables the own-turn status system at 1.5.0', () => {
    expect(CONFIG.version).toBe('1.5.0');
    expect(statusEffectsEnabled()).toBe(true);
    expect(CONFIG.statusEffects?.effects.dot).toMatchObject({ maxStacks: 3, bossScale: 0.5, magnitude: 0.04 });
    expect(CONFIG.statusEffects?.apply.enemies.boss_ch1?.[0]).toMatchObject({
      on: 'boss-ch1-cleave', status: 'defDown', display: 'crushed', magnitude: 0.2,
    });
  });
});

describe('status stacking and turn phases', () => {
  it('refreshes strongest, stacks bleed to 3, and skips selfApplied at turn end', () => {
    let list: RunningStatus[] = [];
    list = applyStatus(list, { id: 'atkUp', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.15 });
    list = applyStatus(list, { id: 'atkUp', sourceId: 'b', targetId: 't', turns: 2, magnitude: 0.1 });
    expect(list[0]).toMatchObject({ magnitude: 0.15, turnsLeft: 2, sourceId: 'a' });

    list = applyStatus([], { id: 'dot', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.04, selfApplied: false });
    list = applyStatus(list, { id: 'dot', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.04 });
    list = applyStatus(list, { id: 'dot', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.04 });
    list = applyStatus(list, { id: 'dot', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.04 });
    expect(list[0]?.stacks).toBe(3);

    const selfBuff: RunningStatus[] = [
      { id: 'hot', sourceId: 't', targetId: 't', stacks: 1, magnitude: 0.05, turnsLeft: 2, selfApplied: true },
      { id: 'atkUp', sourceId: 'a', targetId: 't', stacks: 1, magnitude: 0.15, turnsLeft: 2 },
    ];
    const ended = turnEndStatuses(selfBuff, 't');
    expect(ended.find(s => s.id === 'hot')).toMatchObject({ turnsLeft: 2, selfApplied: false });
    expect(ended.find(s => s.id === 'atkUp')).toMatchObject({ turnsLeft: 1 });
  });

  it('consumes stun into Steadfast and gives bosses 3 turns', () => {
    const normal = turnStartPhases({
      id: 'h', hp: 100, maxHp: 100, boss: false,
      statuses: [{ id: 'stun', sourceId: 'e', targetId: 'h', stacks: 1, magnitude: 0, turnsLeft: 1 }],
    });
    expect(normal.mayAct).toBe(false);
    expect(normal.stunEnded).toBe(true);
    expect(normal.unit.statuses.find(s => s.id === 'steadfast')).toMatchObject({ turnsLeft: 2, selfApplied: true });

    const boss = turnStartPhases({
      id: 'b', hp: 100, maxHp: 100, boss: true,
      statuses: [{ id: 'stun', sourceId: 'e', targetId: 'b', stacks: 1, magnitude: 0, turnsLeft: 1 }],
    }, { steadfastTurns: 3 });
    expect(boss.unit.statuses.find(s => s.id === 'steadfast')).toMatchObject({ turnsLeft: 3 });
  });

  it('scales boss bleed by 0.5 and cleanses in Stun > Bleed > Slow > Armor Break > ATK Down order', () => {
    const boss = turnStartPhases({
      id: 'boss', hp: 1000, maxHp: 1000, boss: true,
      statuses: [{ id: 'dot', sourceId: 'h', targetId: 'boss', stacks: 3, magnitude: 0.04, turnsLeft: 2 }],
    }, { bossScale: 0.5 });
    expect(boss.events[0]).toMatchObject({ type: 'dot', amount: Math.round(1000 * 0.04 * 3 * 0.5) });

    const order = CONFIG.statusEffects!.cleanse['priest-burst-heal']!.order;
    const mixed: RunningStatus[] = [
      { id: 'atkDown', sourceId: 'a', targetId: 't', stacks: 1, magnitude: 0.2, turnsLeft: 2, appliedAtTick: 10 },
      { id: 'dot', sourceId: 'a', targetId: 't', stacks: 2, magnitude: 0.04, turnsLeft: 2, appliedAtTick: 5 },
      { id: 'stun', sourceId: 'a', targetId: 't', stacks: 1, magnitude: 0, turnsLeft: 1, appliedAtTick: 1 },
      { id: 'spdDown', sourceId: 'a', targetId: 't', stacks: 1, magnitude: 0.3, turnsLeft: 2, appliedAtTick: 8 },
      { id: 'defDown', sourceId: 'a', targetId: 't', stacks: 1, magnitude: 0.25, turnsLeft: 2, appliedAtTick: 9 },
    ];
    const first = cleanseOne(mixed, 't', order);
    expect(first.removed?.id).toBe('stun');
    const second = cleanseOne(first.statuses, 't', order);
    expect(second.removed?.id).toBe('dot');
  });
});

describe('combat status wiring', () => {
  it('applies banner ATK Up, cleave bleed, and priest cleanse+Guard on own turns', () => {
    const state = createState(15100);
    state.roster.push({ id: 'mk1', level: 1, xp: 0, stars: 1, equipment: { weapon: null, armor: null, charm: null } });
    state.partyIds = ['mk1', 'mw1', 'priest'];
    spawnParty(state);
    const banner = state.party.find(u => u.sourceId === 'mk1')!;
    const melee = state.party.find(u => u.sourceId === 'mw1')!;
    const priest = state.party.find(u => u.sourceId === 'priest')!;
    const enemy = state.enemies[0]!;
    state.party.forEach(hold); state.enemies.forEach(hold);
    banner.statuses = []; melee.statuses = []; priest.statuses = []; enemy.statuses = [];
    enemy.hp = enemy.maxHp = 100_000; enemy.def = 0;

    banner.mana = 60; banner.gauge = 0; banner.action = {
      state: 'windup', kind: 'heal', targetId: melee.id, startTick: 0, impactTick: 5, abilityId: 'banner-buff', delivery: 'cast',
    };
    for (let i = 0; i < 5; i += 1) { state.tick += 1; partyCombatTick(state); }
    expect(unitHasStatus(melee, 'atkUp')).toBe(true);
    expect(effectiveAttack(state, melee)).toBeCloseTo(melee.atk * 1.15);

    melee.mana = 60; melee.statuses = []; melee.action = {
      state: 'windup', kind: 'attack', targetId: enemy.id, startTick: state.tick, impactTick: state.tick + 1,
      abilityId: 'cleave', delivery: 'leap',
    };
    step(state);
    expect(enemy.statuses?.find(s => s.id === 'dot')).toMatchObject({ stacks: 1, turnsLeft: 2, magnitude: 0.04 });

    enemy.statuses = [
      { id: 'stun', sourceId: melee.id, targetId: enemy.id, stacks: 1, magnitude: 0, turnsLeft: 1, appliedAtTick: 1 },
      { id: 'atkDown', sourceId: melee.id, targetId: enemy.id, stacks: 1, magnitude: 0.2, turnsLeft: 2, appliedAtTick: 2 },
    ];
    // Priest cleanse is for allies; apply directly then Guard.
    priest.statuses = [];
    cleanseUnit(state, priest, enemy, 'priest-burst-heal', state.tick);
    expect(enemy.statuses?.some(s => s.id === 'stun')).toBe(false);
    expect(enemy.statuses?.some(s => s.id === 'atkDown')).toBe(true);

    addUnitStatus(state, priest, priest, 'dmgReduction', 1, 0.1, state.tick);
    expect(effectiveDamageReduction(state, priest)).toBeCloseTo(0.1);
  });

  it('applies Crushed from boss cleave and Steadfast after a boss stun ends', () => {
    const state = createState(15101);
    state.highestCleared = 9;
    state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
    state.partyIds = ['mw2', 'mw1', 'priest'];
    spawnParty(state);
    // Force a boss wave by stepping into the boss stage.
    for (const hero of state.roster) { hero.level = 10; hero.stars = 2; }
    state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
    // Directly spawn stage 10.
    state.progress = { kind: 'PUSHING', stage: 10 };
    beginEncounter(state);
    const boss = state.enemies.find(u => u.sourceId === 'boss_ch1');
    expect(boss).toBeTruthy();
    expect(isStatusBoss(boss!)).toBe(true);
    const tank = state.party[0]!;
    state.party.forEach(hold); state.enemies.forEach(hold);
    boss!.statuses = []; tank.statuses = [];
    boss!.specialAction = {
      state: 'areaImpact', targetId: tank.id, centerX: tank.x, radius: 56,
      startTick: state.tick, impactTick: state.tick, abilityId: 'boss-ch1-cleave',
    };
    boss!.action = { state: 'recovery', kind: 'attack', targetId: tank.id, startTick: state.tick, impactTick: state.tick, readyTick: state.tick + 10, abilityId: 'boss-ch1-cleave', delivery: 'cast' };
    step(state);
    expect(tank.statuses?.find(s => s.id === 'defDown')).toMatchObject({ magnitude: 0.2, display: 'crushed', turnsLeft: 2 });
    expect(effectiveDefense(state, tank)).toBeCloseTo(tank.def * 0.8);

    boss!.statuses = [{ id: 'stun', sourceId: tank.id, targetId: boss!.id, stacks: 1, magnitude: 0, turnsLeft: 1 }];
    boss!.gauge = 0;
    expect(beginStatusTurn(state, boss!, state.tick)).toBe(false);
    expect(boss!.statuses.find(s => s.id === 'steadfast')).toMatchObject({ turnsLeft: 3 });
  });

  it('lets a stunned unit spend gauge, skips the action, and ticks other statuses at turn end', () => {
    const state = createState(15102);
    spawnParty(state);
    const hero = state.party[0]!;
    const enemy = state.enemies[0]!;
    state.party.forEach(hold); state.enemies.forEach(hold);
    hero.statuses = [
      { id: 'stun', sourceId: enemy.id, targetId: hero.id, stacks: 1, magnitude: 0, turnsLeft: 1 },
      { id: 'atkUp', sourceId: hero.id, targetId: hero.id, stacks: 1, magnitude: 0.15, turnsLeft: 2 },
    ];
    hero.gauge = 10000;
    const before = hero.gauge;
    step(state);
    expect(hero.gauge).toBeLessThan(before);
    expect(hero.action?.state).toBe('idle');
    expect(hero.statuses.some(s => s.id === 'stun')).toBe(false);
    expect(hero.statuses.find(s => s.id === 'steadfast')).toBeTruthy();
    expect(hero.statuses.find(s => s.id === 'atkUp')?.turnsLeft).toBe(1);
  });

  it('routes bleed through shields first and round-trips statuses through save/load', () => {
    const state = createState(15103);
    spawnParty(state);
    const hero = state.party[0]!;
    state.party.forEach(hold); state.enemies.forEach(hold);
    hero.statuses = [];
    applyPartyShield(state, hero, hero, 40, 100, state.tick);
    hero.statuses = [{ id: 'dot', sourceId: 'e', targetId: hero.id, stacks: 1, magnitude: 0.1, turnsLeft: 2 }];
    const hpBefore = hero.hp;
    beginStatusTurn(state, hero, state.tick);
    expect(hero.shield).toBeLessThan(40);
    expect(hero.hp).toBe(hpBefore);
    expect(state.events.some(e => e.data.type === 'hit' && e.data.dot === true)).toBe(false); // fully absorbed
    expect(state.events.some(e => e.data.type === 'shieldAbsorb')).toBe(true);

    hero.statuses = [
      { id: 'atkUp', sourceId: hero.id, targetId: hero.id, stacks: 1, magnitude: 0.15, turnsLeft: 2, selfApplied: true, appliedAtTick: 3 },
    ];
    const restored = load(snapshot(state));
    expect(restored.party[0]?.statuses?.[0]).toMatchObject({ id: 'atkUp', turnsLeft: 2, selfApplied: true });
  });

  it('lets a hero act when a shield eats a would-be-lethal bleed (no false stun skip)', () => {
    const state = createState(15106);
    spawnParty(state);
    const hero = state.party[0]!;
    state.party.forEach(hold); state.enemies.forEach(hold);
    hero.maxHp = 1000;
    hero.hp = 10;
    hero.statuses = [];
    applyPartyShield(state, hero, hero, 500, 100, state.tick);
    hero.statuses = [{ id: 'dot', sourceId: 'e', targetId: hero.id, stacks: 1, magnitude: 0.04, turnsLeft: 2 }];
    expect(beginStatusTurn(state, hero, state.tick)).toBe(true);
    expect(hero.hp).toBe(10);
    expect(hero.shield).toBe(460);
    expect(state.events.some(e => e.data.type === 'status' && e.data.kind === 'skip')).toBe(false);
    expect(state.events.some(e => e.data.type === 'shieldAbsorb')).toBe(true);
  });

  it('ticks boss statuses after a cleave resolves and after a missed windup', () => {
    const state = createState(15107);
    state.highestCleared = 9;
    state.progress = { kind: 'BOSS_FIGHT', stage: 10, failedPower: 0, bossLosses: 0 };
    beginEncounter(state);
    const boss = state.enemies.find(u => u.sourceId === 'boss_ch1')!;
    const tank = state.party[0]!;
    expect(boss).toBeTruthy();
    state.enemies = [boss];
    state.party.forEach(hold);
    boss.statuses = [
      { id: 'dot', sourceId: tank.id, targetId: boss.id, stacks: 1, magnitude: 0.04, turnsLeft: 2 },
      { id: 'atkDown', sourceId: tank.id, targetId: boss.id, stacks: 1, magnitude: 0.2, turnsLeft: 2 },
    ];
    boss.moving = false;
    boss.x = tank.x + 40;
    boss.procCounters = { basicSuccess: 4, bossPattern: 0 };
    boss.action = { state: 'idle' };
    boss.gauge = 10000;
    const hpBefore = boss.hp;
    step(state);
    expect(boss.specialAction).toMatchObject({ state: 'areaMark', abilityId: 'boss-ch1-cleave' });
    expect(boss.hp).toBeLessThan(hpBefore); // bleed ticked at turn start
    for (let i = 0; i < 200 && boss.specialAction; i += 1) {
      boss.gauge = 0;
      step(state);
    }
    expect(boss.specialAction).toBeUndefined();
    expect(boss.statuses.find(s => s.id === 'dot')?.turnsLeft).toBe(1);
    expect(boss.statuses.find(s => s.id === 'atkDown')?.turnsLeft).toBe(1);

    const missState = createState(15108);
    spawnParty(missState);
    const hero = missState.party[0]!;
    missState.party.slice(1).forEach(hold);
    missState.enemies.forEach(hold);
    hero.statuses = [
      { id: 'atkUp', sourceId: hero.id, targetId: hero.id, stacks: 1, magnitude: 0.15, turnsLeft: 2 },
    ];
    hero.moving = false;
    hero.gauge = 10000;
    step(missState);
    expect(hero.action?.state).toBe('windup');
    const windup = hero.action as Unit['action'] & { state: 'windup'; targetId: string; impactTick: number };
    expect(windup.state).toBe('windup');
    hero.action = { ...windup, targetId: 'missing-target' };
    for (let i = 0; i < 80 && hero.action?.state === 'windup'; i += 1) {
      hero.gauge = 0;
      step(missState);
      if (missState.tick > windup.impactTick + 2) break;
    }
    expect(hero.statuses.find(s => s.id === 'atkUp')?.turnsLeft).toBe(1);
  });

  it('clears statuses on wave start and sorts display with overflow', () => {
    const state = createState(15104);
    spawnParty(state);
    const hero = state.party[0]!;
    hero.statuses = [
      { id: 'atkUp', sourceId: hero.id, targetId: hero.id, stacks: 1, magnitude: 0.15, turnsLeft: 2, appliedAtTick: 1 },
      { id: 'dot', sourceId: 'e', targetId: hero.id, stacks: 2, magnitude: 0.04, turnsLeft: 2, appliedAtTick: 2 },
    ];
    clearUnitStatuses(state.party);
    expect(hero.statuses).toEqual([]);

    const sorted = [
      { id: 'atkUp', turnsLeft: 2, appliedAtTick: 5 },
      { id: 'stun', turnsLeft: 1, appliedAtTick: 1 },
      { id: 'dot', turnsLeft: 2, appliedAtTick: 2 },
      { id: 'defDown', turnsLeft: 1, appliedAtTick: 3 },
      { id: 'shield', turnsLeft: 99, appliedAtTick: 4 },
    ].sort(compareStatusDisplay);
    expect(sorted.map(s => s.id)).toEqual(['stun', 'dot', 'defDown', 'shield', 'atkUp']);
    expect(STATUS_CATALOG.steadfast.cleansable).toBe(false);
  });

  it('anti-lock: stunned boss gets Steadfast and resists the next stun', () => {
    const state = createState(15105);
    spawnParty(state);
    const boss = state.enemies[0]!;
    boss.boss = true;
    boss.sourceId = 'boss_ch1';
    boss.statuses = [];
    addUnitStatus(state, state.party[0]!, boss, 'stun', 1, 0, state.tick);
    expect(beginStatusTurn(state, boss, state.tick)).toBe(false);
    expect(unitHasStatus(boss, 'steadfast')).toBe(true);
    const resisted = addUnitStatus(state, state.party[0]!, boss, 'stun', 1, 0, state.tick + 1);
    expect(resisted).toBe(false);
    expect(state.events.some(e => e.data.type === 'status' && e.data.kind === 'resist')).toBe(true);
    endStatusTurn(state, boss, state.tick);
  });
});
