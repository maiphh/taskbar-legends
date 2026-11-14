export type StatusPolarity = 'buff' | 'debuff';
export type StatusStack = 'refresh' | 'strongest' | 'add';

export type StatusDef = {
  id: string;
  polarity: StatusPolarity;
  stack: StatusStack;
  maxStacks: number;
  preventsAction: boolean;
  freezesCooldown: boolean;
  breaksOnHit: boolean;
  blocksDebuff: boolean;
  blocksBuff: boolean;
  locksGauge: boolean;
};

export type RunningStatus = {
  id: string;
  sourceId: string;
  targetId: string;
  stacks: number;
  magnitude: number;
  turnsLeft: number;
};

const base = (partial: Omit<StatusDef, 'preventsAction' | 'freezesCooldown' | 'breaksOnHit' | 'blocksDebuff' | 'blocksBuff' | 'locksGauge'> & Partial<StatusDef>): StatusDef => ({
  preventsAction: false,
  freezesCooldown: false,
  breaksOnHit: false,
  blocksDebuff: false,
  blocksBuff: false,
  locksGauge: false,
  ...partial,
});

export const STATUS_CATALOG = {
  atkUp: base({ id: 'atkUp', polarity: 'buff', stack: 'strongest', maxStacks: 1 }),
  atkDown: base({ id: 'atkDown', polarity: 'debuff', stack: 'strongest', maxStacks: 1 }),
  defDown: base({ id: 'defDown', polarity: 'debuff', stack: 'strongest', maxStacks: 1 }),
  dmgReduction: base({ id: 'dmgReduction', polarity: 'buff', stack: 'strongest', maxStacks: 1 }),
  spdUp: base({ id: 'spdUp', polarity: 'buff', stack: 'strongest', maxStacks: 1 }),
  spdDown: base({ id: 'spdDown', polarity: 'debuff', stack: 'strongest', maxStacks: 1 }),
  shield: base({ id: 'shield', polarity: 'buff', stack: 'strongest', maxStacks: 1 }),
  hot: base({ id: 'hot', polarity: 'buff', stack: 'add', maxStacks: 5 }),
  dot: base({ id: 'dot', polarity: 'debuff', stack: 'add', maxStacks: 5 }),
  stun: base({ id: 'stun', polarity: 'debuff', stack: 'refresh', maxStacks: 1, preventsAction: true, freezesCooldown: true }),
  sleep: base({ id: 'sleep', polarity: 'debuff', stack: 'refresh', maxStacks: 1, preventsAction: true, freezesCooldown: true, breaksOnHit: true }),
  petrification: base({ id: 'petrification', polarity: 'debuff', stack: 'refresh', maxStacks: 1, preventsAction: true, freezesCooldown: true, locksGauge: true }),
  immunity: base({ id: 'immunity', polarity: 'buff', stack: 'refresh', maxStacks: 1, blocksDebuff: true }),
  buffBlock: base({ id: 'buffBlock', polarity: 'debuff', stack: 'refresh', maxStacks: 1, blocksBuff: true }),
} as const satisfies Record<string, StatusDef>;

export type StatusId = keyof typeof STATUS_CATALOG;

export function statusDef(id: string): StatusDef | undefined {
  return (STATUS_CATALOG as Record<string, StatusDef>)[id];
}

export type StatusApply = {
  id: string;
  sourceId: string;
  targetId: string;
  turns: number;
  magnitude: number;
};

function forTarget(statuses: RunningStatus[], targetId: string): RunningStatus[] {
  return statuses.filter(status => status.targetId === targetId);
}

function magnitudeOf(statuses: RunningStatus[], id: string, cap: number): number {
  return Math.min(cap, statuses.filter(status => status.id === id).reduce((total, status) => total + status.magnitude * status.stacks, 0));
}

export function applyStatus(statuses: RunningStatus[], next: StatusApply): RunningStatus[] {
  const def = statusDef(next.id);
  if (!def) return statuses.slice();

  const targetStatuses = forTarget(statuses, next.targetId);
  if (def.polarity === 'debuff' && targetStatuses.some(status => statusDef(status.id)?.blocksDebuff)) return statuses.slice();
  if (def.polarity === 'buff' && targetStatuses.some(status => statusDef(status.id)?.blocksBuff)) return statuses.slice();

  const others = statuses.filter(status => !(status.targetId === next.targetId && status.id === next.id));
  const existing = targetStatuses.find(status => status.id === next.id);

  if (!existing) {
    return [...others, {
      id: next.id,
      sourceId: next.sourceId,
      targetId: next.targetId,
      stacks: 1,
      magnitude: next.magnitude,
      turnsLeft: next.turns,
    }];
  }

  if (def.stack === 'add') {
    return [...others, {
      ...existing,
      stacks: Math.min(def.maxStacks, existing.stacks + 1),
      magnitude: next.magnitude,
      turnsLeft: next.turns,
      sourceId: next.sourceId,
    }];
  }

  if (def.stack === 'refresh') {
    return [...others, {
      ...existing,
      sourceId: next.sourceId,
      magnitude: next.magnitude,
      turnsLeft: next.turns,
      stacks: 1,
    }];
  }

  // strongest: keep larger magnitude, always refresh turns; keep source of the stronger instance
  const keepExisting = existing.magnitude > next.magnitude;
  return [...others, {
    ...existing,
    magnitude: Math.max(existing.magnitude, next.magnitude),
    turnsLeft: next.turns,
    sourceId: keepExisting ? existing.sourceId : next.sourceId,
    stacks: 1,
  }];
}

export function dispel(statuses: RunningStatus[], targetId: string, polarity: StatusPolarity): RunningStatus[] {
  return statuses.filter(status => {
    if (status.targetId !== targetId) return true;
    const def = statusDef(status.id);
    return !def || def.polarity !== polarity;
  });
}

export function onTurnStart<T extends { id: string; hp: number; maxHp: number; statuses: RunningStatus[] }>(unit: T): { unit: T; events: Array<{ type: 'hot' | 'dot'; targetId: string; amount: number }> } {
  const events: Array<{ type: 'hot' | 'dot'; targetId: string; amount: number }> = [];
  let hp = unit.hp;
  const mine = unit.statuses.filter(status => status.targetId === unit.id);

  for (const status of mine) {
    if (status.id === 'hot') {
      const amount = Math.round(unit.maxHp * status.magnitude * status.stacks);
      if (amount > 0) {
        hp = Math.min(unit.maxHp, hp + amount);
        events.push({ type: 'hot', targetId: unit.id, amount });
      }
    } else if (status.id === 'dot') {
      const amount = Math.round(unit.maxHp * status.magnitude * status.stacks);
      if (amount > 0) {
        hp = Math.max(0, hp - amount);
        events.push({ type: 'dot', targetId: unit.id, amount });
      }
    }
  }

  const statuses = unit.statuses
    .map(status => status.targetId === unit.id ? { ...status, turnsLeft: status.turnsLeft - 1 } : status)
    .filter(status => status.targetId !== unit.id || status.turnsLeft > 0);

  return { unit: { ...unit, hp, statuses }, events };
}

export function onDirectHit(statuses: RunningStatus[], targetId: string): RunningStatus[] {
  return statuses.filter(status => {
    if (status.targetId !== targetId) return true;
    return !statusDef(status.id)?.breaksOnHit;
  });
}

export function effectiveAttack(atk: number, statuses: RunningStatus[]): number {
  const up = magnitudeOf(statuses, 'atkUp', 0.5);
  const down = magnitudeOf(statuses, 'atkDown', 0.5);
  return atk * (1 + up) * (1 - down);
}

export function effectiveDefense(def: number, statuses: RunningStatus[]): number {
  return def * (1 - magnitudeOf(statuses, 'defDown', 0.6));
}

export function damageTakenMultiplier(statuses: RunningStatus[]): number {
  return 1 - magnitudeOf(statuses, 'dmgReduction', 0.5);
}

export function fillMultiplier(statuses: RunningStatus[]): number {
  const up = magnitudeOf(statuses, 'spdUp', 0.5);
  const down = magnitudeOf(statuses, 'spdDown', 0.5);
  return (1 + up) * (1 - down);
}

export function canAct(statuses: RunningStatus[]): boolean {
  return !statuses.some(status => statusDef(status.id)?.preventsAction);
}
