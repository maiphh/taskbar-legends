import { CONFIG, ticksForSeconds } from '../config';
import { grantXp } from './economy';
import { combatTime } from './clock';
import { emit, goldChange } from './events';
import { applyPartyEffect, effectiveAttack, effectiveDamageReduction, effectiveDefense, effectActive, prunePartyEffects } from './party-effects';
import { getPartyHeroDefinition } from './party-definitions';
import { getPartyEnemyDefinition } from './party-enemies';
import { partyKillReward } from './rewards';
import {
  applyHeroSupportStatuses, applyOnHitStatuses, beginStatusTurn, cleanseUnit, clearUnitStatuses,
  completeStatusTurn, finishStatusTurn, markStatusTurn, statusSystemOn, unitHasStatus,
} from './status-effects';
import { spendTurn, type GaugeUnit } from './turn/action-bar';
import { canAct, fillMultiplier, onTurnStart, statusDef, type RunningStatus } from './turn/statuses';
import { actionBoundaries, createActionTimeline, hasUnfinishedPresentation } from './turn/animation-timing';
import type { GameEvent, GameState, PartyProjectile, Unit } from './model';

export const PARTY_V2 = Object.freeze({
  version: 'party-v2', radius: { normal: 10, tank: 12 }, reach: { melee: 12, ranged: 260, heal: 260 },
  timing: { windupTicks: 10, returnTicks: 3, settleTicks: 1, minimumRecoveryTicks: 22, projectileExpiryTicks: ticksForSeconds(4), projectileSpeed: 500 },
  animation: { attackImpactFraction: 0.5, healImpactFraction: 0.5 },
  speed: { tank: 65, melee: 90, support: 65, ranged: 80, enemyMelee: 70, enemyRanged: 55 },
});

/** World px per tick while a fresh wave marches from entry x to its formation slot. */
export const ENEMY_ENTRY_PX = 12;

/** Fixed enemy home x for a formation slot. Heroes stay on CONFIG.sim.heroSlotX. */
export function enemyFormationX(slot: number): number {
  return 158 + slot * 18;
}

/**
 * Longest a single action or enemy special may hold the lane. Honest clips
 * (boss leap, assassin mark, bomber telegraph) finish well inside this.
 * Anything older, scheduled longer, or stamped on the wrong clock is cleared.
 */
export const PRESENTATION_CAP_TICKS = ticksForSeconds(2.5);

function marchLimitPx(): number {
  let max = 0;
  for (let slot = 0; slot < CONFIG.runtime.maxEnemiesPerWave; slot += 1) {
    const spawn = CONFIG.sim.enemySpawnX + slot * CONFIG.sim.enemySpawnSpacingPx;
    max = Math.max(max, Math.abs(spawn - enemyFormationX(slot)));
  }
  return max + ENEMY_ENTRY_PX;
}

/** Farthest a configured spawn slot walks. Farther positions snap home so a stuck mover cannot hold the lane. */
export const ENEMY_MARCH_LIMIT_PX = marchLimitPx();

export type SkillDelivery = 'leap' | 'cast';

/** Turn gauge speed from role and basic style. Not pixel movement speed. */
export function turnSpd(unit: Unit): number {
  if (unit.side === 'enemy') {
    if (unit.sourceId === 'assassin') return 110;
    const style = getPartyEnemyDefinition(unit.sourceId).basicStyle;
    return style === 'projectile' ? 100 : 95;
  }
  const hero = getPartyHeroDefinition(unit.sourceId);
  if (hero.role === 'tank') return 90;
  if (hero.role === 'support') return 115;
  return hero.basic.style === 'melee' ? 100 : 105;
}

export interface Body { x: number; radius: number }
export function edgeDistance(a: Body, b: Body): number { return Math.max(0, Math.abs(a.x - b.x) - a.radius - b.radius); }
export function inEdgeReach(a: Body, b: Body, reach: number): boolean { return edgeDistance(a, b) <= reach; }
export function presentationCombatTime(state: GameState): number {
  const native = combatTime(state);
  if (state.phase.kind !== 'farmPad' || state.phase.presentationStartedAtTick === undefined) return native;
  return native + Math.max(0, state.tick - state.phase.presentationStartedAtTick);
}
export function combatEventAge(state: GameState, event: GameEvent): number | null {
  if (event.combatEncounter !== state.encounter) return null;
  return presentationCombatTime(state) - (event.combatTick ?? event.tick);
}
export function partyUnitFields(unit: Unit): Pick<Unit, 'radius' | 'speed' | 'range' | 'facing' | 'targetId' | 'moving' | 'action' | 'mana'> {
  const role = unit.side === 'hero' ? getPartyHeroDefinition(unit.sourceId).role : null;
  const radius = unit.side === 'hero' && role === 'tank' ? PARTY_V2.radius.tank : PARTY_V2.radius.normal;
  const enemyDefinition = unit.side === 'enemy' ? getPartyEnemyDefinition(unit.sourceId) : undefined;
  const speed = unit.side === 'enemy'
    ? enemyDefinition!.speed
    : role === 'tank' ? PARTY_V2.speed.tank : role === 'dps' && getPartyHeroDefinition(unit.sourceId).tags.includes('melee') ? PARTY_V2.speed.melee : role === 'support' ? PARTY_V2.speed.support : PARTY_V2.speed.ranged;
  const range = unit.side === 'enemy' ? enemyDefinition!.range : getPartyHeroDefinition(unit.sourceId).basic.range;
  return { radius, speed, range, facing: unit.side === 'hero' ? 1 : -1, targetId: null, moving: false, mana: 0, action: { state: 'idle' } };
}

type ActionKind = 'attack' | 'heal';
type PickedTarget = { target: Unit; kind: ActionKind; abilityId?: string };
type Impact = { source: Unit; target: Unit; targetId: string; kind: ActionKind; abilityId?: string; reason?: 'target' | 'range' | 'facing' | 'unneeded' };
type EffectKind = 'atkBonus' | 'atkReduction' | 'defReduction' | 'damageReduction';
type DamageIntent = { source: Unit; target: Unit; coefficient: number; snapAtk?: number; abilityId: string; basic: boolean; projectileId?: string; interceptable: boolean; primary: boolean };
type PendingHeal = { source: Unit; target: Unit; amount: number; effect?: { group: string; kind: EffectKind; magnitude: number; durationTicks: number }; requiresHit?: { sourceId: string; targetId: string }; cooldownId?: string; cooldownTicks?: number; impact?: Impact; basic?: boolean };

function compareId(a: Unit, b: Unit): number { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
function living(units: readonly Unit[]): Unit[] { return units.filter(unit => unit.hp > 0).sort(compareId); }
function radius(unit: Unit): number { return unit.radius ?? PARTY_V2.radius.normal; }
function partyDef(unit: Unit) { return unit.side === 'hero' ? getPartyHeroDefinition(unit.sourceId) : undefined; }
function unitRole(unit: Unit) { return partyDef(unit)?.role ?? null; }
function skillDelivery(source: Unit, abilityId?: string): SkillDelivery {
  if (source.side === 'enemy') {
    return getPartyEnemyDefinition(source.sourceId).basicStyle === 'melee' ? 'leap' : 'cast';
  }
  const def = partyDef(source);
  if (!def) return 'cast';
  if (abilityId && abilityId !== def.basic.id) {
    const kind = def.active.kind;
    if (kind === 'cleave' || kind === 'singleBurst') return 'leap';
    return 'cast';
  }
  return def.basic.style === 'melee' ? 'leap' : 'cast';
}
function unitStatuses(unit: Unit): RunningStatus[] {
  return (unit.statuses ??= []) as RunningStatus[];
}
function toGaugeUnit(unit: Unit): GaugeUnit & { ref: Unit } {
  if (unit.gauge === undefined) unit.gauge = 0;
  return {
    id: unit.id,
    side: unit.side === 'hero' ? 'party' : 'enemy',
    slot: unit.slot,
    gauge: unit.gauge,
    spd: turnSpd(unit),
    hp: unit.hp,
    statuses: unitStatuses(unit),
    ref: unit,
  };
}
function syncGauge(wrapper: GaugeUnit & { ref: Unit }): void {
  wrapper.ref.gauge = wrapper.gauge;
}
function presentationBusy(unit: Unit): boolean {
  const action = unit.action;
  if (action?.state === 'windup' || action?.state === 'recovery') return true;
  return !!unit.specialAction;
}
function presentationOverdue(startTick: number, endTick: number, now: number): boolean {
  if (!Number.isFinite(startTick) || !Number.isFinite(endTick) || !Number.isFinite(now)) return true;
  if (startTick > now) return true;
  if (now - startTick >= PRESENTATION_CAP_TICKS) return true;
  return endTick - startTick > PRESENTATION_CAP_TICKS;
}
/** Drop a presentation that can no longer finish on its own. Due impacts are left for the resolver when requested. */
function releaseStalePresentations(state: GameState, units: readonly Unit[], now: number, keepResolvable: boolean): void {
  for (const unit of units) {
    if (unit.hp <= 0) continue;
    const action = unit.action;
    if (action && action.state !== 'idle') {
      const end = action.readyTick ?? action.impactTick;
      const due = action.state === 'windup' && Number.isFinite(action.impactTick) && action.impactTick <= now;
      const finishedRecovery = action.state === 'recovery' && Number.isFinite(action.readyTick) && action.readyTick <= now;
      if (finishedRecovery) unit.action = { state: 'idle' };
      else if (presentationOverdue(action.startTick, end, now) && !(keepResolvable && due)) {
        unit.action = { state: 'idle' };
        if (statusSystemOn()) finishStatusTurn(state, unit, now);
        emit(state, { type: 'presentationForced', unitId: unit.id, kind: 'action' }, now);
      }
    }
    const special = unit.specialAction;
    if (!special) continue;
    const due = Number.isFinite(special.impactTick) && special.impactTick <= now;
    if (presentationOverdue(special.startTick, special.impactTick, now) && !(keepResolvable && due)) {
      delete unit.specialAction;
      if (statusSystemOn()) finishStatusTurn(state, unit, now);
      emit(state, { type: 'presentationForced', unitId: unit.id, kind: 'special' }, now);
    }
  }
}
export function hasPendingActionPresentation(state: GameState): boolean {
  const now = combatTime(state);
  return [...state.party, ...state.enemies].some(unit => unit.hp > 0 && (!!unit.specialAction || (unit.action && unit.action.state !== 'idle'
    && hasUnfinishedPresentation(unit.sourceId, unit.action, now))));
}
function isTank(unit: Unit): boolean { return unit.side === 'hero' && unitRole(unit) === 'tank'; }
function distance(a: Unit, b: Unit): number { return edgeDistance({ x: a.x, radius: radius(a) }, { x: b.x, radius: radius(b) }); }
function targetPool(state: GameState, source: Unit, kind: ActionKind): Unit[] { return kind === 'heal' ? (source.side === 'hero' ? state.party : state.enemies) : (source.side === 'hero' ? state.enemies : state.party); }
function nearest(source: Unit, candidates: Unit[]): Unit | undefined { return candidates.sort((a, b) => distance(source, a) - distance(source, b) || compareId(a, b))[0]; }
function existingTarget(state: GameState, source: Unit): Unit | undefined {
  if (!source.targetId) return undefined;
  return targetPool(state, source, 'attack').find(unit => unit.id === source.targetId && unit.hp > 0);
}
function hurtAlly(state: GameState, threshold = 0.9): Unit | undefined {
  return living(state.party).filter(ally => ally.hp / ally.maxHp < threshold).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || compareId(a, b))[0];
}
function attackTarget(state: GameState, source: Unit): Unit | undefined { return existingTarget(state, source) ?? nearest(source, living(targetPool(state, source, 'attack'))); }
function setCooldown(unit: Unit, id: string, readyAt: number): void { (unit.partyCooldowns ??= {})[id] = readyAt; }
function cooldownReady(unit: Unit, id: string, now: number): boolean { return (unit.partyCooldowns?.[id] ?? 0) <= now; }
function threatened(state: GameState, unit: Unit): boolean {
  return living(state.enemies).some(enemy => enemy.targetId === unit.id || distance(enemy, unit) <= enemy.range + radius(unit));
}
function supportTarget(state: GameState): Unit | undefined {
  return living(state.party).sort((a, b) => effectiveAttack(state, b) / b.attackTicks - effectiveAttack(state, a) / a.attackTicks || compareId(a, b))[0];
}
function chooseActive(state: GameState, source: Unit, target: Unit | undefined): PickedTarget | undefined {
  const def = partyDef(source); if (!def || (source.mana ?? 0) < manaCost(def)) return undefined;
  const active = def.active;
  const enemy = target;
  let picked: PickedTarget | undefined;
  switch (active.kind) {
    case 'shield': if (source.hp / source.maxHp < (active.hpThreshold ?? 0.9) || threatened(state, source)) picked = { target: source, kind: 'heal', abilityId: active.id }; break;
    case 'selfHeal': if (source.hp / source.maxHp < (active.hpThreshold ?? 0.65)) picked = { target: source, kind: 'heal', abilityId: active.id }; break;
    case 'burstHeal': { const ally = hurtAlly(state, active.hpThreshold ?? 0.8); if (ally) picked = { target: ally, kind: 'heal', abilityId: active.id }; break; }
    case 'buff': {
      const ally = supportTarget(state);
      if (ally && !(statusSystemOn() ? unitHasStatus(ally, 'atkUp') : effectActive(state, ally.id, 'party-atk-buff'))) {
        picked = { target: ally, kind: 'heal', abilityId: active.id };
      }
      break;
    }
    case 'selfSustain': if (enemy && source.hp < source.maxHp) picked = { target: enemy, kind: 'attack', abilityId: active.id }; break;
    case 'weaken': {
      if (enemy) {
        const blocked = statusSystemOn()
          ? unitHasStatus(enemy, 'atkDown') || unitHasStatus(enemy, 'defDown')
          : effectActive(state, enemy.id, 'enemy-atk-weaken') || effectActive(state, enemy.id, 'enemy-def-weaken');
        if (!blocked) picked = { target: enemy, kind: 'attack', abilityId: active.id };
      }
      break;
    }
    case 'cleave': case 'projectile': case 'fireball': case 'singleBurst': if (enemy) picked = { target: enemy, kind: 'attack', abilityId: active.id }; break;
    case 'intercept': break;
  }
  return picked;
}
function manaCost(def: NonNullable<ReturnType<typeof partyDef>>): number {
  return def.active.manaCost ?? 60;
}
function chooseTarget(state: GameState, source: Unit): PickedTarget | undefined {
  if (source.side === 'hero') {
    const def = getPartyHeroDefinition(source.sourceId), target = attackTarget(state, source);
    const active = chooseActive(state, source, target);
    if (active) return active;
    if (def.basic.style === 'heal') {
      const hurt = hurtAlly(state, 0.9);
      if (hurt) return { target: hurt, kind: 'heal', abilityId: def.basic.id };
    }
    return target ? { target, kind: 'attack', abilityId: def.basic.id } : undefined;
  }
  const tanks = living(state.party).filter(isTank);
  if (tanks.length) return { target: tanks[0]!, kind: 'attack' };
  const old = existingTarget(state, source);
  const target = old ?? nearest(source, living(targetPool(state, source, 'attack')));
  return target ? { target, kind: 'attack' } : undefined;
}
function rearmostHero(state: GameState): Unit | undefined {
  return living(state.party).sort((a, b) => a.x - b.x || compareId(a, b))[0];
}
function aimDirection(source: Unit, target: Unit): -1 | 1 {
  if (target.x < source.x) return -1;
  if (target.x > source.x) return 1;
  return source.facing ?? -1;
}
function startEnemySpecial(state: GameState, source: Unit, now: number): boolean {
  if (source.side !== 'enemy') return false;
  const definition = getPartyEnemyDefinition(source.sourceId);
  const enrage = definition.enrage;
  const target = nearest(source, living(state.party));
  // Signature enrage: once below the HP gate, telegraph a burst and lock the atk mult.
  if (enrage && target && (source.procCounters?.enraged ?? 0) === 0 && source.hp <= source.maxHp * enrage.hpPct) {
    source.procCounters ??= {}; source.procCounters.enraged = 1;
    source.specialAction = {
      state: 'areaMark', targetId: target.id, centerX: target.x, radius: enrage.burstGlobal ? 0 : 64,
      startTick: now, impactTick: now + enrage.telegraphTicks, abilityId: enrage.abilityId,
      ...(enrage.burstGlobal ? { global: true } : {}),
    };
    emit(state, { type: 'skill', unitId: source.id, skill: enrage.abilityId }, now);
    return true;
  }
  const special = definition.special;
  if (!special) return false;
  if (special.kind === 'assassin') {
    const rear = rearmostHero(state); if (!rear) return false;
    source.specialAction = { state: 'assassinMark', targetId: rear.id, startTick: now, impactTick: now + special.markTicks };
    emit(state, { type: 'skill', unitId: source.id, skill: 'assassin-mark' }, now);
    return true;
  }
  if (!target) return false;
  if (special.kind === 'localArea') {
    if (!cooldownReady(source, special.abilityId, now)) return false;
    setCooldown(source, special.abilityId, now + special.cooldownTicks);
  } else if (special.kind === 'bossLocal' || special.kind === 'bossGlobal') {
    const successful = source.procCounters?.basicSuccess ?? 0, used = source.procCounters?.bossPattern ?? 0;
    if (successful < (used + 1) * special.every) return false;
    source.procCounters ??= {}; source.procCounters.bossPattern = used + 1;
  } else {
    return false;
  }
  source.specialAction = { state: 'areaMark', targetId: target.id, centerX: target.x, radius: special.kind === 'bossGlobal' ? 0 : special.radius,
    startTick: now, impactTick: now + special.telegraphTicks, abilityId: special.abilityId, ...(special.kind === 'bossGlobal' ? { global: true } : {}) };
  emit(state, { type: 'skill', unitId: source.id, skill: special.abilityId }, now);
  return true;
}
function advanceEnemySpecials(state: GameState, now: number): { busy: Set<string>; damage: DamageIntent[] } {
  const busy = new Set<string>(), damage: DamageIntent[] = [];
  for (const source of living(state.enemies)) {
    const action = source.specialAction;
    if (!action) continue;
    busy.add(source.id);
    if (action.state === 'areaMark') {
      if (action.impactTick > now) continue;
      const timeline = createActionTimeline(source.sourceId, 'cast', now, { farmFast: farmFastTimeline(state) });
      const target = state.party.find(unit => unit.id === action.targetId);
      source.action = { state: 'recovery', kind: 'attack', targetId: action.targetId, targetSide: 'hero', targetSlot: target?.slot ?? 0,
        targetCount: state.enemies.length, ...timeline, abilityId: action.abilityId, delivery: 'cast' };
      source.specialAction = { ...action, state: 'areaImpact', startTick: now, impactTick: timeline.impactTick };
      continue;
    }
    if (action.state === 'areaImpact') {
      if (action.impactTick > now) continue;
      const enemy = getPartyEnemyDefinition(source.sourceId);
      const special = enemy.special;
      const enrage = enemy.enrage;
      let coefficient = 1;
      if (enrage && action.abilityId === enrage.abilityId) coefficient = enrage.burstCoefficient;
      else if (special?.kind === 'localArea' || special?.kind === 'bossLocal' || special?.kind === 'bossGlobal') coefficient = special.coefficient;
      const targets = action.global ? living(state.party) : living(state.party).filter(target => Math.abs(target.x - action.centerX) <= action.radius + radius(target));
      for (const target of targets.sort(compareId)) damage.push({ source, target, coefficient, abilityId: action.abilityId, basic: false, interceptable: !action.global, primary: target.id === action.targetId });
      delete source.specialAction;
      if (statusSystemOn()) finishStatusTurn(state, source, now);
      continue;
    }
    if (action.state === 'assassinDash') {
      // Legacy dash: convert to a leap windup without moving x.
      const target = state.party.find(unit => unit.id === action.targetId && unit.hp > 0);
      delete source.specialAction;
      source.moving = false;
      if (!target) {
        if (statusSystemOn()) finishStatusTurn(state, source, now);
        continue;
      }
      source.facing = aimDirection(source, target);
      source.targetId = target.id;
      const timeline = createActionTimeline(source.sourceId, 'leap', now, { farmFast: farmFastTimeline(state) });
      source.action = { state: 'windup', kind: 'attack', targetId: target.id, targetSide: target.side, targetSlot: target.slot, targetCount: state.enemies.length, ...timeline, delivery: 'leap' };
      emit(state, { type: 'actionStart', unitId: source.id, targetId: target.id, kind: 'attack', startTick: now, impactTick: timeline.impactTick }, now);
      continue;
    }
    const target = state.party.find(unit => unit.id === action.targetId && unit.hp > 0);
    if (!target) {
      delete source.specialAction;
      source.moving = false;
      if (statusSystemOn()) finishStatusTurn(state, source, now);
      continue;
    }
    if (action.state === 'assassinMark') {
      if (action.impactTick > now) continue;
      const enemy = getPartyEnemyDefinition(source.sourceId), special = enemy.special;
      if (!special || special.kind !== 'assassin') {
        delete source.specialAction;
        if (statusSystemOn()) finishStatusTurn(state, source, now);
        continue;
      }
      delete source.specialAction;
      source.moving = false;
      source.facing = aimDirection(source, target);
      source.targetId = target.id;
      const timeline = createActionTimeline(source.sourceId, 'leap', now, { farmFast: farmFastTimeline(state) });
      source.action = { state: 'windup', kind: 'attack', targetId: target.id, targetSide: target.side, targetSlot: target.slot, targetCount: state.enemies.length, ...timeline, delivery: 'leap' };
      emit(state, { type: 'actionStart', unitId: source.id, targetId: target.id, kind: 'attack', startTick: now, impactTick: timeline.impactTick }, now);
    }
  }
  return { busy, damage };
}
function recover(source: Unit, action: Extract<NonNullable<Unit['action']>, { state: 'windup' }>, anchor?: Pick<Unit, 'side' | 'slot'>, targetCount = 1): void {
  const delivery = action.delivery ?? skillDelivery(source, action.abilityId);
  const timeline = actionBoundaries(source.sourceId, delivery, action);
  source.action = {
    state: 'recovery', kind: action.kind, targetId: action.targetId, ...timeline,
    ...(action.abilityId ? { abilityId: action.abilityId } : {}), delivery,
    ...(anchor ? { targetSide: anchor.side, targetSlot: anchor.slot, targetCount } : {}),
  };
  source.moving = false;
}
function miss(state: GameState, impact: Impact, reason: Impact['reason']): void {
  if (!reason) return;
  const now = combatTime(state);
  emit(state, { type: 'miss', unitId: impact.source.id, targetId: impact.targetId, kind: impact.kind, reason }, now);
  const action = impact.source.action;
  if (action?.state === 'windup') {
    recover(impact.source, action, { side: action.targetSide ?? impact.target.side, slot: action.targetSlot ?? impact.target.slot }, action.targetCount ?? 1);
    if (statusSystemOn()) completeStatusTurn(state, impact.source, now);
  }
}
function rewardDeath(state: GameState, target: Unit): void {
  if (target.side !== 'enemy') return;
  const reward = partyKillReward(target.sourceId, state.progress.stage);
  goldChange(state, reward.gold, 'kill'); grantXp(state, reward.xp);
}
function applyEffect(state: GameState, source: Unit, target: Unit, effect: { group: string; kind: EffectKind; magnitude: number; durationTicks: number; stackPolicy?: 'strongestRefresh' | 'sourceAura' }, now: number, emitIfChanged = true): void {
  const value = { id: `${effect.group}:${target.id}`, sourceId: source.id, targetId: target.id, group: effect.group, kind: effect.kind, magnitude: effect.magnitude, appliedAtTick: now, expiresAtTick: now + effect.durationTicks, stackPolicy: effect.stackPolicy ?? 'strongestRefresh' } as const;
  applyPartyEffect(state, { ...value });
  if (emitIfChanged) emit(state, { type: 'effect', sourceId: source.id, targetId: target.id, effectId: effect.group, group: effect.group, expiresAtTick: now + effect.durationTicks }, now);
}
export function applyPartyShield(state: GameState, source: Unit, target: Unit, amount: number, durationTicks: number, now: number): void {
  const active = target.shieldUntilTick > now, previous = active ? target.shield : 0;
  const nextAmount = Math.round(amount);
  if (!active || nextAmount > previous) target.shieldProviderId = source.id;
  target.shield = Math.max(previous, nextAmount);
  target.shieldUntilTick = Math.max(active ? target.shieldUntilTick : 0, now + durationTicks);
  emit(state, { type: 'skill', unitId: source.id, skill: 'shield' }, now);
}
function heal(state: GameState, source: Unit, target: Unit, amount: number, now: number): number {
  if (source.hp <= 0 || target.hp <= 0) return 0;
  const actual = Math.min(target.maxHp - target.hp, Math.max(0, Math.round(amount)));
  if (!actual) return 0;
  target.hp += actual; emit(state, { type: 'heal', sourceId: source.id, targetId: target.id, amount: actual }, now); return actual;
}
function commitAbility(state: GameState, impact: Impact, now: number): boolean {
  const source = impact.source, def = partyDef(source), id = impact.abilityId;
  if (!def || !id || id === def.basic.id) return false;
  const ability = def.active; if (ability.id !== id) return false;
  const target = impact.target;
  switch (ability.kind) {
    case 'shield': applyPartyShield(state, source, source, source.maxHp * (ability.shieldFraction ?? 0), ability.durationTicks ?? 0, now); break;
    case 'selfHeal': heal(state, source, source, source.maxHp * (ability.healCoefficient ?? 0), now); break;
    case 'burstHeal': {
      const healed = heal(state, source, target, effectiveAttack(state, source) * (ability.healCoefficient ?? 0), now);
      if (healed > 0) {
        if (statusSystemOn()) {
          cleanseUnit(state, source, target, ability.id, now);
          applyHeroSupportStatuses(state, source, target, ability.id, now, { healed: true });
        } else {
          applyEffect(state, source, target, { group: 'healing-guard', kind: 'damageReduction', magnitude: 0.1, durationTicks: ticksForSeconds(2) }, now);
        }
      }
      if (!healed) return false; break;
    }
    case 'buff':
      if (statusSystemOn()) applyHeroSupportStatuses(state, source, target, ability.id, now);
      else applyEffect(state, source, target, { group: 'party-atk-buff', kind: 'atkBonus', magnitude: ability.atkBonus ?? 0, durationTicks: ability.durationTicks ?? 0 }, now);
      break;
    case 'weaken':
      if (statusSystemOn()) applyHeroSupportStatuses(state, source, target, ability.id, now);
      else {
        applyEffect(state, source, target, { group: 'enemy-atk-weaken', kind: 'atkReduction', magnitude: ability.atkReduction ?? 0, durationTicks: ability.durationTicks ?? 0 }, now);
        applyEffect(state, source, target, { group: 'enemy-def-weaken', kind: 'defReduction', magnitude: ability.defReduction ?? 0, durationTicks: ability.durationTicks ?? 0 }, now);
      }
      break;
    case 'selfSustain': return false;
    case 'cleave': case 'projectile': case 'fireball': case 'singleBurst': return false;
    case 'intercept': return false;
  }
  source.mana = 0; emit(state, { type: 'skill', unitId: source.id, skill: ability.id }, now); return true;
}
function farmDamageRamp(state: GameState, source: Unit): number {
  const clock = state.farmClock;
  if (source.side !== 'hero' || !clock || clock.scale <= 1) return 1;
  const afterSec = CONFIG.combat.farmDamageRampAfterSec, mult = CONFIG.combat.farmDamageRampMult;
  if (afterSec === undefined || mult === undefined) return 1;
  if (clock.elapsedTicks < ticksForSeconds(afterSec)) return 1;
  return mult;
}
function damageAmount(state: GameState, source: Unit, target: Unit, coefficient: number, snapAtk?: number): number {
  const atk = snapAtk ?? effectiveAttack(state, source), def = effectiveDefense(state, target), dr = effectiveDamageReduction(state, target);
  const base = Math.max(1, Math.round(atk * coefficient * 100 / (100 + def) * (1 - dr)));
  const ramp = farmDamageRamp(state, source);
  return ramp === 1 ? base : Math.max(1, Math.round(base * ramp));
}
function farmFastTimeline(state: GameState): boolean {
  return (state.farmClock?.scale ?? 1) > 1;
}
interface DamageResult { intent: DamageIntent; total: number; hpDamage: number; absorbed: number }
function applyDamageBatch(state: GameState, intents: DamageIntent[], now: number): DamageResult[] {
  const ordered = [...intents].sort((a, b) => a.source.id.localeCompare(b.source.id) || (a.projectileId ?? '').localeCompare(b.projectileId ?? '') || a.target.id.localeCompare(b.target.id));
  const shieldLeft = new Map<string, number>(), hpLeft = new Map<string, number>(), initialHp = new Map<string, number>(), results: DamageResult[] = [];
  for (const intent of ordered) {
    const target = intent.target;
    if (target.hp <= 0 && !hpLeft.has(target.id)) continue;
    if (!shieldLeft.has(target.id)) { shieldLeft.set(target.id, target.shieldUntilTick > now ? target.shield : 0); hpLeft.set(target.id, target.hp); initialHp.set(target.id, target.hp); }
    const amount = damageAmount(state, intent.source, target, intent.coefficient, intent.snapAtk);
    const absorbed = Math.min(shieldLeft.get(target.id) ?? 0, amount); shieldLeft.set(target.id, (shieldLeft.get(target.id) ?? 0) - absorbed);
    const hpDamage = Math.min(hpLeft.get(target.id) ?? 0, amount - absorbed); hpLeft.set(target.id, (hpLeft.get(target.id) ?? 0) - hpDamage);
    const total = absorbed + hpDamage; results.push({ intent, total, hpDamage, absorbed });
    if (absorbed > 0) emit(state, { type: 'shieldAbsorb', attackerId: intent.source.id, targetId: target.id, ...(target.shieldProviderId ? { providerId: target.shieldProviderId } : {}), amount: absorbed }, now);
    if (hpDamage > 0) emit(state, { type: 'hit', attackerId: intent.source.id, targetId: target.id, damage: hpDamage, side: target.side }, now);
  }
  const targets = new Set(ordered.map(intent => intent.target.id));
  for (const targetId of [...targets].sort()) {
    const target = [...state.party, ...state.enemies].find(unit => unit.id === targetId);
    if (!target || !hpLeft.has(targetId)) continue;
    target.hp = hpLeft.get(targetId)!; target.shield = shieldLeft.get(targetId)!;
    if (!target.shield) delete target.shieldProviderId;
  }
  for (const targetId of [...targets].sort()) {
    const target = [...state.party, ...state.enemies].find(unit => unit.id === targetId);
    if (target && target.hp === 0 && (initialHp.get(targetId) ?? 0) > 0) {
      if (target.side === 'enemy') { delete target.specialAction; target.moving = false; }
      emit(state, { type: 'death', unitId: target.id, side: target.side }, now); rewardDeath(state, target);
    }
  }
  return results;
}
function successfulBasic(result: DamageResult): void {
  const { intent } = result, source = intent.source;
  source.procCounters ??= {}; source.procCounters.basicSuccess = (source.procCounters.basicSuccess ?? 0) + 1;
  const def = partyDef(source); if (!def) return;
  source.mana = Math.min(manaCost(def), (source.mana ?? 0) + 20);
}
function basicCoefficient(source: Unit, target: Unit): number {
  const def = partyDef(source); if (!def) return 1;
  if (source.action && source.side === 'hero') return def.basic.coefficient;
  void target;
  return def.basic.coefficient;
}
function prepareAttack(state: GameState, impact: Impact, now: number, damage: DamageIntent[], heals: PendingHeal[]): void {
  const source = impact.source, target = impact.target, def = partyDef(source), active = def?.active, id = impact.abilityId ?? def?.basic.id ?? 'enemy-basic';
  const ability = active?.id === id ? active : undefined, basic = !ability;
  if (ability && ['shield', 'buff', 'weaken'].includes(ability.kind)) { commitAbility(state, impact, now); return; }
  const baseCoefficient = basic ? (def?.basic.style === 'heal' ? def?.basic.fallbackCoefficient ?? 0.7 : basicCoefficient(source, target)) : ability?.coefficient ?? 1;
  if (ability?.kind === 'selfSustain') heals.push({ source, target: source, amount: source.maxHp * (ability.healCoefficient ?? 0), requiresHit: { sourceId: source.id, targetId: target.id } });
  const add = (victim: Unit, coefficient: number, primary: boolean, interceptable = true): void => {
    damage.push({ source, target: victim, coefficient, abilityId: id, basic, interceptable, primary });
  };
  add(target, baseCoefficient, true);
  if (ability?.kind === 'cleave') {
    const secondaryTargets = living(targetPool(state, source, 'attack')).filter(unit => unit.id !== target.id && Math.abs(unit.x - target.x) <= (ability.radius ?? 0) + radius(unit))
      .sort((a, b) => Math.abs(a.x - target.x) - Math.abs(b.x - target.x) || compareId(a, b)).slice(0, ability.maxSecondaryTargets ?? 1);
    for (const secondary of secondaryTargets) add(secondary, ability.secondaryCoefficient ?? 0, false);
  }
  if (ability?.kind === 'fireball') {
    const centerX = target.x;
    for (const secondary of living(targetPool(state, source, 'attack')).filter(unit => unit.id !== target.id && Math.abs(unit.x - centerX) <= (ability.radius ?? 0) + radius(unit)).sort(compareId)) {
      add(secondary, ability.secondaryCoefficient ?? 0, false, false);
    }
  }
  if (ability) { source.mana = 0; emit(state, { type: 'skill', unitId: source.id, skill: ability.id }, now); }
}
function advanceProjectiles(state: GameState, now: number): { damage: DamageIntent[]; consumed: Set<string> } {
  const damage: DamageIntent[] = [], consumed = new Set<string>(), keep: PartyProjectile[] = [];
  for (const projectile of [...(state.projectiles ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    const pool = projectile.targetSide === 'hero' ? state.party : state.enemies;
    const primary = pool.find(unit => unit.id === projectile.targetId && unit.hp > 0);
    const ground = projectile.delivery === 'ground';
    const flightCap = projectile.releasedAtTick + PARTY_V2.timing.projectileExpiryTicks;
    if ((!ground && !primary) || now >= projectile.expiresAtTick || !Number.isFinite(flightCap) || now >= flightCap) {
      emit(state, { type: 'projectile', projectileId: projectile.id, sourceId: projectile.sourceId, action: 'expire' }, now); consumed.add(projectile.id); continue;
    }
    if (projectile.releasedAtTick >= now) { keep.push(projectile); continue; }
    const destination = ground ? projectile.centerX! : primary!.x;
    const delta = destination - projectile.x, perTick = projectile.speed / CONFIG.sim.ticksPerSecond;
    projectile.x += Math.sign(delta) * Math.min(Math.abs(delta), perTick);
    const arrived = now >= projectile.impactNotBeforeTick && (ground ? Math.abs(destination - projectile.x) <= 0.001 : Math.abs(projectile.x - primary!.x) <= radius(primary!) + 2);
    if (!arrived) { keep.push(projectile); continue; }
    consumed.add(projectile.id);
    const source = [...state.party, ...state.enemies].find(unit => unit.id === projectile.sourceId); if (!source) continue;
    const victims = ground ? living(pool).filter(unit => Math.abs(unit.x - destination) <= (projectile.radius ?? 0) + radius(unit)).sort(compareId) : [primary!];
    for (const victim of victims) {
      const isPrimary = victim.id === projectile.targetId, coefficient = isPrimary ? projectile.coefficient : projectile.splashCoefficient ?? 0;
      if (coefficient > 0) damage.push({ source, target: victim, coefficient, snapAtk: projectile.atk, abilityId: projectile.abilityId,
        basic: projectile.basic ?? (partyDef(source)?.basic.id === projectile.abilityId || source.side === 'enemy' && projectile.abilityId === 'enemy-basic'),
        projectileId: projectile.id, interceptable: !ground, primary: isPrimary });
    }
    emit(state, { type: 'projectile', projectileId: projectile.id, sourceId: projectile.sourceId, action: 'impact' }, now);
  }
  state.projectiles = keep;
  return { damage, consumed };
}
export function hasPendingHostileImpact(state: GameState): boolean { return (state.projectiles ?? []).some(projectile => projectile.sourceSide === 'enemy' && projectile.targetSide === 'hero'); }
export function expireFriendlyDeadTargetProjectiles(state: GameState): void {
  if (state.enemies.some(enemy => enemy.hp > 0)) return;
  for (const projectile of state.projectiles ?? []) if (projectile.sourceSide === 'hero' && projectile.targetSide === 'enemy') emit(state, { type: 'projectile', projectileId: projectile.id, sourceId: projectile.sourceId, action: 'expire' }, combatTime(state));
  state.projectiles = (state.projectiles ?? []).filter(projectile => !(projectile.sourceSide === 'hero' && projectile.targetSide === 'enemy'));
}
export function cancelPartyEncounterEffects(state: GameState): void {
  state.partyEffects = [];
  state.projectiles = [];
  clearUnitStatuses(state.party, state.enemies);
}

function beginActorTurn(state: GameState, unit: Unit, now: number): void {
  const wrapper = toGaugeUnit(unit);
  spendTurn(wrapper);
  syncGauge(wrapper);
  if (statusSystemOn()) {
    if (!beginStatusTurn(state, unit, now)) {
      unit.action = { state: 'idle' };
      unit.moving = false;
      return;
    }
    markStatusTurn(unit);
  } else {
    const statuses = unitStatuses(unit);
    if (!canAct(statuses)) {
      const turned = onTurnStart({ id: unit.id, hp: unit.hp, maxHp: unit.maxHp, statuses });
      unit.hp = turned.unit.hp;
      unit.statuses = turned.unit.statuses;
      unit.action = { state: 'idle' };
      unit.moving = false;
      return;
    }
  }
  if (startEnemySpecial(state, unit, now)) {
    unit.moving = false;
    return;
  }
  const choice = chooseTarget(state, unit);
  if (!choice) {
    unit.targetId = null;
    unit.action = { state: 'idle' };
    if (statusSystemOn()) finishStatusTurn(state, unit, now);
    return;
  }
  const target = targetPool(state, unit, choice.kind).find(item => item.id === choice.target.id && item.hp > 0);
  if (!target) {
    unit.targetId = null;
    unit.action = { state: 'idle' };
    if (statusSystemOn()) finishStatusTurn(state, unit, now);
    return;
  }
  const direction = Math.sign(target.x - unit.x);
  if (direction !== 0) unit.facing = direction as -1 | 1;
  unit.targetId = target.id;
  const delivery = skillDelivery(unit, choice.abilityId);
  const timeline = createActionTimeline(unit.sourceId, delivery, now, { farmFast: farmFastTimeline(state) });
  const targetCount = state.enemies.length;
  unit.action = {
    state: 'windup', kind: choice.kind, targetId: target.id, targetSide: target.side, targetSlot: target.slot, targetCount, ...timeline, delivery,
    ...(choice.abilityId ? { abilityId: choice.abilityId } : {}),
  };
  unit.moving = false;
  emit(state, { type: 'actionStart', unitId: unit.id, targetId: target.id, kind: choice.kind, startTick: now, impactTick: timeline.impactTick }, now);
}

function resolveDueImpacts(state: GameState, startUnits: Unit[], now: number, specialDamage: DamageIntent[]): void {
  const due: Impact[] = [];
  for (const source of living(startUnits)) {
    const action = source.action; if (action?.state !== 'windup' || action.impactTick > now) continue;
    const target = targetPool(state, source, action.kind).find(unit => unit.id === action.targetId);
    if (!target || target.hp <= 0) {
      due.push({ source, target: target ?? source, targetId: action.targetId, kind: action.kind, abilityId: action.abilityId, reason: 'target' });
      continue;
    }
    const def = partyDef(source);
    if (def && action.abilityId === def.active.id && (source.mana ?? 0) < manaCost(def)) {
      due.push({ source, target, targetId: action.targetId, kind: action.kind, abilityId: action.abilityId, reason: 'unneeded' });
      continue;
    }
    due.push({ source, target, targetId: target.id, kind: action.kind, abilityId: action.abilityId });
  }
  for (const impact of due) if (impact.reason) miss(state, impact, impact.reason);
  const valid = due.filter(impact => !impact.reason).sort((a, b) => compareId(a.source, b.source) || compareId(a.target, b.target));
  const damage: DamageIntent[] = [...specialDamage], heals: PendingHeal[] = [];
  const statusCommitted = new Set<Impact>();
  for (const impact of valid) {
    const definition = partyDef(impact.source), ability = definition?.active;
    if (ability && ability.id === impact.abilityId && ['shield', 'buff', 'weaken'].includes(ability.kind)) {
      if (commitAbility(state, impact, now)) statusCommitted.add(impact);
    }
  }
  for (const impact of valid) {
    const impactDefinition = partyDef(impact.source);
    if (impact.kind === 'attack' && (!impactDefinition || impact.abilityId === impactDefinition.basic.id)) impact.source.attacks += 1;
    if (statusCommitted.has(impact)) continue;
    if (impact.kind === 'heal') {
      const def = partyDef(impact.source), basic = !impact.abilityId || impact.abilityId === def?.basic.id;
      const ability = def && !basic && def.active.id === impact.abilityId ? def.active : undefined;
      if (ability?.kind === 'shield') { commitAbility(state, impact, now); continue; }
      if (basic) {
        const coefficient = def?.basic.coefficient ?? 1.2;
        heals.push({ source: impact.source, target: impact.target, amount: effectiveAttack(state, impact.source) * coefficient, impact, basic: true });
      } else if (ability?.kind === 'selfHeal') {
        heals.push({ source: impact.source, target: impact.source, amount: impact.source.maxHp * (ability.healCoefficient ?? 0), impact, cooldownId: ability.id, cooldownTicks: ability.cooldownTicks });
      } else if (ability?.kind === 'burstHeal') {
        heals.push({ source: impact.source, target: impact.target, amount: effectiveAttack(state, impact.source) * (ability.healCoefficient ?? 0), impact,
          effect: { group: 'healing-guard', kind: 'damageReduction', magnitude: 0.1, durationTicks: ticksForSeconds(2) }, cooldownId: ability.id, cooldownTicks: ability.cooldownTicks });
      } else miss(state, impact, 'unneeded');
    } else prepareAttack(state, impact, now, damage, heals);
  }
  const projectileImpacts = advanceProjectiles(state, now); damage.push(...projectileImpacts.damage);
  const results = applyDamageBatch(state, damage, now), successfulHits = new Set<string>(), tankDamage = new Set<string>();
  for (const result of results) {
    if (result.total > 0) successfulHits.add(`${result.intent.source.id}/${result.intent.target.id}`);
    const victim = result.intent.target;
    if (result.hpDamage > 0 && victim.side === 'hero' && isTank(victim) && result.intent.source.side === 'enemy') tankDamage.add(victim.id);
    if (result.intent.basic && result.intent.primary && result.total > 0) successfulBasic(result);
  }
  if (statusSystemOn()) {
    for (const result of results) {
      if (result.total <= 0 || result.intent.target.hp <= 0) continue;
      const { source, target, abilityId, primary } = result.intent;
      const delivery = source.action && 'delivery' in source.action ? source.action.delivery : undefined;
      applyOnHitStatuses(state, source, target, abilityId, primary, now, { delivery });
    }
  }
  for (const id of tankDamage) { const tank = state.party.find(unit => unit.id === id); if (tank) tank.mana = Math.min(manaCost(partyDef(tank)!), (tank.mana ?? 0) + 5); }
  for (const impact of valid) {
    if (impact.abilityId) {
      const def = partyDef(impact.source), active = def?.active;
      if (active?.id === impact.abilityId && active.kind === 'projectile' && (impact.source.partyCooldowns?.[active.id] ?? 0) <= now) setCooldown(impact.source, active.id, now + active.cooldownTicks);
    }
  }
  prunePartyEffects(state);
  const missedHeals = new Set<Impact>();
  for (const entry of heals) {
    if (entry.requiresHit && !successfulHits.has(`${entry.requiresHit.sourceId}/${entry.requiresHit.targetId}`)) continue;
    const actual = heal(state, entry.source, entry.target, entry.amount, now);
    if (actual > 0) {
      if (statusSystemOn() && entry.cooldownId === 'priest-burst-heal') {
        cleanseUnit(state, entry.source, entry.target, entry.cooldownId, now);
        applyHeroSupportStatuses(state, entry.source, entry.target, entry.cooldownId, now, { healed: true });
      } else if (statusSystemOn() && entry.cooldownId === 'bruiser-heal') {
        applyHeroSupportStatuses(state, entry.source, entry.target, entry.cooldownId, now, { healed: true });
      } else if (entry.effect) {
        applyEffect(state, entry.source, entry.target, entry.effect, now);
      }
      if (entry.cooldownId) {
        entry.source.mana = 0;
      }
      if (entry.basic) { entry.source.attacks += 1; entry.source.mana = Math.min(manaCost(partyDef(entry.source)!), (entry.source.mana ?? 0) + 20); }
    } else if (entry.impact) missedHeals.add(entry.impact);
  }
  for (const impact of missedHeals) emit(state, { type: 'miss', unitId: impact.source.id, targetId: impact.targetId, kind: 'heal', reason: 'unneeded' }, now);
  for (const impact of valid) {
    const action = impact.source.action;
    if (action?.state === 'windup') {
      const anchor = { side: action.targetSide ?? impact.target.side, slot: action.targetSlot ?? impact.target.slot };
      recover(impact.source, action, anchor, action.targetCount ?? Math.max(1, state.enemies.length));
      if (statusSystemOn()) completeStatusTurn(state, impact.source, now);
      else {
        const turned = onTurnStart({ id: impact.source.id, hp: impact.source.hp, maxHp: impact.source.maxHp, statuses: unitStatuses(impact.source) });
        impact.source.hp = turned.unit.hp;
        impact.source.statuses = turned.unit.statuses;
      }
    }
  }
}

/** One deterministic simulation tick for the opt-in party-v2 rules. */
export function partyCombatTick(state: GameState, allowNewActions = true): void {
  const now = combatTime(state), startUnits = [...state.party, ...state.enemies].sort(compareId);
  state.partyEffects ??= []; state.projectiles ??= []; state.nextProjectileId ??= 0;
  if (state.party.every(hero => hero.hp <= 0)) { cancelPartyEncounterEffects(state); return; }
  for (const enemy of living(state.enemies)) {
    if (!enemy.moving) continue;
    const home = enemyFormationX(enemy.slot);
    const delta = home - enemy.x;
    if (!Number.isFinite(enemy.x) || !Number.isFinite(delta) || Math.abs(delta) > ENEMY_MARCH_LIMIT_PX || Math.abs(delta) <= ENEMY_ENTRY_PX) {
      enemy.x = home;
      enemy.moving = false;
    } else enemy.x += Math.sign(delta) * ENEMY_ENTRY_PX;
  }
  // March may delay the next turn. It must not delay a hit, a telegraph, or a recovery that is already due.
  prunePartyEffects(state);
  for (const unit of startUnits) if (unit.shieldUntilTick <= now) { unit.shield = 0; delete unit.shieldProviderId; }
  releaseStalePresentations(state, startUnits, now, true);
  const specials = advanceEnemySpecials(state, now);
  resolveDueImpacts(state, startUnits, now, specials.damage);
  releaseStalePresentations(state, startUnits, now, false);

  if (state.party.every(hero => hero.hp <= 0)) { cancelPartyEncounterEffects(state); return; }
  if (living(state.enemies).some(enemy => enemy.moving)) return;
  for (const unit of living(startUnits)) unit.moving = false;

  // A turn owns the presentation lane until its recovery finishes. Keep every
  // unit's gauge frozen during that window so the next actor is selected from
  // the same gauge order that existed when this action began.
  if (living([...state.party, ...state.enemies]).some(presentationBusy)) return;

  if (!allowNewActions) return;

  let actor: Unit | undefined;
  for (const unit of startUnits) {
    if (unit.hp <= 0) continue;
    const statuses = unitStatuses(unit);
    if (!statuses.some(status => statusDef(status.id)?.locksGauge)) {
      unit.gauge = (unit.gauge ?? 0) + Math.round(turnSpd(unit) * 7 * fillMultiplier(statuses));
    }
    if (presentationBusy(unit) || (unit.gauge ?? 0) < 10000) continue;
    if (!actor || (unit.gauge ?? 0) > (actor.gauge ?? 0)
      || ((unit.gauge ?? 0) === (actor.gauge ?? 0) && unit.side === 'hero' && actor.side === 'enemy')
      || ((unit.gauge ?? 0) === (actor.gauge ?? 0) && unit.side === actor.side && unit.slot < actor.slot)) actor = unit;
  }
  if (actor) beginActorTurn(state, actor, now);

  if (state.party.every(hero => hero.hp <= 0)) cancelPartyEncounterEffects(state);
}
