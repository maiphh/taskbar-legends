import { CONFIG, stageConfig } from '../config';
import { heroStats, getOwned, partyPower } from './economy';
import { emit } from './events';
import { captureFarmClock, combatTime } from './clock';
import { partyCombatTick, partyUnitFields } from './party-combat';
import { getPartyEnemyDefinition, partyWaveKinds } from './party-enemies';
import { captureEncounterFarmContext } from './farm-proof';
import type { GameState, Unit } from './model';

export function damage(atk: number, def: number): number { return Math.max(1, Math.round(atk * 100 / (100 + def))); }
export function spawnParty(state: GameState): void {
  state.party = state.partyIds.map((id, slot) => {
    const stats = heroStats(state, getOwned(state, id));
    const unit: Unit = { id: `hero-${id}`, sourceId: id, side: 'hero', ...stats, hp: stats.maxHp,
      x: CONFIG.sim.heroSlotX[slot] ?? 0, slot, boss: false, cooldown: CONFIG.combat.firstAttackDelayTicks,
      attacks: 0, shield: 0, shieldUntilTick: 0, bornTick: state.tick };
    Object.assign(unit, partyUnitFields(unit));
    if (state.farmClock) unit.nativeBornTick = combatTime(state);
    emit(state, { type: 'spawn', unitId: unit.id, side: 'hero', stage: state.progress.stage, wave: 1 });
    return unit;
  });
}
export function spawnWave(state: GameState): void {
  const stage = stageConfig(state.progress.stage);
  const wave = stage.waves[state.wave - 1];
  if (!wave) throw new Error('Missing wave');
  const kinds = 'enemies' in wave ? wave.enemies : [wave.boss, ...wave.adds];
  {
    const partyKinds = partyWaveKinds(stage.index, state.wave, kinds, stage.isBoss);
    state.enemies = partyKinds.map((kind, slot) => {
      const definition = getPartyEnemyDefinition(kind), mult = CONFIG.enemies.scalingPerStage ** (stage.index - 1);
      const unit: Unit = { id: `enemy-${state.encounter}-${state.wave}-${slot}`, sourceId: kind, side: 'enemy',
        hp: Math.round(definition.hp * mult), maxHp: Math.round(definition.hp * mult), atk: Math.round(definition.atk * mult), def: Math.round(definition.def * mult),
        attackTicks: definition.attackTicks, range: definition.range, x: CONFIG.sim.enemySpawnX + slot * CONFIG.sim.enemySpawnSpacingPx,
        slot, cooldown: CONFIG.combat.firstAttackDelayTicks, boss: kind.startsWith('boss'), attacks: 0, shield: 0, shieldUntilTick: 0, bornTick: state.tick };
      Object.assign(unit, partyUnitFields(unit));
      unit.moving = true;
      if (state.farmClock) unit.nativeBornTick = combatTime(state);
      emit(state, { type: 'spawn', unitId: unit.id, side: 'enemy', stage: stage.index, wave: state.wave });
      return unit;
    });
    emit(state, { type: 'wave', stage: stage.index, wave: state.wave });
    for (const hero of state.party) { hero.targetId = null; hero.moving = false; hero.action = { state: 'idle' }; delete hero.specialAction; }
    state.phase = { kind: 'battle' };
  }
}
export function beginEncounter(state: GameState): void {
  // Timed party effects and projectile deadlines use the old native clock; none
  // may carry across the clock reset into a fresh encounter.
  state.partyEffects = []; state.projectiles = [];
  state.encounter += 1; state.wave = 1; state.stageStartedTick = state.tick;
  captureFarmClock(state);
  state.attemptPower = partyPower(state);
  if (!(String(state.progress.stage) in state.metrics.firstAttemptTicks)) state.metrics.firstAttemptTicks[String(state.progress.stage)] = state.tick;
  spawnParty(state);
  state.encounterFarmContext = captureEncounterFarmContext(state);
  emit(state, { type: 'stage', stage: state.progress.stage, mode: state.progress.kind });
  spawnWave(state);
}
export function combatTick(state: GameState, allowPartyAction = true): void {
  partyCombatTick(state, allowPartyAction);
}
