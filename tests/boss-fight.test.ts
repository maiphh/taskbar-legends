import { describe, expect, it } from 'vitest';
import { CONFIG, bossConfig, stageConfig, ticksForSeconds } from '../src/config';
import { beginEncounter } from '../src/core/combat';
import { bossSecondsRemaining, createState, step } from '../src/core/game';
import type { Unit } from '../src/core/model';
import { getPartyEnemyDefinition, partyWaveKinds } from '../src/core/party-enemies';
import { bossHpBar, bossHpBarFromUnit } from '../src/core/selectors';
import { effectiveAttack } from '../src/core/party-effects';
import { PARTY_V2 } from '../src/core/party-combat';

function hold(unit: Unit): void {
  unit.speed = 0; unit.gauge = 0; unit.action = { state: 'idle' }; unit.moving = false; delete unit.specialAction;
}

describe('stage-10 boss fight', () => {
  it('spawns the hero-as-boss only on stage 10 / 20 boss waves', () => {
    for (const stage of CONFIG.stages) {
      for (let wave = 1; wave <= stage.waves.length; wave += 1) {
        const definition = stage.waves[wave - 1]!;
        const original = 'enemies' in definition ? definition.enemies : [definition.boss, ...definition.adds];
        const kinds = partyWaveKinds(stage.index, wave, original, stage.isBoss);
        const bosses = kinds.filter(id => id.startsWith('boss'));
        if (stage.isBoss) {
          expect(stage.index === 10 || stage.index === 20).toBe(true);
          expect(bosses).toHaveLength(1);
          expect(kinds.length).toBeLessThanOrEqual(3);
        } else {
          expect(bosses).toHaveLength(0);
        }
      }
    }
    const one = stageConfig(10), two = stageConfig(20);
    expect(one.isBoss && one.timeoutSec).toBe(22);
    expect(two.isBoss && two.timeoutSec).toBe(21);
    expect(one.waves).toHaveLength(1);
    expect(two.waves).toHaveLength(1);
  });

  it('loads boss presentation and skill numbers from design-config', () => {
    const ch1 = bossConfig('boss_ch1'), ch2 = bossConfig('boss_ch2');
    expect(ch1.name).toBe('Gorm, the Ashen Brute');
    expect(ch1.heroSprite).toBe('fantasy-warrior');
    expect(ch1.scale).toBe(2);
    expect(ch1.skills.cleave.telegraphLabel).toBe('CLEAVE!');
    expect(ch1.skills.enrage.hpPct).toBe(0.3);
    expect(ch2.name).toBe('Nyx, the Hex Sovereign');
    expect(ch2.heroSprite).toBe('evil-wizard-2');
    const def = getPartyEnemyDefinition('boss_ch1');
    expect(def.special).toMatchObject({ kind: 'bossLocal', abilityId: 'boss-ch1-cleave' });
    expect(def.enrage).toMatchObject({ kind: 'bossEnrage', abilityId: 'boss-ch1-enrage', hpPct: 0.3 });
    expect(def.fullName).toBe(ch1.name);
  });

  it('fires cleave then enrage deterministically under a fixed seed', () => {
    const state = createState(404); state.highestCleared = 9;
    state.progress = { kind: 'BOSS_FIGHT', stage: 10, failedPower: 0, bossLosses: 0 };
    beginEncounter(state);
    const boss = state.enemies.find(unit => unit.sourceId === 'boss_ch1')!;
    const tank = state.party.find(unit => unit.sourceId === 'mw2')!;
    expect(boss).toBeDefined();
    state.enemies = [boss];
    for (const hero of state.party) { hero.speed = 0; hero.action = { state: 'idle' }; hero.gauge = 0; }
    boss.moving = false; boss.x = tank.x + 40; boss.atk = 12;
    boss.procCounters = { basicSuccess: 4, bossPattern: 0 };
    boss.action = { state: 'idle' }; boss.gauge = 10000;
    step(state);
    expect(boss.specialAction).toMatchObject({ state: 'areaMark', abilityId: 'boss-ch1-cleave' });
    const bar = bossHpBar(state);
    expect(bar?.telegraph).toBe('CLEAVE!');
    expect(bar?.name).toBe('Gorm, the Ashen Brute');

    // Resolve the cleave, then force the enrage gate on the next turn.
    const mark = boss.specialAction!;
    if (mark.state === 'areaMark') {
      hold(boss);
      step(state, Math.max(1, mark.impactTick - state.tick + PARTY_V2.timing.windupTicks * 5));
    }
    delete boss.specialAction;
    boss.hp = Math.max(1, Math.floor(boss.maxHp * 0.25));
    boss.moving = false;
    boss.action = { state: 'idle' };
    boss.gauge = 10000;
    step(state);
    expect(boss.procCounters?.enraged).toBe(1);
    expect(boss.specialAction).toMatchObject({ state: 'areaMark', abilityId: 'boss-ch1-enrage', global: true });
    expect(bossHpBar(state)?.telegraph).toBe('ENRAGE!');
    expect(bossHpBar(state)?.enraged).toBe(true);
    expect(effectiveAttack(state, boss)).toBeCloseTo(boss.atk * 1.5);
  });

  it('exposes boss HP bar state from the living boss unit', () => {
    const state = createState(7); state.highestCleared = 9;
    state.progress = { kind: 'BOSS_FIGHT', stage: 10, failedPower: 0, bossLosses: 0 };
    beginEncounter(state);
    const boss = state.enemies.find(unit => unit.boss)!;
    const bar = bossHpBarFromUnit(boss);
    expect(bar.unitId).toBe(boss.id);
    expect(bar.maxHp).toBe(boss.maxHp);
    expect(bar.ratio).toBe(1);
    expect(bar.enraged).toBe(false);
    expect(bar.telegraph).toBeNull();
    boss.hp = 0;
    expect(bossHpBar(state)).toBeNull();
  });

  it('still loses the boss fight when the stage timer expires', () => {
    const chapterOne = stageConfig(10);
    if (!chapterOne.isBoss) throw new Error('expected boss stage');
    const state = createState(11);
    state.highestCleared = 9;
    state.progress = { kind: 'BOSS_FIGHT', stage: 10, failedPower: 0, bossLosses: 0 };
    beginEncounter(state);
    for (const unit of [...state.party, ...state.enemies]) { unit.hp = unit.maxHp = 1_000_000; unit.atk = 1; }
    state.stageStartedTick = 0;
    state.tick = ticksForSeconds(chapterOne.timeoutSec) - 2;
    step(state);
    expect(state.stats.losses).toBe(0);
    expect(bossSecondsRemaining(state)).toBe(1);
    step(state);
    expect(state.stats.losses).toBe(1);
    expect(state.stats.bossFailures).toBe(1);
    expect(state.progress.kind).toBe('BOSS_READY');
  });

  it('keeps a normally geared party able to clear 1-10 inside the timer', () => {
    const state = createState(42);
    state.highestCleared = 9;
    state.progress = { kind: 'BOSS_FIGHT', stage: 10, failedPower: 0, bossLosses: 0 };
    for (const hero of state.roster) { hero.level = 10; hero.stars = 2; }
    beginEncounter(state);
    const stageTen = stageConfig(10);
    if (!stageTen.isBoss) throw new Error('expected boss stage');
    const timeout = ticksForSeconds(stageTen.timeoutSec);
    for (let i = 0; i < timeout + 5 && state.progress.kind === 'BOSS_FIGHT'; i += 1) step(state);
    expect(state.stats.clears).toBeGreaterThanOrEqual(1);
    expect(state.highestCleared).toBeGreaterThanOrEqual(10);
  });
});
