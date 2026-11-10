import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { createPartyState, load, snapshot, step } from '../src/core/game';
import { spawnWave } from '../src/core/combat';
import { spawnParty } from '../src/core/combat';
import { partyCombatTick } from '../src/core/party-combat';
import { applyPartyShield, PARTY_V2 } from '../src/core/party-combat';
import { activePartyEffects, applyPartyEffect, effectiveAttack, effectiveDamageReduction, effectiveDefense, prunePartyEffects } from '../src/core/party-effects';
import type { PartyProjectile, Unit } from '../src/core/model';

function hold(unit: Unit): void { unit.action = { state: 'recovery', kind: 'attack', targetId: unit.id, startTick: 0, impactTick: 0, readyTick: Number.MAX_SAFE_INTEGER }; unit.cooldown = Number.MAX_SAFE_INTEGER; }
function bullet(source: Unit, target: Unit, overrides: Partial<PartyProjectile> = {}): PartyProjectile {
  return { id: 'projectile-test-1', sourceId: source.id, sourceSide: source.side, targetId: target.id, targetSide: target.side, abilityId: 'test-arrow', delivery: 'homing',
    x: target.x - 25, speed: 500, atk: 50, coefficient: 1, releasedAtTick: 0, impactNotBeforeTick: 1, expiresAtTick: 80, ...overrides };
}

describe('party-v2 common impact resolution', () => {
  it('naturally commits mk1 banner before same-tick damage, starts cooldown once, then resumes basics', () => {
    const state = createPartyState(2520);
    state.roster.push({ id: 'mk1', level: 1, xp: 0, stars: 1, equipment: { weapon: null, armor: null, charm: null } });
    state.partyIds = ['mk1', 'mw1', 'priest']; spawnParty(state);
    const banner = state.party.find(unit => unit.sourceId === 'mk1')!, target = state.party.find(unit => unit.sourceId === 'mw1')!;
    const enemy = state.enemies[0]!;
    state.party.forEach(hold); state.enemies.forEach(hold);
    banner.action = { state: 'idle' }; banner.cooldown = 0; banner.partyCooldowns = {};
    target.action = { state: 'windup', kind: 'attack', targetId: enemy.id, startTick: 0, impactTick: 5, abilityId: 'melee-cleave-strike' };
    target.x = enemy.x; enemy.hp = enemy.maxHp = 100_000; enemy.def = 0;
    // The banner's natural decision and the melee hit commit on the same native tick.
    for (let i = 0; i < 5; i += 1) { state.tick += 1; partyCombatTick(state); }
    const buff = state.partyEffects?.find(effect => effect.group === 'party-atk-buff' && effect.targetId === target.id);
    expect(buff).toMatchObject({ sourceId: banner.id, magnitude: 0.15, expiresAtTick: 85 });
    expect(banner.partyCooldowns?.['banner-buff']).toBe(145);
    const damage = state.events.find(event => event.data.type === 'hit' && event.data.attackerId === target.id && event.data.targetId === enemy.id);
    expect(damage?.data.type === 'hit' ? damage.data.damage : 0).toBe(Math.round(target.atk * 1.15));
    for (let i = 0; i < 22; i += 1) { state.tick += 1; partyCombatTick(state); }
    expect(state.events.filter(event => event.data.type === 'skill' && event.data.unitId === banner.id && event.data.skill === 'banner-buff')).toHaveLength(1);
    expect(banner.action).toMatchObject({ state: 'windup', kind: 'attack', abilityId: 'banner-bolt' });
  });
  it('counts natural boss_ch2 basic projectile contacts and then resolves its global volley', () => {
    const state = createPartyState(2521), base = state.enemies[0]!;
    for (const hero of state.party) { hero.maxHp = 100_000; hero.hp = hero.maxHp; }
    const boss: Unit = { ...base, id: 'boss-natural', sourceId: 'boss_ch2', hp: 1_000_000, maxHp: 1_000_000, atk: 50, def: 0, attackTicks: 30, range: 260, x: 360,
      radius: 10, speed: 55, facing: -1 as const, targetId: null, moving: false, action: { state: 'idle' as const }, specialAction: undefined, partyCooldowns: {}, procCounters: {} };
    state.enemies = [boss];
    let globalMark = false;
    for (let tick = 0; tick < 260 && !globalMark; tick += 1) {
      step(state);
      globalMark = boss.specialAction?.state === 'areaMark' && boss.specialAction.global === true;
    }
    expect(boss.procCounters?.basicSuccess).toBeGreaterThanOrEqual(4);
    expect(globalMark).toBe(true);
    if (!globalMark) return;
    expect(boss.specialAction?.state === 'areaMark' && boss.specialAction.global).toBe(true);
    expect(state.events.filter(event => event.data.type === 'projectile' && event.data.sourceId === boss.id && event.data.action === 'impact').length).toBeGreaterThanOrEqual(4);
    const mark = boss.specialAction;
    if (mark?.state !== 'areaMark') return;
    step(state, mark.impactTick - state.tick);
    const impacts = state.events.filter(event => (event.data.type === 'hit' || event.data.type === 'shieldAbsorb') && (event.data.type === 'hit' ? event.data.attackerId : event.data.attackerId) === boss.id);
    expect(new Set(impacts.map(event => event.data.type === 'hit' || event.data.type === 'shieldAbsorb' ? event.data.targetId : '')).size).toBe(3);
    expect(state.events.some(event => event.data.type === 'guard' && event.data.guardianId === state.party[0]?.id && event.data.fromTargetId !== state.party[0]?.id)).toBe(false);
  });

  it('cancels an unlaunched bomber area mark when the caster dies through game.step', () => {
    const state = createPartyState(2522), hitter = state.party[0]!, template = state.enemies[0]!;
    hitter.sourceId = 'mw1'; hitter.atk = 10_000; hitter.x = 140;
    state.party.slice(1).forEach(unit => { unit.hp = 0; hold(unit); });
    const bomber = { ...template, id: 'last-bomber', sourceId: 'bomber', hp: 1, maxHp: 1, x: 140, radius: 10, speed: 50, range: 200,
      action: { state: 'idle' as const }, partyCooldowns: { 'bomber-blast': 120 }, procCounters: {}, specialAction: { state: 'areaMark' as const,
        targetId: hitter.id, centerX: hitter.x, radius: 48, startTick: state.tick, impactTick: state.tick + 10, abilityId: 'bomber-blast' } };
    state.enemies = [bomber]; state.wave = CONFIG.stages[0]!.waves.length;
    hitter.action = { state: 'windup', kind: 'attack', targetId: bomber.id, startTick: state.tick, impactTick: state.tick + 1, abilityId: 'bruiser-strike' };
    step(state);
    expect(bomber.hp).toBe(0);
    expect(bomber.specialAction).toBeUndefined();
    expect(state.events.some(event => event.data.type === 'hit' && event.data.attackerId === bomber.id)).toBe(false);
  });

  it('cleave hits the primary and only its nearest secondary, with stable ID tie breaks', () => {
    const state = createPartyState(2520), melee = state.party[0]!, template = state.enemies[0]!;
    melee.sourceId = 'mw1'; melee.atk = 100; melee.x = 108; melee.partyCooldowns = { cleave: Number.MAX_SAFE_INTEGER };
    state.party.slice(1).forEach(unit => { unit.hp = 0; hold(unit); });
    const main = { ...template, id: 'main', x: 140, hp: 10000, maxHp: 10000, def: 0 };
    const nearest = { ...template, id: 'near', x: 150, hp: 10000, maxHp: 10000, def: 0 };
    const sameDistance = { ...template, id: 'a-tie', x: 130, hp: 10000, maxHp: 10000, def: 0 };
    state.enemies = [main, nearest, sameDistance]; state.enemies.forEach(hold);
    const impactTick = state.tick + 1;
    melee.action = { state: 'windup', kind: 'attack', targetId: main.id, startTick: impactTick - 1, impactTick, abilityId: 'cleave' };
    step(state);
    const damage = new Map(state.events.filter(event => event.data.type === 'hit' && event.data.attackerId === melee.id).map(event => event.data.type === 'hit' ? [event.data.targetId, event.data.damage] : ['', 0]));
    expect(damage.get(main.id)).toBe(150);
    expect(damage.get('a-tie')).toBe(60);
    expect(damage.has(nearest.id)).toBe(false);
  });

  it('applies a due guardian shield before same-tick damage regardless of unit ordering', () => {
    const state = createPartyState(231), tank = state.party.find(unit => unit.sourceId === 'mw2')!, enemy = state.enemies[0]!;
    state.party = [tank, ...state.party.filter(unit => unit !== tank).map(unit => ({ ...unit, hp: 0 }))];
    state.enemies = [enemy]; tank.hp = tank.maxHp - 80; tank.x = 100; enemy.x = 100; enemy.speed = 0; enemy.atk = 60;
    tank.action = { state: 'windup', kind: 'heal', targetId: tank.id, startTick: 0, impactTick: 1, abilityId: 'guardian-shield' };
    enemy.action = { state: 'windup', kind: 'attack', targetId: tank.id, startTick: 0, impactTick: 1 };
    step(state);
    expect(state.events.some(event => event.data.type === 'shieldAbsorb' && event.data.targetId === tank.id)).toBe(true);
    expect(tank.hp).toBeGreaterThan(0);
    expect(tank.partyCooldowns?.['guardian-shield']).toBeGreaterThan(1);
  });

  it('reserves one guardian intercept across direct and projectile impacts in the same batch', () => {
    const state = createPartyState(232), tank = state.party.find(unit => unit.sourceId === 'mw2')!, melee = state.party.find(unit => unit.sourceId === 'mw1')!, priest = state.party.find(unit => unit.sourceId === 'priest')!;
    state.party.forEach(hold); tank.x = 100; melee.x = 140; priest.x = 50;
    const direct = state.enemies[0]!, archer = { ...state.enemies[1]!, id: 'enemy-archer-fixture', sourceId: 'archer', x: 180, hp: 5000, maxHp: 5000, atk: 40, speed: 0 };
    state.enemies = [direct, archer];
    direct.x = 100; direct.speed = 0; direct.atk = 40; direct.action = { state: 'windup', kind: 'attack', targetId: priest.id, startTick: 0, impactTick: 1 };
    hold(archer);
    state.projectiles = [bullet(archer, melee)];
    const before = new Map(state.party.map(unit => [unit.id, unit.hp]));
    step(state);
    const guards = state.events.filter(event => event.data.type === 'guard');
    expect(guards).toHaveLength(1);
    const damaged = state.party.filter(unit => unit.hp < (before.get(unit.id) ?? unit.hp));
    expect(damaged.length).toBeGreaterThanOrEqual(1);
    expect(tank.guardReadyTick).toBeGreaterThan(1);
  });

  it('keeps released payloads after source death, uses impact-time defense and shield, and resumes the same flight', () => {
    const state = createPartyState(233), tank = state.party.find(unit => unit.sourceId === 'mw2')!, source = state.enemies[0]!;
    state.party.forEach(hold); state.enemies = [source]; hold(source); source.hp = 0;
    tank.x = 100; tank.def = 100; tank.shield = 12; tank.shieldUntilTick = 20;
    state.projectiles = [bullet(source, tank, { x: 75, atk: 100, coefficient: 1 })];
    const resumed = load(snapshot(state));
    step(state); step(resumed);
    expect(resumed).toEqual(state);
    expect(state.projectiles).toHaveLength(0);
    expect(state.events.some(event => event.data.type === 'shieldAbsorb' && event.data.amount === 12)).toBe(true);
    const hit = state.events.find(event => event.data.type === 'hit' && event.data.targetId === tank.id);
    expect(hit?.data.type === 'hit' ? hit.data.damage : 0).toBe(38);
    expect(tank.hp).toBe(tank.maxHp - 38);
  });

  it('lets a hostile projectile finish through game.step after the last enemy dies, then loses if that impact kills the last hero', () => {
    const state = createPartyState(234), tank = state.party.find(unit => unit.sourceId === 'mw2')!, enemy = state.enemies[0]!;
    state.party.forEach(hold); state.enemies = [enemy]; hold(enemy); enemy.hp = 0;
    tank.x = 100; tank.hp = tank.maxHp - 20; state.wave = CONFIG.stages[state.progress.stage - 1]!.waves.length;
    state.projectiles = [bullet(enemy, tank, { x: tank.x - 25, atk: 50 })];
    step(state);
    expect(tank.hp).toBeLessThan(tank.maxHp - 20);
    expect(state.phase.kind).not.toBe('battle');
    expect(state.stats.clears).toBe(1);

    const loss = createPartyState(235), last = loss.party[0]!, lastEnemy = loss.enemies[0]!;
    loss.party.forEach(unit => { unit.hp = 0; hold(unit); }); hold(lastEnemy);
    loss.projectiles = [bullet(lastEnemy, last, { atk: 5000 })];
    const gold = loss.gold; step(loss);
    expect(loss.stats.losses).toBe(1);
    expect(loss.stats.clears).toBe(0);
    expect(loss.gold).toBe(gold);
    expect(loss.projectiles).toHaveLength(0);
  });

  it('locks ground AoE to its release center and excludes bodies outside the exact radius', () => {
    const state = createPartyState(236);
    state.party[0]!.sourceId = 'wiz';
    const [primary, nearby, outside] = state.enemies;
    if (!primary || !nearby || !outside) throw new Error('Expected enemy fixture');
    state.enemies = [primary, { ...primary, id: 'enemy-nearby', x: 230 }, { ...primary, id: 'enemy-outside', x: 300 }];
    state.enemies.forEach((enemy, index) => { enemy.hp = 1000; enemy.maxHp = 1000; enemy.x = [200, 230, 300][index]!; enemy.action = { state: 'recovery', kind: 'attack', targetId: enemy.id, startTick: 0, impactTick: 0, readyTick: 1000 }; });
    state.party.forEach(unit => { unit.action = { state: 'recovery', kind: 'attack', targetId: unit.id, startTick: 0, impactTick: 0, readyTick: 1000 }; unit.partyCooldowns = { [unit.sourceId === 'wiz' ? 'fireball' : 'disabled']: unit.sourceId === 'wiz' ? 0 : 1000 }; });
    const [main, secondary, far] = state.enemies, before = [main!.hp, secondary!.hp, far!.hp];
    // A ground payload is serialized at its cast center; moving the original target cannot drag the blast.
    state.projectiles = [{ id: 'ground-fixture', sourceId: state.party[0]!.id, sourceSide: 'hero', targetId: main!.id, targetSide: 'enemy', abilityId: 'fireball', delivery: 'ground', x: 175, speed: 500, atk: 100, coefficient: 1.4, splashCoefficient: 0.6, radius: 48, centerX: 200, releasedAtTick: 0, impactNotBeforeTick: 1, expiresAtTick: 80 }];
    main!.x = 400; step(state, 2);
    expect(main!.hp).toBe(before[0]);
    expect(secondary!.hp).toBeLessThan(before[1]!);
    expect(far!.hp).toBe(before[2]);
  });

  it('keeps the strongest shield and credits its provider after snapshot and impact', () => {
    const state = createPartyState(237), guardian = state.party.find(unit => unit.sourceId === 'mw2')!, healer = state.party.find(unit => unit.sourceId === 'priest')!;
    const attacker = state.enemies[0]!;
    state.party.forEach(hold); state.enemies = [attacker]; hold(attacker); attacker.atk = 50;
    applyPartyShield(state, guardian, guardian, 50, 100, 0);
    applyPartyShield(state, healer, guardian, 20, 30, 1);
    expect(guardian.shield).toBe(50); expect(guardian.shieldUntilTick).toBe(100); expect(guardian.shieldProviderId).toBe(guardian.id);
    state.projectiles = [bullet(attacker, guardian, { x: guardian.x - 25, atk: 50 })];
    const resumed = load(snapshot(state)); step(resumed, 3);
    const absorb = resumed.events.find(event => event.data.type === 'shieldAbsorb' && event.data.targetId === guardian.id);
    expect(absorb?.data.type === 'shieldAbsorb' ? { provider: absorb.data.providerId, attacker: absorb.data.attackerId } : null)
      .toEqual({ provider: guardian.id, attacker: attacker.id });
  });

  it('refreshes a living aura without per-tick event spam and removes it at source death', () => {
    const state = createPartyState(238), banner = state.party[0]!;
    banner.sourceId = 'mk1'; state.party.forEach(hold); state.enemies.forEach(hold);
    step(state, 20);
    const auraEvents = state.events.filter(event => event.data.type === 'effect' && event.data.group === 'party-guard-aura');
    expect(auraEvents.length).toBe(state.party.length);
    expect(state.partyEffects?.filter(effect => effect.group === 'party-guard-aura')).toHaveLength(state.party.length);
    banner.hp = 0; step(state);
    expect(state.partyEffects?.some(effect => effect.group === 'party-guard-aura')).toBe(false);
  });

  it('does not let a due heal rescue a unit killed in the same damage batch', () => {
    const state = createPartyState(239), tank = state.party.find(unit => unit.sourceId === 'mw2')!, priest = state.party.find(unit => unit.sourceId === 'priest')!, enemy = state.enemies[0]!;
    state.party.forEach(hold); state.enemies = [enemy]; hold(enemy); enemy.atk = 5000; enemy.speed = 0; enemy.x = tank.x;
    tank.hp = 1; tank.action = { state: 'idle' }; tank.partyCooldowns = { 'guardian-shield': Number.MAX_SAFE_INTEGER };
    priest.action = { state: 'windup', kind: 'heal', targetId: tank.id, startTick: 0, impactTick: 1, abilityId: 'priest-burst-heal' };
    enemy.action = { state: 'windup', kind: 'attack', targetId: tank.id, startTick: 0, impactTick: 1 };
    step(state);
    expect(tank.hp).toBe(0);
    expect(state.events.some(event => event.data.type === 'heal' && event.data.sourceId === priest.id && event.data.targetId === tank.id)).toBe(false);
  });

  it('resolves the bruiser active self-heal after a valid hit even when a shield absorbs it', () => {
    const state = createPartyState(240), bruiser = state.party[0]!, target = state.enemies[0]!;
    bruiser.sourceId = 'fw'; bruiser.hp = bruiser.maxHp - 30; state.party.forEach(hold); state.enemies = [target]; hold(target);
    target.x = bruiser.x; target.shield = 500; target.shieldUntilTick = 100;
    bruiser.action = { state: 'windup', kind: 'attack', targetId: target.id, startTick: 0, impactTick: 1, abilityId: 'bruiser-burst-heal' };
    const before = bruiser.hp; step(state);
    expect(bruiser.hp).toBe(before + Math.round(bruiser.maxHp * 0.08));
    expect(state.events.some(event => event.data.type === 'shieldAbsorb' && event.data.targetId === target.id)).toBe(true);
    expect(state.events.some(event => event.data.type === 'heal' && event.data.sourceId === bruiser.id)).toBe(true);
  });

  it('bases the bruiser fourth-basic lifesteal on actual HP damage, excluding shield absorption', () => {
    const runFourth = (seed: number, shield: number) => {
      const state = createPartyState(seed), bruiser = state.party[0]!, target = state.enemies[0]!;
      bruiser.sourceId = 'hk1'; bruiser.hp = bruiser.maxHp - 100; bruiser.procCounters = { basicSuccess: 3 };
      bruiser.partyCooldowns = { 'bruiser-heal': Number.MAX_SAFE_INTEGER };
      state.party.slice(1).forEach(unit => { unit.hp = 0; hold(unit); });
      state.enemies = [target]; hold(target); target.x = bruiser.x; target.hp = 1000; target.maxHp = 1000; target.def = 0;
      target.shield = shield; target.shieldUntilTick = 100;
      bruiser.action = { state: 'windup', kind: 'attack', targetId: target.id, startTick: 0, impactTick: 1, abilityId: 'bruiser-strike' };
      const before = bruiser.hp; step(state);
      return { state, bruiser, before };
    };
    const unshielded = runFourth(243, 0), hit = unshielded.state.events.find(event => event.data.type === 'hit' && event.data.targetId === unshielded.state.enemies[0]!.id);
    const expectedHeal = hit?.data.type === 'hit' ? Math.round(hit.data.damage * 0.3) : 0;
    expect(unshielded.bruiser.hp).toBe(unshielded.before + expectedHeal);
    const shielded = runFourth(244, 1000);
    expect(shielded.bruiser.procCounters?.basicSuccess).toBe(4);
    expect(shielded.bruiser.hp).toBe(shielded.before);
    expect(shielded.state.events.some(event => event.data.type === 'shieldAbsorb' && event.data.targetId === shielded.state.enemies[0]!.id)).toBe(true);
    expect(shielded.state.events.some(event => event.data.type === 'heal' && event.data.sourceId === shielded.bruiser.id)).toBe(false);
  });

  it('awards the fourth-shot bonus at impact order and does not count an expired shot', () => {
    const state = createPartyState(241), ranger = state.party[0]!, target = state.enemies[0]!;
    ranger.sourceId = 'hu1'; ranger.atk = 100; ranger.procCounters = { basicSuccess: 2 }; hold(ranger);
    state.party.slice(1).forEach(hold); state.enemies = [target]; hold(target); target.def = 0; target.x = ranger.x + 25; target.hp = 1000; target.maxHp = 1000;
    const createShot = (id: string): PartyProjectile => bullet(ranger, target, { id, abilityId: 'ranger-shot', x: target.x - 25, atk: 100 });
    state.projectiles = [createShot('projectile-b'), createShot('projectile-a')];
    step(state);
    const amounts = state.events.filter(event => event.data.type === 'hit' && event.data.targetId === target.id).map(event => event.data.type === 'hit' ? event.data.damage : 0);
    expect(amounts).toEqual([100, 120]);
    expect(ranger.procCounters?.basicSuccess).toBe(4);

    const expired = createPartyState(242), expiringRanger = expired.party[0]!, deadTarget = expired.enemies[0]!;
    expiringRanger.sourceId = 'hu1'; expiringRanger.procCounters = { basicSuccess: 3 }; hold(expiringRanger);
    expired.party.slice(1).forEach(hold); expired.enemies = [deadTarget]; deadTarget.hp = 0;
    expired.projectiles = [bullet(expiringRanger, deadTarget, { abilityId: 'ranger-shot' })];
    step(expired);
    expect(expiringRanger.procCounters?.basicSuccess).toBe(3);
    expect(expired.events.some(event => event.data.type === 'hit' && event.data.attackerId === expiringRanger.id)).toBe(false);
  });

  it('ramps same-target basics by five percent, caps at fifteen, and resets on a target change', () => {
    const state = createPartyState(245), melee = state.party[0]!, first = state.enemies[0]!, second = { ...first, id: 'second-target', x: first.x };
    melee.sourceId = 'mw1'; melee.atk = 100; melee.partyCooldowns = { cleave: Number.MAX_SAFE_INTEGER };
    state.party.slice(1).forEach(unit => { unit.hp = 0; hold(unit); }); state.enemies = [first, second];
    state.enemies.forEach(target => { hold(target); target.x = melee.x; target.def = 0; target.hp = 10000; target.maxHp = 10000; });
    const hitBasic = (target: Unit): number => {
      const impactTick = state.tick + 1;
      melee.action = { state: 'windup', kind: 'attack', targetId: target.id, startTick: impactTick - 1, impactTick, abilityId: 'melee-cleave-strike' };
      step(state);
      const event = [...state.events].reverse().find(item => item.data.type === 'hit' && item.data.attackerId === melee.id && item.data.targetId === target.id);
      return event?.data.type === 'hit' ? event.data.damage : 0;
    };
    expect([hitBasic(first), hitBasic(first), hitBasic(first), hitBasic(first)]).toEqual([100, 105, 110, 115]);
    expect(hitBasic(second)).toBe(100);
    expect(hitBasic(first)).toBe(100);
  });

  it('keeps the strongest shared weaken, refreshes its deadline and expires it exactly', () => {
    const state = createPartyState(246), weakener = state.party[0]!, stronger = state.party[1]!, target = state.enemies[0]!;
    target.def = 100;
    const effect = (source: Unit, magnitude: number, expiry: number) => applyPartyEffect(state, {
      id: `enemy-def-weaken:${target.id}`, sourceId: source.id, targetId: target.id, group: 'enemy-def-weaken', kind: 'defReduction', magnitude,
      appliedAtTick: state.tick, expiresAtTick: expiry, stackPolicy: 'strongestRefresh',
    });
    effect(weakener, 0.25, 50); effect(stronger, 0.4, 30); effect(weakener, 0.2, 70);
    expect(effectiveDefense(state, target)).toBe(60);
    expect(state.partyEffects?.find(entry => entry.group === 'enemy-def-weaken')).toMatchObject({ sourceId: stronger.id, magnitude: 0.4, expiresAtTick: 70 });
    state.tick = 70; prunePartyEffects(state);
    expect(activePartyEffects(state, target.id)).toHaveLength(0);
    expect(effectiveDefense(state, target)).toBe(100);
  });

  it('caps combined effect groups without mutating their base stats', () => {
    const state = createPartyState(249), unit = state.party[0]!, atk = unit.atk, def = unit.def;
    const add = (group: string, kind: 'atkBonus' | 'atkReduction' | 'defReduction' | 'damageReduction', magnitude: number): void => applyPartyEffect(state, {
      id: `${group}:${unit.id}`, sourceId: unit.id, targetId: unit.id, group, kind, magnitude, appliedAtTick: 0, expiresAtTick: 100, stackPolicy: 'strongestRefresh',
    });
    add('atk-a', 'atkBonus', 0.4); add('atk-b', 'atkBonus', 0.4);
    add('def-a', 'defReduction', 0.5); add('def-b', 'defReduction', 0.5);
    add('dr-a', 'damageReduction', 0.4); add('dr-b', 'damageReduction', 0.4);
    add('atk-down-a', 'atkReduction', 0.4); add('atk-down-b', 'atkReduction', 0.4);
    expect(effectiveAttack(state, unit)).toBe(atk * 1.5 * 0.5);
    expect(effectiveDefense(state, unit)).toBe(def * 0.4);
    expect(effectiveDamageReduction(state, unit)).toBe(0.5);
    expect(unit.atk).toBe(atk); expect(unit.def).toBe(def);
  });

  it('grants the first-weaken shield once per target, not on later reapplications', () => {
    const state = createPartyState(247), weakener = state.party[0]!, target = state.enemies[0]!;
    weakener.sourceId = 'ew1'; state.party.slice(1).forEach(unit => { unit.hp = 0; hold(unit); });
    state.enemies = [target]; target.x = weakener.x; target.hp = 10000; target.maxHp = 10000; hold(target);
    const cast = (): void => {
      weakener.partyCooldowns = { weaken: 0 }; weakener.action = { state: 'idle' };
      step(state); step(state, PARTY_V2.timing.windupTicks);
    };
    cast();
    expect(target.procCounters?.firstWeakenShield).toBe(1);
    expect(weakener.shield).toBeGreaterThan(0);
    weakener.shield = 0; weakener.shieldUntilTick = 0; delete weakener.shieldProviderId;
    state.partyEffects = state.partyEffects?.filter(effect => effect.targetId !== target.id);
    cast();
    expect(weakener.shield).toBe(0);
    expect(target.procCounters?.firstWeakenShield).toBe(1);
  });

  it('applies the wizard third-shot splash once as a non-recursive secondary impact', () => {
    const state = createPartyState(248), wizard = state.party[0]!, primary = state.enemies[0]!;
    wizard.sourceId = 'wiz'; wizard.atk = 100; wizard.partyCooldowns = { fireball: Number.MAX_SAFE_INTEGER };
    state.party.slice(1).forEach(unit => { unit.hp = 0; hold(unit); });
    const secondary = { ...primary, id: 'splash-near', x: wizard.x + 30 }, outside = { ...primary, id: 'splash-far', x: wizard.x + 100 };
    state.enemies = [primary, secondary, outside];
    for (const target of state.enemies) { hold(target); target.hp = 10000; target.maxHp = 10000; target.def = 0; }
    primary.x = wizard.x;
    for (let hit = 0; hit < 3; hit += 1) {
      const impactTick = state.tick + 1;
      wizard.action = { state: 'windup', kind: 'attack', targetId: primary.id, startTick: impactTick - 1, impactTick, abilityId: 'arcane-bolt' };
      step(state);
    }
    const splashHits = state.events.filter(event => event.data.type === 'hit' && event.data.attackerId === wizard.id && event.data.targetId === secondary.id);
    expect(splashHits).toHaveLength(1);
    expect(splashHits[0]?.data.type === 'hit' ? splashHits[0].data.damage : 0).toBe(35);
    expect(state.events.some(event => event.data.type === 'hit' && event.data.targetId === outside.id)).toBe(false);
    expect(wizard.procCounters?.basicSuccess).toBe(3);
  });

  it('marks, visibly dashes and lands the assassin without traversal damage before guardian defense', () => {
    const state = createPartyState(252); state.highestCleared = 11; state.progress = { kind: 'PUSHING', stage: 12 }; state.wave = 1; spawnWave(state);
    const assassin = state.enemies.find(unit => unit.sourceId === 'assassin')!, tank = state.party.find(unit => unit.sourceId === 'mw2')!, priest = state.party.find(unit => unit.sourceId === 'priest')!;
    state.enemies = [assassin]; state.party.forEach(hold); assassin.action = { state: 'idle' }; assassin.x = 400;
    const start = assassin.x; step(state);
    expect(assassin.specialAction).toMatchObject({ state: 'assassinMark', targetId: priest.id });
    step(state, PARTY_V2.timing.windupTicks + 16);
    expect(assassin.specialAction?.state).toBe('assassinDash');
    expect(assassin.x).toBeLessThan(start);
    expect(state.events.some(event => event.data.type === 'hit' && event.data.attackerId === assassin.id)).toBe(false);
    const landed = (): boolean => state.enemies[0]?.action?.state === 'windup';
    for (let i = 0; i < 40 && !landed(); i += 1) step(state);
    expect(assassin.action).toMatchObject({ state: 'windup', targetId: priest.id });
    expect(assassin.facing).toBe(-1);
    expect(state.events.some(event => event.data.type === 'hit' && event.data.attackerId === assassin.id)).toBe(false);
    step(state, PARTY_V2.timing.windupTicks);
    expect(state.events.some(event => event.data.type === 'guard' && event.data.fromTargetId === priest.id && event.data.toTargetId === tank.id)).toBe(true);
    expect(priest.hp).toBe(priest.maxHp);
  });

  it('locks the bomber radius-48 mark, impacts only its local area and starts a six-second cooldown', () => {
    const state = createPartyState(256); state.highestCleared = 11; state.progress = { kind: 'PUSHING', stage: 12 }; state.wave = 2; spawnWave(state);
    const bomber = state.enemies.find(unit => unit.sourceId === 'bomber')!, tank = state.party.find(unit => unit.sourceId === 'mw2')!, melee = state.party.find(unit => unit.sourceId === 'mw1')!, priest = state.party.find(unit => unit.sourceId === 'priest')!;
    state.enemies = [bomber]; bomber.action = { state: 'idle' }; state.party.forEach(hold);
    tank.x = 220; melee.x = 180; priest.x = 100; state.party.forEach(unit => { unit.speed = 0; });
    for (let i = 0; i < 240 && bomber.specialAction?.state !== 'areaMark'; i += 1) step(state);
    const mark = bomber.specialAction;
    expect(mark).toMatchObject({ state: 'areaMark', targetId: tank.id, centerX: 220, radius: 48, abilityId: 'bomber-blast' });
    expect(bomber.partyCooldowns?.['bomber-blast']).toBeGreaterThanOrEqual(mark?.state === 'areaMark' ? mark.impactTick : 0);
    const before = state.events.filter(event => event.data.type === 'hit' && event.data.attackerId === bomber.id).length;
    tank.x = 400; tank.guardReadyTick = 100_000;
    step(state, PARTY_V2.timing.windupTicks * 5);
    const areaHits = state.events.filter(event => event.data.type === 'hit' && event.data.attackerId === bomber.id).slice(before);
    expect(areaHits.some(event => event.data.type === 'hit' && event.data.targetId === melee.id)).toBe(true);
    expect(areaHits.some(event => event.data.type === 'hit' && event.data.targetId === priest.id)).toBe(false);
    expect(bomber.specialAction).toBeUndefined();
  });

  it('applies chapter-one local slam after its fifth basic and chapter-two global volley to all heroes', () => {
    const first = createPartyState(253); first.highestCleared = 9; first.progress = { kind: 'BOSS_FIGHT', stage: 10, failedPower: 1, bossLosses: 0 }; first.wave = 3; spawnWave(first);
    const boss = first.enemies.find(unit => unit.sourceId === 'boss_ch1')!, tank = first.party.find(unit => unit.sourceId === 'mw2')!, priest = first.party.find(unit => unit.sourceId === 'priest')!;
    first.enemies = [boss]; first.party.forEach(hold); first.party.forEach(unit => { unit.speed = 0; });
    boss.x = tank.x + radiusForTest(boss, tank); boss.atk = 10; boss.procCounters = { basicSuccess: 4, bossPattern: 0 }; boss.action = { state: 'windup', kind: 'attack', targetId: tank.id, startTick: 0, impactTick: 1 };
    step(first); expect(boss.procCounters?.basicSuccess).toBe(5);
    boss.action = { state: 'idle' }; step(first);
    expect(boss.specialAction).toMatchObject({ state: 'areaMark', abilityId: 'boss-ch1-slam', radius: 64, centerX: tank.x });
    expect(boss.procCounters?.bossPattern).toBe(1);
    const priorHits = first.events.filter(event => event.data.type === 'hit' && event.data.attackerId === boss.id).length;
    step(first, PARTY_V2.timing.windupTicks * 5);
    const slamHits = first.events.filter(event => event.data.type === 'hit' && event.data.attackerId === boss.id).slice(priorHits);
    expect(slamHits.some(event => event.data.type === 'hit' && event.data.targetId === priest.id)).toBe(false);
    expect(boss.procCounters?.basicSuccess).toBe(5);

    const second = createPartyState(254); second.highestCleared = 19; second.progress = { kind: 'BOSS_FIGHT', stage: 20, failedPower: 1, bossLosses: 0 }; second.wave = 3; spawnWave(second);
    const boss2 = second.enemies.find(unit => unit.sourceId === 'boss_ch2')!;
    second.enemies = [boss2]; second.party.forEach(hold); boss2.x = 200; boss2.atk = 20; boss2.procCounters = { basicSuccess: 4, bossPattern: 0 }; boss2.action = { state: 'idle' };
    step(second);
    expect(boss2.specialAction).toMatchObject({ state: 'areaMark', abilityId: 'boss-ch2-volley', global: true });
    const before = second.party.map(unit => unit.hp), atMark = second.events.filter(event => event.data.type === 'hit' && event.data.attackerId === boss2.id).length;
    step(second, PARTY_V2.timing.windupTicks * 5);
    expect(second.party.every((unit, i) => unit.hp < (before[i] ?? unit.hp))).toBe(true);
    expect(second.events.filter(event => event.data.type === 'guard')).toHaveLength(0);
    expect(boss2.procCounters?.basicSuccess).toBe(4);
    expect(second.events.filter(event => event.data.type === 'hit' && event.data.attackerId === boss2.id).length).toBeGreaterThan(atMark);
  });

  it('enrages bosses once at sixty native seconds without mutating their base attack', () => {
    const state = createPartyState(255), boss = state.enemies[0]!;
    boss.sourceId = 'boss_ch1'; boss.atk = 100; boss.bornTick = 0; state.tick = 0;
    expect(effectiveAttack(state, boss)).toBe(100);
    state.tick = CONFIG.sim.ticksPerSecond * 60;
    expect(effectiveAttack(state, boss)).toBe(150);
    expect(effectiveAttack(state, boss)).toBe(150);
    expect(boss.atk).toBe(100);
  });
});

function radiusForTest(a: Unit, b: Unit): number { return (a.radius ?? 10) + (b.radius ?? 10) + a.range; }
