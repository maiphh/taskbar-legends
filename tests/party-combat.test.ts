import { describe, expect, it } from 'vitest';
import { CONFIG, stageConfig } from '../src/config';
import { createPartyState, createState, load, snapshot, step } from '../src/core/game';
import { combatEventAge, edgeDistance, inEdgeReach, PARTY_V2, presentationCombatTime } from '../src/core/party-combat';
import { getPartyHeroDefinition } from '../src/core/party-definitions';
import { effectiveDamageReduction } from '../src/core/party-effects';
import { emit } from '../src/core/events';
import type { GameState, Unit } from '../src/core/model';

function partyState(): GameState {
  const state = createPartyState(91);
  for (const unit of state.party) unit.partyCooldowns = { [getPartyHeroDefinition(unit.sourceId).active.id]: Number.MAX_SAFE_INTEGER };
  return state;
}
function idle(unit: Unit): void { unit.action = { state: 'idle' }; unit.targetId = null; unit.moving = false; }
function currentAction(unit: Unit): Unit['action'] { return unit.action; }
function contactState(): { state: GameState; tank: Unit; melee: Unit; healer: Unit; enemy: Unit } {
  const state = partyState(), tank = state.party.find(unit => unit.sourceId === 'mw2')!, melee = state.party.find(unit => unit.sourceId === 'mw1')!;
  const healer = state.party.find(unit => unit.sourceId === 'priest')!, enemy = state.enemies[0]!;
  state.enemies = [enemy];
  tank.x = 100; melee.hp = 0; healer.hp = 0; enemy.x = 124; enemy.atk = 30; enemy.range = PARTY_V2.reach.melee;
  tank.speed = 0; enemy.speed = 0; idle(tank); idle(enemy);
  return { state, tank, melee, healer, enemy };
}
function impactDamage(attacker: Unit, defender: Unit): number { return Math.max(1, Math.round(attacker.atk * 100 / (100 + defender.def))); }

describe('party-v2 positioning and actions', () => {
  it('clears old-clock effects, shields, procs, and projectiles at a real farm-pad encounter reset', () => {
    const state = createPartyState(277), hero = state.party[0]!;
    state.progress = { kind: 'FARMING', stage: 1, failedStage: 2, retryAtTick: Number.MAX_SAFE_INTEGER, failTick: 0, failedPower: Number.MAX_SAFE_INTEGER, failures: 1 };
    state.highestCleared = 1;
    state.farmClock = { scale: 1, minCycleTicks: 1, elapsedTicks: 0, remainder: 0 };
    state.wave = stageConfig(state.progress.stage).waves.length;
    state.enemies.forEach(enemy => { enemy.hp = 0; });
    hero.shield = 40; hero.shieldUntilTick = 500; hero.shieldProviderId = hero.id;
    hero.procCounters = { basicSuccess: 3 }; hero.partyCooldowns = { 'expired-next-encounter': 500 };
    state.partyEffects = [{ id: 'old-buff', sourceId: hero.id, targetId: hero.id, group: 'old-buff', kind: 'atkBonus', magnitude: 0.3,
      appliedAtTick: 0, expiresAtTick: 500, stackPolicy: 'strongestRefresh' }];
    step(state);
    expect(state.phase.kind).toBe('farmPad');
    const pad = state.phase;
    if (pad.kind !== 'farmPad') return;
    state.projectiles = [{ id: 'old-flight', sourceId: hero.id, sourceSide: 'hero', targetId: 'old-target', targetSide: 'enemy', abilityId: 'old-shot', delivery: 'homing', x: 100, speed: 500, atk: 30, coefficient: 1,
      releasedAtTick: state.tick, impactNotBeforeTick: state.tick + 1, expiresAtTick: state.tick + 80 }];
    state.phase = { ...pad, settleAtTick: state.tick + 1 };
    const resumed = load(snapshot(state)), previousEncounter = state.encounter;
    step(resumed);
    expect(resumed.encounter).toBe(previousEncounter + 1);
    expect(resumed.partyEffects).toEqual([]);
    expect(resumed.projectiles).toEqual([]);
    expect(resumed.party.every(unit => unit.shield === 0 && unit.procCounters === undefined && unit.partyCooldowns?.['expired-next-encounter'] === undefined)).toBe(true);
  });
  it('keeps legacy state fields absent while party-v2 saves its explicit rules and initialized unit mechanics', () => {
    const legacy = createState(1), preview = partyState();
    expect(legacy.combatRules).toBeUndefined();
    expect(legacy.party[0]?.radius).toBeUndefined();
    expect(preview.combatRules).toBe('party-v2');
    expect(preview.partyIds).toEqual(['mw2', 'mw1', 'priest']);
    expect(preview.roster.map(hero => hero.id)).toEqual(expect.arrayContaining(['mw2', 'hu1', 'wiz', 'mw1', 'priest']));
    for (const unit of preview.party) expect(unit).toMatchObject({ action: { state: 'idle' }, targetId: null, moving: false });
    for (const unit of preview.enemies) expect(unit).toMatchObject({ action: { state: 'idle' }, targetId: null, moving: true });
    const restored = load(snapshot(preview));
    expect(restored).toEqual(preview);
    const invalid = structuredClone(preview); delete invalid.party[0]!.action;
    expect(() => load(invalid)).toThrow(/missing combat state/);
  });
  it('uses inclusive symmetric edge reach, including targets behind the attacker', () => {
    const tank = { x: 34, radius: 12 }, enemy = { x: 0, radius: 10 };
    expect(edgeDistance(tank, enemy)).toBe(12);
    expect(edgeDistance(enemy, tank)).toBe(12);
    expect(inEdgeReach(tank, enemy, 12)).toBe(true);
    expect(inEdgeReach({ ...tank, x: 34.001 }, enemy, 12)).toBe(false);
    expect(inEdgeReach(tank, { ...enemy, x: 200 }, 12)).toBe(false);
    expect(edgeDistance({ ...tank, x: 0 }, { ...enemy, x: 0 })).toBe(0);
  });

  it('starts windup without damage, hits at the impact tick, and commits enemy attacks against the living tank', () => {
    const { state, tank, enemy } = contactState(), tankHp = tank.hp, enemyHp = enemy.hp;
    tank.gauge = 10000; enemy.gauge = 0;
    step(state);
    expect(tank.action).toMatchObject({ state: 'windup', startTick: 1, impactTick: 1 + PARTY_V2.timing.windupTicks });
    expect(enemy.action).toMatchObject({ state: 'idle' });
    expect([tank.hp, enemy.hp]).toEqual([tankHp, enemyHp]);
    step(state, PARTY_V2.timing.windupTicks - 1);
    expect([tank.hp, enemy.hp]).toEqual([tankHp, enemyHp]);
    step(state);
    expect(enemy.hp).toBeLessThan(enemyHp);
    expect(tank.attacks).toBe(1);
    // Enemy acts on a later formation turn against the living tank.
    enemy.gauge = 10000; tank.action = { state: 'idle' };
    for (let i = 0; i < 20 && !state.events.some(event => event.data.type === 'hit' && event.data.attackerId === enemy.id); i += 1) step(state);
    expect(state.events.filter(event => event.data.type === 'hit' && event.data.attackerId === enemy.id && event.data.targetId === tank.id).length).toBeGreaterThanOrEqual(1);
    expect(tank.hp).toBeLessThan(tankHp);
  });

  it('cancels a windup when its target dies, without a remote hit', () => {
    const { state, tank, enemy } = contactState();
    const spare = { ...enemy, id: 'spare-enemy', hp: 1, maxHp: 1 };
    state.enemies = [enemy, spare];
    tank.gauge = 10000; enemy.gauge = 0; spare.gauge = 0;
    step(state);
    expect(tank.action?.state).toBe('windup');
    expect(tank.action).toMatchObject({ targetId: enemy.id });
    enemy.hp = 0;
    step(state, PARTY_V2.timing.windupTicks);
    expect(state.events.some(event => event.data.type === 'hit' && event.data.attackerId === tank.id)).toBe(false);
    expect(state.events.some(event => event.data.type === 'miss' && event.data.unitId === tank.id && event.data.reason === 'target')).toBe(true);
    expect(tank.attacks).toBe(0);
  });

  it('returns to idle after a cancelled swing and can start another formation turn', () => {
    const { state, tank, enemy } = contactState();
    const spare = { ...enemy, id: 'spare-enemy', hp: 1, maxHp: 1 };
    state.enemies = [enemy, spare];
    tank.gauge = 10000; enemy.gauge = 0; spare.gauge = 0;
    step(state);
    expect(tank.action).toMatchObject({ targetId: enemy.id });
    enemy.hp = 0;
    step(state, PARTY_V2.timing.windupTicks);
    expect(tank.action).toMatchObject({ state: 'recovery' });
    expect(tank.attacks).toBe(0);
    step(state, PARTY_V2.timing.minimumRecoveryTicks);
    expect(tank.action).toMatchObject({ state: 'idle' });
    spare.hp = spare.maxHp;
    tank.gauge = 10000;
    step(state);
    expect(state.events.filter(event => event.data.type === 'actionStart' && event.data.unitId === tank.id).length).toBeGreaterThanOrEqual(2);
  });

  it('lands a melee hit on a far archer from the formation slot without walking', () => {
    const state = partyState(), melee = state.party.find(unit => unit.sourceId === 'mw1')!, archer = state.enemies[0]!;
    state.enemies = [archer]; archer.sourceId = 'archer'; archer.x = 400; archer.range = PARTY_V2.reach.ranged; archer.atk = 5;
    archer.hp = 1000; archer.maxHp = 1000; archer.speed = PARTY_V2.speed.enemyRanged; idle(archer);
    for (const hero of state.party) if (hero !== melee) hero.hp = 0;
    const initialMeleeX = melee.x, archerX = archer.x;
    melee.gauge = 10000; archer.gauge = 0;
    let contact: { event: GameState['events'][number]; meleeX: number } | undefined;
    for (let tick = 0; tick < 120 && !contact; tick += 1) {
      step(state);
      const event = state.events.find(item => item.data.type === 'hit' && item.data.attackerId === melee.id && item.data.targetId === archer.id);
      if (event) contact = { event, meleeX: melee.x };
    }
    expect(melee.x).toBe(initialMeleeX);
    expect(contact).toBeDefined();
    expect(archer.x).toBe(archerX);
    expect(archer.hp).toBeLessThan(1000);
  });

  it('retargets an enemy from a dead tank to a living survivor', () => {
    const { state, tank, melee, healer, enemy } = contactState();
    tank.hp = 0; melee.hp = melee.maxHp; healer.hp = healer.maxHp; enemy.x = 120;
    enemy.targetId = tank.id; idle(enemy); enemy.gauge = 10000;
    for (const hero of state.party) if (hero.hp > 0) hero.gauge = 0;
    step(state);
    expect(enemy.targetId).toBe(melee.id);
    expect(enemy.action).toMatchObject({ state: 'windup', targetId: melee.id });
  });

  it('resolves mutually lethal committed impacts once with stable event order', () => {
    const makeTie = (): GameState => {
      const { state, tank, enemy } = contactState();
      tank.hp = impactDamage(enemy, tank); enemy.hp = impactDamage(tank, enemy);
      tank.targetId = enemy.id; tank.action = { state: 'windup', kind: 'attack', targetId: enemy.id, startTick: 0, impactTick: 1, delivery: 'leap' };
      enemy.targetId = tank.id; enemy.action = { state: 'windup', kind: 'attack', targetId: tank.id, startTick: 0, impactTick: 1, delivery: 'leap' };
      return state;
    };
    const a = makeTie(), b = makeTie(); b.party.reverse(); b.enemies.reverse();
    step(a); step(b);
    const deaths = (state: GameState) => state.events.filter(event => event.data.type === 'death').map(event => event.data.type === 'death' ? event.data.unitId : '').sort();
    expect(deaths(a)).toEqual([a.party[0]!.id, a.enemies[0]!.id].sort());
    expect(deaths(a)).toEqual(deaths(b));
    expect(a.events.filter(event => event.data.type === 'death')).toHaveLength(2);
    expect(b.events.filter(event => event.data.type === 'death')).toHaveLength(2);
  });

  it('allocates overkill and existing shields stably and reports only actual damage', () => {
    const { state, tank, melee, enemy } = contactState();
    melee.hp = melee.maxHp; melee.x = 90; enemy.x = 120; enemy.hp = 10; enemy.maxHp = 10;
    enemy.shield = 8; enemy.shieldUntilTick = 100; enemy.atk = 1;
    idle(melee); idle(tank); idle(enemy);
    tank.action = { state: 'windup', kind: 'attack', targetId: enemy.id, startTick: 0, impactTick: 1, delivery: 'leap', abilityId: 'guardian-strike' };
    melee.action = { state: 'windup', kind: 'attack', targetId: enemy.id, startTick: 0, impactTick: 1, delivery: 'leap', abilityId: 'melee-cleave-strike' };
    step(state);
    const hits = state.events.filter(event => event.data.type === 'hit' && event.data.targetId === enemy.id);
    expect(hits.reduce((sum, event) => sum + (event.data.type === 'hit' ? event.data.damage : 0), 0)).toBe(10);
    expect(state.events.filter(event => event.data.type === 'shieldAbsorb' && event.data.targetId === enemy.id).reduce((sum, event) => sum + (event.data.type === 'shieldAbsorb' ? event.data.amount : 0), 0)).toBe(8);
    expect(enemy.hp).toBe(0); expect(enemy.shield).toBe(0);
    expect(state.events.filter(event => event.data.type === 'death' && event.data.unitId === enemy.id)).toHaveLength(1);
    expect(tank.attacks).toBe(1); expect(melee.attacks).toBe(1);
  });

  it('heals a hurt ally at impact, never revives, and skips an unnecessary heal without full cadence', () => {
    const state = partyState(), tank = state.party.find(unit => unit.sourceId === 'mw2')!, healer = state.party.find(unit => unit.sourceId === 'priest')!;
    const enemy = state.enemies[0]!; enemy.sourceId = 'archer'; enemy.x = 1000; enemy.speed = 0; enemy.range = PARTY_V2.reach.ranged;
    state.enemies = [enemy];
    tank.x = 100; healer.x = 110; tank.hp = tank.maxHp - 50;
    healer.speed = 0; idle(tank); idle(healer); idle(enemy);
    for (const unit of state.party) unit.gauge = 0;
    healer.gauge = 10000; enemy.gauge = 0;
    const before = tank.hp;
    step(state); expect(healer.action?.state).toBe('windup'); expect(tank.hp).toBe(before);
    step(state, PARTY_V2.timing.windupTicks); expect(tank.hp).toBeGreaterThan(before);
    const healEvent = state.events.find(event => event.data.type === 'heal' && event.data.targetId === tank.id);
    expect(healEvent).toBeDefined();
    expect(effectiveDamageReduction(state, tank)).toBe(0);
    expect(healer.mana).toBe(20);

    healer.action = { state: 'idle' }; healer.targetId = null; tank.hp = tank.maxHp - 50; healer.gauge = 10000;
    step(state); expect(healer.action?.state).toBe('windup');
    tank.hp = tank.maxHp;
    step(state, PARTY_V2.timing.windupTicks);
    expect(state.events.some(event => event.data.type === 'miss' && event.data.unitId === healer.id && event.data.reason === 'unneeded')).toBe(true);
    const afterSkip = currentAction(healer);
    expect(afterSkip?.state).toBe('recovery');
    if (afterSkip?.state === 'recovery') expect(afterSkip.readyTick).toBe(afterSkip.impactTick + PARTY_V2.timing.minimumRecoveryTicks);
  });

  it('does not heal a dead ally; formation heals still reach a far living ally', () => {
    const deadState = partyState(), deadTank = deadState.party.find(unit => unit.sourceId === 'mw2')!;
    deadTank.hp = 0; step(deadState);
    expect(deadTank.hp).toBe(0);
    expect(deadState.events.some(event => event.data.type === 'actionStart' && event.data.kind === 'heal' && event.data.targetId === deadTank.id)).toBe(false);

    const farState = partyState(), farTank = farState.party.find(unit => unit.sourceId === 'mw2')!, farHealer = farState.party.find(unit => unit.sourceId === 'priest')!;
    farTank.x = 1000; farTank.hp = 1; farHealer.x = 50; farHealer.speed = 0;
    for (const unit of farState.party) unit.gauge = 0;
    farHealer.gauge = 10000; farState.enemies.forEach(enemy => { idle(enemy); enemy.gauge = 0; });
    step(farState);
    expect(farHealer.targetId).toBe(farTank.id);
    expect(farHealer.action?.state).toBe('windup');
    step(farState, PARTY_V2.timing.windupTicks);
    expect(farState.events.some(event => event.data.type === 'heal' && event.data.targetId === farTank.id)).toBe(true);
    expect(farTank.hp).toBeGreaterThan(1);
  });

  it('keeps windup state authoritative after its start event is evicted', () => {
    const { state, tank, enemy } = contactState(); enemy.hp = 1000; enemy.maxHp = 1000;
    tank.gauge = 10000; enemy.gauge = 0;
    const before = enemy.hp; step(state);
    for (let i = 0; i < CONFIG.runtime.eventLogLimit + 10; i += 1) emit(state, { type: 'gold', amount: 0, total: state.gold, reason: 'eviction-test' });
    expect(state.events.some(event => event.data.type === 'actionStart' && event.data.unitId === tank.id)).toBe(false);
    step(state, PARTY_V2.timing.windupTicks);
    expect(enemy.hp).toBeLessThan(before);
  });

  it('round-trips formation windup, recovery, and accelerated native-clock continuation exactly', () => {
    const prepareFight = (): GameState => {
      const state = partyState(), archer = state.enemies[0]!;
      state.enemies = [archer]; archer.sourceId = 'archer'; archer.range = PARTY_V2.reach.ranged; archer.x = 400; archer.hp = 1000; archer.maxHp = 1000; idle(archer);
      return state;
    };
    const assertContinuation = (start: GameState, ticks: number): void => {
      const uninterrupted = structuredClone(start), restored = load(snapshot(start));
      step(uninterrupted, ticks); step(restored, ticks);
      expect(snapshot(restored)).toBe(snapshot(uninterrupted));
    };
    const idleFight = prepareFight(); step(idleFight);
    expect(idleFight.party.every(unit => unit.x === (prepareFight().party.find(hero => hero.id === unit.id)?.x))).toBe(true);
    expect(idleFight.party.every(unit => !unit.moving)).toBe(true); assertContinuation(idleFight, 30);
    const windup = prepareFight();
    for (let i = 0; i < 80 && !windup.party.some(unit => unit.action?.state === 'windup'); i += 1) step(windup);
    expect(windup.party.some(unit => unit.action?.state === 'windup')).toBe(true); assertContinuation(windup, 20);
    const recovery = prepareFight();
    for (let i = 0; i < 120 && !recovery.party.some(unit => unit.action?.state === 'recovery'); i += 1) step(recovery);
    expect(recovery.party.some(unit => unit.action?.state === 'recovery')).toBe(true); assertContinuation(recovery, 30);

    const farmA = partyState(), farmB = partyState();
    for (const farm of [farmA, farmB]) {
      farm.highestCleared = 1;
      farm.progress = { kind: 'FARMING', stage: 1, failedStage: 2, retryAtTick: 100_000, failTick: 0, failedPower: 1_000_000, failures: 1 };
      farm.farmClock = { scale: 3, minCycleTicks: 60, elapsedTicks: 0, remainder: 0 };
    }
    step(farmA, 7); step(farmB, 7);
    const farmRestored = load(snapshot(farmB));
    step(farmA, 40); step(farmRestored, 40);
    expect(snapshot(farmRestored)).toBe(snapshot(farmA));
  });

  it('resets hero/enemy native birth ticks and ignores prior-encounter hit events after a farm restart', () => {
    const state = partyState(), tank = state.party.find(unit => unit.sourceId === 'mw2')!;
    emit(state, { type: 'hit', attackerId: 'enemy-old', targetId: tank.id, damage: 3, side: 'hero' }, 500);
    const oldHit = state.events.at(-1)!;
    expect(oldHit.combatEncounter).toBe(state.encounter);
    state.highestCleared = 1;
    state.progress = { kind: 'FARMING', stage: 1, failedStage: 2, retryAtTick: 100_000, failTick: 0, failedPower: 1_000_000, failures: 1 };
    state.phase = { kind: 'rest', remainingTicks: 1, next: 'encounter' };
    step(state);
    expect(state.encounter).toBe(2);
    expect(state.farmClock?.elapsedTicks).toBe(0);
    expect(state.party.every(unit => unit.nativeBornTick === 0)).toBe(true);
    expect(state.enemies.every(unit => unit.nativeBornTick === 0)).toBe(true);
    expect(combatEventAge(state, oldHit)).toBeNull();
    emit(state, { type: 'hit', attackerId: state.enemies[0]!.id, targetId: state.party[0]!.id, damage: 1, side: 'hero' }, 0);
    expect(combatEventAge(state, state.events.at(-1)!)).toBe(0);
  });

  it('ages action presentation and hit effects through real farm padding without advancing native time or rewards', () => {
    const state = partyState(), tank = state.party.find(unit => unit.sourceId === 'mw2')!, enemy = state.enemies[0]!;
    state.highestCleared = 1;
    state.progress = { kind: 'FARMING', stage: 1, failedStage: 2, retryAtTick: 100_000, failTick: 0, failedPower: 1_000_000, failures: 1 };
    state.phase = { kind: 'battle' };
    state.wave = CONFIG.stages[0]!.waves.length;
    state.stageStartedTick = 0;
    state.farmClock = { scale: 3, minCycleTicks: 300, elapsedTicks: 0, remainder: 0 };
    state.enemies = [enemy];
    for (const unit of state.party) { unit.hp = unit === tank ? unit.maxHp : 0; idle(unit); }
    tank.x = 100; tank.atk = 10_000; tank.speed = 0; idle(tank); tank.gauge = 10000;
    enemy.x = 124; enemy.hp = 1; enemy.maxHp = 1; enemy.atk = 1; enemy.speed = 0; idle(enemy); enemy.gauge = 0;

    for (let i = 0; i < 40 && (state.phase as GameState['phase']).kind !== 'farmPad'; i += 1) step(state);
    const enteredPad = state.phase as GameState['phase'];
    expect(enteredPad.kind).toBe('farmPad');
    if (enteredPad.kind !== 'farmPad') return;
    expect(enteredPad.presentationStartedAtTick).toBe(state.tick);
    const pad = load(snapshot(state));
    expect(pad.phase).toEqual(state.phase);
    const frozenNative = state.farmClock!.elapsedTicks, frozenRewards = { gold: state.gold, xp: state.roster.map(hero => hero.xp), clears: state.stats.clears };
    const hit = state.events.find(event => event.data.type === 'hit' && event.data.targetId === enemy.id)!;
    const ageBefore = combatEventAge(state, hit), presentationBefore = presentationCombatTime(state);
    expect(ageBefore).toBeDefined();
    step(state, 30);
    expect((state.phase as GameState['phase']).kind).toBe('farmPad');
    expect(state.farmClock!.elapsedTicks).toBe(frozenNative);
    expect(presentationCombatTime(state)).toBe(presentationBefore + 30);
    expect(combatEventAge(state, hit)).toBe((ageBefore ?? 0) + 30);
    expect({ gold: state.gold, xp: state.roster.map(hero => hero.xp), clears: state.stats.clears }).toEqual(frozenRewards);
  });
});
