import { CONFIG, enemyKindSchema, type EnemyKind } from '../config';
import { ticksForSeconds } from '../config';

export type PartyEnemySpecial =
  | { kind: 'assassin'; markTicks: number; dashSpeed: number }
  | { kind: 'localArea'; abilityId: string; coefficient: number; radius: number; telegraphTicks: number; cooldownTicks: number }
  | { kind: 'bossLocal'; abilityId: string; coefficient: number; radius: number; telegraphTicks: number; every: number }
  | { kind: 'bossGlobal'; abilityId: string; coefficient: number; telegraphTicks: number; every: number };

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
  const bossPattern: PartyEnemySpecial | undefined = parsed === 'boss_ch1'
    ? { kind: 'bossLocal', abilityId: 'boss-ch1-slam', coefficient: 1, radius: 64, telegraphTicks: tick(1), every: 5 }
    : parsed === 'boss_ch2'
      ? { kind: 'bossGlobal', abilityId: 'boss-ch2-volley', coefficient: 0.9, telegraphTicks: tick(1), every: 4 }
      : undefined;
  const ranged = parsed === 'archer' || parsed === 'boss_ch2';
  return { id, hp: base.hp, atk: base.atk, def: base.def, attackTicks: base.attackIntervalTicks,
    range: ranged ? 260 : 12, speed: parsed === 'archer' ? 55 : 70, basicStyle: ranged ? 'projectile' : 'melee',
    visualKind: parsed, rewardKind: parsed, ...(bossPattern ? { special: bossPattern } : {}) };
}

export function partyWaveKinds(stage: number, wave: number, original: readonly EnemyKind[], isBossStage: boolean): string[] {
  const kinds: string[] = [...original];
  if (isBossStage || stage < 11 || stage > 19) return kinds;
  const specialId = wave === 1 ? 'assassin' : wave === 2 && stage >= 12 ? 'bomber' : wave === 3 && stage >= 13 ? 'bomber' : undefined;
  if (!specialId) return kinds;
  for (let index = kinds.length - 1; index >= 0; index -= 1) {
    const kind = kinds[index];
    if (kind && !kind.startsWith('boss')) { kinds[index] = specialId; break; }
  }
  return kinds;
}
