import { describe, expect, it } from 'vitest';
import { CONFIG, stageConfig, ticksForSeconds } from '../src/config';
import { beginEncounter } from '../src/core/combat';
import { combatTime } from '../src/core/clock';
import { createState, step } from '../src/core/game';
import type { GameState, Unit } from '../src/core/model';
import { ENEMY_ENTRY_PX, ENEMY_MARCH_LIMIT_PX, PARTY_V2, PRESENTATION_CAP_TICKS, enemyFormationX } from '../src/core/party-combat';
import { referencePolicy, type PolicyCursor } from '../src/core/policy';
import { actionBoundaries, createActionTimeline, sampleActionPresentation } from '../src/core/turn/animation-timing';
import { presentationHitstop, PresentationLaneClock } from '../src/legendary-presentation';

function quiet(state: GameState, keep?: Unit): Unit {
  const enemy = keep ?? state.enemies[0]!;
  for (const unit of state.enemies) {
    if (unit !== enemy) unit.hp = 0;
    unit.moving = false;
    unit.action = { state: 'idle' };
    delete unit.specialAction;
  }
  return enemy;
}

function forced(state: GameState, kind?: 'action' | 'special'): number {
  return state.events.filter(event => event.data.type === 'presentationForced' && (kind === undefined || event.data.kind === kind)).length;
}

describe('presentation lock cannot freeze a wave', () => {
  it('force-completes a special whose impact is far beyond the cap and lets gauges move', () => {
    const state = createState(7101);
    const enemy = quiet(state);
    const hero = state.party[0]!;
    enemy.sourceId = 'bomber';
    enemy.hp = enemy.maxHp = 10_000;
    const now = combatTime(state);
    enemy.specialAction = { state: 'areaMark', targetId: hero.id, centerX: hero.x, radius: 48, startTick: now, impactTick: now + ticksForSeconds(120), abilityId: 'bomber-blast' };
    hero.gauge = 0;
    step(state);
    expect(enemy.specialAction).toBeUndefined();
    expect(forced(state, 'special')).toBe(1);
    expect(hero.gauge ?? 0).toBeGreaterThan(0);
    expect(state.stats.losses).toBe(0);
    expect(state.phase.kind).toBe('battle');
  });

  it('keeps an honest one-second telegraph and does not log a force-complete', () => {
    const state = createState(7102);
    const enemy = quiet(state);
    const hero = state.party[0]!;
    enemy.sourceId = 'bomber';
    enemy.hp = enemy.maxHp = 10_000;
    const now = combatTime(state);
    enemy.specialAction = { state: 'areaMark', targetId: hero.id, centerX: hero.x, radius: 48, startTick: now, impactTick: now + ticksForSeconds(1), abilityId: 'bomber-blast' };
    step(state, ticksForSeconds(0.5));
    expect(enemy.specialAction?.state).toBe('areaMark');
    expect(forced(state)).toBe(0);
    const impact = enemy.specialAction?.state === 'areaMark' ? enemy.specialAction.impactTick : now;
    step(state, Math.max(0, impact - combatTime(state)));
    expect(enemy.specialAction?.state).toBe('areaImpact');
    expect(forced(state)).toBe(0);
    expect(state.stats.losses).toBe(0);
  });

  it('resolves a due windup while another enemy is still marching', () => {
    const state = createState(7103);
    const enemy = quiet(state);
    const hero = state.party[0]!;
    enemy.hp = enemy.maxHp = 10_000;
    enemy.moving = true;
    enemy.x = enemyFormationX(enemy.slot) + ENEMY_ENTRY_PX * 4;
    const timeline = createActionTimeline(hero.sourceId, 'leap', combatTime(state));
    hero.atk = 5_000;
    hero.action = { state: 'windup', kind: 'attack', targetId: enemy.id, targetSide: 'enemy', targetSlot: enemy.slot, targetCount: 1, ...timeline, impactTick: 0, delivery: 'leap' };
    const hp = enemy.hp;
    step(state);
    expect(enemy.hp).toBeLessThan(hp);
    expect(enemy.moving).toBe(true);
    expect(enemy.x).toBe(enemyFormationX(enemy.slot) + ENEMY_ENTRY_PX * 3);
    expect(forced(state)).toBe(0);
  });

  it('snaps a mover that is farther than any spawn slot instead of marching for seconds', () => {
    const state = createState(7104);
    const enemy = state.enemies[0]!;
    enemy.moving = true;
    enemy.x = 2000;
    expect(Math.abs(2000 - enemyFormationX(enemy.slot))).toBeGreaterThan(ENEMY_MARCH_LIMIT_PX);
    step(state);
    expect(enemy.x).toBe(enemyFormationX(enemy.slot));
    expect(enemy.moving).toBe(false);
    const home = enemyFormationX(0);
    const again = createState(7105);
    again.enemies[0]!.moving = true;
    again.enemies[0]!.x = Number.NaN;
    step(again);
    expect(again.enemies[0]!.x).toBe(home);
    expect(again.enemies[0]!.moving).toBe(false);
  });

  it('converts a legacy dash while the assassin is still walking in', () => {
    const state = createState(7106);
    const enemy = quiet(state);
    const hero = state.party[0]!;
    enemy.sourceId = 'assassin';
    enemy.hp = enemy.maxHp = 10_000;
    enemy.moving = true;
    enemy.x = enemyFormationX(enemy.slot) + ENEMY_ENTRY_PX * 5;
    const now = combatTime(state);
    enemy.specialAction = { state: 'assassinDash', targetId: hero.id, targetX: hero.x, startX: enemy.x, startTick: now, impactTick: now + 4 };
    step(state);
    expect(enemy.specialAction).toBeUndefined();
    expect(enemy.action?.state).toBe('windup');
    expect(state.events.some(event => event.data.type === 'actionStart' && event.data.unitId === enemy.id)).toBe(true);
    expect(forced(state)).toBe(0);
  });

  it('clears a mark whose target is already gone without waiting out the march', () => {
    const state = createState(7107);
    const enemy = state.enemies[0]!;
    enemy.sourceId = 'assassin';
    enemy.moving = false;
    const now = combatTime(state);
    enemy.specialAction = { state: 'assassinMark', targetId: 'missing-hero', startTick: now, impactTick: now + ticksForSeconds(1) };
    const stillMarching = state.enemies[1]!;
    expect(stillMarching.moving).toBe(true);
    step(state);
    expect(enemy.specialAction).toBeUndefined();
    expect(stillMarching.moving).toBe(true);
    expect(forced(state)).toBe(0);
  });

  it('drops a recovery stamped on the wrong clock or scheduled far past the cap', () => {
    const skew = createState(7108);
    const enemy = quiet(skew);
    const hero = skew.party[0]!, ally = skew.party[1]!;
    hero.action = { state: 'recovery', kind: 'attack', targetId: enemy.id, startTick: 5_000, impactTick: 5_000, contactTick: 5_000, attackEndTick: 5_004, returnEndTick: 5_008, readyTick: 5_020, delivery: 'leap' };
    ally.gauge = 0;
    step(skew);
    expect(hero.action?.state).toBe('idle');
    expect(forced(skew, 'action')).toBe(1);
    expect(ally.gauge ?? 0).toBeGreaterThan(0);

    const state = createState(7109);
    state.progress = { kind: 'FARMING', stage: 1, failedStage: 2, retryAtTick: Number.MAX_SAFE_INTEGER, failTick: 0, failedPower: Number.MAX_SAFE_INTEGER, failures: 1 };
    state.highestCleared = 1;
    beginEncounter(state);
    const farmer = state.party[0]!, partner = state.party[1]!, foe = quiet(state);
    const clock = combatTime(state);
    farmer.action = { state: 'recovery', kind: 'attack', targetId: foe.id, startTick: clock, impactTick: clock, contactTick: clock, attackEndTick: clock + 4, returnEndTick: clock + 8, readyTick: clock + ticksForSeconds(120), delivery: 'leap' };
    partner.gauge = 0;
    step(state);
    expect(farmer.action?.state).toBe('idle');
    expect(forced(state, 'action')).toBe(1);
    expect(partner.gauge ?? 0).toBeGreaterThan(0);
    expect(state.stats.losses).toBe(0);
  });

  it('lets an already-expired stage timer resolve within a couple of ticks once a stuck special is cleared', () => {
    const state = createState(7110);
    const enemy = quiet(state);
    const hero = state.party[0]!;
    enemy.hp = enemy.maxHp = 1_000_000;
    enemy.specialAction = { state: 'areaMark', targetId: hero.id, centerX: hero.x, radius: 48, startTick: combatTime(state), impactTick: combatTime(state) + ticksForSeconds(120), abilityId: 'bomber-blast' };
    state.stageStartedTick = state.tick - ticksForSeconds(stageConfig(state.progress.stage).timeoutSec);
    const start = state.tick;
    step(state, 3);
    expect(state.stats.losses).toBe(1);
    expect(state.tick - start).toBeLessThanOrEqual(3);
    expect(forced(state, 'special')).toBe(1);
  });

  it('does not time out a fresh wave just because a stuck special was cleared', () => {
    const state = createState(7111);
    const enemy = quiet(state);
    const hero = state.party[0]!;
    enemy.hp = enemy.maxHp = 1_000_000;
    enemy.specialAction = { state: 'areaMark', targetId: hero.id, centerX: hero.x, radius: 48, startTick: combatTime(state), impactTick: combatTime(state) + ticksForSeconds(120), abilityId: 'bomber-blast' };
    step(state, PRESENTATION_CAP_TICKS);
    expect(state.stats.losses).toBe(0);
    expect(state.phase.kind).toBe('battle');
    expect(enemy.specialAction).toBeUndefined();
    expect(state.party.some(unit => (unit.gauge ?? 0) > 0 || unit.action?.state === 'windup')).toBe(true);
  });

  it('expires a hostile projectile that outlives the flight cap so the wave can clear', () => {
    const state = createState(7112);
    state.enemies.forEach(unit => { unit.hp = 0; unit.moving = false; unit.action = { state: 'idle' }; });
    state.party.forEach(unit => { unit.action = { state: 'idle' }; unit.moving = false; });
    const now = combatTime(state);
    state.projectiles = [{ id: 'stuck-arrow', sourceId: state.enemies[0]!.id, sourceSide: 'enemy', targetId: state.party[0]!.id, targetSide: 'hero', abilityId: 'enemy-basic', delivery: 'homing', x: 10, speed: 1, atk: 10, coefficient: 1, releasedAtTick: now, impactNotBeforeTick: now + ticksForSeconds(30), expiresAtTick: now + ticksForSeconds(120) }];
    step(state, PARTY_V2.timing.projectileExpiryTicks + 1);
    expect(state.projectiles ?? []).toEqual([]);
    expect(state.stats.losses).toBe(0);
    expect(state.phase.kind).not.toBe('battle');
  });

  it('suppresses legendary hit-stop when the simulation jump already passed the hold', () => {
    const hitstop = { holdMs: 140, slowFactor: 0.5 };
    expect(presentationHitstop(hitstop, 1, 1000 / CONFIG.sim.ticksPerSecond)).toEqual(hitstop);
    expect(presentationHitstop(hitstop, 2, 50)).toEqual(hitstop);
    expect(presentationHitstop(hitstop, 5, 50)).toBeNull();
    const clock = new PresentationLaneClock();
    clock.reset(0, 'a:1');
    let time = 0;
    for (let frame = 0; frame < 8; frame += 1) {
      time += 5;
      const sample = clock.sample(time, presentationHitstop(hitstop, 5, 50), 0, false, false, 'a:1');
      expect(sample.time).toBe(time);
      expect(sample.debtTicks).toBe(0);
    }
    clock.reset(10, 'a:1');
    expect(clock.sample(12, presentationHitstop(hitstop, 2, 50), 100, false, false, 'a:1').time).toBe(10);
  });

  it('keeps every sampled fight inside the cap, with no force-complete and no stall long enough to time a wave out', () => {
    const rows: { seed: number; stage: number; maxAge: number; maxStall: number; forced: number; losses: number }[] = [];
    const watch = (seed: number, seconds: number, setup?: (state: GameState) => void, policy = false): void => {
      const state = createState(seed);
      setup?.(state);
      const cursor: PolicyCursor = { revision: -1 };
      let last = '';
      let stall = 0;
      let maxStall = 0;
      let maxAge = 0;
      let stuckLosses = 0;
      for (let i = 0; i < ticksForSeconds(seconds); i += 1) {
        if (policy) referencePolicy(state, cursor);
        const before = state.stats.losses;
        step(state);
        const battle = state.phase.kind === 'battle' && state.enemies.some(unit => unit.hp > 0) && state.party.some(unit => unit.hp > 0);
        if (!battle) { stall = 0; last = ''; continue; }
        const now = combatTime(state);
        const parts: string[] = [];
        let busy = false;
        for (const unit of [...state.party, ...state.enemies]) {
          if (unit.hp <= 0) continue;
          const action = unit.action;
          if (action && action.state !== 'idle') {
            busy = true;
            const age = now - action.startTick;
            maxAge = Math.max(maxAge, age);
            expect(action.startTick).toBeLessThanOrEqual(now);
            expect(age).toBeLessThanOrEqual(PRESENTATION_CAP_TICKS);
            const delivery = action.delivery ?? 'leap';
            const sample = sampleActionPresentation(delivery, actionBoundaries(unit.sourceId, delivery, action), now);
            parts.push(`${unit.id}:${action.state}:${action.startTick}:${sample.phase}:${Math.floor(sample.ageMs)}`);
          } else parts.push(`${unit.id}:idle:${unit.gauge ?? 0}:${unit.moving ? 1 : 0}`);
          if (unit.specialAction) {
            busy = true;
            const age = now - unit.specialAction.startTick;
            maxAge = Math.max(maxAge, age);
            expect(unit.specialAction.startTick).toBeLessThanOrEqual(now);
            expect(age).toBeLessThanOrEqual(PRESENTATION_CAP_TICKS);
            parts.push(`${unit.id}:${unit.specialAction.state}:${unit.specialAction.startTick}`);
          }
        }
        const sig = parts.join('|');
        if (sig === last && busy) stall += 1; else stall = 0;
        maxStall = Math.max(maxStall, stall);
        if (state.stats.losses > before && stall > PRESENTATION_CAP_TICKS) stuckLosses += 1;
        last = sig;
      }
      expect(stuckLosses).toBe(0);
      expect(maxStall).toBeLessThanOrEqual(PRESENTATION_CAP_TICKS);
      expect(state.eventCounts.presentationForced ?? 0).toBe(0);
      rows.push({ seed, stage: state.progress.stage, maxAge, maxStall, forced: state.eventCounts.presentationForced ?? 0, losses: state.stats.losses });
    };
    for (const seed of [1, 2, 3, 4, 5, 6]) watch(seed, 20, undefined, true);
    for (const stage of [12, 13]) {
      watch(stage + 20, 15, state => {
        state.highestCleared = stage - 1;
        state.progress = { kind: 'PUSHING', stage };
        beginEncounter(state);
      });
    }
    expect(rows.every(row => row.forced === 0 && row.maxAge <= PRESENTATION_CAP_TICKS && row.maxStall <= PRESENTATION_CAP_TICKS)).toBe(true);
    expect(Math.max(...rows.map(row => row.maxAge))).toBeGreaterThan(0);
  });
});
