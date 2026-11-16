import { CONFIG, SALVAGE_DESIGN, TICK_MS, setSalvageRules, setV14Rules, v14RuleSchema } from '../config';
import { createState, step } from '../core/game';
import { cloneState, parseAction, parseState } from '../core/model';
import type { GameState } from '../core/model';
import { applyOffline } from '../core/save';
import { ManagementAuthority } from '../management/authority';

// The online rules are fixed for this server bundle. Never select rules from request data.
setV14Rules(v14RuleSchema.options);
setSalvageRules(SALVAGE_DESIGN ? 'design' : 'default');

const CORE_REVISION = 'party-v2-online-core-1';
const FARM_RESOLVER_REVISION = 'farm-proof-party-runtime-1';
function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
}
const rulesMaterial = stableJson({ coreRevision: CORE_REVISION, farmResolver: FARM_RESOLVER_REVISION, canonicalConfig: CONFIG });
export const RULES_ID = `sha256:${[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rulesMaterial)))]
  .map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
export interface Ledger { gold: number; tickets: number; inventory: GameState['inventory'] }
export interface ActiveProgress { ticks: number; remainderMs: number }
export interface SettlementResult extends ActiveProgress { offline: ReturnType<typeof applyOffline> | null }
export interface AccountRow { state: Record<string, unknown>; gold: number; tickets: number; revision: number; rules_id: string; remainder_ms: number }

export function createAccount(seed: number): GameState {
  const state = cloneState(createState(seed));
  // Gear IDs use the public account seed; paid/random outcomes use a separate CSPRNG seed.
  state.rng = crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
  return parseState(state);
}

/** Safe render/cache state. The server's RNG cursor is never returned in account or receipt JSON. */
export function publicAccountState(state: GameState): GameState {
  const view = cloneState(state);
  view.rng = 0;
  return parseState(view);
}

export function assembleAccount(row: AccountRow, inventory: GameState['inventory']): GameState {
  return parseState({ ...row.state, gold: row.gold, tickets: row.tickets, inventory });
}

export function splitAccount(value: unknown): { state: Record<string, unknown>; gold: number; tickets: number; inventory: GameState['inventory'] } {
  const { gold, tickets, inventory, ...state } = parseState(value);
  return { state, gold, tickets, inventory };
}

/** Settle only server-measured active lease time. Caller stores this fractional remainder once. */
export function settleActive(state: GameState, elapsedMs: number, remainderMs: number): ActiveProgress {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || !Number.isFinite(remainderMs) || remainderMs < 0 || remainderMs >= TICK_MS)
    throw new Error('Invalid server time interval');
  const accumulated = elapsedMs + remainderMs, ticks = Math.floor(accumulated / TICK_MS);
  let remaining = ticks;
  while (remaining > 0) { const chunk = Math.min(remaining, 100); step(state, chunk); remaining -= chunk; }
  return { ticks, remainderMs: accumulated - ticks * TICK_MS };
}

/** Offline rewards are computed once from the server-owned checkpoint and are capped by core policy at eight hours. */
export function settleInterval(state: GameState, activeMs: number, offlineMs: number, remainderMs: number): SettlementResult {
  const active = settleActive(state, activeMs, remainderMs);
  const offline = offlineMs > 0 ? applyOffline(state, offlineMs) : null;
  return { ...active, offline };
}

export function applyCommand(state: GameState, rawAction: unknown, pullCount?: 1 | 10): { state: GameState; reason?: string } {
  const action = parseAction(pullCount === undefined ? rawAction : { type: 'pull' });
  const authority = new ManagementAuthority(parseState(cloneState(state)));
  const reply = pullCount === undefined
    ? authority.execute({ clientId: 'online-edge', requestId: 'command', expectedRevision: 0, action })
    : authority.executeManyPulls({ clientId: 'online-edge', requestId: 'command', expectedRevision: 0, count: pullCount });
  if (!reply.accepted) return { state, reason: reply.reason ?? 'Action rejected.' };
  return { state: authority.getState() };
}
