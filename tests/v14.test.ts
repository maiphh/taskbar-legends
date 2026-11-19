// v1.4 code requests implemented in this PR (design.md Â§18): CR-14-08 chest pick-1-of-2, CR-14-09 farm chest pity, CR-14-11 zero tickets.
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, V14_DESIGN, activeV14Rules, parseV14Flag, setV14Rules, ticksForSeconds, v14RuleSchema } from '../src/config';
import { beginEncounter } from '../src/core/combat';
import { bestChoice, chest, chooseChest, farmChestRoll } from '../src/core/economy';
import { createState, input, load, snapshot, step } from '../src/core/game';
import { captureFarmClock } from '../src/core/clock';
import { parseState } from '../src/core/model';
import type { GameState, Gear } from '../src/core/model';
import { runReference } from '../src/core/policy';
import { maybeDayOneSpark } from '../src/core/rewards';
import { applyOffline, makeSave, restoreSave } from '../src/core/save';
import design from '../src/design-config.json';

afterEach(() => { setV14Rules([]); });
describe('v14 config block', () => {
  it('ships the designer block inert: no rule on by default, Â§18 defaults, designer values parsed', () => {
    expect(activeV14Rules()).toEqual([]);
    expect(CONFIG.v14).toMatchObject({ chestChoice: { options: 1, fromStage: 1 }, dayOneSpark: null, farmChest: null, recruit: { legendaryPityEvery: 0, newHeroGuaranteeEvery: 0 }, fortune: { legendaryEvery: 0 } });
    expect(design.version).toBe('1.5.0'); expect(design.v14.targetVersion).toBe('1.4.0');
    expect(V14_DESIGN.chestChoice).toMatchObject({ options: 2, fromStage: 9 });
    expect(V14_DESIGN.dayOneSpark).toMatchObject({ gapSec: 150, maxOpenHour: 6, belowStage: 10 });
    expect(V14_DESIGN.farmChest).toMatchObject({ baseChance: 0.03, guaranteeEvery: 7, fromStage: 9 });
    setV14Rules(['chestChoice', 'farmChest']); expect(activeV14Rules()).toEqual(['chestChoice', 'farmChest']);
    expect(CONFIG.v14.dayOneSpark).toMatchObject({ gapSec: 150, maxOpenHour: 6, belowStage: 10 });
    setV14Rules(['recruitPity', 'gearFortune']); expect(activeV14Rules()).toEqual(['recruitPity', 'gearFortune']);
    expect(CONFIG.v14.dayOneSpark).toBeNull();
    setV14Rules([]); expect(CONFIG.v14).toMatchObject({ chestChoice: { options: 1, fromStage: 1 }, dayOneSpark: null, farmChest: null, recruit: { legendaryPityEvery: 0, newHeroGuaranteeEvery: 0 }, fortune: { legendaryEvery: 0 } });
    expect(parseV14Flag(null)).toEqual([...v14RuleSchema.options]);
    expect(parseV14Flag('all')).toEqual([...v14RuleSchema.options]);
    expect(parseV14Flag('none')).toEqual([]);
    expect(parseV14Flag('chestChoice,farmChest')).toEqual(['chestChoice', 'farmChest']);
  });
});

describe('CR-14-08 chest pick-1-of-2', () => {
  it('options = 1 keeps same-seed current rules-off accounts deterministic', { timeout: 60_000 }, () => {
    setV14Rules([]);
    const a = runReference(3, 1), b = runReference(3, 1);
    applyOffline(a.state, 9 * 3600 * 1000); applyOffline(b.state, 9 * 3600 * 1000);
    expect(snapshot(a.state)).toBe(snapshot(b.state));
    expect(a.state.combatRules).toBe('party-v2');
  });
  it('options = 2: each chest offers two rolls and keeping the higher score salvages the other', () => {
    setV14Rules(['chestChoice']);
    const state = createState(5, { starterGear: false });
    for (let count = 0; count < 24; count += 1) {
      chest(state, 10);
      const pair = state.pendingChoice?.[0]; if (!pair) throw new Error('Expected chest options');
      const expectedId = pair[bestChoice(pair)].id;
      chooseChest(state, bestChoice(pair));
      expect(state.inventory.at(-1)?.id).toBe(expectedId);
      expect(state.events.at(-1)?.data.type).toBe('chestChoice');
    }
    expect(state.stats.chests).toBe(24);
  });  it('keeps the chosen item, salvages the other for salvageBase Ã— rarityMult, queues â‰¤ 3 and auto-picks the oldest by score', () => {
    setV14Rules(['chestChoice']);
    const state = createState(9);
    chest(state, 10);
    const pair = state.pendingChoice?.[0]; if (!pair) throw new Error('no choice');
    const initialItems = state.inventory.length; expect(initialItems).toBe(3); expect(state.stats.chests).toBe(1);
    const gold = state.gold;
    input(state, { type: 'chooseChest', keep: 1 });
    expect(state.inventory.map(item => item.id)).toContain(pair[1].id);
    expect(state.inventory).toHaveLength(initialItems + 1);
    expect(state.gold - gold).toBe(Math.round(CONFIG.runtime.salvageBase * CONFIG.gear.rarityMult[pair[0].rarity]));
    expect(state.events.at(-1)?.data).toEqual({ type: 'chestChoice', options: [pair[0].id, pair[1].id], kept: pair[1].id, rarities: [pair[0].rarity, pair[1].rarity] });
    expect(state.pendingChoice).toBeUndefined();
    for (let index = 0; index < 3; index += 1) chest(state, 10);
    const oldest = state.pendingChoice?.[0] as [Gear, Gear];
    chest(state, 10);
    expect(state.pendingChoice).toHaveLength(3);
    expect(state.inventory.at(-1)?.id).toBe(oldest[bestChoice(oldest)].id);
    expect(() => parseState(structuredClone(state))).not.toThrow();
  });
  it('drops below fromStage stay single items', () => {
    setV14Rules(['chestChoice']); CONFIG.v14.chestChoice.fromStage = 10;
    const state = createState(2), initialItems = state.inventory.length; chest(state, 9); expect(state.pendingChoice).toBeUndefined(); expect(state.inventory).toHaveLength(initialItems + 1);
    chest(state, 10); expect(state.pendingChoice).toHaveLength(1);
  });
});

describe('dayOneSpark (idea 4)', () => {
  it('a farm clear 150 s after the last spark queues two items; 10 s later does not; a day-2 clear does not', () => {
    setV14Rules(['chestChoice']);
    const spark = CONFIG.v14.dayOneSpark;
    if (!spark) throw new Error('dayOneSpark');
    const state = createState(3, { starterGear: false });
    // Below chestChoice.fromStage (9) so a normal chest would be a single item; spark still queues a pair.
    expect(CONFIG.v14.chestChoice.fromStage).toBeGreaterThan(5);

    state.tick = ticksForSeconds(300);
    state.dayOneSparkAtTick = state.tick - ticksForSeconds(spark.gapSec);
    const queued = state.pendingChoice?.length ?? 0;
    expect(maybeDayOneSpark(state, 5)).toBe(true);
    expect(state.pendingChoice).toHaveLength(queued + 1);
    const pair = state.pendingChoice?.[queued];
    if (!pair) throw new Error('spark pair');
    expect(pair).toHaveLength(2);
    expect(pair[0]?.dropStage).toBe(5);
    expect(pair[1]?.dropStage).toBe(5);
    expect(state.dayOneSparkAtTick).toBe(state.tick);

    state.tick += ticksForSeconds(10);
    const afterGap = state.pendingChoice?.length ?? 0;
    expect(maybeDayOneSpark(state, 5)).toBe(false);
    expect(state.pendingChoice?.length ?? 0).toBe(afterGap);

    // Past maxOpenHour (hour 6 of day 1 / start of day-2 open time in the reference clock).
    state.tick = ticksForSeconds(spark.maxOpenHour * 3600);
    state.dayOneSparkAtTick = state.tick - ticksForSeconds(spark.gapSec * 2);
    expect(maybeDayOneSpark(state, 5)).toBe(false);
    expect(state.pendingChoice?.length ?? 0).toBe(afterGap);
  });

  it('first eligible farm clear on day 1 sparks with no prior dayOneSparkAtTick', () => {
    setV14Rules(['chestChoice']);
    const state = createState(8, { starterGear: false });
    state.tick = ticksForSeconds(60);
    expect(state.dayOneSparkAtTick).toBeUndefined();
    expect(maybeDayOneSpark(state, 3)).toBe(true);
    expect(state.pendingChoice).toHaveLength(1);
    expect(state.dayOneSparkAtTick).toBe(state.tick);
  });

  it('does nothing when chestChoice is off or the farm stage is at/above belowStage', () => {
    setV14Rules([]);
    const off = createState(2, { starterGear: false });
    expect(CONFIG.v14.dayOneSpark).toBeNull();
    expect(maybeDayOneSpark(off, 4)).toBe(false);

    setV14Rules(['chestChoice']);
    const state = createState(2, { starterGear: false });
    state.tick = ticksForSeconds(200);
    expect(maybeDayOneSpark(state, CONFIG.v14.dayOneSpark!.belowStage)).toBe(false);
    expect(state.pendingChoice).toBeUndefined();
  });
});

describe('CR-14-09 farm chest pity from fromStage (design 9)', () => {
  const run = (stage: number, clears: number) => {
    const state = createState(11); let dry = 0, maxDry = 0, chests = 0;
    for (let clear = 0; clear < clears; clear += 1) {
      const before = state.stats.chests; farmChestRoll(state, stage);
      if (state.stats.chests > before) { chests += 1; dry = 0; } else maxDry = Math.max(maxDry, ++dry);
    }
    return { state, chests, maxDry, mean: clears / chests };
  };
  it('never has a 7-clear dry run at stage â‰¥ fromStage; mean interval = (1 âˆ’ (1 âˆ’ b)^7) / b Â± 0.2 clears', () => {
    setV14Rules(['farmChest']);
    const result = run(12, 40_000), b = CONFIG.v14.farmChest?.baseChance ?? 0, expected = (1 - (1 - b) ** 7) / b;
    expect(result.maxDry).toBeLessThanOrEqual(6);
    expect(result.mean).toBeGreaterThan(expected - 0.2); expect(result.mean).toBeLessThan(expected + 0.2);
    expect(result.state.farmChestDry).toBeLessThan(7);
  });
  it('below fromStage the 1.3.0 farmChestChance applies and the dry counter is untouched', () => {
    setV14Rules(['farmChest']);
    const result = run((CONFIG.v14.farmChest?.fromStage ?? 10) - 1, 20_000);
    expect(result.state.farmChestDry).toBeUndefined();
    expect(result.mean).toBeCloseTo(1 / CONFIG.rewards.farmChestChance, 0);
  });
  it('awards repeat-farm chests through the current encounter clear and farm pad path', () => {
    setV14Rules(['farmChest']);
    const rule = CONFIG.v14.farmChest;
    if (!rule) throw new Error('farmChest rule');
    rule.fromStage = 1;
    rule.baseChance = 0;
    rule.guaranteeEvery = 2;

    const originalMinCycle = CONFIG.combat.nonBossFarmMinCycleSec;
    CONFIG.combat.nonBossFarmMinCycleSec = 1;
    try {
      const state = createState(4, { starterGear: false });
      state.highestCleared = 1;
      state.progress = { kind: 'FARMING', stage: 1, failedStage: 1, retryAtTick: Number.MAX_SAFE_INTEGER,
        failTick: 0, failedPower: Number.MAX_SAFE_INTEGER, failures: 1 };
      captureFarmClock(state);
      expect(state.farmClock).toBeDefined();

      const stage = CONFIG.stages[0];
      if (!stage) throw new Error('stage 1');
      const completeRepeat = () => {
        const phaseKind = (): GameState['phase']['kind'] => state.phase.kind;
        state.phase = { kind: 'battle' };
        state.wave = stage.waves.length;
        state.stageStartedTick = state.tick;
        state.enemies.forEach(enemy => { enemy.hp = 0; });
        step(state);
        expect(phaseKind()).toBe('farmPad');
        let guard = 0;
        while (phaseKind() === 'farmPad' && guard < 200) { step(state); guard += 1; }
        expect(phaseKind()).toBe('battle');
      };

      for (let clear = 1; clear <= 3; clear += 1) {
        const before = state.stats.chests;
        completeRepeat();
        expect(state.stats.clears).toBe(clear);
        expect(state.metrics.farmSamples).toBe(clear);
        expect(state.stats.chests - before).toBe(clear === 2 ? 1 : 0);
      }
      expect(state.farmChestDry).toBe(1);
      expect(state.inventory).toHaveLength(1);
    } finally {
      CONFIG.combat.nonBossFarmMinCycleSec = originalMinCycle;
    }
  });
});
describe('saves (CR-14-11)', () => {
  const withChoice = (): GameState => {
    setV14Rules(['chestChoice', 'farmChest']);
    const state = createState(7); chest(state, 10); chest(state, 10); farmChestRoll(state, 10); state.farmChestDry = 5;
    return state;
  };
  it('pendingChoice and farmChestDry survive snapshot/load and the save envelope', () => {
    const state = withChoice(), text = snapshot(state);
    expect(snapshot(load(text))).toBe(text);
    const restored = restoreSave(makeSave(state, 1_000), 1_000).state;
    expect(restored.pendingChoice).toEqual(state.pendingChoice); expect(restored.farmChestDry).toBe(5);
    chooseChest(restored, 0); expect(restored.pendingChoice).toHaveLength(1);
  });
  it('1.3.0 saves (no v14 fields) load unchanged; balance 1.3.0 and 1.4.0 are accepted', () => {
    const state = createState(3); step(state, 2_000);
    const raw = JSON.parse(snapshot(state)) as Record<string, unknown>;
    expect('pendingChoice' in raw || 'farmChestDry' in raw).toBe(false);
    expect(snapshot(load(raw))).toBe(snapshot(state));
    expect(load({ ...raw, balance: '1.3.0' }).balance).toBe(CONFIG.version);
    expect(load({ ...raw, balance: '1.4.0' }).balance).toBe(CONFIG.version);
    expect(load({ ...raw, balance: '1.4.1' }).balance).toBe(CONFIG.version);
    expect(load({ ...raw, balance: '1.4.2' }).balance).toBe(CONFIG.version);
    expect(load({ ...raw, balance: '1.4.3' }).balance).toBe(CONFIG.version);
    expect(load({ ...raw, balance: '1.4.4' }).balance).toBe(CONFIG.version);
  });
  it('a 1.4.3 save loads under 1.5.0 and continues tick-for-tick; a 1.4.3 COMPLETE boss repeat picks up the Â§20 pad on its next encounter', () => {
    expect(CONFIG.version).toBe('1.5.0');
    const state = createState(3); step(state, 2_000);
    const raw = { ...(JSON.parse(snapshot(state)) as Record<string, unknown>), balance: '1.4.3' };
    const restored = load(raw); expect(restored.balance).toBe('1.5.0'); expect(snapshot(restored)).toBe(snapshot(state));
    step(state, 4_000); step(restored, 4_000); expect(snapshot(restored)).toBe(snapshot(state));
    // 1.4.3 had no boss-stage clock, so a mid-fight COMPLETE save carries none; the next boss repeat gets the scale-1 pad clock.
    const done = createState(4); done.highestCleared = CONFIG.stages.length; done.progress = { kind: 'COMPLETE', stage: CONFIG.stages.length };
    const old = { ...(JSON.parse(snapshot(done)) as Record<string, unknown>), balance: '1.4.3' };
    const resumed = load(old); expect(resumed.farmClock).toBeUndefined();
    expect(CONFIG.combat.bossRepeatMinCycle).toBe(true); beginEncounter(resumed); expect(resumed.farmClock?.scale).toBe(1);
  });
  it('rejects a pending choice that reuses an inventory id or a future id', () => {
    const state = withChoice(); chooseChest(state, 0);
    const kept = state.inventory[0]; const pair = state.pendingChoice?.[0]; if (!kept || !pair) throw new Error('fixture');
    expect(() => load({ ...state, pendingChoice: [[kept, pair[1]]] })).toThrow();
    expect(() => load({ ...state, nextGearId: 1 })).toThrow();
    expect(() => load({ ...state, pendingChoice: [pair, pair, pair, pair] })).toThrow();
  });
  it('a stage with firstClearTickets 0 emits no tickets event and still saves', () => {
    setV14Rules(['chestChoice', 'farmChest']);
    const stage = CONFIG.stages[0]; if (!stage) throw new Error('stage 1');
    const configured = stage.firstClearTickets; stage.firstClearTickets = 0;
    try {
      const state = createState(); state.wave = stage.waves.length; state.enemies.forEach(enemy => { enemy.hp = 0; }); step(state);
      expect(state.highestCleared).toBe(1);
      expect(state.events.some(event => event.data.type === 'tickets')).toBe(false);
      expect(() => restoreSave(makeSave(state, 0), 0)).not.toThrow();
    } finally { stage.firstClearTickets = configured; }
  });
});
