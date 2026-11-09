import { CONFIG, slotSchema, ticksForSeconds } from '../config';
import { cheapestEquippedUpgrade, gearScore, getOwned, heroStats, upgradeCost } from './economy';
import type { GameEvent, GameState, Gear } from './model';

/** Pure read-only views over GameState used by the HUD for feedback; never mutate state. */
export interface Affordability { heroes: boolean; gear: boolean; recruit: boolean; boss: boolean }
const upgradable = (state: GameState, item: Gear): boolean => item.level < CONFIG.gear.upgrade.maxLevel && state.gold >= upgradeCost(item);

/** Unequipped gear that beats what a party hero wears in that slot. */
export function betterUnequippedGear(state: GameState): Gear | undefined {
  const equipped = new Set(state.roster.flatMap(hero => Object.values(hero.equipment)));
  for (const id of state.partyIds) {
    const hero = getOwned(state, id);
    for (const slot of slotSchema.options) {
      const current = state.inventory.find(item => item.id === hero.equipment[slot]);
      const better = state.inventory.find(item => item.slot === slot && !equipped.has(item.id) && gearScore(item) > (current ? gearScore(current) : 0));
      if (better) return better;
    }
  }
  return undefined;
}
export function affordability(state: GameState): Affordability {
  const heroUpgrade = cheapestEquippedUpgrade(state);
  return {
    heroes: heroUpgrade !== undefined && upgradable(state, heroUpgrade),
    gear: state.inventory.some(item => upgradable(state, item)) || betterUnequippedGear(state) !== undefined,
    recruit: state.tickets >= CONFIG.gacha.costTickets,
    boss: state.progress.kind === 'BOSS_READY',
  };
}

export interface StatDelta { heroId: string | null; atk: number; maxHp: number; def: number; dpsPct: number; label: string }
/** Stat change from one gear upgrade (level - 1 -> level) on whoever wears it now. */
export function upgradeDelta(state: GameState, gearId: number, level: number): StatDelta {
  const item = state.inventory.find(gear => gear.id === gearId);
  const owner = item ? state.roster.find(hero => hero.equipment[item.slot] === gearId) : undefined;
  if (!item || !owner) return { heroId: null, atk: 0, maxHp: 0, def: 0, dpsPct: 0, label: `+1 LV (now +${level})` };
  const at = (lv: number) => heroStats({ ...state, inventory: state.inventory.map(gear => gear.id === gearId ? { ...gear, level: lv } : gear) }, owner);
  const before = at(level - 1), after = at(level);
  const dps = (stats: typeof after) => stats.atk / stats.attackTicks;
  const delta = { atk: after.atk - before.atk, maxHp: after.maxHp - before.maxHp, def: after.def - before.def,
    dpsPct: Math.round((dps(after) / dps(before) - 1) * 1000) / 10 };
  const parts = [delta.atk && `+${delta.atk} ATK`, delta.maxHp && `+${delta.maxHp} HP`, delta.def && `+${delta.def} DEF`,
    delta.dpsPct >= 0.1 && `+${delta.dpsPct}% DPS`].filter((part): part is string => typeof part === 'string');
  return { heroId: owner.id, ...delta, label: parts.slice(0, 2).join(' ') || `+1 LV (now +${level})` };
}

export interface UpgradePopup { seq: number; age: number; gearId: number; delta: StatDelta }
export function upgradePopups(state: GameState): UpgradePopup[] {
  const life = ticksForSeconds(CONFIG.view.upgradePopupSeconds);
  return state.events.filter(event => event.data.type === 'upgrade' && state.tick - event.tick < life).map(event => {
    if (event.data.type !== 'upgrade') throw new Error('unreachable');
    return { seq: event.seq, age: (state.tick - event.tick) / life, gearId: event.data.gearId, delta: upgradeDelta(state, event.data.gearId, event.data.level) };
  });
}

export type StageCue = { kind: 'clear'; stage: number; age: number } | { kind: 'boss'; stage: number; clearedStage: number | null; age: number };
function latest(state: GameState, match: (event: GameEvent) => boolean): GameEvent | undefined {
  for (let index = state.events.length - 1; index >= 0; index -= 1) { const event = state.events[index]; if (event && match(event)) return event; }
  return undefined;
}
/** First clears get a banner; entering BOSS_READY (after a clear or a lost boss) gets a "boss ready" banner. */
export function stageCue(state: GameState): StageCue | null {
  const life = ticksForSeconds(CONFIG.view.stageCueSeconds);
  const clear = latest(state, event => event.data.type === 'clear' && event.data.first);
  const fresh = (event: GameEvent | undefined): event is GameEvent => event !== undefined && state.tick - event.tick < life;
  if (state.progress.kind === 'BOSS_READY') {
    const lost = latest(state, event => event.data.type === 'loss' && event.data.boss);
    const trigger = [clear, lost].filter(fresh).sort((a, b) => b.seq - a.seq)[0];
    if (trigger) return { kind: 'boss', stage: state.progress.bossStage, clearedStage: trigger.data.type === 'clear' ? trigger.data.stage : null, age: (state.tick - trigger.tick) / life };
  }
  if (fresh(clear) && clear.data.type === 'clear') return { kind: 'clear', stage: clear.data.stage, age: (state.tick - clear.tick) / life };
  return null;
}
