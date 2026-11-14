import { describe, expect, it } from 'vitest';
import {
  STATUS_CATALOG,
  applyStatus,
  canAct,
  damageTakenMultiplier,
  dispel,
  effectiveAttack,
  effectiveDefense,
  fillMultiplier,
  onDirectHit,
  onTurnStart,
  type RunningStatus,
} from '../src/core/turn/statuses';
import { fillGauges, gaugeRatio, nextActor, spendTurn, tickCooldowns, type GaugeUnit } from '../src/core/turn/action-bar';
import {
  autoChooseSkill,
  resolveSkill,
  selectTargets,
  type SkillDef,
  type TurnUnit,
} from '../src/core/turn/skills';

function status(partial: Partial<RunningStatus> & Pick<RunningStatus, 'id' | 'targetId'>): RunningStatus {
  return {
    sourceId: partial.sourceId ?? 'src',
    stacks: partial.stacks ?? 1,
    magnitude: partial.magnitude ?? 0.3,
    turnsLeft: partial.turnsLeft ?? 2,
    ...partial,
  };
}

function unit(partial: Partial<TurnUnit> & Pick<TurnUnit, 'id' | 'side'>): TurnUnit {
  return {
    slot: 0,
    gauge: 0,
    spd: 100,
    hp: 1000,
    maxHp: 1000,
    atk: 100,
    def: 50,
    x: 40,
    statuses: [],
    cooldowns: {},
    ...partial,
  };
}

describe('status catalog', () => {
  it('exports the plan rows with polarity, stack mode, and crowd-control flags', () => {
    expect(STATUS_CATALOG.atkUp).toMatchObject({ polarity: 'buff', stack: 'strongest', maxStacks: 1 });
    expect(STATUS_CATALOG.atkDown).toMatchObject({ polarity: 'debuff', stack: 'strongest', maxStacks: 1 });
    expect(STATUS_CATALOG.defDown).toMatchObject({ polarity: 'debuff', stack: 'strongest', maxStacks: 1 });
    expect(STATUS_CATALOG.dmgReduction).toMatchObject({ polarity: 'buff', stack: 'strongest', maxStacks: 1 });
    expect(STATUS_CATALOG.spdUp).toMatchObject({ polarity: 'buff', stack: 'strongest', maxStacks: 1 });
    expect(STATUS_CATALOG.spdDown).toMatchObject({ polarity: 'debuff', stack: 'strongest', maxStacks: 1 });
    expect(STATUS_CATALOG.shield).toMatchObject({ polarity: 'buff', stack: 'strongest', maxStacks: 1 });
    expect(STATUS_CATALOG.hot).toMatchObject({ polarity: 'buff', stack: 'add', maxStacks: 5 });
    expect(STATUS_CATALOG.dot).toMatchObject({ polarity: 'debuff', stack: 'add', maxStacks: 5 });
    expect(STATUS_CATALOG.stun).toMatchObject({
      polarity: 'debuff', stack: 'refresh', maxStacks: 1, preventsAction: true, freezesCooldown: true, breaksOnHit: false,
    });
    expect(STATUS_CATALOG.sleep).toMatchObject({
      polarity: 'debuff', stack: 'refresh', maxStacks: 1, preventsAction: true, freezesCooldown: true, breaksOnHit: true,
    });
    expect(STATUS_CATALOG.immunity).toMatchObject({ polarity: 'buff', stack: 'refresh', maxStacks: 1, blocksDebuff: true });
    expect(STATUS_CATALOG.buffBlock).toMatchObject({ polarity: 'debuff', stack: 'refresh', maxStacks: 1, blocksBuff: true });
  });
});

describe('status stacking and caps', () => {
  it('caps atkUp/atkDown at 0.5, defDown at 0.6, dmgReduction at 0.5 and applies the plan formulas', () => {
    const atk = applyStatus([], { id: 'atkUp', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.8 });
    const mixed = applyStatus(atk, { id: 'atkDown', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.8 });
    expect(effectiveAttack(100, mixed.filter(s => s.targetId === 't'))).toBe(100 * (1 + 0.5) * (1 - 0.5));

    const def = applyStatus([], { id: 'defDown', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.9 });
    expect(effectiveDefense(100, def)).toBe(100 * (1 - 0.6));

    const dr = applyStatus([], { id: 'dmgReduction', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.9 });
    expect(damageTakenMultiplier(dr)).toBe(1 - 0.5);
  });

  it('caps spdUp and spdDown at 0.5 for fillMultiplier', () => {
    const up = applyStatus([], { id: 'spdUp', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.9 });
    expect(fillMultiplier(up)).toBe(1 + 0.5);
    const down = applyStatus([], { id: 'spdDown', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.9 });
    expect(fillMultiplier(down)).toBe(1 - 0.5);
    const both = applyStatus(up, { id: 'spdDown', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.2 });
    expect(fillMultiplier(both)).toBe((1 + 0.5) * (1 - 0.2));
  });

  it('uses strongest, refresh, and add stacking rules', () => {
    const strong = applyStatus(
      [status({ id: 'atkUp', targetId: 't', magnitude: 0.2, turnsLeft: 1 })],
      { id: 'atkUp', sourceId: 'b', targetId: 't', turns: 3, magnitude: 0.4 },
    );
    expect(strong).toEqual([expect.objectContaining({ id: 'atkUp', magnitude: 0.4, turnsLeft: 3, sourceId: 'b', stacks: 1 })]);

    const keep = applyStatus(
      [status({ id: 'atkUp', targetId: 't', sourceId: 'a', magnitude: 0.4, turnsLeft: 1 })],
      { id: 'atkUp', sourceId: 'b', targetId: 't', turns: 5, magnitude: 0.2 },
    );
    expect(keep).toEqual([expect.objectContaining({ id: 'atkUp', magnitude: 0.4, turnsLeft: 5, sourceId: 'a' })]);

    const refreshed = applyStatus(
      [status({ id: 'stun', targetId: 't', magnitude: 1, turnsLeft: 1, sourceId: 'a' })],
      { id: 'stun', sourceId: 'b', targetId: 't', turns: 2, magnitude: 1 },
    );
    expect(refreshed).toEqual([expect.objectContaining({ id: 'stun', turnsLeft: 2, magnitude: 1, sourceId: 'b' })]);

    let dots = applyStatus([], { id: 'dot', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.05 });
    dots = applyStatus(dots, { id: 'dot', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.05 });
    dots = applyStatus(dots, { id: 'dot', sourceId: 'a', targetId: 't', turns: 3, magnitude: 0.05 });
    expect(dots[0]).toMatchObject({ id: 'dot', stacks: 3, turnsLeft: 3, magnitude: 0.05 });
    for (let i = 0; i < 5; i += 1) dots = applyStatus(dots, { id: 'dot', sourceId: 'a', targetId: 't', turns: 1, magnitude: 0.05 });
    expect(dots[0]?.stacks).toBe(5);
  });
});

describe('immunity, buffBlock, crowd control', () => {
  it('blocks new debuffs with immunity and new buffs with buffBlock without stripping existing ones', () => {
    const withImm = applyStatus([], { id: 'immunity', sourceId: 'a', targetId: 't', turns: 2, magnitude: 1 });
    const withBuff = applyStatus(withImm, { id: 'atkUp', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.3 });
    const blockedDebuff = applyStatus(withBuff, { id: 'atkDown', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.3 });
    expect(blockedDebuff.map(s => s.id).sort()).toEqual(['atkUp', 'immunity']);

    const existingBuff = applyStatus([], { id: 'atkUp', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.3 });
    const withBlock = applyStatus(existingBuff, { id: 'buffBlock', sourceId: 'e', targetId: 't', turns: 2, magnitude: 1 });
    const blockedBuff = applyStatus(withBlock, { id: 'spdUp', sourceId: 'a', targetId: 't', turns: 2, magnitude: 0.3 });
    expect(blockedBuff.map(s => s.id).sort()).toEqual(['atkUp', 'buffBlock']);
  });

  it('lets stun and sleep prevent acting, freezes cooldown via catalog, and only a direct hit clears sleep', () => {
    const stunned = [status({ id: 'stun', targetId: 't', turnsLeft: 2 })];
    const asleep = [status({ id: 'sleep', targetId: 't', turnsLeft: 2 })];
    expect(canAct(stunned)).toBe(false);
    expect(canAct(asleep)).toBe(false);
    expect(STATUS_CATALOG.stun.freezesCooldown).toBe(true);
    expect(STATUS_CATALOG.sleep.freezesCooldown).toBe(true);

    expect(onDirectHit(stunned, 't').map(s => s.id)).toEqual(['stun']);
    expect(onDirectHit(asleep, 't')).toEqual([]);
  });

  it('dispel removes matching polarity without touching the other', () => {
    const list = [
      status({ id: 'atkUp', targetId: 't' }),
      status({ id: 'atkDown', targetId: 't' }),
      status({ id: 'spdUp', targetId: 'other' }),
    ];
    expect(dispel(list, 't', 'buff').map(s => s.id).sort()).toEqual(['atkDown', 'spdUp']);
    expect(dispel(list, 't', 'debuff').map(s => s.id).sort()).toEqual(['atkUp', 'spdUp']);
  });
});

describe('onTurnStart hot/dot and duration ticks', () => {
  it('applies hot and dot from max HP by magnitude * stacks, then decrements and drops expired statuses', () => {
    const u = unit({
      id: 't',
      side: 'party',
      hp: 500,
      maxHp: 1000,
      statuses: [
        status({ id: 'hot', targetId: 't', stacks: 2, magnitude: 0.1, turnsLeft: 1 }),
        status({ id: 'dot', targetId: 't', stacks: 1, magnitude: 0.05, turnsLeft: 2 }),
        status({ id: 'stun', targetId: 't', turnsLeft: 1 }),
      ],
    });
    const result = onTurnStart(u);
    // hot 0.1*2*1000 = 200, dot 0.05*1*1000 = 50 → hp 650
    expect(result.unit.hp).toBe(650);
    expect(result.unit.statuses.map(s => ({ id: s.id, turnsLeft: s.turnsLeft }))).toEqual([
      { id: 'dot', turnsLeft: 1 },
    ]);
  });

  it('ticks stun and sleep down even when the unit skips its action, and dot does not break sleep', () => {
    const u = unit({
      id: 't',
      side: 'enemy',
      hp: 1000,
      statuses: [
        status({ id: 'sleep', targetId: 't', turnsLeft: 2 }),
        status({ id: 'dot', targetId: 't', stacks: 1, magnitude: 0.1, turnsLeft: 2 }),
      ],
    });
    expect(canAct(u.statuses)).toBe(false);
    const result = onTurnStart(u);
    expect(result.unit.hp).toBe(900);
    expect(result.unit.statuses.map(s => s.id).sort()).toEqual(['dot', 'sleep']);
    expect(result.unit.statuses.find(s => s.id === 'sleep')?.turnsLeft).toBe(1);
  });
});

describe('action bar gauge', () => {
  it('maps gauge values to a 0..1 display ratio', () => {
    expect(gaugeRatio(undefined)).toBe(0);
    expect(gaugeRatio(0)).toBe(0);
    expect(gaugeRatio(5000)).toBe(0.5);
    expect(gaugeRatio(10000)).toBe(1);
    expect(gaugeRatio(15000)).toBe(1);
    expect(gaugeRatio(-1)).toBe(0);
  });

  it('fills with round(spd * 7 * fillMultiplier), keeps overflow, and picks party before enemies then lower slot', () => {
    const units: GaugeUnit[] = [
      { id: 'e0', side: 'enemy', slot: 0, gauge: 9990, spd: 100, hp: 1, statuses: [] },
      { id: 'p1', side: 'party', slot: 1, gauge: 9990, spd: 100, hp: 1, statuses: [] },
      { id: 'p0', side: 'party', slot: 0, gauge: 9990, spd: 100, hp: 1, statuses: [] },
      { id: 'dead', side: 'party', slot: 2, gauge: 20000, spd: 200, hp: 0, statuses: [] },
    ];
    fillGauges(units);
    expect(units.find(u => u.id === 'p0')?.gauge).toBe(9990 + Math.round(100 * 7));
    expect(units.find(u => u.id === 'dead')?.gauge).toBe(20000);

    const boosted: GaugeUnit[] = [
      { id: 'fast', side: 'party', slot: 0, gauge: 0, spd: 100, hp: 1, statuses: [status({ id: 'spdUp', targetId: 'fast', magnitude: 0.3 })] },
    ];
    fillGauges(boosted);
    expect(boosted[0]?.gauge).toBe(Math.round(100 * 7 * 1.3));

    const tied = fillGauges([
      { id: 'e', side: 'enemy' as const, slot: 0, gauge: 10000, spd: 0, hp: 1, statuses: [] },
      { id: 'p-high', side: 'party' as const, slot: 1, gauge: 10000, spd: 0, hp: 1, statuses: [] },
      { id: 'p-low', side: 'party' as const, slot: 0, gauge: 10000, spd: 0, hp: 1, statuses: [] },
    ]);
    expect(nextActor(tied)?.id).toBe('p-low');

    const overflow: GaugeUnit[] = [
      { id: 'a', side: 'party', slot: 0, gauge: 15000, spd: 0, hp: 1, statuses: [] },
      { id: 'b', side: 'party', slot: 1, gauge: 12000, spd: 0, hp: 1, statuses: [] },
    ];
    expect(nextActor(overflow)?.id).toBe('a');
    spendTurn(overflow[0]!);
    expect(overflow[0]?.gauge).toBe(5000);
    expect(nextActor(overflow)?.id).toBe('b');
    expect(nextActor([{ id: 'x', side: 'party' as const, slot: 0, gauge: 9999, spd: 0, hp: 1, statuses: [] }])).toBeNull();
  });

  it('treats a bonus turn as another nextActor check without filling', () => {
    const units: GaugeUnit[] = [
      { id: 'a', side: 'party', slot: 0, gauge: 20000, spd: 50, hp: 1, statuses: [] },
      { id: 'b', side: 'enemy', slot: 0, gauge: 5000, spd: 50, hp: 1, statuses: [] },
    ];
    spendTurn(units[0]!);
    expect(nextActor(units)?.id).toBe('a');
    expect(units[1]?.gauge).toBe(5000);
  });

  it('skips fill when any of the unit statuses locksGauge', () => {
    const units: GaugeUnit[] = [
      { id: 'locked', side: 'party', slot: 0, gauge: 0, spd: 100, hp: 1, statuses: [status({ id: 'petrification', targetId: 'locked' })] },
      { id: 'free', side: 'party', slot: 1, gauge: 0, spd: 100, hp: 1, statuses: [] },
    ];
    fillGauges(units);
    expect(units[0]?.gauge).toBe(0);
    expect(units[1]?.gauge).toBe(Math.round(100 * 7));
  });
});

describe('tickCooldowns', () => {
  it('subtracts one from positive cooldowns unless canAct is false and a status freezesCooldown', () => {
    const ready = tickCooldowns({ a: 3, b: 0, c: 1 }, []);
    expect(ready).toEqual({ a: 2, b: 0, c: 0 });

    const stunned = [status({ id: 'stun', targetId: 't' })];
    expect(tickCooldowns({ a: 3, b: 1 }, stunned)).toEqual({ a: 3, b: 1 });

    const asleep = [status({ id: 'sleep', targetId: 't' })];
    expect(tickCooldowns({ a: 2 }, asleep)).toEqual({ a: 2 });

    const buffOnly = [status({ id: 'atkUp', targetId: 't' })];
    expect(tickCooldowns({ a: 2 }, buffOnly)).toEqual({ a: 1 });
  });
});

describe('selectTargets', () => {
  it('resolves self, allyAll, enemyAll, enemyFront, allyLowest, and enemyLowest', () => {
    const actor = unit({ id: 'p0', side: 'party', slot: 0, hp: 500, maxHp: 1000 });
    const allyHigh = unit({ id: 'p1', side: 'party', slot: 1, hp: 900, maxHp: 1000 });
    const allyLow = unit({ id: 'p2', side: 'party', slot: 2, hp: 100, maxHp: 1000 });
    const eFront = unit({ id: 'e0', side: 'enemy', slot: 0, hp: 800, maxHp: 1000 });
    const eLow = unit({ id: 'e1', side: 'enemy', slot: 1, hp: 50, maxHp: 1000 });
    const eDead = unit({ id: 'e2', side: 'enemy', slot: 2, hp: 0, maxHp: 1000 });
    const units = [actor, allyHigh, allyLow, eFront, eLow, eDead];

    expect(selectTargets(actor, units, { id: 's', delivery: 'cast', cooldownTurns: 0, target: 'self', effects: [] }).map(u => u.id)).toEqual(['p0']);
    expect(selectTargets(actor, units, { id: 's', delivery: 'cast', cooldownTurns: 0, target: 'allyAll', effects: [] }).map(u => u.id).sort()).toEqual(['p0', 'p1', 'p2']);
    expect(selectTargets(actor, units, { id: 's', delivery: 'cast', cooldownTurns: 0, target: 'enemyAll', effects: [] }).map(u => u.id).sort()).toEqual(['e0', 'e1']);
    expect(selectTargets(actor, units, { id: 's', delivery: 'leap', cooldownTurns: 0, target: 'enemyFront', effects: [] }).map(u => u.id)).toEqual(['e0']);
    expect(selectTargets(actor, units, { id: 's', delivery: 'cast', cooldownTurns: 0, target: 'allyLowest', effects: [] }).map(u => u.id)).toEqual(['p2']);
    expect(selectTargets(actor, units, { id: 's', delivery: 'cast', cooldownTurns: 0, target: 'enemyLowest', effects: [] }).map(u => u.id)).toEqual(['e1']);
  });
});

describe('applyStatus chance', () => {
  it('always lands when chance is 0, and misses only when chance > 0 and roll >= chance', () => {
    const actor = unit({ id: 'hero', side: 'party' });
    const foe = unit({ id: 'foe', side: 'enemy' });
    const zeroChance: SkillDef = {
      id: 'hex0',
      delivery: 'cast',
      cooldownTurns: 0,
      target: 'enemyFront',
      effects: [{ op: 'applyStatus', statusId: 'atkDown', turns: 2, magnitude: 0.3, chance: 0 }],
    };
    const landed = resolveSkill([actor, foe], 'hero', zeroChance, 'foe', 0);
    expect(landed.units.find(u => u.id === 'foe')?.statuses.some(s => s.id === 'atkDown')).toBe(true);

    const alwaysMissRoll = resolveSkill(
      [actor, unit({ id: 'open', side: 'enemy' })],
      'hero',
      { ...zeroChance, id: 'hex1', effects: [{ op: 'applyStatus', statusId: 'atkDown', turns: 2, magnitude: 0.3, chance: 1 }] },
      'open',
      1,
    );
    expect(alwaysMissRoll.units.find(u => u.id === 'open')?.statuses.some(s => s.id === 'atkDown')).toBe(false);
  });
});

describe('skills', () => {
  const strike: SkillDef = {
    id: 'slash',
    delivery: 'leap',
    cooldownTurns: 0,
    target: 'enemyFront',
    effects: [{ op: 'damage', coefficient: 1 }],
    basic: true,
  };
  const buffSkill: SkillDef = {
    id: 'war-cry',
    delivery: 'cast',
    cooldownTurns: 3,
    target: 'self',
    effects: [{ op: 'applyStatus', statusId: 'atkUp', turns: 2, magnitude: 0.3, chance: 1 }],
  };

  it('resolves damage with effective stats, skips dead targets, keeps actor x for leap and cast, and records delivery', () => {
    const actor = unit({ id: 'hero', side: 'party', x: 40, atk: 100, statuses: [status({ id: 'atkUp', targetId: 'hero', magnitude: 0.5 })] });
    const foe = unit({
      id: 'foe',
      side: 'enemy',
      x: 120,
      def: 100,
      statuses: [
        status({ id: 'defDown', targetId: 'foe', magnitude: 0.5 }),
        status({ id: 'dmgReduction', targetId: 'foe', magnitude: 0.2 }),
      ],
    });
    const dead = unit({ id: 'corpse', side: 'enemy', hp: 0, x: 130 });
    const { events, units } = resolveSkill([actor, foe, dead], 'hero', strike, 'foe');
    const atk = 100 * 1.5;
    const def = 100 * (1 - 0.5);
    const expected = Math.max(1, Math.round(atk * 1 * 100 / (100 + def) * (1 - 0.2)));
    expect(units.find(u => u.id === 'foe')?.hp).toBe(1000 - expected);
    expect(units.find(u => u.id === 'corpse')?.hp).toBe(0);
    expect(units.find(u => u.id === 'hero')?.x).toBe(40);
    expect(events).toContainEqual({ type: 'strike', actorId: 'hero', targetId: 'foe', delivery: 'leap' });

    const castSkill: SkillDef = { ...strike, id: 'bolt', delivery: 'cast', basic: true };
    const cast = resolveSkill([actor, foe], 'hero', castSkill, 'foe');
    expect(cast.units.find(u => u.id === 'hero')?.x).toBe(40);
    expect(cast.events).toContainEqual({ type: 'strike', actorId: 'hero', targetId: 'foe', delivery: 'cast' });
  });

  it('applies heal, shield, gauge percent, cooldown delta, and chance-gated statuses with immunity rules after the roll', () => {
    const actor = unit({ id: 'hero', side: 'party', hp: 400, cooldowns: { 'war-cry': 0, 'slash': 2 } });
    const foe = unit({ id: 'foe', side: 'enemy', gauge: 0, statuses: [status({ id: 'immunity', targetId: 'foe', turnsLeft: 2 })] });
    const healSkill: SkillDef = {
      id: 'mend',
      delivery: 'cast',
      cooldownTurns: 2,
      target: 'self',
      effects: [
        { op: 'heal', coefficient: 2 },
        { op: 'shield', fraction: 0.2 },
        { op: 'gauge', delta: 25 },
        { op: 'cooldown', skillId: 'slash', delta: -1 },
      ],
    };
    const healed = resolveSkill([actor, foe], 'hero', healSkill);
    const hero = healed.units.find(u => u.id === 'hero')!;
    expect(hero.hp).toBe(Math.min(1000, 400 + Math.round(effectiveAttack(100, []) * 2)));
    expect(hero.statuses.some(s => s.id === 'shield' && s.magnitude === 200)).toBe(true);
    expect(hero.gauge).toBe(2500);
    expect(hero.cooldowns.slash).toBe(1);
    expect(hero.cooldowns.mend).toBe(2);

    const land: SkillDef = {
      id: 'hex',
      delivery: 'cast',
      cooldownTurns: 1,
      target: 'enemyFront',
      effects: [{ op: 'applyStatus', statusId: 'atkDown', turns: 2, magnitude: 0.3, chance: 1 }],
    };
    const immune = resolveSkill([actor, foe], 'hero', land, 'foe', 0);
    expect(immune.units.find(u => u.id === 'foe')?.statuses.some(s => s.id === 'atkDown')).toBe(false);

    const missRoll = resolveSkill(
      [actor, unit({ id: 'open', side: 'enemy' })],
      'hero',
      land,
      'open',
      1,
    );
    expect(missRoll.units.find(u => u.id === 'open')?.statuses.some(s => s.id === 'atkDown')).toBe(false);

    const hit = resolveSkill(
      [actor, unit({ id: 'open', side: 'enemy' })],
      'hero',
      land,
      'open',
      0,
    );
    expect(hit.units.find(u => u.id === 'open')?.statuses.some(s => s.id === 'atkDown')).toBe(true);
  });

  it('does not treat gauge changes as blocked by immunity and clears sleep only on direct damage', () => {
    const actor = unit({ id: 'hero', side: 'party' });
    const foe = unit({
      id: 'foe',
      side: 'enemy',
      gauge: 5000,
      statuses: [
        status({ id: 'immunity', targetId: 'foe', turnsLeft: 2 }),
        status({ id: 'sleep', targetId: 'foe', turnsLeft: 2 }),
      ],
    });
    const push: SkillDef = {
      id: 'push',
      delivery: 'cast',
      cooldownTurns: 0,
      target: 'enemyFront',
      effects: [{ op: 'gauge', delta: -25 }],
    };
    const pushed = resolveSkill([actor, foe], 'hero', push, 'foe');
    expect(pushed.units.find(u => u.id === 'foe')?.gauge).toBe(2500);
    expect(pushed.units.find(u => u.id === 'foe')?.statuses.some(s => s.id === 'sleep')).toBe(true);

    const hit = resolveSkill([actor, foe], 'hero', strike, 'foe');
    expect(hit.units.find(u => u.id === 'foe')?.statuses.some(s => s.id === 'sleep')).toBe(false);
  });

  it('autoChooseSkill prefers the first ready non-basic skill and falls back to basic', () => {
    const basic = { ...strike, id: 'basic', basic: true as const };
    const a = { ...buffSkill, id: 'a' };
    const b = { ...buffSkill, id: 'b' };
    expect(autoChooseSkill([basic, a, b], { a: 1, b: 0 }).id).toBe('b');
    expect(autoChooseSkill([basic, a, b], { a: 0, b: 0 }).id).toBe('a');
    expect(autoChooseSkill([basic, a, b], { a: 2, b: 3 }).id).toBe('basic');
  });
});
