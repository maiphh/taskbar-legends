import { describe, expect, it } from 'vitest';
import { CONFIG, heroConfig, ticksForSeconds } from '../src/config';
import { beginEncounter, damage } from '../src/core/combat';
import { blankEquipment, chest, drawHero, grantXp, heroStats, partyPower, pull, upgrade, upgradeCost } from '../src/core/economy';
import { createState, input, load, snapshot, step } from '../src/core/game';
import { parseState } from '../src/core/model';
import type { GameState } from '../src/core/model';
import { referencePolicy, runReference } from '../src/core/policy';
import { applyOffline, expectedFarmRewards, makeSave, restoreSave } from '../src/core/save';

function failedFrontier(stage = 8): GameState {
  const state = createState(1);
  state.highestCleared = stage - 1;
  state.progress = { kind: 'PUSHING', stage };
  beginEncounter(state);
  for (const hero of state.party) hero.hp = 0;
  step(state);
  return state;
}
function forceClear(state: GameState): void {
  state.wave = CONFIG.stages[state.progress.stage - 1]?.waves.length ?? 3;
  state.enemies = [];
  step(state);
}

describe('pure deterministic core', () => {
  it('has byte-identical state every tick with identical seed and input', () => {
    const a = createState(9), b = createState(9);
    for (let tick = 0; tick < 1000; tick += 1) {
      if (tick % 100 === 0) { input(a, { type: 'pull' }); input(b, { type: 'pull' }); }
      step(a); step(b);
      expect(snapshot(a)).toBe(snapshot(b));
    }
  });
  it('emits deterministic hit events with attacker, target, damage and the exact hit tick', () => {
    const a = createState(1), b = createState(1);
    for (const state of [a, b]) { const front = state.enemies[0]; if (!front) throw new Error('Fixture'); front.x = 170; step(state); }
    const hits = a.events.filter(event => event.data.type === 'hit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toEqual(b.events.filter(event => event.data.type === 'hit'));
    for (const event of hits) {
      if (event.data.type !== 'hit') throw new Error('Expected hit');
      expect(event.tick).toBe(1); expect(event.data.damage).toBeGreaterThan(0);
      expect(event.data.attackerId).toMatch(/^(hero|enemy)-/); expect(event.data.targetId).toMatch(/^(hero|enemy)-/);
    }
    expect(hits.some(event => event.data.type === 'hit' && event.data.side === 'hero')).toBe(true);
    expect(hits.some(event => event.data.type === 'hit' && event.data.side === 'enemy')).toBe(true);
  });
  it('combat consumes no random numbers, and drops do', () => {
    const a = createState(1), b = createState(999);
    step(a, 150); step(b, 150);
    expect(a.party).toEqual(b.party); expect(a.enemies).toEqual(b.enemies);
    expect(a.rng).toBe(1); expect(b.rng).toBe(999);
    chest(a, 1); expect(a.rng).not.toBe(1);
  });
  it('ranger kills a 60hp/10def grunt on the 4th attack, 16 damage each', () => {
    const state = createState(1);
    const ranger = state.party.find(hero => hero.sourceId === 'hu1');
    const enemy = state.enemies[0];
    if (!ranger || !enemy) throw new Error('Fixture missing');
    state.party = [ranger]; state.enemies = [enemy]; enemy.x = ranger.x + 200;
    enemy.cooldown = 10000; enemy.atk = 1;
    expect(damage(ranger.atk, enemy.def)).toBe(16);
    step(state, 48);
    expect(enemy.hp).toBe(12); expect(ranger.attacks).toBe(3);
    step(state); expect(enemy.hp).toBe(0); expect(ranger.attacks).toBe(4);
  });
  it('same snapshot resumes identically and validation rejects malformed state/actions', () => {
    const a = createState(4); step(a, 800); input(a, { type: 'pull' });
    const b = load(snapshot(a)); expect(b).toEqual(a); expect(snapshot(b)).toBe(snapshot(a)); step(a, 500); step(b, 500); expect(b).toEqual(a);
    expect(() => load({ ...a, gold: -1 })).toThrow();
    expect(() => load({ ...a, partyIds: ['wiz', 'wiz', 'wiz'] })).toThrow();
    expect(() => load({ ...a, progress: { kind: 'PUSHING', stage: 20 } })).toThrow();
    expect(() => step(a, -1)).toThrow(); expect(() => step(a, 0.5)).toThrow();
    expect(() => load('not-json')).toThrow();
  });
  it('ticks can be chunked without changing outcomes and clones do not alias', () => {
    const a = createState(1), b = createState(1); step(a, 2000);
    for (let i = 0; i < 20; i += 1) step(b, 100);
    expect(b).toEqual(a); const copy = load(a); copy.gold += 1; expect(copy.gold).not.toBe(a.gold);
    expect(parseState(a)).toEqual(a);
  });
});

describe('progression, retry and boss gates', () => {
  it('advances a clear, keeps HP across waves, heals between stages', () => {
    const state = createState(); const hero = state.party[0]; if (!hero) throw new Error('Fixture');
    hero.hp = 25; state.enemies = []; step(state);
    expect(state.wave).toBe(2); step(state, ticksForSeconds(CONFIG.sim.waveGapSec)); expect(state.party[0]?.hp).toBe(25);
    forceClear(state); expect(state.highestCleared).toBe(1); expect(state.progress).toEqual({ kind: 'PUSHING', stage: 2 });
    step(state, ticksForSeconds(CONFIG.sim.stageGapSec)); expect(state.party[0]?.hp).toBe(state.party[0]?.maxHp);
  });
  it('uses the whole-stage timer, not an independent timer per wave', () => {
    const state = createState(); state.wave = 3; state.stageStartedTick = state.tick;
    state.tick = ticksForSeconds(90) - 1; step(state); expect(state.stats.losses).toBe(1);
  });
  it('falls back to highest clear and retries at exactly +120 seconds', () => {
    const state = failedFrontier(); expect(state.progress.kind).toBe('FARMING');
    if (state.progress.kind !== 'FARMING') throw new Error('Fixture');
    const deadline = state.progress.retryAtTick;
    expect(deadline - state.tick).toBe(ticksForSeconds(120)); expect(state.progress.stage).toBe(7);
    // Freeze the encounter in a rest; no XP growth can trigger an early power-based retry.
    state.phase = { kind: 'rest', next: 'encounter', remainingTicks: ticksForSeconds(200) };
    step(state, deadline - state.tick - 1); expect(state.stats.retries).toBe(0);
    step(state); expect(state.stats.retries).toBe(1);
    expect(state.events.find(event => event.data.type === 'retry')?.tick).toBe(deadline);
  });
  it('backs off repeated frontier failures to 240/480/600 seconds and resets on clear', () => {
    const state = failedFrontier();
    for (const seconds of [240, 480, 600, 600]) {
      input(state, { type: 'retry' });
      for (const hero of state.party) hero.hp = 0;
      step(state);
      if (state.progress.kind !== 'FARMING') throw new Error('Expected farm');
      expect(state.progress.retryAtTick - state.tick).toBe(ticksForSeconds(seconds));
    }
    input(state, { type: 'retry' }); forceClear(state); expect(state.retryFailures).toBe(0);
  });
  it('power growth retries only at the next stage start', () => {
    const state = failedFrontier();
    for (const hero of state.roster) hero.stars = 2;
    step(state, ticksForSeconds(CONFIG.sim.stageGapSec) - 1); expect(state.stats.retries).toBe(0);
    step(state); expect(state.stats.retries).toBe(1); expect(state.progress.kind).toBe('PUSHING');
  });
  it('never enters a boss without input, even after large power growth; failures wait for input', () => {
    const state = createState(); state.highestCleared = 8; state.progress = { kind: 'PUSHING', stage: 9 };
    beginEncounter(state); forceClear(state); expect(state.progress.kind).toBe('BOSS_READY');
    step(state, ticksForSeconds(600)); expect(state.progress.kind).toBe('BOSS_READY'); expect(state.stats.bossFailures).toBe(0);
    input(state, { type: 'retry' }); expect(state.progress.kind).toBe('BOSS_FIGHT');
    for (const hero of state.party) hero.hp = 0; step(state);
    expect(state.stats.bossFailures).toBe(1); expect(state.progress.kind).toBe('BOSS_READY');
    for (const hero of state.roster) hero.level = 60;
    const retries = state.stats.retries; step(state, ticksForSeconds(600)); expect(state.stats.retries).toBe(retries);
  });
  it('level-one starters lose chapter-one boss stage in under 60 seconds', () => {
    const state = createState(); state.highestCleared = 9;
    state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
    input(state, { type: 'retry' });
    for (let i = 0; i < ticksForSeconds(60) && state.stats.bossFailures === 0; i += 1) step(state);
    expect(state.stats.bossFailures).toBe(1); expect(state.tick).toBeLessThan(ticksForSeconds(60));
  });
});

describe('economy and policy', () => {
  it('uses the configured level/star/rarity stat formula before gear', () => {
    expect(Math.round(200 * 1.35 * 1.9 * 1.24)).toBe(636);
    const state = createState();
    const hero = { id: 'fw', level: 10, stars: 3, xp: 0, equipment: blankEquipment() };
    const definition = heroConfig(hero.id);
    expect(heroStats(state, hero).maxHp).toBe(Math.round(200 * CONFIG.rarity.statMult.epic * 1.9 * 1.24 * (definition.mod.hp ?? 1)));
  });
  it('only living combat heroes earn XP in full, level cap is respected', () => {
    const state = createState(); const dead = state.party[0]; if (!dead) throw new Error('Fixture'); dead.hp = 0;
    grantXp(state, 40); expect(state.roster[0]?.level).toBe(1); expect(state.roster[1]?.level).toBe(2); expect(state.roster[2]?.level).toBe(2);
    grantXp(state, 1e9); expect(state.roster[1]?.level).toBe(60); expect(state.roster[1]?.xp).toBe(0);
  });
  it('one million seeded pulls match published rates within 0.3 points and never miss Epic+ for 30 pulls', () => {
    const state = { rng: 1 }; let pity = 0, gap = 0, maxGap = 0;
    const rates = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const owned = new Set(CONFIG.heroes.filter(hero => hero.starter).map(hero => hero.id));
    for (let i = 0; i < 1_000_000; i += 1) {
      const draw = drawHero(state, pity, owned); pity = draw.nextPity; gap += 1; rates[draw.rarity] += 1; owned.add(draw.hero.id);
      if (draw.rarity === 'epic' || draw.rarity === 'legendary') gap = 0;
      maxGap = Math.max(maxGap, gap);
    }
    expect(maxGap).toBeLessThan(30);
    for (const rarity of ['common', 'rare', 'epic', 'legendary'] satisfies (keyof typeof rates)[]) expect(Math.abs(rates[rarity] / 1_000_000 - CONFIG.gacha.rates[rarity])).toBeLessThan(0.003);
    const missing = new Set(CONFIG.heroes.filter(hero => hero.id !== 'ew3').map(hero => hero.id));
    for (let seed = 1; seed <= 100; seed += 1) {
      const draw = drawHero({ rng: seed }, 29, missing);
      expect(draw.pity).toBe(true);
      if (draw.rarity === 'legendary') expect(draw.hero.id).toBe('ew3');
    }
  });
  it('caps inventory and upgrades, spends exact gold, and gacha is serialized', () => {
    const state = createState(); for (let i = 0; i < 60; i += 1) chest(state, 2);
    expect(state.inventory).toHaveLength(50); const item = state.inventory[0]; if (!item) throw new Error('Fixture');
    state.gold = 100000; const cost = upgradeCost(item); upgrade(state, item.id); expect(state.gold).toBe(100000 - cost);
    for (let i = 0; i < 15; i += 1) upgrade(state, item.id); expect(item.level).toBe(10);
    pull(state); expect(load(snapshot(state))).toEqual(state);
  });
  it('reference policy is deterministic across economy and offline sessions', () => {
    const a = runReference(11, 2, 300), b = runReference(11, 2, 300);
    expect(a).toEqual(b); expect(a.state.tickets).toBe(0); expect(a.state.stats.pulls).toBeGreaterThanOrEqual(10);
    expect(heroConfig(a.state.partyIds[0] ?? '').role).toBe('tank');
  });
  it('reference policy buys only affordable equipped upgrades and respects boss power gate', () => {
    const state = createState(); state.highestCleared = 9;
    state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 1e9, bossLosses: 1 };
    referencePolicy(state, { revision: -1 }); expect(state.progress.kind).toBe('BOSS_READY'); expect(state.gold).toBeGreaterThanOrEqual(0);
  });
});

describe('offline timestamp accounting', () => {
  it('12 hours closed equals exactly the 8-hour cap without progress or tickets', () => {
    const state = createState(9); step(state, 4000); const saved = makeSave(state, 1000);
    const a = restoreSave(saved, 1000 + 8 * 3600000), b = restoreSave(saved, 1000 + 12 * 3600000);
    expect(a.state).toEqual(b.state); expect(b.capped).toBe(true);
    expect(a.state.tick).toBe(state.tick); expect(a.state.progress).toEqual(state.progress); expect(a.state.tickets).toBe(state.tickets);
    expect(a.chests).toBe(4); expect(a.seconds).toBe(28800);
  });
  it('uses floor(elapsed/average last ten farm clears), exact configured rewards, no clock dependence', () => {
    const state = createState(); state.highestCleared = 4; state.progress = { kind: 'FARMING', stage: 4, failedStage: 5, retryAtTick: 9999, failedPower: partyPower(state), failures: 1 };
    state.metrics.farmClearSeconds = [20, 40]; const save = makeSave(state, 1000, 25);
    const restored = restoreSave(save, 1000 + 95900); expect(restored.clears).toBe(3); expect(restored.remainderMs).toBe(25);
    expect(restored.gold).toBe(expectedFarmRewards(4).gold * 3);
    expect(restoreSave(save, 999).state).toEqual(state);
    expect(() => restoreSave(save, NaN)).toThrow();
  });
  it('8h offline gold is within 1% of stable open farming at a measured stage', () => {
    const state = createState(1); state.highestCleared = 9;
    state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
    for (const hero of state.roster) hero.level = CONFIG.growth.levelCap;
    beginEncounter(state); step(state, ticksForSeconds(600));
    const open = load(snapshot(state)), offline = load(snapshot(state));
    const initial = state.gold; applyOffline(offline, 8 * 3600000); step(open, ticksForSeconds(8 * 3600));
    expect(Math.abs((offline.gold - initial) / (open.gold - initial) - 1)).toBeLessThan(0.01);
  });
});
