import { gearScore } from '../core/economy';
import type { Gear, OwnedHero } from '../core/model';

export type EquipSlot = Gear['slot'];
export interface EquipListEntry { gear: Gear; wornBy: OwnedHero | undefined }

/** Slot scoped inventory, ranked by the game's economy score with stable ID tie breaking. */
export function equipList(inventory: readonly Gear[], roster: readonly OwnedHero[], slot: EquipSlot): EquipListEntry[] {
  return inventory.filter(item => item.slot === slot).slice().sort((a,b) => gearScore(b)-gearScore(a) || a.id.localeCompare(b.id))
    .map(gear => ({ gear, wornBy: roster.find(hero => Object.values(hero.equipment).includes(gear.id)) }));
}

/** Best item per slot; callers apply these with the existing equip action, in slot order. */
export function autoEquipBest(hero: OwnedHero, inventory: readonly Gear[]): Gear[] {
  return (['weapon','armor','charm'] as const).map(slot => inventory.filter(item => item.slot === slot)
    .slice().sort((a,b) => gearScore(b)-gearScore(a) || a.id.localeCompare(b.id))[0])
    .filter((item): item is Gear => item !== undefined && hero.equipment[item.slot] !== item.id);
}
