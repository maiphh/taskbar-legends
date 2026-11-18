import { CONFIG, bossConfig, enemyKindSchema, isBossEnemyId, type EnemyKind } from '../config';
import { ticksForSeconds } from '../config';

export type PartyEnemySpecial =
  | { kind: 'assassin'; markTicks: number; dashSpeed: number }
  | { kind: 'localArea'; abilityId: string; coefficient: number; radius: number; telegraphTicks: number; cooldownTicks: number }
  | { kind: 'bossLocal'; abilityId: string; coefficient: number; radius: number; telegraphTicks: number; every: number; telegraphLabel: string }
  | { kind: 'bossGlobal'; abilityId: string; coefficient: number; telegraphTicks: number; every: number; telegraphLabel: string }
  | {
      kind: 'bossEnrage'; abilityId: string; hpPct: number; atkMult: number; telegraphTicks: number;
      telegraphLabel: string; burstCoefficient: number; burstGlobal: boolean;
    };

export interface PartyEnemyDefinition {
  id: string;
  hp: number;
  atk: number;
  def: number;
  attackTicks: number;
  range: number;
  speed: number;
  basicStyle: 'melee' | 'projectile';
  visualKind: EnemyKind;
  rewardKind: EnemyKind;
  special?: PartyEnemySpecial;
  /** Optional second signature skill (boss enrage). */
  enrage?: Extract<PartyEnemySpecial, { kind: 'bossEnrage' }>;
  scale?: number;
  tint?: string;
  outline?: string;
  displayName?: string;
  title?: string;
  fullName?: string;
  heroSprite?: string;
}

const tick = ticksForSeconds;
const special: Record<string, PartyEnemyDefinition> = {
  assassin: { id: 'assassin', hp: 65, atk: 60, def: 5, attackTicks: 24, range: 12, speed: 110, basicStyle: 'melee', visualKind: 'grunt', rewardKind: 'grunt', special: { kind: 'assassin', markTicks: tick(1), dashSpeed: 360 } },
  bomber: { id: 'bomber', hp: 90, atk: 45, def: 5, attackTicks: 30, range: 200, speed: 50, basicStyle: 'projectile', visualKind: 'brute', rewardKind: 'grunt', special: { kind: 'localArea', abilityId: 'bomber-blast', coefficient: 1, radius: 48, telegraphTicks: tick(1), cooldownTicks: tick(6) } },
};

export function isPartyEnemyId(id: string): boolean {
  return enemyKindSchema.safeParse(id).success || Object.hasOwn(special, id);
}

export function getPartyEnemyDefinition(id: string): PartyEnemyDefinition {
  const added = special[id];
  if (added) return added;
  const parsed = enemyKindSchema.parse(id), base = CONFIG.enemies[parsed];
  if (isBossEnemyId(parsed)) {
    const boss = bossConfig(parsed);
    const cleave = boss.skills.cleave;
    const enrage = boss.skills.enrage;
    return {
      id, hp: boss.hp, atk: boss.atk, def: boss.def, attackTicks: boss.attackIntervalTicks,
      range: 12, speed: 70, basicStyle: 'melee', visualKind: parsed, rewardKind: parsed,
      special: {
        kind: 'bossLocal', abilityId: cleave.id, coefficient: cleave.coefficient, radius: cleave.radius,
        telegraphTicks: cleave.telegraphTicks, every: cleave.everyNthAttack, telegraphLabel: cleave.telegraphLabel,
      },
      enrage: {
        kind: 'bossEnrage', abilityId: enrage.id, hpPct: enrage.hpPct, atkMult: enrage.atkMult,
        telegraphTicks: enrage.telegraphTicks, telegraphLabel: enrage.telegraphLabel,
        burstCoefficient: enrage.burstCoefficient, burstGlobal: enrage.burstGlobal,
      },
      scale: boss.scale, tint: boss.tint, outline: boss.outline,
      displayName: boss.displayName, title: boss.title, fullName: boss.name, heroSprite: boss.heroSprite,
    };
  }
  const ranged = parsed === 'archer';
  return { id, hp: base.hp, atk: base.atk, def: base.def, attackTicks: base.attackIntervalTicks,
    range: ranged ? 260 : 12, speed: parsed === 'archer' ? 55 : 70, basicStyle: ranged ? 'projectile' : 'melee',
    visualKind: parsed, rewardKind: parsed };
}

/** Cap a wave to squad size 3 or 5 after special-id replacement. Boss waves keep 1 boss + 0–2 authored adds. */
function capPartyWaveKinds(kinds: string[]): string[] {
  const bossIndex = kinds.findIndex(id => id.startsWith('boss'));
  if (bossIndex >= 0) {
    const boss = kinds[bossIndex]!;
    const adds = kinds.filter((_, index) => index !== bossIndex).slice(0, 2);
    return [boss, ...adds];
  }
  if (kinds.length >= 5) return kinds.slice(-5);
  if (kinds.length === 4) return kinds.slice(-3);
  if (kinds.length === 3) return kinds;
  if (kinds.length === 0) return ['grunt', 'grunt', 'grunt'];
  const pad = kinds.at(-1)!;
  while (kinds.length < 3) kinds.push(pad);
  return kinds;
}

export function partyWaveKinds(stage: number, wave: number, original: readonly EnemyKind[], isBossStage: boolean): string[] {
  const kinds: string[] = [...original];
  if (!(isBossStage || stage < 11 || stage > 19)) {
    const specialId = wave === 1 ? 'assassin' : wave === 2 && stage >= 12 ? 'bomber' : wave === 3 && stage >= 13 ? 'bomber' : undefined;
    if (specialId) {
      for (let index = kinds.length - 1; index >= 0; index -= 1) {
        const kind = kinds[index];
        if (kind && !kind.startsWith('boss')) { kinds[index] = specialId; break; }
      }
    }
  }
  return capPartyWaveKinds(kinds);
}
