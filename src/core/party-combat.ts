import { CONFIG, ticksForSeconds } from '../config';
import { grantXp } from './economy';
import { combatTime } from './clock';
import { emit, goldChange } from './events';
import { activePartyEffects, applyPartyEffect, effectiveAttack, effectiveDamageReduction, effectiveDefense, effectActive, prunePartyEffects } from './party-effects';
import { getPartyHeroDefinition } from './party-definitions';
import { getPartyEnemyDefinition } from './party-enemies';
import type { GameEvent, GameState, PartyProjectile, Unit } from './model';

export const PARTY_V2 = Object.freeze({
  version: 'party-v2', radius: { normal: 10, tank: 12 }, reach: { melee: 12, ranged: 260, heal: 260 },
  timing: { windupTicks: 4, minimumRecoveryTicks: 2, animationRecoveryTicks: 8, projectileExpiryTicks: ticksForSeconds(4), projectileSpeed: 500 },
  animation: { attackImpactFraction: 0.5, healImpactFraction: 0.5 },
  speed: { tank: 65, melee: 90, support: 65, ranged: 80, enemyMelee: 70, enemyRanged: 55 },
});

export interface Body { x: number; radius: number }
export function edgeDistance(a: Body, b: Body): number { return Math.max(0, Math.abs(a.x - b.x) - a.radius - b.radius); }
export function inEdgeReach(a: Body, b: Body, reach: number): boolean { return edgeDistance(a, b) <= reach; }
export function presentationCombatTime(state: GameState): number {
  const native = combatTime(state);
  if (state.combatRules !== 'party-v2' || state.phase.kind !== 'farmPad' || state.phase.presentationStartedAtTick === undefined) return native;
  return native + Math.max(0, state.tick - state.phase.presentationStartedAtTick);
}
export function combatEventAge(state: GameState, event: GameEvent): number | null {
  if (state.combatRules !== 'party-v2') return state.tick - event.tick;
  if (event.combatEncounter !== state.encounter) return null;
  return presentationCombatTime(state) - (event.combatTick ?? event.tick);
}
export function partyUnitFields(unit: Unit): Pick<Unit, 'radius' | 'speed' | 'range' | 'facing' | 'targetId' | 'moving' | 'action'> {
  const role = unit.side === 'hero' ? getPartyHeroDefinition(unit.sourceId).role : null;
  const radius = unit.side === 'hero' && role === 'tank' ? PARTY_V2.radius.tank : PARTY_V2.radius.normal;
  const enemyDefinition = unit.side === 'enemy' ? getPartyEnemyDefinition(unit.sourceId) : undefined;
  const speed = unit.side === 'enemy'
    ? enemyDefinition!.speed
    : role === 'tank' ? PARTY_V2.speed.tank : role === 'dps' && getPartyHeroDefinition(unit.sourceId).tags.includes('melee') ? PARTY_V2.speed.melee : role === 'support' ? PARTY_V2.speed.support : PARTY_V2.speed.ranged;
  const range = unit.side === 'enemy' ? enemyDefinition!.range : getPartyHeroDefinition(unit.sourceId).basic.range;
  return { radius, speed, range, facing: unit.side === 'hero' ? 1 : -1, targetId: null, moving: false, action: { state: 'idle' } };
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
function isTank(unit: Unit): boolean { return unit.side === 'hero' && unitRole(unit) === 'tank'; }
function reachFor(source: Unit): number { return source.range; }
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
function chooseActive(state: GameState, source: Unit, target: Unit | undefined, now: number): PickedTarget | undefined {
  const def = partyDef(source); if (!def || !cooldownReady(source, def.active.id, now)) return undefined;
  const active = def.active;
  const enemy = target;
  let picked: PickedTarget | undefined;
  switch (active.kind) {
    case 'shield': if (source.hp / source.maxHp < (active.hpThreshold ?? 0.9) || threatened(state, source)) picked = { target: source, kind: 'heal', abilityId: active.id }; break;
    case 'selfHeal': if (source.hp / source.maxHp < (active.hpThreshold ?? 0.65)) picked = { target: source, kind: 'heal', abilityId: active.id }; break;
    case 'burstHeal': { const ally = hurtAlly(state, active.hpThreshold ?? 0.8); if (ally) picked = { target: ally, kind: 'heal', abilityId: active.id }; break; }
    case 'buff': { const ally = supportTarget(state); if (ally && !effectActive(state, ally.id, 'party-atk-buff')) picked = { target: ally, kind: 'heal', abilityId: active.id }; break; }
    case 'selfSustain': if (enemy && source.hp < source.maxHp) picked = { target: enemy, kind: 'attack', abilityId: active.id }; break;
    case 'weaken': if (enemy && !effectActive(state, enemy.id, 'enemy-atk-weaken') && !effectActive(state, enemy.id, 'enemy-def-weaken')) picked = { target: enemy, kind: 'attack', abilityId: active.id }; break;
    case 'cleave': case 'projectile': case 'fireball': case 'singleBurst': if (enemy) picked = { target: enemy, kind: 'attack', abilityId: active.id }; break;
    case 'intercept': break;
  }
  return picked;
}
function chooseTarget(state: GameState, source: Unit, now: number): PickedTarget | undefined {
  if (source.side === 'hero') {
    const def = getPartyHeroDefinition(source.sourceId), target = attackTarget(state, source);
    const active = chooseActive(state, source, target, now);
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
  const special = getPartyEnemyDefinition(source.sourceId).special;
  if (!special) return false;
  if (special.kind === 'assassin') {
    const target = rearmostHero(state); if (!target) return false;
    source.specialAction = { state: 'assassinMark', targetId: target.id, startTick: now, impactTick: now + special.markTicks };
    emit(state, { type: 'skill', unitId: source.id, skill: 'assassin-mark' }, now);
    return true;
  }
  const target = nearest(source, living(state.party)); if (!target) return false;
  if (special.kind === 'localArea') {
    if (!cooldownReady(source, special.abilityId, now) || !inEdgeReach({ x: source.x, radius: radius(source) }, { x: target.x, radius: radius(target) }, source.range)) return false;
    setCooldown(source, special.abilityId, now + special.cooldownTicks);
  } else {
    const successful = source.procCounters?.basicSuccess ?? 0, used = source.procCounters?.bossPattern ?? 0;
    if (successful < (used + 1) * special.every || !inEdgeReach({ x: source.x, radius: radius(source) }, { x: target.x, radius: radius(target) }, source.range)) return false;
    source.procCounters ??= {}; source.procCounters.bossPattern = used + 1;
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
      const definition = getPartyEnemyDefinition(source.sourceId).special;
      const coefficient = definition?.kind === 'localArea' || definition?.kind === 'bossLocal' || definition?.kind === 'bossGlobal' ? definition.coefficient : 1;
      const targets = action.global ? living(state.party) : living(state.party).filter(target => Math.abs(target.x - action.centerX) <= action.radius + radius(target));
      for (const target of targets.sort(compareId)) damage.push({ source, target, coefficient, abilityId: action.abilityId, basic: false, interceptable: !action.global, primary: target.id === action.targetId });
      delete source.specialAction;
      continue;
    }
    const target = state.party.find(unit => unit.id === action.targetId && unit.hp > 0);
    if (!target) { delete source.specialAction; source.moving = false; continue; }
    if (action.state === 'assassinMark') {
      if (action.impactTick > now) continue;
      const enemy = getPartyEnemyDefinition(source.sourceId), special = enemy.special;
      if (!special || special.kind !== 'assassin') { delete source.specialAction; continue; }
      const direction = aimDirection(source, target);
      const targetX = target.x - direction * (radius(source) + radius(target) + source.range);
      const ticks = Math.ceil(Math.abs(targetX - source.x) / Math.max(1, special.dashSpeed / CONFIG.sim.ticksPerSecond));
      source.specialAction = { state: 'assassinDash', targetId: target.id, targetX, startX: source.x, startTick: now, impactTick: now + ticks };
    }
    const dash = source.specialAction;
    if (!dash || dash.state !== 'assassinDash') continue;
    const enemy = getPartyEnemyDefinition(source.sourceId), special = enemy.special;
    if (!special || special.kind !== 'assassin') { delete source.specialAction; continue; }
    const direction = aimDirection(source, target);
    const landing = target.x - direction * (radius(source) + radius(target) + source.range);
    const delta = landing - source.x, movement = special.dashSpeed / CONFIG.sim.ticksPerSecond;
    if (Math.abs(delta) > movement) { source.x += Math.sign(delta) * movement; source.moving = true; dash.targetX = landing; continue; }
    source.x = landing; source.moving = false; source.facing = Math.sign(target.x - source.x) as -1 | 1;
    source.targetId = target.id; source.action = { state: 'windup', kind: 'attack', targetId: target.id, startTick: now, impactTick: now + PARTY_V2.timing.windupTicks };
    delete source.specialAction;
    emit(state, { type: 'actionStart', unitId: source.id, targetId: target.id, kind: 'attack', startTick: now, impactTick: now + PARTY_V2.timing.windupTicks }, now);
  }
  return { busy, damage };
}
function recover(source: Unit, startTick: number, impactTick: number, kind: ActionKind, targetId: string, fullCadence: boolean, abilityId?: string): void {
  const readyTick = fullCadence ? Math.max(startTick + source.attackTicks, impactTick + PARTY_V2.timing.minimumRecoveryTicks) : impactTick + PARTY_V2.timing.minimumRecoveryTicks;
  source.action = { state: 'recovery', kind, targetId, startTick, impactTick, readyTick, ...(abilityId ? { abilityId } : {}) }; source.moving = false;
}
function miss(state: GameState, impact: Impact, reason: Impact['reason']): void {
  if (!reason) return;
  emit(state, { type: 'miss', unitId: impact.source.id, targetId: impact.targetId, kind: impact.kind, reason }, combatTime(state));
  const action = impact.source.action;
  if (action?.state === 'windup') recover(impact.source, action.startTick, action.impactTick, action.kind, action.targetId, !(impact.kind === 'heal' && reason === 'unneeded'), action.abilityId);
}
function rewardDeath(state: GameState, target: Unit): void {
  if (target.side !== 'enemy') return;
  const base = CONFIG.enemies[getPartyEnemyDefinition(target.sourceId).rewardKind], mult = CONFIG.rewards.killScaling ** (state.progress.stage - 1);
  goldChange(state, Math.round(base.gold * mult), 'kill'); grantXp(state, Math.round(base.xp * mult));
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
      if (healed > 0) applyEffect(state, source, target, { group: 'healing-guard', kind: 'damageReduction', magnitude: 0.1, durationTicks: ticksForSeconds(2) }, now);
      if (!healed) return false; break;
    }
    case 'buff': applyEffect(state, source, target, { group: 'party-atk-buff', kind: 'atkBonus', magnitude: ability.atkBonus ?? 0, durationTicks: ability.durationTicks ?? 0 }, now); break;
    case 'weaken': applyEffect(state, source, target, { group: 'enemy-atk-weaken', kind: 'atkReduction', magnitude: ability.atkReduction ?? 0, durationTicks: ability.durationTicks ?? 0 }, now);
      applyEffect(state, source, target, { group: 'enemy-def-weaken', kind: 'defReduction', magnitude: ability.defReduction ?? 0, durationTicks: ability.durationTicks ?? 0 }, now);
      if (def.passive.kind === 'firstWeakenShield' && !(target.procCounters?.firstWeakenShield ?? 0)) {
        target.procCounters ??= {}; target.procCounters.firstWeakenShield = 1;
        const ally = hurtAlly(state, 1) ?? living(state.party)[0]; if (ally) applyPartyShield(state, source, ally, ally.maxHp * (def.passive.shieldFraction ?? 0), def.passive.durationTicks ?? 0, now);
      }
      break;
    case 'selfSustain': return false;
    case 'cleave': case 'projectile': case 'fireball': case 'singleBurst': return false;
    case 'intercept': return false;
  }
  setCooldown(source, ability.id, now + ability.cooldownTicks); emit(state, { type: 'skill', unitId: source.id, skill: ability.id }, now); return true;
}
function damageAmount(state: GameState, source: Unit, target: Unit, coefficient: number, snapAtk?: number): number {
  const atk = snapAtk ?? effectiveAttack(state, source), def = effectiveDefense(state, target), dr = effectiveDamageReduction(state, target);
  return Math.max(1, Math.round(atk * coefficient * 100 / (100 + def) * (1 - dr)));
}
interface DamageResult { intent: DamageIntent; total: number; hpDamage: number; absorbed: number }
function applyDamageBatch(state: GameState, intents: DamageIntent[], now: number): DamageResult[] {
  const ordered = [...intents].sort((a, b) => a.source.id.localeCompare(b.source.id) || (a.projectileId ?? '').localeCompare(b.projectileId ?? '') || a.target.id.localeCompare(b.target.id));
  const shieldLeft = new Map<string, number>(), hpLeft = new Map<string, number>(), initialHp = new Map<string, number>(), results: DamageResult[] = [];
  const procCount = new Map<string, number>();
  for (const intent of ordered) {
    const target = intent.target;
    if (target.hp <= 0 && !hpLeft.has(target.id)) continue;
    if (!shieldLeft.has(target.id)) { shieldLeft.set(target.id, target.shieldUntilTick > now ? target.shield : 0); hpLeft.set(target.id, target.hp); initialHp.set(target.id, target.hp); }
    const counter = procCount.get(intent.source.id) ?? (intent.source.procCounters?.basicSuccess ?? 0);
    const passive = partyDef(intent.source)?.passive;
    const coefficient = intent.basic && passive?.kind === 'fourthBonus' && (counter + 1) % 4 === 0 ? intent.coefficient * (1 + (passive.coefficient ?? 0.2)) : intent.coefficient;
    const amount = damageAmount(state, intent.source, target, coefficient, intent.snapAtk);
    const absorbed = Math.min(shieldLeft.get(target.id) ?? 0, amount); shieldLeft.set(target.id, (shieldLeft.get(target.id) ?? 0) - absorbed);
    const hpDamage = Math.min(hpLeft.get(target.id) ?? 0, amount - absorbed); hpLeft.set(target.id, (hpLeft.get(target.id) ?? 0) - hpDamage);
    const total = absorbed + hpDamage; results.push({ intent, total, hpDamage, absorbed });
    if (absorbed > 0) emit(state, { type: 'shieldAbsorb', attackerId: intent.source.id, targetId: target.id, ...(target.shieldProviderId ? { providerId: target.shieldProviderId } : {}), amount: absorbed }, now);
    if (hpDamage > 0) emit(state, { type: 'hit', attackerId: intent.source.id, targetId: target.id, damage: hpDamage, side: target.side }, now);
    if (intent.basic && total > 0) procCount.set(intent.source.id, counter + 1);
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
function effectAura(state: GameState, now: number): void {
  const source = living(state.party).find(unit => partyDef(unit)?.passive.kind === 'livingAura');
  if (!source) return;
  const magnitude = partyDef(source)!.passive.atkReduction ?? 0.05;
  for (const ally of living(state.party)) {
    const prior = activePartyEffects(state, ally.id).find(effect => effect.group === 'party-guard-aura');
    const changed = !prior || prior.sourceId !== source.id || prior.magnitude !== magnitude;
    applyEffect(state, source, ally, { group: 'party-guard-aura', kind: 'damageReduction', magnitude, durationTicks: 2, stackPolicy: 'sourceAura' }, now, changed);
  }
}
function reserveGuards(state: GameState, impacts: DamageIntent[], now: number, reserved: Set<string>): void {
  const guardians = living(state.party).filter(hero => ['intercept'].includes(partyDef(hero)!.passive.kind)).sort(compareId);
  for (const impact of impacts.filter(value => value.interceptable && value.source.side === 'enemy' && value.target.side === 'hero').sort((a, b) => a.source.id.localeCompare(b.source.id) || (a.projectileId ?? '').localeCompare(b.projectileId ?? ''))) {
    const target = impact.target;
    const guardian = guardians.find(value => value.id !== target.id && !reserved.has(value.id) && (value.guardReadyTick ?? 0) <= now && inEdgeReach({ x: value.x, radius: radius(value) }, { x: target.x, radius: radius(target) }, partyDef(value)!.passive.range ?? 0));
    if (!guardian) continue;
    reserved.add(guardian.id); impact.target = guardian;
    guardian.guardReadyTick = now + (partyDef(guardian)!.passive.cooldownTicks ?? ticksForSeconds(8));
    emit(state, { type: 'guard', guardianId: guardian.id, fromTargetId: target.id, toTargetId: guardian.id }, now);
  }
}
function launchProjectile(state: GameState, source: Unit, target: Unit, abilityId: string, coefficient: number, now: number, options: { splashCoefficient?: number; radius?: number; ground?: boolean; basic?: boolean } = {}): void {
  const serial = (state.nextProjectileId ?? 0) + 1; state.nextProjectileId = serial;
  const projectile: PartyProjectile = { id: `projectile-${state.encounter}-${serial}`, sourceId: source.id, sourceSide: source.side, targetId: target.id, targetSide: target.side, abilityId, delivery: options.ground ? 'ground' : 'homing', ...(options.basic === undefined ? {} : { basic: options.basic }),
    x: source.x, speed: PARTY_V2.timing.projectileSpeed, atk: effectiveAttack(state, source), coefficient,
    ...(options.splashCoefficient === undefined ? {} : { splashCoefficient: options.splashCoefficient }), ...(options.radius === undefined ? {} : { radius: options.radius }),
    ...(options.ground ? { centerX: target.x } : {}), releasedAtTick: now, impactNotBeforeTick: now + 1, expiresAtTick: now + PARTY_V2.timing.projectileExpiryTicks };
  (state.projectiles ??= []).push(projectile);
  emit(state, { type: 'projectile', projectileId: projectile.id, sourceId: source.id, action: 'release' }, now);
}
function successfulBasic(state: GameState, result: DamageResult, now: number, heals: PendingHeal[], procDamage: DamageIntent[]): void {
  const { intent } = result, source = intent.source, target = intent.target;
  source.procCounters ??= {}; source.procCounters.basicSuccess = (source.procCounters.basicSuccess ?? 0) + 1;
  const def = partyDef(source); if (!def) return;
  const passive = def.passive, count = source.procCounters.basicSuccess;
  if (passive.kind === 'fourthSelfHeal' && count % 4 === 0) heals.push({ source, target: source, amount: result.hpDamage * (passive.coefficient ?? 0) });
  if (passive.kind === 'fourthGuard' && count % 4 === 0) applyEffect(state, source, source, { group: passive.group ?? 'bruiser-guard', kind: 'damageReduction', magnitude: passive.atkReduction ?? 0.1, durationTicks: passive.durationTicks ?? 0 }, now);
  if (passive.kind === 'sameTargetRamp') {
    source.procCounters ??= {};
    source.procCounters.sameTarget = source.lastBasicTargetId === target.id
      ? Math.min(passive.cap ?? 0, (source.procCounters.sameTarget ?? 0) + (passive.coefficient ?? 0.05))
      : Math.min(passive.cap ?? 0, passive.coefficient ?? 0.05);
    source.lastBasicTargetId = target.id; source.lastBasicRamp = source.procCounters.sameTarget;
  }
  if (passive.kind === 'thirdSplash' && count % 3 === 0) {
    for (const secondary of living(targetPool(state, source, 'attack')).filter(unit => unit.id !== target.id && Math.abs(unit.x - target.x) <= (passive.radius ?? 0) + radius(unit)).sort(compareId)) {
      procDamage.push({ source, target: secondary, coefficient: passive.coefficient ?? 0, abilityId: passive.id, basic: false, interceptable: false, primary: false });
    }
  }
}
function basicCoefficient(source: Unit, target: Unit): number {
  const def = partyDef(source); if (!def) return 1;
  const passive = def.passive;
  let coefficient = def.basic.coefficient;
  if (passive.kind === 'sameTargetRamp' && source.lastBasicTargetId === target.id) coefficient *= 1 + (source.lastBasicRamp ?? 0);
  return coefficient;
}
function prepareAttack(state: GameState, impact: Impact, now: number, damage: DamageIntent[], heals: PendingHeal[]): void {
  const source = impact.source, target = impact.target, def = partyDef(source), active = def?.active, id = impact.abilityId ?? def?.basic.id ?? 'enemy-basic';
  const ability = active?.id === id ? active : undefined, basic = !ability;
  if (ability && ['shield', 'buff', 'weaken'].includes(ability.kind)) { commitAbility(state, impact, now); return; }
  const baseCoefficient = basic ? (def?.basic.style === 'heal' ? def?.basic.fallbackCoefficient ?? 0.7 : basicCoefficient(source, target)) : ability?.coefficient ?? 1;
  if (ability?.kind === 'selfSustain') heals.push({ source, target: source, amount: source.maxHp * (ability.healCoefficient ?? 0), requiresHit: { sourceId: source.id, targetId: target.id } });
  const projectile = ability?.kind === 'projectile' || ability?.kind === 'fireball'
    || (source.side === 'hero' && basic && def?.basic.style === 'projectile')
    || (source.side === 'enemy' && getPartyEnemyDefinition(source.sourceId).basicStyle === 'projectile');
  if (projectile) {
    launchProjectile(state, source, target, id, baseCoefficient, now, ability?.kind === 'fireball' ? { splashCoefficient: ability.secondaryCoefficient, radius: ability.radius, ground: true } : { basic });
    if (ability) setCooldown(source, ability.id, now + ability.cooldownTicks);
    return;
  }
  const add = (victim: Unit, coefficient: number, primary: boolean): void => { damage.push({ source, target: victim, coefficient, abilityId: id, basic, interceptable: true, primary }); };
  add(target, baseCoefficient, true);
  if (ability?.kind === 'cleave') {
    const secondaryTargets = living(targetPool(state, source, 'attack')).filter(unit => unit.id !== target.id && Math.abs(unit.x - target.x) <= (ability.radius ?? 0) + radius(unit))
      .sort((a, b) => Math.abs(a.x - target.x) - Math.abs(b.x - target.x) || compareId(a, b)).slice(0, ability.maxSecondaryTargets ?? 1);
    for (const secondary of secondaryTargets) add(secondary, ability.secondaryCoefficient ?? 0, false);
  }
  if (ability) setCooldown(source, ability.id, now + ability.cooldownTicks);
}
function advanceProjectiles(state: GameState, now: number): { damage: DamageIntent[]; consumed: Set<string> } {
  const damage: DamageIntent[] = [], consumed = new Set<string>(), keep: PartyProjectile[] = [];
  for (const projectile of [...(state.projectiles ?? [])].sort((a, b) => a.id.localeCompare(b.id))) {
    const pool = projectile.targetSide === 'hero' ? state.party : state.enemies;
    const primary = pool.find(unit => unit.id === projectile.targetId && unit.hp > 0);
    const ground = projectile.delivery === 'ground';
    if ((!ground && !primary) || now >= projectile.expiresAtTick) {
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
export function cancelPartyEncounterEffects(state: GameState): void { state.partyEffects = []; state.projectiles = []; }

/** One deterministic simulation tick for the opt-in party-v2 rules. */
export function partyCombatTick(state: GameState): void {
  const now = combatTime(state), startUnits = [...state.party, ...state.enemies].sort(compareId);
  state.partyEffects ??= []; state.projectiles ??= []; state.nextProjectileId ??= 0;
  if (state.party.every(hero => hero.hp <= 0)) { cancelPartyEncounterEffects(state); return; }
  prunePartyEffects(state); effectAura(state, now);
  for (const unit of startUnits) if (unit.shieldUntilTick <= now) { unit.shield = 0; delete unit.shieldProviderId; }
  for (const unit of living(startUnits)) if (unit.action?.state === 'recovery' && unit.action.readyTick <= now) unit.action = { state: 'idle' };
  const specials = advanceEnemySpecials(state, now);

  const choices = new Map<string, PickedTarget>(), moves = new Map<string, number>();
  for (const unit of living(startUnits)) {
    if (!specials.busy.has(unit.id)) unit.moving = false;
    if (specials.busy.has(unit.id) || unit.specialAction || unit.action?.state !== 'idle') continue;
    if (startEnemySpecial(state, unit, now)) { specials.busy.add(unit.id); continue; }
    const choice = chooseTarget(state, unit, now); if (!choice) { unit.targetId = null; continue; }
    choices.set(unit.id, choice); unit.targetId = choice.target.id;
    const gap = distance(unit, choice.target) - reachFor(unit), sign = Math.sign(choice.target.x - unit.x), perTick = unit.speed! / CONFIG.sim.ticksPerSecond;
    if (gap > 0 && sign !== 0) moves.set(unit.id, unit.x + sign * Math.min(gap, perTick));
  }
  for (const unit of living(startUnits)) { const next = moves.get(unit.id); if (next !== undefined) { unit.moving = next !== unit.x; unit.x = next; } }
  for (const unit of living(startUnits)) {
    const choice = choices.get(unit.id); if (!choice || unit.action?.state !== 'idle') continue;
    const target = targetPool(state, unit, choice.kind).find(item => item.id === choice.target.id && item.hp > 0);
    if (!target || !inEdgeReach({ x: unit.x, radius: radius(unit) }, { x: target.x, radius: radius(target) }, reachFor(unit))) continue;
    const direction = Math.sign(target.x - unit.x); if (direction !== 0) unit.facing = direction as -1 | 1;
    const impactTick = now + PARTY_V2.timing.windupTicks;
    unit.action = { state: 'windup', kind: choice.kind, targetId: target.id, startTick: now, impactTick, ...(choice.abilityId ? { abilityId: choice.abilityId } : {}) };
    unit.moving = false; emit(state, { type: 'actionStart', unitId: unit.id, targetId: target.id, kind: choice.kind, startTick: now, impactTick }, now);
  }

  const due: Impact[] = [];
  for (const source of living(startUnits)) {
    const action = source.action; if (action?.state !== 'windup' || action.impactTick > now) continue;
    const target = targetPool(state, source, action.kind).find(unit => unit.id === action.targetId);
    if (!target || target.hp <= 0) { due.push({ source, target: target ?? source, targetId: action.targetId, kind: action.kind, abilityId: action.abilityId, reason: 'target' }); continue; }
    if (!inEdgeReach({ x: source.x, radius: radius(source) }, { x: target.x, radius: radius(target) }, reachFor(source))) { due.push({ source, target, targetId: target.id, kind: action.kind, abilityId: action.abilityId, reason: 'range' }); continue; }
    const direction = Math.sign(target.x - source.x);
    if (action.kind === 'attack' && source.range <= PARTY_V2.reach.melee && direction !== 0 && source.facing !== direction) { due.push({ source, target, targetId: target.id, kind: action.kind, abilityId: action.abilityId, reason: 'facing' }); continue; }
    due.push({ source, target, targetId: target.id, kind: action.kind, abilityId: action.abilityId });
  }
  for (const impact of due) if (impact.reason) miss(state, impact, impact.reason);
  const valid = due.filter(impact => !impact.reason).sort((a, b) => compareId(a.source, b.source) || compareId(a.target, b.target));
  const damage: DamageIntent[] = [...specials.damage], heals: PendingHeal[] = [];
  // Protection and status effects commit before this tick's damage batch, regardless
  // of whether the ability uses an attack or heal animation.
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
        const coefficient = def?.basic.coefficient ?? 1.2, passive = def?.passive;
        heals.push({ source: impact.source, target: impact.target, amount: effectiveAttack(state, impact.source) * coefficient, impact, basic: true,
          ...(passive?.kind === 'healGuard' ? { effect: { group: passive.group ?? 'healing-guard', kind: 'damageReduction' as const, magnitude: passive.coefficient ?? 0.1, durationTicks: passive.durationTicks ?? 0 } } : {}) });
      } else if (ability?.kind === 'selfHeal') {
        heals.push({ source: impact.source, target: impact.source, amount: impact.source.maxHp * (ability.healCoefficient ?? 0), impact, cooldownId: ability.id, cooldownTicks: ability.cooldownTicks });
      } else if (ability?.kind === 'burstHeal') {
        heals.push({ source: impact.source, target: impact.target, amount: effectiveAttack(state, impact.source) * (ability.healCoefficient ?? 0), impact,
          effect: { group: 'healing-guard', kind: 'damageReduction', magnitude: 0.1, durationTicks: ticksForSeconds(2) }, cooldownId: ability.id, cooldownTicks: ability.cooldownTicks });
      } else miss(state, impact, 'unneeded');
    } else prepareAttack(state, impact, now, damage, heals);
  }
  const projectileImpacts = advanceProjectiles(state, now); damage.push(...projectileImpacts.damage);
  const reservedGuards = new Set<string>(); reserveGuards(state, damage, now, reservedGuards);
  const results = applyDamageBatch(state, damage, now), procDamage: DamageIntent[] = [], successfulHits = new Set<string>();
  for (const result of results) {
    if (result.total > 0) successfulHits.add(`${result.intent.source.id}/${result.intent.target.id}`);
    if (result.intent.basic && result.intent.primary && result.total > 0) successfulBasic(state, result, now, heals, procDamage);
  }
  // Proc-generated splash is one non-recursive secondary batch.
  if (procDamage.length) applyDamageBatch(state, procDamage, now);
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
      if (entry.effect) applyEffect(state, entry.source, entry.target, entry.effect, now);
      if (entry.cooldownId) setCooldown(entry.source, entry.cooldownId, now + (entry.cooldownTicks ?? 0));
      if (entry.basic) entry.source.attacks += 1;
    } else if (entry.impact) missedHeals.add(entry.impact);
  }
  for (const impact of missedHeals) emit(state, { type: 'miss', unitId: impact.source.id, targetId: impact.targetId, kind: 'heal', reason: 'unneeded' }, now);
  for (const impact of valid) {
    const action = impact.source.action;
    if (action?.state === 'windup') recover(impact.source, action.startTick, action.impactTick, action.kind, action.targetId, !(action.kind === 'heal' && missedHeals.has(impact)), action.abilityId);
  }
  if (state.party.every(hero => hero.hp <= 0)) cancelPartyEncounterEffects(state);
}
