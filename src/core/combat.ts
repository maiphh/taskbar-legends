import { CONFIG, enemyKindSchema, heroConfig, stageConfig, ticksForSeconds } from '../config';
import { grantXp, heroStats, getOwned, partyPower } from './economy';
import { emit, goldChange } from './events';
import { captureFarmClock, combatTime } from './clock';
import type { GameState, Unit } from './model';

export function damage(atk: number, def: number): number { return Math.max(1, Math.round(atk * 100 / (100 + def))); }
export function spawnParty(state: GameState): void {
  state.party = state.partyIds.map((id, slot) => {
    const stats = heroStats(state, getOwned(state, id));
    const unit: Unit = { id: `hero-${id}`, sourceId: id, side: 'hero', ...stats, hp: stats.maxHp,
      x: CONFIG.sim.heroSlotX[slot] ?? 0, slot, boss: false, cooldown: CONFIG.combat.firstAttackDelayTicks,
      attacks: 0, shield: 0, shieldUntilTick: 0, bornTick: state.tick };
    emit(state, { type: 'spawn', unitId: unit.id, side: 'hero', stage: state.progress.stage, wave: 1 });
    return unit;
  });
}
export function spawnWave(state: GameState): void {
  const stage = stageConfig(state.progress.stage);
  const wave = stage.waves[state.wave - 1];
  if (!wave) throw new Error('Missing wave');
  const kinds = 'enemies' in wave ? wave.enemies : [wave.boss, ...wave.adds];
  state.enemies = kinds.map((kind, slot) => {
    const base = CONFIG.enemies[kind];
    const mult = CONFIG.enemies.scalingPerStage ** (stage.index - 1);
    const unit: Unit = { id: `enemy-${state.encounter}-${state.wave}-${slot}`, sourceId: kind, side: 'enemy',
      hp: Math.round(base.hp * mult), maxHp: Math.round(base.hp * mult), atk: Math.round(base.atk * mult), def: Math.round(base.def * mult),
      attackTicks: base.attackIntervalTicks, range: base.rangePx, x: CONFIG.sim.enemySpawnX + slot * CONFIG.sim.enemySpawnSpacingPx,
      slot, cooldown: CONFIG.combat.firstAttackDelayTicks, boss: kind.startsWith('boss'), attacks: 0, shield: 0, shieldUntilTick: 0, bornTick: state.tick };
    if (state.farmClock) unit.nativeBornTick = combatTime(state);
    emit(state, { type: 'spawn', unitId: unit.id, side: 'enemy', stage: stage.index, wave: state.wave });
    return unit;
  });
  emit(state, { type: 'wave', stage: stage.index, wave: state.wave });
  state.phase = { kind: 'battle' };
}
export function beginEncounter(state: GameState): void {
  state.encounter += 1; state.wave = 1; state.stageStartedTick = state.tick;
  captureFarmClock(state);
  state.attemptPower = partyPower(state);
  if (!(String(state.progress.stage) in state.metrics.firstAttemptTicks)) state.metrics.firstAttemptTicks[String(state.progress.stage)] = state.tick;
  spawnParty(state);
  emit(state, { type: 'stage', stage: state.progress.stage, mode: state.progress.kind });
  spawnWave(state);
}
function hit(state: GameState, source: Unit, target: Unit, multiplier = 1): void {
  if (target.hp <= 0) return;
  let amount = damage(source.atk * multiplier, target.def);
  const absorbed = Math.min(amount, target.shield);
  target.shield -= absorbed; amount -= absorbed;
  const hpDamage = Math.min(target.hp, amount);
  target.hp -= hpDamage;
  emit(state, { type: 'hit', attackerId: source.id, targetId: target.id, damage: Math.max(1, hpDamage + absorbed), side: target.side });
  if (target.hp > 0) return;
  emit(state, { type: 'death', unitId: target.id, side: target.side });
  if (target.side !== 'enemy') return;
  const kind = enemyKindSchema.parse(target.sourceId);
  const base = CONFIG.enemies[kind];
  const mult = CONFIG.rewards.killScaling ** (state.progress.stage - 1);
  goldChange(state, Math.round(base.gold * mult), 'kill');
  grantXp(state, Math.round(base.xp * mult));
}
function heal(state: GameState, source: Unit, target: Unit, multiplier: number): void {
  const amount = Math.min(target.maxHp - target.hp, Math.round(source.atk * multiplier));
  if (target.hp <= 0 || amount <= 0) return;
  target.hp += amount;
  emit(state, { type: 'heal', sourceId: source.id, targetId: target.id, amount });
}
function attackHero(state: GameState, hero: Unit): void {
  const definition = heroConfig(hero.sourceId);
  const role = CONFIG.roles[definition.role];
  const targets = state.enemies.filter(enemy => enemy.hp > 0 && enemy.x - hero.x <= hero.range).sort((a, b) => a.x - b.x || a.slot - b.slot);
  const target = targets[0];
  const hurt = state.party.filter(ally => ally.hp > 0 && ally.hp / ally.maxHp < CONFIG.roles.support.healThresholdPct).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp || a.slot - b.slot)[0];
  if (!target && !(definition.role === 'support' && hurt)) return;
  hero.attacks += 1; hero.cooldown = hero.attackTicks;
  const skill = hero.attacks % role.skill.everyNthAttack === 0;
  if (skill) emit(state, { type: 'skill', unitId: hero.id, skill: role.skill.id });
  switch (definition.role) {
    case 'tank':
      if (skill) { hero.shield = Math.round(hero.maxHp * CONFIG.roles.tank.skill.shieldPctMaxHp); hero.shieldUntilTick = combatTime(state) + ticksForSeconds(CONFIG.roles.tank.skill.shieldDurationSec); }
      else if (target) hit(state, hero, target);
      return;
    case 'warrior': {
      if (!target) return;
      const spec = CONFIG.roles.warrior.skill;
      if (!skill) { hit(state, hero, target); return; }
      const second = targets.find(enemy => enemy.id !== target.id && Math.abs(enemy.x - target.x) <= spec.secondRadiusPx);
      hit(state, hero, target, spec.mainMult);
      if (second) hit(state, hero, second, spec.secondMult);
      return;
    }
    case 'ranger':
      if (skill) for (const enemy of targets.slice(0, CONFIG.roles.ranger.skill.targets)) hit(state, hero, enemy, CONFIG.roles.ranger.skill.mult);
      else if (target) hit(state, hero, target);
      return;
    case 'mage': {
      if (!target) return;
      if (!skill) { hit(state, hero, target); return; }
      const spec = CONFIG.roles.mage.skill;
      const radius = spec.splashRadiusPx + (definition.mod.splashRadiusPx ?? 0);
      const splash = state.enemies.filter(enemy => enemy.hp > 0 && enemy.id !== target.id && Math.abs(enemy.x - target.x) <= radius);
      hit(state, hero, target, spec.mainMult);
      for (const enemy of splash) hit(state, hero, enemy, spec.splashMult);
      return;
    }
    case 'support':
      if (skill) for (const ally of state.party) heal(state, hero, ally, CONFIG.roles.support.skill.healAllMult);
      else if (hurt) heal(state, hero, hurt, CONFIG.roles.support.healMult);
      else if (target) hit(state, hero, target);
      return;
    default: { const exhaustive: never = definition.role; return exhaustive; }
  }
}
export function combatTick(state: GameState): void {
  for (const hero of state.party) {
    if (hero.shieldUntilTick <= combatTime(state)) hero.shield = 0;
    if (hero.hp > 0) hero.cooldown = Math.max(0, hero.cooldown - 1);
  }
  // Position integration before targeting: integer fixed tick / configured px per second.
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const target = state.party.find(hero => hero.hp > 0);
    if (!target) break;
    const kind = enemyKindSchema.parse(enemy.sourceId);
    const base = CONFIG.enemies[kind];
    const stopDistance = kind === 'grunt' || kind === 'brute' ? CONFIG.combat.enemyMeleeStopOffsetPx : enemy.range;
    enemy.x = Math.max(target.x + stopDistance, enemy.x - base.speedPxPerSec / CONFIG.sim.ticksPerSecond);
    enemy.cooldown = Math.max(0, enemy.cooldown - 1);
  }
  for (const hero of state.party) if (hero.hp > 0 && hero.cooldown === 0) attackHero(state, hero);
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0 || enemy.cooldown > 0) continue;
    const target = state.party.find(hero => hero.hp > 0);
    if (!target || enemy.x - target.x > enemy.range) continue;
    enemy.attacks += 1; enemy.cooldown = enemy.attackTicks;
    const base = CONFIG.enemies[enemyKindSchema.parse(enemy.sourceId)];
    let multiplier = 1;
    if ('enrageAfterSec' in base && combatTime(state) - (enemy.nativeBornTick ?? enemy.bornTick) >= ticksForSeconds(base.enrageAfterSec)) multiplier *= base.enrageAtkMult;
    if ('skill' in base && enemy.attacks % base.skill.everyNthAttack === 0) {
      emit(state, { type: 'skill', unitId: enemy.id, skill: base.skill.id });
      for (const hero of state.party) if (hero.hp > 0) hit(state, enemy, hero, multiplier * base.skill.mult);
    } else hit(state, enemy, target, multiplier);
  }
}
