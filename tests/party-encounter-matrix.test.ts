import { describe, expect, it } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { CONFIG, stageConfig, ticksForSeconds } from '../src/config';
import { spawnParty } from '../src/core/combat';
import { autoParty } from '../src/core/economy';
import { createPartyState, step } from '../src/core/game';
import { itemId, gearTemplateId } from '../src/core/model';
import type { GameState, Gear, Unit } from '../src/core/model';
import { partyUnitFields } from '../src/core/party-combat';
import { getPartyEnemyDefinition } from '../src/core/party-enemies';
import { combatTick } from '../src/core/combat';

type Band = { name: string; level: number; stars: number; gearAtk: number; gearHp: number; speed: number };
const bands: Band[] = [
  { name: 'intro', level: 1, stars: 1, gearAtk: 3, gearHp: 20, speed: 0.05 },
  { name: 'middle', level: 10, stars: 2, gearAtk: 12, gearHp: 70, speed: 0.15 },
  { name: 'late', level: 20, stars: 4, gearAtk: 24, gearHp: 150, speed: 0.25 },
];
const enemies = ['grunt', 'archer', 'bomber', 'assassin', 'boss_ch1'] as const;
const teams = ['balanced', 'fastFarm', 'defensive', 'tripleDps', 'supportStack', 'debufferBruiser', 'healingBruiser'] as const;
function makeGear(state: GameState, slot: Gear['slot'], serial: number, band: Band): Gear {
  const id = itemId(state.seed, serial), base = { hp: 0, atk: 0, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 };
  if (slot === 'weapon') base.atk = band.gearAtk;
  if (slot === 'armor') { base.hp = band.gearHp; base.def = Math.round(band.gearHp / 12); }
  if (slot === 'charm') base.speedPct = band.speed;
  return { id, templateId: gearTemplateId(slot, 'common'), tradeable: false, acquiredAt: { tick: 0, source: 'starter' }, slot,
    rarity: 'common', dropStage: 1, level: 0, spent: 0, stats: base };
}
function buildFixture(stage: number, band: Band, team: typeof teams[number], enemyId: typeof enemies[number], seed: number): GameState {
  const state = createPartyState(seed);
  for (const definition of CONFIG.heroes) if (!state.roster.some(hero => hero.id === definition.id)) state.roster.push({ id: definition.id, level: band.level, xp: 0, stars: band.stars, equipment: { weapon: null, armor: null, charm: null } });
  for (const hero of state.roster) { hero.level = band.level; hero.stars = band.stars; }
  state.progress = { kind: 'PUSHING', stage };
  state.highestCleared = stage - 1;
  state.combatRules = 'party-v2'; state.partyPreset = undefined; state.partyEffects = []; state.projectiles = [];
  if (team === 'balanced') autoParty(state, 'balanced');
  else if (team === 'fastFarm') autoParty(state, 'fastFarm');
  else if (team === 'defensive') state.partyIds = ['mw2', 'hk1', 'priest'];
  else if (team === 'supportStack') state.partyIds = ['priest', 'mk1', 'ew1'];
  else if (team === 'debufferBruiser') state.partyIds = ['hk1', 'ew1', 'mk1'];
  else if (team === 'healingBruiser') state.partyIds = ['hk1', 'priest', 'mk1'];
  else state.partyIds = ['mw1', 'hu1', 'wiz'];
  state.inventory = [];
  let serial = 1;
  for (const id of state.partyIds) {
    const hero = state.roster.find(value => value.id === id)!;
    for (const slot of ['weapon', 'armor', 'charm'] as const) {
      const item = makeGear(state, slot, serial++, band); state.inventory.push(item); hero.equipment[slot] = item.id;
    }
  }
  state.nextGearId = serial;
  spawnParty(state);
  // Formation shift is an explicit position variation in addition to progression stats.
  const shift = stage % 3 === 0 ? 18 : stage % 3 === 1 ? -12 : 0;
  state.party.forEach(unit => { unit.x += shift; });
  const definition = getPartyEnemyDefinition(enemyId);
  const mult = CONFIG.enemies.scalingPerStage ** (stage - 1), pressure = 2, template = state.enemies[0]!;
  const seeded = { ...template, sourceId: enemyId, side: 'enemy' as const, range: definition.range } as Unit;
  const enemy: Unit = { ...seeded, ...partyUnitFields(seeded), id: `matrix-${stage}-${enemyId}`,
    hp: Math.round(definition.hp * mult * pressure), maxHp: Math.round(definition.hp * mult * pressure), atk: Math.round(definition.atk * mult * pressure), def: Math.round(definition.def * mult),
    attackTicks: definition.attackTicks, range: definition.range, x: enemyId === 'archer' ? 350 : enemyId === 'bomber' ? 300 : CONFIG.sim.enemySpawnX,
    slot: 0, boss: enemyId.startsWith('boss'), attacks: 0, shield: 0, shieldUntilTick: 0, bornTick: 0,
  };
  if (enemyId.startsWith('boss')) enemy.boss = true;
  state.enemies = [enemy]; state.phase = { kind: 'battle' }; state.tick = 0; state.farmClock = undefined;
  return state;
}
function run(state: GameState, limit = 1200): { ticks: number; heroHp: number; enemyHp: number; hits: number; damage: number; marks: number } {
  let ticks = 0;
  for (; ticks < limit && state.party.some(unit => unit.hp > 0) && state.enemies.some(unit => unit.hp > 0); ticks += 1) {
    state.tick += 1; combatTick(state);
  }
  return { ticks, heroHp: state.party.reduce((sum, unit) => sum + unit.hp, 0), enemyHp: state.enemies.reduce((sum, unit) => sum + unit.hp, 0),
    hits: state.events.filter(event => event.data.type === 'hit').length,
    damage: state.events.filter(event => event.data.type === 'hit').reduce((sum, event) => sum + (event.data.type === 'hit' ? event.data.damage : 0), 0),
    marks: state.events.filter(event => event.data.type === 'skill' && /assassin|bomber|boss/.test(event.data.skill)).length };
}

describe('party-v2 deterministic encounter matrix', () => {
  it('runs three equal-budget progression bands against frontline, ranged, local AoE, assassin, and boss pressure', async () => {
    const results: { band: string; stage: number; team: string; teamIds: string[]; enemy: string; input: { teamIds: string[]; party: { id: string; hp: number; atk: number; def: number; attackTicks: number; moveSpeed: number; range: number; x: number }[]; enemy: { id: string; hp: number; atk: number; def: number; attackTicks: number; moveSpeed: number; range: number; x: number }[]; pressureMultiplier: number }; result: ReturnType<typeof run>; outcome: string }[] = [];
    let seed = 9100;
    for (let bandIndex = 0; bandIndex < bands.length; bandIndex += 1) {
      const band = bands[bandIndex]!;
      const stage = [1, 11, 19][bandIndex]!;
      for (const enemy of enemies) for (const team of teams) {
        const fixture = buildFixture(stage, band, team, enemy, seed++);
        const input = { teamIds: fixture.partyIds, party: fixture.party.map(unit => ({ id: unit.sourceId, hp: unit.maxHp, atk: unit.atk, def: unit.def, attackTicks: unit.attackTicks, moveSpeed: unit.speed ?? 0, range: unit.range, x: unit.x })),
          enemy: fixture.enemies.map(unit => ({ id: unit.sourceId, hp: unit.maxHp, atk: unit.atk, def: unit.def, attackTicks: unit.attackTicks, moveSpeed: unit.speed ?? 0, range: unit.range, x: unit.x })), pressureMultiplier: 2 };
        const first = run(fixture);
        const repeat = run(buildFixture(stage, band, team, enemy, seed - 1));
        expect(repeat).toEqual(first);
        expect(first.ticks).toBeLessThanOrEqual(1200);
        expect(first.heroHp).toBeGreaterThanOrEqual(0); expect(first.enemyHp).toBeGreaterThanOrEqual(0);
        results.push({ band: band.name, stage, team, teamIds: input.teamIds, enemy, input,
          result: first, outcome: first.enemyHp === 0 ? 'win' : first.heroHp === 0 ? 'loss' : 'censored-60s-stress' });
      }
    }
    expect(results).toHaveLength(105);
    const clearCount = results.filter(entry => entry.result.enemyHp === 0).length;
    const deathCount = (team: string) => results.filter(entry => entry.team === team && entry.result.heroHp === 0).length;
    expect(deathCount('balanced')).toBe(0);
    expect(deathCount('tripleDps')).toBeGreaterThan(deathCount('defensive'));
    expect(results.some(entry => entry.team === 'supportStack' && entry.result.ticks === 1200 && entry.result.enemyHp > 0)).toBe(true);
    expect(results.filter(entry => entry.enemy === 'grunt').every(entry => entry.result.enemyHp === 0)).toBe(true);
    expect(results.some(entry => entry.enemy === 'boss_ch1' && entry.result.ticks === 1200 && entry.result.enemyHp > 0)).toBe(true);
    console.log(JSON.stringify({ trials: results.length,
      clears: results.filter(entry => entry.result.enemyHp === 0).length,
      heroLosses: results.filter(entry => entry.result.heroHp === 0).length,
      boundedEndings: results.filter(entry => entry.result.ticks === 1200).length,
      byEnemy: enemies.map(enemy => ({ enemy, cleared: results.filter(entry => entry.enemy === enemy && entry.result.enemyHp === 0).length,
        deaths: results.filter(entry => entry.enemy === enemy && entry.result.heroHp === 0).length })),
      byTeam: teams.map(team => ({ team, cleared: results.filter(entry => entry.team === team && entry.result.enemyHp === 0).length,
        deaths: results.filter(entry => entry.team === team && entry.result.heroHp === 0).length })) }));
    const stats = bands.map((band, index) => {
      const state = buildFixture([1, 11, 19][index]!, band, 'balanced', 'grunt', 9990 + index);
      const hero = state.party[0]!;
      return { hp: hero.maxHp, atk: hero.atk, attackTicks: hero.attackTicks, x: hero.x };
    });
    expect(new Set(stats.map(value => `${value.hp}/${value.atk}/${value.attackTicks}/${value.x}`)).size).toBe(3);
    // The defensive trio is intentionally low damage; it stays bounded against a high-HP boss rather than entering an unbounded sim loop.
    const sustainState = buildFixture(19, bands[2]!, 'defensive', 'boss_ch1', 9199);
    sustainState.enemies[0]!.hp *= 10; sustainState.enemies[0]!.maxHp *= 10;
    const sustain = run(sustainState, 1200);
    expect(sustain.ticks).toBe(1200);
    expect(sustain.enemyHp).toBeGreaterThan(0);
    // These two full-engine cases reach the configured stage deadline. They are true timeouts, unlike the capped stress rows above.
    const timeoutCases = (['supportStack', 'defensive'] as const).map(team => {
      const state = buildFixture(1, bands[0]!, team, 'boss_ch1', team === 'supportStack' ? 9200 : 9201);
      const boss = state.enemies[0]!; boss.hp = 1_000_000_000; boss.maxHp = boss.hp; boss.atk = 1; boss.def = 10_000; boss.speed = 0; boss.range = 260;
      state.wave = stageConfig(1).waves.length;
      const timeoutTicks = ticksForSeconds(stageConfig(1).timeoutSec);
      step(state, timeoutTicks);
      expect(state.stats.losses).toBe(1); expect(state.stats.clears).toBe(0); expect(state.progress.kind).toBe('FARMING'); expect(state.phase.kind).toBe('rest');
      expect(state.party.every(unit => unit.hp > 0)).toBe(true);
      return { team, teamIds: [...state.partyIds], stage: 1, timeoutTicks, elapsedTicks: state.tick, losses: state.stats.losses, clears: state.stats.clears,
        survivingHeroes: state.party.map(unit => ({ id: unit.sourceId, hp: unit.hp, maxHp: unit.maxHp })), enemyHp: boss.hp };
    });
    const clusterCases = (['balanced', 'fastFarm'] as const).map(team => {
      const state = buildFixture(1, bands[0]!, team, 'grunt', team === 'balanced' ? 9300 : 9301), template = state.enemies[0]!;
      state.enemies = [300, 325, 350].map((x, index) => ({ ...template, id: `cluster-grunt-${index}`, x }));
      const startHp = state.enemies.reduce((sum, enemy) => sum + enemy.hp, 0), enemiesAtStart = state.enemies.map(enemy => ({ id: enemy.id, hp: enemy.maxHp, atk: enemy.atk, moveSpeed: enemy.speed ?? 0, x: enemy.x })), result = run(state);
      return { team, teamIds: [...state.partyIds], enemies: enemiesAtStart, startHp, result,
        outcome: result.enemyHp === 0 ? 'win' : result.heroHp === 0 ? 'loss' : 'censored-60s-stress' };
    });
    const debuffCases = (['debufferBruiser', 'healingBruiser'] as const).map(team => {
      const state = buildFixture(11, bands[1]!, team, 'boss_ch1', team === 'debufferBruiser' ? 9400 : 9401), boss = state.enemies[0]!;
      boss.hp = 1_000_000; boss.maxHp = boss.hp; boss.def = 250; boss.atk = 1;
      const initialHp = boss.hp, bossInput = { hp: initialHp, atk: boss.atk, def: 250, attackTicks: boss.attackTicks, moveSpeed: boss.speed ?? 0, x: boss.x }, result = run(state, 400);
      return { team, teamIds: [...state.partyIds], bossInput,
        result, hpDamage: initialHp - result.enemyHp };
    });
    expect(clusterCases.find(value => value.team === 'fastFarm')!.result.ticks).toBeLessThan(clusterCases.find(value => value.team === 'balanced')!.result.ticks);
    expect(debuffCases.find(value => value.team === 'debufferBruiser')!.hpDamage).toBeGreaterThan(debuffCases.find(value => value.team === 'healingBruiser')!.hpDamage);
    await writeFile(new URL('../docs/COMPACT-PARTY-PHASE-3-MATRIX.json', import.meta.url), JSON.stringify({
      generatedBy: 'tests/party-encounter-matrix.test.ts', enemyPressure: '2x stage-scaled HP and ATK; base DEF retained',
      budget: 'same level, stars and three common gear slots per deployed hero; native hero rarity/modifiers remain inherent, so this is equal investment budget, not equal power',
      bands, trialCount: results.length, aggregate: { clearCount, heroLosses: results.filter(entry => entry.result.heroHp === 0).length,
        censored60sStress: results.filter(entry => entry.outcome === 'censored-60s-stress').length }, cases: results,
      censoredStressCase: { teamIds: sustainState.partyIds, inputLimitTicks: 1200, result: sustain, interpretation: 'A helper-capped stress run only; not an engine timeout.' },
      engineTimeoutCases: timeoutCases, clusteredFrontlineComparison: clusterCases, debufferBruiserComparison: debuffCases,
    }, null, 2), 'utf8');
  });
});
