import { canAct, fillMultiplier, statusDef, type RunningStatus } from './statuses';

export type GaugeUnit = {
  id: string;
  side: 'party' | 'enemy';
  slot: number;
  gauge: number;
  spd: number;
  hp: number;
  statuses: RunningStatus[];
};

const FULL_GAUGE = 10000;

export function gaugeRatio(gauge: number | undefined): number {
  return Math.max(0, Math.min(1, (gauge ?? 0) / FULL_GAUGE));
}

export function fillGauges<T extends GaugeUnit>(units: T[]): T[] {
  for (const unit of units) {
    if (unit.hp <= 0) continue;
    const mine = unit.statuses.filter(status => status.targetId === unit.id);
    if (mine.some(status => statusDef(status.id)?.locksGauge)) continue;
    unit.gauge += Math.round(unit.spd * 7 * fillMultiplier(mine));
  }
  return units;
}

export function nextActor<T extends GaugeUnit>(units: T[]): T | null {
  const ready = units.filter(unit => unit.hp > 0 && unit.gauge >= FULL_GAUGE);
  if (ready.length === 0) return null;
  ready.sort((a, b) => {
    if (b.gauge !== a.gauge) return b.gauge - a.gauge;
    if (a.side !== b.side) return a.side === 'party' ? -1 : 1;
    return a.slot - b.slot;
  });
  return ready[0] ?? null;
}

export function spendTurn(unit: GaugeUnit): void {
  unit.gauge -= FULL_GAUGE;
}

/** Subtract 1 from each positive cooldown unless the unit cannot act and a status freezes cooldowns. */
export function tickCooldowns(cooldowns: Record<string, number>, statuses: RunningStatus[]): Record<string, number> {
  const frozen = !canAct(statuses) && statuses.some(status => statusDef(status.id)?.freezesCooldown);
  if (frozen) return { ...cooldowns };
  const next: Record<string, number> = { ...cooldowns };
  for (const id of Object.keys(next)) {
    const value = next[id] ?? 0;
    if (value > 0) next[id] = value - 1;
  }
  return next;
}
