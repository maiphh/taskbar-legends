import { statusEffectsConfig, statusEffectsEnabled } from '../../config';

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
  cleansable: boolean;
  control: boolean;
  bossScale?: number;
  bossTurns?: number;
  grantedOnStunEnd?: boolean;
  defaultTurns?: number;
  defaultMagnitude?: number;
};

export type RunningStatus = {
  id: string;
  sourceId: string;
  targetId: string;
  stacks: number;
  magnitude: number;
  turnsLeft: number;
  /** Set when the carrier applied this status to itself during the current action; skips turn-end tick. */
  selfApplied?: boolean;
  /** Presentation alias (e.g. crushed for boss Armor Break). */
  display?: string;
  /** Combat tick when this instance was created or last refreshed; used for stable display sort. */
  appliedAtTick?: number;
};

const base = (partial: Omit<StatusDef, 'preventsAction' | 'freezesCooldown' | 'breaksOnHit' | 'blocksDebuff' | 'blocksBuff' | 'locksGauge' | 'cleansable' | 'control'> & Partial<StatusDef>): StatusDef => ({
  preventsAction: false,
  freezesCooldown: false,
  breaksOnHit: false,
  blocksDebuff: false,
  blocksBuff: false,
  locksGauge: false,
  cleansable: true,
  control: false,
  ...partial,
});

const BASE_CATALOG = {
  atkUp: base({ id: 'atkUp', polarity: 'buff', stack: 'strongest', maxStacks: 1 }),
  atkDown: base({ id: 'atkDown', polarity: 'debuff', stack: 'strongest', maxStacks: 1 }),
  defDown: base({ id: 'defDown', polarity: 'debuff', stack: 'strongest', maxStacks: 1 }),
  dmgReduction: base({ id: 'dmgReduction', polarity: 'buff', stack: 'strongest', maxStacks: 1 }),
  spdUp: base({ id: 'spdUp', polarity: 'buff', stack: 'strongest', maxStacks: 1 }),
  spdDown: base({ id: 'spdDown', polarity: 'debuff', stack: 'strongest', maxStacks: 1 }),
  shield: base({ id: 'shield', polarity: 'buff', stack: 'strongest', maxStacks: 1 }),
  hot: base({ id: 'hot', polarity: 'buff', stack: 'add', maxStacks: 5 }),
  dot: base({ id: 'dot', polarity: 'debuff', stack: 'add', maxStacks: 5 }),
  stun: base({ id: 'stun', polarity: 'debuff', stack: 'refresh', maxStacks: 1, preventsAction: true, freezesCooldown: true, control: true }),
  sleep: base({ id: 'sleep', polarity: 'debuff', stack: 'refresh', maxStacks: 1, preventsAction: true, freezesCooldown: true, breaksOnHit: true, control: true }),
  petrification: base({ id: 'petrification', polarity: 'debuff', stack: 'refresh', maxStacks: 1, preventsAction: true, freezesCooldown: true, locksGauge: true, control: true }),
  immunity: base({ id: 'immunity', polarity: 'buff', stack: 'refresh', maxStacks: 1, blocksDebuff: true }),
  buffBlock: base({ id: 'buffBlock', polarity: 'debuff', stack: 'refresh', maxStacks: 1, blocksBuff: true }),
  steadfast: base({ id: 'steadfast', polarity: 'buff', stack: 'refresh', maxStacks: 1, cleansable: false, grantedOnStunEnd: true, bossTurns: 3, defaultTurns: 2 }),
} as const satisfies Record<string, StatusDef>;

function buildCatalog(): Record<string, StatusDef> {
  const catalog: Record<string, StatusDef> = { ...BASE_CATALOG };
  const config = statusEffectsConfig();
  if (!config) return catalog;
  for (const [id, entry] of Object.entries(config.effects)) {
    const previous = catalog[id] ?? base({ id, polarity: entry.polarity, stack: entry.stack, maxStacks: entry.maxStacks });
    catalog[id] = {
      ...previous,
      id,
      polarity: entry.polarity,
      stack: entry.stack,
      maxStacks: entry.maxStacks,
      control: entry.control ?? previous.control,
      cleansable: entry.cleansable ?? previous.cleansable,
      bossScale: entry.bossScale ?? previous.bossScale,
      bossTurns: entry.bossTurns ?? previous.bossTurns,
      grantedOnStunEnd: entry.grantedOnStunEnd ?? previous.grantedOnStunEnd,
      defaultTurns: entry.turns,
      defaultMagnitude: entry.magnitude,
      preventsAction: entry.control ? true : previous.preventsAction,
      freezesCooldown: entry.control ? true : previous.freezesCooldown,
    };
  }
  return catalog;
}

export const STATUS_CATALOG = buildCatalog() as typeof BASE_CATALOG & Record<string, StatusDef>;
export type StatusId = keyof typeof BASE_CATALOG;

export function statusDef(id: string): StatusDef | undefined {
  return (STATUS_CATALOG as Record<string, StatusDef>)[id];
}

export function statusCaps(): { atkUp: number; atkDown: number; defDown: number; dmgReduction: number; spdUp: number; spdDown: number } {
  const caps = statusEffectsConfig()?.caps;
  return caps ?? { atkUp: 0.5, atkDown: 0.5, defDown: 0.6, dmgReduction: 0.5, spdUp: 0.5, spdDown: 0.5 };
}

export type StatusApply = {
  id: string;
  sourceId: string;
  targetId: string;
  turns: number;
  magnitude: number;
  selfApplied?: boolean;
  display?: string;
  appliedAtTick?: number;
};

export type StatusApplyResult = {
  statuses: RunningStatus[];
  kind: 'apply' | 'refresh' | 'stack' | 'resist' | 'blocked';
};

function forTarget(statuses: RunningStatus[], targetId: string): RunningStatus[] {
  return statuses.filter(status => status.targetId === targetId);
}

function magnitudeOf(statuses: RunningStatus[], id: string, cap: number): number {
  return Math.min(cap, statuses.filter(status => status.id === id).reduce((total, status) => total + status.magnitude * status.stacks, 0));
}

export function applyStatus(statuses: RunningStatus[], next: StatusApply): RunningStatus[] {
  return applyStatusDetailed(statuses, next).statuses;
}

export function applyStatusDetailed(statuses: RunningStatus[], next: StatusApply): StatusApplyResult {
  const def = statusDef(next.id);
  if (!def) return { statuses: statuses.slice(), kind: 'blocked' };

  const targetStatuses = forTarget(statuses, next.targetId);
  if (def.polarity === 'debuff' && targetStatuses.some(status => statusDef(status.id)?.blocksDebuff)) {
    return { statuses: statuses.slice(), kind: 'blocked' };
  }
  if (def.polarity === 'buff' && targetStatuses.some(status => statusDef(status.id)?.blocksBuff)) {
    return { statuses: statuses.slice(), kind: 'blocked' };
  }
  if (next.id === 'stun' && targetStatuses.some(status => status.id === 'steadfast')) {
    return { statuses: statuses.slice(), kind: 'resist' };
  }

  const others = statuses.filter(status => !(status.targetId === next.targetId && status.id === next.id));
  const existing = targetStatuses.find(status => status.id === next.id);
  const stamp = {
    selfApplied: next.selfApplied,
    display: next.display ?? existing?.display,
    appliedAtTick: next.appliedAtTick ?? existing?.appliedAtTick,
  };

  if (!existing) {
    return {
      statuses: [...others, {
        id: next.id,
        sourceId: next.sourceId,
        targetId: next.targetId,
        stacks: 1,
        magnitude: next.magnitude,
        turnsLeft: next.turns,
        ...stamp,
      }],
      kind: 'apply',
    };
  }

  if (def.stack === 'add') {
    return {
      statuses: [...others, {
        ...existing,
        stacks: Math.min(def.maxStacks, existing.stacks + 1),
        magnitude: next.magnitude,
        turnsLeft: next.turns,
        sourceId: next.sourceId,
        ...stamp,
      }],
      kind: existing.stacks < def.maxStacks ? 'stack' : 'refresh',
    };
  }

  if (def.stack === 'refresh') {
    return {
      statuses: [...others, {
        ...existing,
        sourceId: next.sourceId,
        magnitude: next.magnitude,
        turnsLeft: next.turns,
        stacks: 1,
        ...stamp,
      }],
      kind: 'refresh',
    };
  }

  const keepExisting = existing.magnitude > next.magnitude;
  return {
    statuses: [...others, {
      ...existing,
      magnitude: Math.max(existing.magnitude, next.magnitude),
      turnsLeft: next.turns,
      sourceId: keepExisting ? existing.sourceId : next.sourceId,
      stacks: 1,
      selfApplied: next.selfApplied ?? existing.selfApplied,
      display: next.display ?? existing.display,
      appliedAtTick: next.appliedAtTick ?? existing.appliedAtTick,
    }],
    kind: 'refresh',
  };
}

export function dispel(statuses: RunningStatus[], targetId: string, polarity: StatusPolarity): RunningStatus[] {
  return statuses.filter(status => {
    if (status.targetId !== targetId) return true;
    const def = statusDef(status.id);
    return !def || def.polarity !== polarity || def.cleansable === false;
  });
}

export function cleanseOne(statuses: RunningStatus[], targetId: string, order: readonly string[]): { statuses: RunningStatus[]; removed: RunningStatus | null } {
  const candidates = statuses
    .filter(status => status.targetId === targetId && statusDef(status.id)?.polarity === 'debuff' && statusDef(status.id)?.cleansable !== false)
    .sort((a, b) => {
      const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      const aRank = ai < 0 ? order.length : ai, bRank = bi < 0 ? order.length : bi;
      if (aRank !== bRank) return aRank - bRank;
      return (b.appliedAtTick ?? 0) - (a.appliedAtTick ?? 0);
    });
  const removed = candidates[0] ?? null;
  if (!removed) return { statuses: statuses.slice(), removed: null };
  return { statuses: statuses.filter(status => status !== removed), removed };
}

function isControl(status: RunningStatus): boolean {
  return Boolean(statusDef(status.id)?.preventsAction);
}

/**
 * Own-turn start planning: Regen → Bleed amounts, then stun consume → Steadfast.
 * Does not mutate HP; callers apply the returned hot/dot events (shield-aware in combat).
 */
export function turnStartPhases<T extends { id: string; hp: number; maxHp: number; statuses: RunningStatus[]; boss?: boolean }>(
  unit: T,
  options: { bossScale?: number; steadfastTurns?: number } = {},
): {
  unit: T;
  events: Array<{ type: 'hot' | 'dot'; targetId: string; amount: number; sourceId: string }>;
  mayAct: boolean;
  stunEnded: boolean;
  steadfastGranted: boolean;
  projectedHp: number;
} {
  const events: Array<{ type: 'hot' | 'dot'; targetId: string; amount: number; sourceId: string }> = [];
  let projectedHp = unit.hp;
  const mine = unit.statuses.filter(status => status.targetId === unit.id);

  for (const status of mine) {
    if (status.id !== 'hot') continue;
    const amount = Math.round(unit.maxHp * status.magnitude * status.stacks);
    if (amount > 0) {
      const healed = Math.min(unit.maxHp - projectedHp, amount);
      if (healed > 0) {
        projectedHp += healed;
        events.push({ type: 'hot', targetId: unit.id, amount: healed, sourceId: status.sourceId });
      }
    }
  }

  for (const status of mine) {
    if (status.id !== 'dot') continue;
    const scale = options.bossScale ?? statusDef('dot')?.bossScale ?? 1;
    const amount = Math.round(unit.maxHp * status.magnitude * status.stacks * scale);
    if (amount > 0) {
      projectedHp = Math.max(0, projectedHp - amount);
      events.push({ type: 'dot', targetId: unit.id, amount, sourceId: status.sourceId });
    }
  }

  const stunned = mine.some(status => isControl(status));
  if (!stunned) {
    // mayAct is about control, not projected DoT. Shields (and real HP after applyDotThroughShield)
    // decide whether the unit dies; only stun skips the action.
    return {
      unit: { ...unit, statuses: unit.statuses }, events,
      mayAct: true, stunEnded: false, steadfastGranted: false, projectedHp,
    };
  }

  let stunEnded = false;
  const next = unit.statuses.map(status => {
    if (status.targetId !== unit.id || !isControl(status)) return status;
    const turnsLeft = status.turnsLeft - 1;
    if (turnsLeft <= 0 && status.id === 'stun') stunEnded = true;
    return { ...status, turnsLeft };
  }).filter(status => status.targetId !== unit.id || status.turnsLeft > 0);

  let steadfastGranted = false;
  let statuses = next;
  if (stunEnded) {
    const turns = options.steadfastTurns ?? (unit.boss ? (statusDef('steadfast')?.bossTurns ?? 3) : (statusDef('steadfast')?.defaultTurns ?? 2));
    statuses = applyStatus(next, {
      id: 'steadfast', sourceId: unit.id, targetId: unit.id, turns, magnitude: 0, selfApplied: true,
    });
    steadfastGranted = statuses.some(status => status.id === 'steadfast' && status.targetId === unit.id);
  }

  return {
    unit: { ...unit, statuses }, events,
    mayAct: false, stunEnded, steadfastGranted, projectedHp,
  };
}

/** Own-turn end: decrement non-control statuses, skipping selfApplied ones granted this action. */
export function turnEndStatuses(statuses: RunningStatus[], targetId: string): RunningStatus[] {
  return statuses
    .map(status => {
      if (status.targetId !== targetId) return status;
      if (isControl(status)) return status;
      if (status.selfApplied) return { ...status, selfApplied: false };
      return { ...status, turnsLeft: status.turnsLeft - 1 };
    })
    .filter(status => status.targetId !== targetId || status.turnsLeft > 0);
}

/** Legacy combined tick used by older unit tests; prefer turnStartPhases + turnEndStatuses in combat. */
export function onTurnStart<T extends { id: string; hp: number; maxHp: number; statuses: RunningStatus[]; boss?: boolean }>(unit: T): { unit: T; events: Array<{ type: 'hot' | 'dot'; targetId: string; amount: number }> } {
  const started = turnStartPhases(unit, {
    bossScale: unit.boss && statusEffectsEnabled() ? (statusDef('dot')?.bossScale ?? 0.5) : 1,
  });
  const statuses = turnEndStatuses(started.unit.statuses, unit.id);
  return {
    unit: { ...started.unit, hp: started.projectedHp, statuses },
    events: started.events.map(event => ({ type: event.type, targetId: event.targetId, amount: event.amount })),
  };
}

export function onDirectHit(statuses: RunningStatus[], targetId: string): RunningStatus[] {
  return statuses.filter(status => {
    if (status.targetId !== targetId) return true;
    return !statusDef(status.id)?.breaksOnHit;
  });
}

export function effectiveAttack(atk: number, statuses: RunningStatus[]): number {
  const caps = statusCaps();
  const up = magnitudeOf(statuses, 'atkUp', caps.atkUp);
  const down = magnitudeOf(statuses, 'atkDown', caps.atkDown);
  return atk * (1 + up) * (1 - down);
}

export function effectiveDefense(def: number, statuses: RunningStatus[]): number {
  return def * (1 - magnitudeOf(statuses, 'defDown', statusCaps().defDown));
}

export function damageTakenMultiplier(statuses: RunningStatus[]): number {
  return 1 - magnitudeOf(statuses, 'dmgReduction', statusCaps().dmgReduction);
}

export function fillMultiplier(statuses: RunningStatus[]): number {
  const caps = statusCaps();
  const up = magnitudeOf(statuses, 'spdUp', caps.spdUp);
  const down = magnitudeOf(statuses, 'spdDown', caps.spdDown);
  return (1 + up) * (1 - down);
}

export function canAct(statuses: RunningStatus[]): boolean {
  return !statuses.some(status => statusDef(status.id)?.preventsAction);
}

export function statusMagnitude(statuses: RunningStatus[], id: string): number {
  const caps = statusCaps();
  const cap = id === 'atkUp' ? caps.atkUp
    : id === 'atkDown' ? caps.atkDown
      : id === 'defDown' ? caps.defDown
        : id === 'dmgReduction' ? caps.dmgReduction
          : id === 'spdUp' ? caps.spdUp
            : id === 'spdDown' ? caps.spdDown
              : Number.POSITIVE_INFINITY;
  return magnitudeOf(statuses, id, cap);
}
