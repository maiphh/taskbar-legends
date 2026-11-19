import { statusEffectsConfig, statusEffectsEnabled } from '../config';
import { grantXp } from './economy';
import { emit, goldChange } from './events';
import { farmDamageRampMultiplier } from './farm-damage-ramp';
import { getPartyEnemyDefinition } from './party-enemies';
import { partyKillReward } from './rewards';
import {
  applyStatusDetailed,
  cleanseOne,
  statusDef,
  statusMagnitude,
  turnEndStatuses,
  turnStartPhases,
  type RunningStatus,
} from './turn/statuses';
import type { GameState, Unit } from './model';

/**
 * Units whose beginActorTurn opened a status turn that has not ended yet.
 * WeakSet keys on the unit object so parallel sims with the same unit ids stay isolated.
 */
const openStatusTurns = new WeakSet<Unit>();

export function markStatusTurn(unit: Unit): void {
  if (!statusSystemOn()) return;
  openStatusTurns.add(unit);
}

/** End a marked non-windup turn (area special, no-target). No-op if nothing was marked. */
export function finishStatusTurn(state: GameState, unit: Unit, now: number): void {
  if (!openStatusTurns.has(unit)) return;
  openStatusTurns.delete(unit);
  endStatusTurn(state, unit, now);
}

/** End statuses for a windup/miss recovery. Always ticks; clears a mark if present. */
export function completeStatusTurn(state: GameState, unit: Unit, now: number): void {
  openStatusTurns.delete(unit);
  endStatusTurn(state, unit, now);
}

export function statusSystemOn(): boolean {
  return statusEffectsEnabled();
}

function list(unit: Unit): RunningStatus[] {
  return (unit.statuses ??= []) as RunningStatus[];
}

export function unitHasStatus(unit: Unit, id: string): boolean {
  return list(unit).some(status => status.id === id);
}

export function isStatusBoss(unit: Unit): boolean {
  if (unit.side !== 'enemy') return false;
  if (unit.boss) return true;
  const kind = getPartyEnemyDefinition(unit.sourceId).special?.kind;
  return kind === 'bossLocal' || kind === 'bossGlobal';
}

export function clearUnitStatuses(...groups: Array<readonly Unit[] | Unit[] | undefined>): void {
  for (const group of groups) {
    if (!group) continue;
    for (const unit of group) {
      unit.statuses = [];
      openStatusTurns.delete(unit);
    }
  }
}

function emitStatus(
  state: GameState,
  kind: 'apply' | 'refresh' | 'stack' | 'expire' | 'resist' | 'skip',
  statusId: string,
  targetId: string,
  sourceId: string,
  turnsLeft: number,
  stacks: number,
  now: number,
): void {
  emit(state, {
    type: 'status', kind, statusId, targetId, sourceId, turnsLeft, stacks,
  }, now);
}

export function addUnitStatus(
  state: GameState,
  source: Unit,
  target: Unit,
  id: string,
  turns: number,
  magnitude: number,
  now: number,
  options: { selfApplied?: boolean; display?: string } = {},
): boolean {
  if (!statusSystemOn() || target.hp <= 0) return false;
  const result = applyStatusDetailed(list(target), {
    id,
    sourceId: source.id,
    targetId: target.id,
    turns,
    magnitude,
    selfApplied: options.selfApplied ?? source.id === target.id,
    display: options.display,
    appliedAtTick: now,
  });
  target.statuses = result.statuses;
  if (result.kind === 'blocked') return false;
  if (result.kind === 'resist') {
    emitStatus(state, 'resist', id, target.id, source.id, 0, 0, now);
    return false;
  }
  const applied = result.statuses.find(status => status.targetId === target.id && status.id === id);
  emitStatus(state, result.kind, id, target.id, source.id, applied?.turnsLeft ?? turns, applied?.stacks ?? 1, now);
  return true;
}

export function cleanseUnit(state: GameState, source: Unit, target: Unit, abilityId: string, now: number): RunningStatus | null {
  const config = statusEffectsConfig();
  if (!config) return null;
  const rule = config.cleanse[abilityId];
  if (!rule) return null;
  const { statuses, removed } = cleanseOne(list(target), target.id, rule.order);
  target.statuses = statuses;
  if (removed) emitStatus(state, 'expire', removed.id, target.id, source.id, 0, removed.stacks, now);
  return removed;
}

function applyDotThroughShield(state: GameState, sourceId: string, unit: Unit, amount: number, now: number): void {
  if (amount <= 0 || unit.hp <= 0) return;
  const source = [...state.party, ...state.enemies].find(candidate => candidate.id === sourceId);
  const ramp = source ? farmDamageRampMultiplier(state, source) : 1;
  if (ramp !== 1) amount = Math.max(1, Math.round(amount * ramp));
  const absorbed = unit.shieldUntilTick > now ? Math.min(unit.shield, amount) : 0;
  if (absorbed > 0) {
    unit.shield -= absorbed;
    if (!unit.shield) delete unit.shieldProviderId;
    emit(state, { type: 'shieldAbsorb', attackerId: sourceId, targetId: unit.id, ...(unit.shieldProviderId ? { providerId: unit.shieldProviderId } : {}), amount: absorbed }, now);
  }
  const hpDamage = Math.min(unit.hp, amount - absorbed);
  if (hpDamage > 0) {
    unit.hp -= hpDamage;
    emit(state, { type: 'hit', attackerId: sourceId, targetId: unit.id, damage: hpDamage, side: unit.side, dot: true }, now);
  }
  if (unit.hp === 0) {
    if (unit.side === 'enemy') { delete unit.specialAction; unit.moving = false; }
    emit(state, { type: 'death', unitId: unit.id, side: unit.side }, now);
    if (unit.side === 'enemy') {
      const reward = partyKillReward(unit.sourceId, state.progress.stage);
      goldChange(state, reward.gold, 'kill');
      grantXp(state, reward.xp);
    }
  }
}

/** Begin an actor's own turn under the status system. Returns false when the action is skipped. */
export function beginStatusTurn(state: GameState, unit: Unit, now: number): boolean {
  if (!statusSystemOn()) return true;
  const boss = isStatusBoss(unit);
  const started = turnStartPhases(
    { id: unit.id, hp: unit.hp, maxHp: unit.maxHp, statuses: list(unit), boss },
    {
      bossScale: boss ? (statusDef('dot')?.bossScale ?? statusEffectsConfig()?.effects.dot?.bossScale ?? 0.5) : 1,
      steadfastTurns: boss
        ? (statusDef('steadfast')?.bossTurns ?? statusEffectsConfig()?.effects.steadfast?.bossTurns ?? 3)
        : (statusDef('steadfast')?.defaultTurns ?? statusEffectsConfig()?.effects.steadfast?.turns ?? 2),
    },
  );

  for (const event of started.events) {
    if (event.type === 'hot') {
      const healed = Math.min(unit.maxHp - unit.hp, event.amount);
      if (healed > 0) {
        unit.hp += healed;
        emit(state, { type: 'heal', sourceId: event.sourceId, targetId: unit.id, amount: healed }, now);
      }
    }
  }
  for (const event of started.events) {
    if (event.type === 'dot') applyDotThroughShield(state, event.sourceId, unit, event.amount, now);
  }

  unit.statuses = started.unit.statuses;
  if (unit.hp <= 0) return false;

  if (started.steadfastGranted) {
    const steadfast = list(unit).find(status => status.id === 'steadfast');
    if (steadfast) emitStatus(state, 'apply', 'steadfast', unit.id, unit.id, steadfast.turnsLeft, 1, now);
  }

  if (!started.mayAct) {
    // Only control (stun) skips the action. Emit skip, then tick remaining statuses.
    if (started.stunEnded) {
      emitStatus(state, 'expire', 'stun', unit.id, unit.id, 0, 1, now);
    }
    emitStatus(state, 'skip', 'stun', unit.id, unit.id, 0, 1, now);
    endStatusTurn(state, unit, now);
    return false;
  }
  return true;
}

export function endStatusTurn(state: GameState, unit: Unit, now: number): void {
  if (!statusSystemOn()) return;
  const before = list(unit);
  const after = turnEndStatuses(before, unit.id);
  for (const status of before) {
    if (status.targetId !== unit.id) continue;
    if (after.some(next => next.id === status.id && next.targetId === unit.id)) continue;
    emitStatus(state, 'expire', status.id, unit.id, status.sourceId, 0, status.stacks, now);
  }
  unit.statuses = after;
}

type ApplySpec = {
  status: string;
  target: 'abilityTarget' | 'self' | 'primaryHit' | 'everyHit';
  when?: 'healed';
  turns?: number;
  magnitude?: number;
  display?: string;
  on?: string;
};

function effectDefaults(statusId: string): { turns: number; magnitude: number } {
  const entry = statusEffectsConfig()?.effects[statusId];
  const def = statusDef(statusId);
  return {
    turns: entry?.turns ?? def?.defaultTurns ?? 1,
    magnitude: entry?.magnitude ?? def?.defaultMagnitude ?? 0,
  };
}

function applySpec(state: GameState, source: Unit, target: Unit, spec: ApplySpec, now: number): void {
  const defaults = effectDefaults(spec.status);
  addUnitStatus(state, source, target, spec.status, spec.turns ?? defaults.turns, spec.magnitude ?? defaults.magnitude, now, {
    display: spec.display,
    selfApplied: source.id === target.id,
  });
}

/** Support actives (buff / weaken / heal Guard / Regen) from config.apply.heroes. */
export function applyHeroSupportStatuses(
  state: GameState,
  source: Unit,
  target: Unit,
  abilityId: string,
  now: number,
  options: { healed?: boolean } = {},
): void {
  const specs = statusEffectsConfig()?.apply.heroes[abilityId] ?? [];
  for (const spec of specs) {
    if (spec.when === 'healed' && !options.healed) continue;
    if (spec.target === 'self') applySpec(state, source, source, spec, now);
    else if (spec.target === 'abilityTarget') applySpec(state, source, target, spec, now);
  }
}

/** On-hit status applications after a damage batch. */
export function applyOnHitStatuses(
  state: GameState,
  source: Unit,
  target: Unit,
  abilityId: string,
  primary: boolean,
  now: number,
  options: { delivery?: string } = {},
): void {
  if (!statusSystemOn() || target.hp <= 0) return;
  const config = statusEffectsConfig();
  if (!config) return;

  if (source.side === 'hero') {
    for (const spec of config.apply.heroes[abilityId] ?? []) {
      if (spec.target === 'primaryHit' && primary) applySpec(state, source, target, spec, now);
      if (spec.target === 'everyHit') applySpec(state, source, target, spec, now);
    }
    return;
  }

  const enemySpecs = config.apply.enemies[source.sourceId] ?? [];
  for (const spec of enemySpecs) {
    if (spec.on === 'leap') {
      if (options.delivery === 'leap' && primary && (spec.target === 'primaryHit' || spec.target === 'everyHit')) {
        applySpec(state, source, target, spec, now);
      }
      continue;
    }
    if (spec.on && spec.on !== abilityId) continue;
    if (spec.target === 'primaryHit' && !primary) continue;
    applySpec(state, source, target, spec, now);
  }
}

export function statusAtkBonus(unit: Unit): number { return statusMagnitude(list(unit), 'atkUp'); }
export function statusAtkReduction(unit: Unit): number { return statusMagnitude(list(unit), 'atkDown'); }
export function statusDefReduction(unit: Unit): number { return statusMagnitude(list(unit), 'defDown'); }
export function statusDamageReduction(unit: Unit): number { return statusMagnitude(list(unit), 'dmgReduction'); }
