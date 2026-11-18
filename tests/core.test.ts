import { describe, expect, it } from 'vitest';
import { CONFIG, heroConfig, stageConfig, ticksForSeconds } from '../src/config';
import { beginEncounter, damage } from '../src/core/combat';
import { blankEquipment, chest, drawHero, grantXp, heroStats, partyPower, pull, upgrade, upgradeCost } from '../src/core/economy';
import { bossSecondsRemaining, createState, input, load, snapshot, step } from '../src/core/game';
import { parseState } from '../src/core/model';
import { getPartyHeroDefinition } from '../src/core/party-definitions';
import type { GameState } from '../src/core/model';
import { referencePolicy, runReference } from '../src/core/policy';
import { applyOffline, expectedFarmRewards, makeSave, restoreSave } from '../src/core/save';
import { setFarmProofFixture } from './helpers/farm-proof-fixture';

const fixtureState = (seed = 1): GameState => createState(seed, { starterGear: false });

function failedFrontier(stage = 8): GameState {
  const state = fixtureState(1);
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
    const a = fixtureState(9), b = fixtureState(9);
    for (let tick = 0; tick < 1000; tick += 1) {
      if (tick % 100 === 0) { input(a, { type: 'pull' }); input(b, { type: 'pull' }); }
      step(a); step(b);
      expect(snapshot(a)).toBe(snapshot(b));
    }
  });
  it('emits deterministic party hit events with attacker, target, and damage', () => {
    const a = fixtureState(1), b = fixtureState(1);
    for (const state of [a, b]) { const front = state.enemies[0], hero = state.party[0]; if (!front || !hero) throw new Error('Fixture'); front.x = hero.x + 40; front.speed = 0; step(state, 400); }
    const hits = a.events.filter(event => event.data.type === 'hit');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toEqual(b.events.filter(event => event.data.type === 'hit'));
    for (const event of hits) {
      if (event.data.type !== 'hit') throw new Error('Expected hit');
      expect(event.data.damage).toBeGreaterThan(0);
      expect(event.data.attackerId).toMatch(/^(hero|enemy)-/); expect(event.data.targetId).toMatch(/^(hero|enemy)-/);
    }
    expect(hits.some(event => event.data.type === 'hit' && event.data.side === 'hero')).toBe(true);
    expect(hits.some(event => event.data.type === 'hit' && event.data.side === 'enemy')).toBe(true);
  });
  it('combat consumes no random numbers, and drops do', () => {
    const a = fixtureState(1), b = fixtureState(999);
    step(a, 150); step(b, 150);
    expect(a.party).toEqual(b.party); expect(a.enemies).toEqual(b.enemies);
    expect(a.rng).toBe(1); expect(b.rng).toBe(999);
    chest(a, 1); expect(a.rng).not.toBe(1);
  });
  it('a current party unit commits damage against a reachable target', () => {
    const state = fixtureState(1);
    const ranger = state.party.find(hero => hero.sourceId === 'mw1');
    const enemy = state.enemies[0];
    if (!ranger || !enemy) throw new Error('Fixture missing');
    state.party = [ranger]; state.enemies = [enemy]; enemy.x = ranger.x + 40; enemy.speed = 0;
    ranger.atk = 10_000; ranger.range = 220; ranger.gauge = 1000;
    enemy.hp = 1; enemy.maxHp = 1; enemy.def = 0; enemy.atk = 1;
    expect(damage(ranger.atk, enemy.def)).toBeGreaterThan(0);
    step(state, 100);
    expect(enemy.hp).toBe(0);
    expect(state.events.some(event => event.data.type === 'hit' && event.data.attackerId === ranger.id && event.data.targetId === enemy.id)).toBe(true);
  });
  it('same snapshot resumes identically and validation rejects malformed state/actions', () => {
    const a = fixtureState(4); step(a, 800); input(a, { type: 'pull' });
    const b = load(snapshot(a)); expect(b).toEqual(a); expect(snapshot(b)).toBe(snapshot(a)); step(a, 500); step(b, 500); expect(b).toEqual(a);
    expect(() => load({ ...a, gold: -1 })).toThrow();
    expect(() => load({ ...a, partyIds: ['wiz', 'wiz', 'wiz'] })).toThrow();
    expect(() => load({ ...a, progress: { kind: 'PUSHING', stage: 20 } })).toThrow();
    expect(() => step(a, -1)).toThrow(); expect(() => step(a, 0.5)).toThrow();
    expect(() => load('not-json')).toThrow();
  });
  it('ticks can be chunked without changing outcomes and clones do not alias', () => {
    const a = fixtureState(1), b = fixtureState(1); step(a, 2000);
    for (let i = 0; i < 20; i += 1) step(b, 100);
    expect(b).toEqual(a); const copy = load(a); copy.gold += 1; expect(copy.gold).not.toBe(a.gold);
    expect(parseState(a)).toEqual(a);
  });
});

describe('progression, retry and boss gates', () => {
  it('advances a clear, keeps HP across waves, heals between stages', () => {
    const state = fixtureState(); const hero = state.party[0]; if (!hero) throw new Error('Fixture');
    hero.hp = 25; state.enemies = []; step(state);
    expect(state.wave).toBe(2); step(state, ticksForSeconds(CONFIG.sim.waveGapSec)); expect(state.party[0]?.hp).toBe(25);
    forceClear(state); expect(state.highestCleared).toBe(1); expect(state.progress).toEqual({ kind: 'PUSHING', stage: 2 });
    step(state, ticksForSeconds(CONFIG.sim.stageGapSec)); expect(state.party[0]?.hp).toBe(state.party[0]?.maxHp);
  });
  it('does not lose a normal stage while both sides are still alive past 90 seconds', () => {
    const state = fixtureState();
    expect(stageConfig(1).isBoss).toBe(false);
    expect(stageConfig(8).isBoss).toBe(false);
    expect(CONFIG.combat.lossCondition).toMatch(/boss also loses/);
    for (const unit of [...state.party, ...state.enemies]) { unit.hp = unit.maxHp = 1_000_000; unit.atk = 1; }
    step(state, ticksForSeconds(95));
    expect(state.stats.losses).toBe(0);
    expect(state.stats.clears).toBe(0);
    expect(state.progress).toMatchObject({ kind: 'PUSHING', stage: 1 });
    expect(state.phase.kind).toBe('battle');
    expect(state.wave).toBe(1);
    expect(bossSecondsRemaining(state)).toBeNull();
    expect(state.party.some(unit => unit.hp > 0)).toBe(true);
    expect(state.enemies.some(unit => unit.hp > 0)).toBe(true);
    expect(state.party.some(unit => unit.hp < unit.maxHp) || state.enemies.some(unit => unit.hp < unit.maxHp)).toBe(true);
  });
  it('loses a boss on its own timer, counted from the stage start and not reset per wave', () => {
    const chapterOne = stageConfig(10), chapterTwo = stageConfig(20);
    if (!chapterOne.isBoss || !chapterTwo.isBoss) throw new Error('expected boss stages');
    expect(chapterOne.timeoutSec).toBe(22);
    expect(chapterTwo.timeoutSec).toBe(21);
    const state = fixtureState();
    state.highestCleared = 9;
    state.progress = { kind: 'BOSS_FIGHT', stage: 10, failedPower: 0, bossLosses: 0 };
    beginEncounter(state);
    for (const unit of [...state.party, ...state.enemies]) { unit.hp = unit.maxHp = 1_000_000; unit.atk = 1; }
    state.wave = chapterOne.waves.length;
    state.stageStartedTick = 0;
    state.tick = ticksForSeconds(chapterOne.timeoutSec) - 2;
    step(state);
    expect(state.stats.losses).toBe(0);
    expect(state.stats.bossFailures).toBe(0);
    expect(bossSecondsRemaining(state)).toBe(1);
    step(state);
    expect(state.stats.losses).toBe(1);
    expect(state.stats.bossFailures).toBe(1);
    expect(state.progress.kind).toBe('BOSS_READY');
    expect(bossSecondsRemaining(state)).toBeNull();
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
  it('zero-delay power growth retries on the gain action wall tick', () => {
    // Own config: this asserts the zero-delay rule, independent of the shipped powerGainRetryMinSec.
    const configured = CONFIG.progression.powerGainRetryMinSec;
    CONFIG.progression.powerGainRetryMinSec = 0;
    try {
      const state = failedFrontier();
      for (const hero of state.roster) hero.stars = 2;
      const gainedAt = state.tick;
      input(state, { type: 'autoEquip' });
      expect(state.stats.retries).toBe(1); expect(state.progress.kind).toBe('PUSHING');
      expect(state.events.find(event => event.data.type === 'retry')?.tick).toBe(gainedAt);
    } finally { CONFIG.progression.powerGainRetryMinSec = configured; }
  });
  it('a 0-ticket first clear logs no tickets event and the save stays valid', () => {
    const stage = CONFIG.stages[0]; if (!stage) throw new Error('stage 1');
    const configured = stage.firstClearTickets;
    stage.firstClearTickets = 0;
    try {
      const state = fixtureState(); const tickets = state.tickets;
      forceClear(state);
      expect(state.highestCleared).toBe(1); expect(state.tickets).toBe(tickets);
      expect(state.events.some(event => event.data.type === 'tickets')).toBe(false);
      expect(() => restoreSave(makeSave(state, 0), 0)).not.toThrow();
    } finally { stage.firstClearTickets = configured; }
  });
  it('never enters a boss without input, even after large power growth; failures wait for input', () => {
    const state = fixtureState(); state.highestCleared = 8; state.progress = { kind: 'PUSHING', stage: 9 };
    beginEncounter(state); forceClear(state); expect(state.progress.kind).toBe('BOSS_READY');
    step(state, ticksForSeconds(600)); expect(state.progress.kind).toBe('BOSS_READY'); expect(state.stats.bossFailures).toBe(0);
    input(state, { type: 'retry' }); expect(state.progress.kind).toBe('BOSS_FIGHT');
    for (const hero of state.party) hero.hp = 0; step(state);
    expect(state.stats.bossFailures).toBe(1); expect(state.progress.kind).toBe('BOSS_READY');
    for (const hero of state.roster) hero.level = 60;
    const retries = state.stats.retries; step(state, ticksForSeconds(600)); expect(state.stats.retries).toBe(retries);
  });
  it('level-one starters lose chapter-one boss stage in under 60 seconds', () => {
    const state = fixtureState(); state.highestCleared = 9;
    state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 0, bossLosses: 0 };
    input(state, { type: 'retry' });
    for (let i = 0; i < ticksForSeconds(60) && state.stats.bossFailures === 0; i += 1) step(state);
    expect(state.stats.bossFailures).toBe(1); expect(state.tick).toBeLessThan(ticksForSeconds(60));
  });
});

describe('economy and policy', () => {
  it('uses the configured level/star/rarity stat formula before gear', () => {
    expect(Math.round(200 * 1.35 * 1.9 * 1.24)).toBe(636);
    const state = fixtureState();
    const hero = { id: 'fw', level: 10, stars: 3, xp: 0, equipment: blankEquipment() };
    const definition = heroConfig(hero.id);
    expect(heroStats(state, hero).maxHp).toBe(Math.round(getPartyHeroDefinition(hero.id).familyStats.hp * CONFIG.rarity.statMult.epic * 1.9 * 1.24 * (definition.mod.hp ?? 1)));
  });
  it('only living combat heroes earn XP in full, level cap is respected', () => {
    const state = fixtureState(); const dead = state.party[0]; if (!dead) throw new Error('Fixture'); dead.hp = 0;
    grantXp(state, Math.round(CONFIG.growth.xpToNext.a));
    expect(state.roster.find(hero => hero.id === dead.sourceId)?.level).toBe(1);
    for (const alive of state.party.filter(hero => hero.hp > 0)) expect(state.roster.find(hero => hero.id === alive.sourceId)?.level).toBe(2);
    const xpThroughCap = Array.from({ length: CONFIG.growth.levelCap }, (_, index) => Math.round(CONFIG.growth.xpToNext.a * (index + 1) ** CONFIG.growth.xpToNext.p)).reduce((sum, xp) => sum + xp, 0);
    grantXp(state, xpThroughCap);
    for (const alive of state.party.filter(hero => hero.hp > 0)) expect(state.roster.find(hero => hero.id === alive.sourceId)).toMatchObject({ level: CONFIG.growth.levelCap, xp: 0 });
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
    const state = fixtureState(); for (let i = 0; i < 60; i += 1) chest(state, 2);
    expect(state.inventory).toHaveLength(50); const item = state.inventory[0]; if (!item) throw new Error('Fixture');
    state.gold = 100000; const cost = upgradeCost(item); upgrade(state, item.id); expect(state.gold).toBe(100000 - cost);
    for (let i = 0; i < 15; i += 1) upgrade(state, item.id); expect(item.level).toBe(10);
    pull(state); expect(load(snapshot(state))).toEqual(state);
  });
  it('reference policy is deterministic across economy and offline sessions', () => {
    const a = runReference(11, 2, 300), b = runReference(11, 2, 300);
    expect(a).toEqual(b); expect(a.state.combatRules).toBe('party-v2');
    expect(new Set(a.state.partyIds).size).toBe(3);
    expect(a.state.partyIds.every(id => a.state.roster.some(hero => hero.id === id))).toBe(true);
  });
  it('reference policy buys only affordable equipped upgrades and respects boss power gate', () => {
    const state = fixtureState(); state.highestCleared = 9;
    state.progress = { kind: 'BOSS_READY', stage: 9, bossStage: 10, failedPower: 1e9, bossLosses: 1 };
    referencePolicy(state, { revision: -1 }); expect(state.progress.kind).toBe('BOSS_READY'); expect(state.gold).toBeGreaterThanOrEqual(0);
  });
});

describe('offline timestamp accounting', () => {
  it('12 hours closed equals exactly the 8-hour cap without progress or tickets', () => {
    const state = fixtureState(9); step(state, 4000); const saved = makeSave(state, 1000);
    const a = restoreSave(saved, 1000 + 8 * 3600000), b = restoreSave(saved, 1000 + 12 * 3600000);
    const withoutRaw = (value: typeof a.state) => ({ ...value, events: value.events.map(event => event.data.type === 'offline' ? { ...event, data: { ...event.data, rawSeconds: 0 } } : event) });
    expect(withoutRaw(a.state)).toEqual(withoutRaw(b.state)); expect(b.capped).toBe(true);
    expect([a.rawSeconds, b.rawSeconds, b.seconds]).toEqual([28800, 43200, 28800]);
    expect(a.state.tick).toBe(state.tick); expect(a.state.progress).toEqual(state.progress); expect(a.state.tickets).toBe(state.tickets);
    expect(a.chests).toBe(4); expect(a.seconds).toBe(28800);
  });
  it('uses continuous expected reward rates, preserves timestamp remainder, and ignores backward clocks', () => {
    const state = fixtureState(); state.highestCleared = 4; state.progress = { kind: 'FARMING', stage: 4, failedStage: 5, retryAtTick: 9999, failedPower: partyPower(state), failures: 1 };
    state.metrics.farmClearSeconds = [20, 40]; setFarmProofFixture(state, 4, 30, 30); const save = makeSave(state, 1000, 25);
    const restored = restoreSave(save, 1000 + 95900); expect(restored.clears).toBe(3); expect(restored.remainderMs).toBe(25);
    expect(restored.gold).toBe(Math.floor(95.9 / 30 * expectedFarmRewards(4).gold * CONFIG.idle.offlineEfficiency));
    expect(restoreSave(save, 999).state).toEqual(state);
    expect(() => restoreSave(save, NaN)).toThrow();
  });
  it('offline catch-up is deterministic from the same current account', () => {
    const source = fixtureState(1), a = load(snapshot(source)), b = load(snapshot(source));
    expect(applyOffline(a, 8 * 3600000)).toEqual(applyOffline(b, 8 * 3600000));
    expect(snapshot(a)).toBe(snapshot(b));
  });
});
