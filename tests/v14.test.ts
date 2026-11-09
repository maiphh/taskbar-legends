// v1.4 code requests implemented in this PR (design.md §18): CR-14-08 chest pick-1-of-2, CR-14-09 farm chest pity, CR-14-11 zero tickets.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, V14_DESIGN, activeV14Rules, setV14Rules } from '../src/config';
import { bestChoice, chest, chooseChest, farmChestRoll, gearScore } from '../src/core/economy';
import { createState, input, load, snapshot, step } from '../src/core/game';
import { parseState } from '../src/core/model';
import type { GameState, Gear } from '../src/core/model';
import { referencePolicy, runReference } from '../src/core/policy';
import { applyOffline, makeSave, restoreSave } from '../src/core/save';
import design from '../src/design-config.json';

afterEach(() => { setV14Rules([]); });
const sha = (value: string): string => createHash('sha256').update(value).digest('hex');
// sha256(snapshot) of runReference(3, 1) + 9 h offline on origin/main c73967e (v1.3.0, before any v1.4 code).
const V13_GOLDEN = 'e9d51b1b023947455f05b211d69c2b91c263c3542376884fdeb5ca755f4d2bcd';
const goldenRun = (): string => { const run = runReference(3, 1); applyOffline(run.state, 9 * 3600 * 1000); return sha(snapshot(run.state)); };

describe('v14 config block', () => {
  it('ships the designer block inert: no rule on by default, §18 defaults, designer values parsed', () => {
    expect(activeV14Rules()).toEqual([]);
    expect(CONFIG.v14).toEqual({ chestChoice: { options: 1, fromStage: 1 }, farmChest: null });
    expect(design.version).toBe('1.3.0'); expect(design.v14.targetVersion).toBe('1.4.0');
    expect(V14_DESIGN.chestChoice).toMatchObject({ options: 2, fromStage: 1 });
    expect(V14_DESIGN.farmChest).toMatchObject({ baseChance: 0.03, guaranteeEvery: 9, fromStage: 10 });
    setV14Rules(['chestChoice', 'farmChest']); expect(activeV14Rules()).toEqual(['chestChoice', 'farmChest']);
    setV14Rules([]); expect(CONFIG.v14).toEqual({ chestChoice: { options: 1, fromStage: 1 }, farmChest: null });
  });
});

describe('CR-14-08 chest pick-1-of-2', () => {
  it('options = 1 replays byte-identical to v1.3.0 (golden from main)', { timeout: 60_000 }, () => {
    expect(goldenRun()).toBe(V13_GOLDEN);
  });
  it('options = 2: a chest queues two rolled items; the reference policy keeps the higher score', { timeout: 60_000 }, () => {
    setV14Rules(['chestChoice']);
    const state = createState(5), cursor = { revision: -1 };
    const scores = new Map<string, number>();
    let seen = 0, checked = 0;
    for (let tick = 0; tick < 2 * 72_000; tick += 1) {
      for (const pair of state.pendingChoice ?? []) for (const item of pair) scores.set(item.id, gearScore(item));
      referencePolicy(state, cursor);
      for (const event of state.events) {
        if (event.seq <= seen) continue; seen = event.seq;
        if (event.data.type !== 'chestChoice') continue;
        const [a, b] = event.data.options, best = Math.max(scores.get(a) ?? NaN, scores.get(b) ?? NaN);
        expect(scores.get(event.data.kept)).toBe(best); checked += 1;
      }
      expect(state.pendingChoice).toBeUndefined();
      step(state);
    }
    expect(checked).toBeGreaterThan(20); expect(checked).toBe(state.eventCounts.chestChoice);
  });
  it('keeps the chosen item, salvages the other for salvageBase × rarityMult, queues ≤ 3 and auto-picks the oldest by score', () => {
    setV14Rules(['chestChoice']);
    const state = createState(9);
    chest(state, 4);
    const pair = state.pendingChoice?.[0]; if (!pair) throw new Error('no choice');
    expect(state.inventory).toHaveLength(0); expect(state.stats.chests).toBe(1);
    const gold = state.gold;
    input(state, { type: 'chooseChest', keep: 1 });
    expect(state.inventory.map(item => item.id)).toEqual([pair[1].id]);
    expect(state.gold - gold).toBe(Math.round(CONFIG.runtime.salvageBase * CONFIG.gear.rarityMult[pair[0].rarity]));
    expect(state.events.at(-1)?.data).toEqual({ type: 'chestChoice', options: [pair[0].id, pair[1].id], kept: pair[1].id });
    expect(state.pendingChoice).toBeUndefined();
    for (let index = 0; index < 3; index += 1) chest(state, 4);
    const oldest = state.pendingChoice?.[0] as [Gear, Gear];
    chest(state, 4);
    expect(state.pendingChoice).toHaveLength(3);
    expect(state.inventory.at(-1)?.id).toBe(oldest[bestChoice(oldest)].id);
    expect(() => parseState(structuredClone(state))).not.toThrow();
  });
  it('drops below fromStage stay single items', () => {
    setV14Rules(['chestChoice']); CONFIG.v14.chestChoice.fromStage = 10;
    const state = createState(2); chest(state, 9); expect(state.pendingChoice).toBeUndefined(); expect(state.inventory).toHaveLength(1);
    chest(state, 10); expect(state.pendingChoice).toHaveLength(1);
  });
});

describe('CR-14-09 farm chest pity from stage 10', () => {
  const run = (stage: number, clears: number) => {
    const state = createState(11); let dry = 0, maxDry = 0, chests = 0;
    for (let clear = 0; clear < clears; clear += 1) {
      const before = state.stats.chests; farmChestRoll(state, stage);
      if (state.stats.chests > before) { chests += 1; dry = 0; } else maxDry = Math.max(maxDry, ++dry);
    }
    return { state, chests, maxDry, mean: clears / chests };
  };
  it('never has a 9-clear dry run at stage ≥ 10; mean interval 8.0 ± 0.2 clears', () => {
    setV14Rules(['farmChest']);
    const result = run(12, 40_000);
    expect(result.maxDry).toBeLessThanOrEqual(8);
    expect(result.mean).toBeGreaterThan(7.8); expect(result.mean).toBeLessThan(8.2);
    expect(result.state.farmChestDry).toBeLessThan(9);
  });
  it('below stage 10 the 1.3.0 farmChestChance applies and the dry counter is untouched', () => {
    setV14Rules(['farmChest']);
    const result = run(9, 20_000);
    expect(result.state.farmChestDry).toBeUndefined();
    expect(result.mean).toBeCloseTo(1 / CONFIG.rewards.farmChestChance, 0);
  });
  it('the reference run never goes 9 farm clears at stage ≥ 10 without a chest', { timeout: 60_000 }, () => {
    setV14Rules(['farmChest']);
    const state = createState(4), cursor = { revision: -1 }; let dry = 0, maxDry = 0, clears = 0;
    for (let tick = 0; tick < 6 * 72_000; tick += 1) {
      referencePolicy(state, cursor);
      const samples = state.metrics.farmSamples, chests = state.stats.chests, stage = state.progress.stage;
      step(state);
      if (state.metrics.farmSamples > samples && stage >= 10) { clears += 1; if (state.stats.chests > chests) dry = 0; else maxDry = Math.max(maxDry, ++dry); }
    }
    expect(clears).toBeGreaterThan(100); expect(maxDry).toBeLessThanOrEqual(8);
  });
});

describe('saves (CR-14-11)', () => {
  const withChoice = (): GameState => {
    setV14Rules(['chestChoice', 'farmChest']);
    const state = createState(7); chest(state, 3); chest(state, 3); farmChestRoll(state, 10); state.farmChestDry = 5;
    return state;
  };
  it('pendingChoice and farmChestDry survive snapshot/load and the save envelope', () => {
    const state = withChoice(), text = snapshot(state);
    expect(snapshot(load(text))).toBe(text);
    const restored = restoreSave(makeSave(state, 1_000), 1_000).state;
    expect(restored.pendingChoice).toEqual(state.pendingChoice); expect(restored.farmChestDry).toBe(5);
    chooseChest(restored, 0); expect(restored.pendingChoice).toHaveLength(1);
  });
  it('1.3.0 saves (no v14 fields) load unchanged; balance 1.4.0 is accepted', () => {
    const state = createState(3); step(state, 2_000);
    const raw = JSON.parse(snapshot(state)) as Record<string, unknown>;
    expect('pendingChoice' in raw || 'farmChestDry' in raw).toBe(false);
    expect(snapshot(load(raw))).toBe(snapshot(state));
    expect(load({ ...raw, balance: '1.4.0' }).balance).toBe(CONFIG.version);
  });
  it('rejects a pending choice that reuses an inventory id or a future id', () => {
    const state = withChoice(); chooseChest(state, 0);
    const kept = state.inventory[0]; const pair = state.pendingChoice?.[0]; if (!kept || !pair) throw new Error('fixture');
    expect(() => load({ ...state, pendingChoice: [[kept, pair[1]]] })).toThrow();
    expect(() => load({ ...state, nextGearId: 1 })).toThrow();
    expect(() => load({ ...state, pendingChoice: [pair, pair, pair, pair] })).toThrow();
  });
  it('a stage with firstClearTickets 0 emits no tickets event and still saves (v1.3 request; holds with v14 rules on)', () => {
    setV14Rules(['chestChoice', 'farmChest']);
    const stage = CONFIG.stages[0]; if (!stage) throw new Error('stage 1');
    const configured = stage.firstClearTickets; stage.firstClearTickets = 0;
    try {
      const state = createState(); const cursor = { revision: -1 };
      while (state.highestCleared < 1) { referencePolicy(state, cursor); step(state); }
      expect(state.events.some(event => event.data.type === 'tickets')).toBe(false);
      expect(() => restoreSave(makeSave(state, 0), 0)).not.toThrow();
    } finally { stage.firstClearTickets = configured; }
  });
});
