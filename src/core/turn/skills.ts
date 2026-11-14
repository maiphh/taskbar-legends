import {
  applyStatus,
  damageTakenMultiplier,
  effectiveAttack,
  effectiveDefense,
  onDirectHit,
  statusDef,
  type RunningStatus,
} from './statuses';

export type SkillDelivery = 'leap' | 'cast';
export type SkillTarget = 'enemyFront' | 'enemyLowest' | 'enemyAll' | 'allyLowest' | 'allyAll' | 'self';

export type SkillEffect =
  | { op: 'damage'; coefficient: number }
  | { op: 'heal'; coefficient: number }
  | { op: 'shield'; fraction: number }
  | { op: 'applyStatus'; statusId: string; turns: number; magnitude: number; chance: number }
  | { op: 'gauge'; delta: number }
  | { op: 'cooldown'; skillId: string; delta: number };

export type SkillDef = {
  id: string;
  delivery: SkillDelivery;
  cooldownTurns: number;
  target: SkillTarget;
  effects: SkillEffect[];
  basic?: boolean;
};

export type TurnUnit = {
  id: string;
  side: 'party' | 'enemy';
  slot: number;
  gauge: number;
  spd: number;
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  x: number;
  statuses: RunningStatus[];
  cooldowns: Record<string, number>;
};

export type SkillEvent =
  | { type: 'strike'; actorId: string; targetId: string; delivery: SkillDelivery }
  | { type: 'damage'; actorId: string; targetId: string; amount: number }
  | { type: 'heal'; actorId: string; targetId: string; amount: number }
  | { type: 'shield'; actorId: string; targetId: string; amount: number }
  | { type: 'status'; actorId: string; targetId: string; statusId: string }
  | { type: 'gauge'; actorId: string; targetId: string; delta: number }
  | { type: 'cooldown'; actorId: string; skillId: string; delta: number };

function cloneUnit(unit: TurnUnit): TurnUnit {
  return {
    ...unit,
    statuses: unit.statuses.map(status => ({ ...status })),
    cooldowns: { ...unit.cooldowns },
  };
}

function living(units: TurnUnit[]): TurnUnit[] {
  return units.filter(unit => unit.hp > 0);
}

function alliesOf(actor: TurnUnit, units: TurnUnit[]): TurnUnit[] {
  return living(units).filter(unit => unit.side === actor.side);
}

function enemiesOf(actor: TurnUnit, units: TurnUnit[]): TurnUnit[] {
  return living(units).filter(unit => unit.side !== actor.side);
}

function byLowestHpThenSlot(a: TurnUnit, b: TurnUnit): number {
  const ratio = a.hp / a.maxHp - b.hp / b.maxHp;
  if (ratio !== 0) return ratio;
  return a.slot - b.slot;
}

export function selectTargets(actor: TurnUnit, units: TurnUnit[], skill: SkillDef): TurnUnit[] {
  if (skill.target === 'self') return actor.hp > 0 ? [actor] : [];
  if (skill.target === 'allyAll') return alliesOf(actor, units);
  if (skill.target === 'enemyAll') return enemiesOf(actor, units);
  if (skill.target === 'enemyFront') {
    const front = enemiesOf(actor, units).sort((a, b) => a.slot - b.slot)[0];
    return front ? [front] : [];
  }
  if (skill.target === 'allyLowest') {
    const lowest = alliesOf(actor, units).sort(byLowestHpThenSlot)[0];
    return lowest ? [lowest] : [];
  }
  if (skill.target === 'enemyLowest') {
    const lowest = enemiesOf(actor, units).sort(byLowestHpThenSlot)[0];
    return lowest ? [lowest] : [];
  }
  return [];
}

function resolveTargets(actor: TurnUnit, units: TurnUnit[], skill: SkillDef, targetId?: string): TurnUnit[] {
  if (targetId === undefined) return selectTargets(actor, units, skill);
  if (skill.target === 'self') return [actor];
  if (skill.target === 'allyAll') return alliesOf(actor, units);
  if (skill.target === 'enemyAll') return enemiesOf(actor, units);
  const target = units.find(unit => unit.id === targetId);
  return target && target.hp > 0 ? [target] : [];
}

function mine(unit: TurnUnit): RunningStatus[] {
  return unit.statuses.filter(status => status.targetId === unit.id);
}

function absorbShield(unit: TurnUnit, amount: number): number {
  const shield = unit.statuses.find(status => status.id === 'shield' && status.targetId === unit.id);
  if (!shield || shield.magnitude <= 0) return amount;
  const absorbed = Math.min(shield.magnitude, amount);
  shield.magnitude -= absorbed;
  if (shield.magnitude <= 0) {
    unit.statuses = unit.statuses.filter(status => status !== shield);
  }
  return amount - absorbed;
}

function dealDamage(actor: TurnUnit, target: TurnUnit, coefficient: number): number {
  if (target.hp <= 0) return 0;
  const atk = effectiveAttack(actor.atk, mine(actor));
  const def = effectiveDefense(target.def, mine(target));
  const taken = damageTakenMultiplier(mine(target));
  const raw = Math.max(1, Math.round(atk * coefficient * 100 / (100 + def) * taken));
  const hpDamage = absorbShield(target, raw);
  target.hp = Math.max(0, target.hp - hpDamage);
  target.statuses = onDirectHit(target.statuses, target.id);
  return raw;
}

export function resolveSkill(
  units: TurnUnit[],
  actorId: string,
  skill: SkillDef,
  targetId?: string,
  roll = 0,
): { events: SkillEvent[]; units: TurnUnit[] } {
  const next = units.map(cloneUnit);
  const actor = next.find(unit => unit.id === actorId);
  const events: SkillEvent[] = [];
  if (!actor || actor.hp <= 0) return { events, units: next };

  const targets = resolveTargets(actor, next, skill, targetId);
  actor.cooldowns[skill.id] = skill.cooldownTurns;

  for (const effect of skill.effects) {
    if (effect.op === 'damage') {
      for (const target of targets) {
        if (target.hp <= 0) continue;
        events.push({ type: 'strike', actorId: actor.id, targetId: target.id, delivery: skill.delivery });
        const amount = dealDamage(actor, target, effect.coefficient);
        if (amount > 0) events.push({ type: 'damage', actorId: actor.id, targetId: target.id, amount });
      }
      continue;
    }

    if (effect.op === 'heal') {
      for (const target of targets) {
        if (target.hp <= 0) continue;
        const amount = Math.round(effectiveAttack(actor.atk, mine(actor)) * effect.coefficient);
        const healed = Math.min(target.maxHp - target.hp, Math.max(0, amount));
        target.hp += healed;
        events.push({ type: 'heal', actorId: actor.id, targetId: target.id, amount: healed });
      }
      continue;
    }

    if (effect.op === 'shield') {
      for (const target of targets) {
        if (target.hp <= 0) continue;
        const amount = target.maxHp * effect.fraction;
        target.statuses = applyStatus(target.statuses, {
          id: 'shield',
          sourceId: actor.id,
          targetId: target.id,
          turns: 1,
          magnitude: amount,
        });
        events.push({ type: 'shield', actorId: actor.id, targetId: target.id, amount });
      }
      continue;
    }

    if (effect.op === 'applyStatus') {
      for (const target of targets) {
        if (target.hp <= 0) continue;
        if (effect.chance > 0 && roll >= effect.chance) continue;
        if (!statusDef(effect.statusId)) continue;
        target.statuses = applyStatus(target.statuses, {
          id: effect.statusId,
          sourceId: actor.id,
          targetId: target.id,
          turns: effect.turns,
          magnitude: effect.magnitude,
        });
        if (target.statuses.some(status => status.id === effect.statusId && status.targetId === target.id)) {
          events.push({ type: 'status', actorId: actor.id, targetId: target.id, statusId: effect.statusId });
        }
      }
      continue;
    }

    if (effect.op === 'gauge') {
      for (const target of targets) {
        if (target.hp <= 0) continue;
        const points = Math.round(effect.delta / 100 * 10000);
        target.gauge += points;
        events.push({ type: 'gauge', actorId: actor.id, targetId: target.id, delta: effect.delta });
      }
      continue;
    }

    if (effect.op === 'cooldown') {
      const current = actor.cooldowns[effect.skillId] ?? 0;
      actor.cooldowns[effect.skillId] = current + effect.delta;
      events.push({ type: 'cooldown', actorId: actor.id, skillId: effect.skillId, delta: effect.delta });
    }
  }

  return { events, units: next };
}

export function autoChooseSkill(skills: SkillDef[], cooldowns: Record<string, number>): SkillDef {
  const basic = skills.find(skill => skill.basic);
  for (const skill of skills) {
    if (skill.basic) continue;
    if ((cooldowns[skill.id] ?? 0) === 0) return skill;
  }
  if (!basic) throw new Error('autoChooseSkill requires a basic skill');
  return basic;
}
