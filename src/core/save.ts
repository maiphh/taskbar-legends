import { z } from 'zod';
import { CONFIG, TICK_MS, slotSchema, stageConfig } from '../config';
import { chest, grantXp } from './economy';
import { emit, goldChange } from './events';
import { cloneState, gearSchema, gearTemplateId, gearV1Schema, itemId, parseState, stateSchema } from './model';
import type { GameState, Gear } from './model';

/** What a SaveStore persists: the game state plus the wall-clock bookkeeping for offline catch-up. */
export interface SaveData { savedAtMs: number; remainderMs: number; state: GameState }
const timing = { savedAtMs: z.number().finite().nonnegative(), remainderMs: z.number().nonnegative().lt(TICK_MS) };
const walletSchema = z.object({ gold: z.number().int().nonnegative(), tickets: z.number().int().nonnegative() }).strict();
const LEDGER_KEYS = ['gold', 'tickets', 'inventory'] as const;
/**
 * v2 keeps currencies (wallet) and item instances (inventory) outside the rest of the state so each can later move
 * to a server ledger. The remaining state is re-validated as a whole after the parts are joined.
 */
const saveV2Schema = z.object({ format: z.literal('taskbar-legends-save-v2'), ...timing, wallet: walletSchema,
  inventory: z.array(gearSchema), state: z.record(z.string(), z.unknown()) }).strict()
  .refine(save => LEDGER_KEYS.every(key => !(key in save.state)), 'Wallet and inventory belong outside state');
const equipmentV1Schema = z.object({ weapon: z.number().int().positive().nullable(), armor: z.number().int().positive().nullable(), charm: z.number().int().positive().nullable() }).strict();
const saveV1Schema = z.object({ format: z.literal('taskbar-legends-save-v1'), ...timing,
  state: z.looseObject({ version: z.literal(1), seed: z.number().int().nonnegative().max(0xffffffff), tick: z.number().int().nonnegative(),
    inventory: z.array(gearV1Schema), roster: z.array(z.looseObject({ equipment: equipmentV1Schema })),
    events: z.array(z.looseObject({ data: z.looseObject({ type: z.string() }) })) }) }).strict();
export type SaveV2 = z.infer<typeof saveV2Schema>;

export function encodeSave(data: SaveData): SaveV2 {
  const { gold, tickets, inventory, ...rest } = stateSchema.parse(data.state);
  return saveV2Schema.parse({ format: 'taskbar-legends-save-v2', savedAtMs: data.savedAtMs, remainderMs: data.remainderMs,
    wallet: { gold, tickets }, inventory, state: rest });
}
/** v1 -> v2: deterministic ids from the save's seed and old numeric id; progress, stats and events are kept. */
export function migrateV1(value: unknown): SaveData {
  const save = saveV1Schema.parse(value);
  const { seed, tick } = save.state;
  const newId = (old: number) => itemId(seed, old);
  const inventory: Gear[] = save.state.inventory.map(({ id, ...item }) => ({ id: newId(id), templateId: gearTemplateId(item.slot, item.rarity),
    tradeable: false, acquiredAt: { tick, source: 'migration' }, ...item }));
  const roster = save.state.roster.map(hero => ({ ...hero, equipment: Object.fromEntries(slotSchema.options.map(slot => {
    const old = hero.equipment[slot]; return [slot, old === null ? null : newId(old)];
  })) }));
  const events = save.state.events.map(event => {
    const gearId = event.data.gearId;
    return typeof gearId === 'number' && (event.data.type === 'gear' || event.data.type === 'upgrade') ? { ...event, data: { ...event.data, gearId: newId(gearId) } } : event;
  });
  const state = parseState({ ...save.state, version: 2, inventory, roster, events });
  return { savedAtMs: save.savedAtMs, remainderMs: save.remainderMs, state };
}
/** Accepts v2 or v1 (migrated). Anything else throws, so a caller never mistakes a bad save for "no save". */
export function decodeSave(value: unknown): SaveData {
  const format = typeof value === 'object' && value !== null && 'format' in value ? value.format : undefined;
  if (format === 'taskbar-legends-save-v1') return migrateV1(value);
  const save = saveV2Schema.parse(value);
  const state = parseState({ ...save.state, ...save.wallet, inventory: save.inventory });
  return { savedAtMs: save.savedAtMs, remainderMs: save.remainderMs, state };
}
export function makeSave(state: GameState, savedAtMs: number, remainderMs = 0): string {
  return JSON.stringify(encodeSave({ state, savedAtMs, remainderMs }));
}
export function expectedFarmRewards(stageNumber: number) {
  const stage = stageConfig(stageNumber);
  let gold = Math.round(CONFIG.rewards.clearGold * CONFIG.rewards.clearScaling ** (stageNumber - 1));
  let xp = Math.round(CONFIG.rewards.clearXp * CONFIG.rewards.clearScaling ** (stageNumber - 1));
  const killMult = CONFIG.rewards.killScaling ** (stageNumber - 1);
  for (const wave of stage.waves) {
    const kinds = 'enemies' in wave ? wave.enemies : [wave.boss, ...wave.adds];
    for (const kind of kinds) { gold += Math.round(CONFIG.enemies[kind].gold * killMult); xp += Math.round(CONFIG.enemies[kind].xp * killMult); }
  }
  return { gold, xp };
}
export function applyOffline(state: GameState, elapsedMs: number) {
  if (!Number.isFinite(elapsedMs)) throw new Error('Invalid elapsed time');
  const rawSeconds = Math.max(0, elapsedMs / 1000);
  const seconds = Math.min(rawSeconds, CONFIG.idle.offlineCapHours * 3600);
  const samples = state.metrics.farmClearSeconds;
  const average = samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : CONFIG.idle.avgFarmClearSecDefault;
  const clears = Math.floor(seconds / average);
  const stage = Math.max(1, state.highestCleared);
  const rewards = expectedFarmRewards(stage);
  const gold = Math.floor(rewards.gold * clears * CONFIG.idle.offlineEfficiency);
  const xp = Math.floor(rewards.xp * clears * CONFIG.idle.offlineEfficiency);
  const chests = Math.min(CONFIG.idle.offlineChestMax, Math.floor(seconds / (CONFIG.idle.offlineChestEveryHours * 3600)));
  goldChange(state, gold, 'offline');
  const heroes = xp ? grantXp(state, xp, state.partyIds) : state.partyIds.map(id => { const level = state.roster.find(hero => hero.id === id)?.level ?? 1; return { id, levelBefore: level, levelAfter: level }; });
  for (let index = 0; index < chests; index += 1) chest(state, stage);
  state.stats.offlineClears += clears; state.stats.offlineSeconds += Math.floor(seconds);
  // Offline does not advance open ticks, progression, retry deadlines, or summon tickets.
  if (seconds) emit(state, { type: 'offline', seconds, rawSeconds, clears, gold, xp, chests, heroes });
  return { seconds, rawSeconds, clears, gold, xp, chests, heroes, capped: elapsedMs > CONFIG.idle.offlineCapHours * 3_600_000 };
}
/** Applies offline catch-up for the wall-clock time since the save was written. */
export function resumeSave(data: SaveData, nowMs: number) {
  if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error('Invalid current timestamp');
  const state = cloneState(data.state);
  const result = applyOffline(state, Math.max(0, nowMs - data.savedAtMs));
  return { state, ...result, remainderMs: data.remainderMs };
}
export function restoreSave(raw: string, nowMs: number) {
  return resumeSave(decodeSave(JSON.parse(raw)), nowMs);
}
