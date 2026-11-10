import { z } from 'zod';
import { CONFIG } from '../config';
import { heroStats, partyBasicDpsForStats, partyGearUtilityGain, realizedBasicCycleTicks, upgradeCost } from '../core/economy';
import { input } from '../core/game';
import { cloneState, parseAction, parseState } from '../core/model';
import type { Action, GameState } from '../core/model';

const requestSchema = z.object({ clientId: z.string().min(1).max(80), requestId: z.string().min(1).max(120), expectedRevision: z.number().int().nonnegative(), action: z.unknown() }).strict();
export interface ManagementSnapshot {
  revision: number; paused: boolean; tick: number; gold: number; tickets: number; pity: number; combatRules?: GameState['combatRules']; progress: GameState['progress']; phase: GameState['phase'];
  highestCleared: number; roster: GameState['roster']; partyIds: string[]; partyPreset?: GameState['partyPreset']; inventory: GameState['inventory']; pendingChoice?: GameState['pendingChoice'];
  heroStats: Record<string, ReturnType<typeof heroStats>>; stats: GameState['stats']; balance: string; pityLegendary?: number; pityNewHero?: number;
  recruit: { cost: number; rates: Record<string, number>; epicPlusRemaining: number; legendaryRemaining: number | null; newHeroRemaining: number | null };
  recentPulls: { seq: number; heroId: string; rarity: string; duplicate: boolean; pity: string | boolean | null }[];
}
export interface HeroGearComparison { before: ReturnType<typeof heroStats>; after: ReturnType<typeof heroStats>; delta: { maxHp: number; atk: number; def: number; attackTicks: number; basicDps: number }; partyUtilityGain: number }
export interface ManagementReply { accepted: boolean; requestId: string; revision: number; snapshot: ManagementSnapshot; reason?: string }
interface CachedReply { fingerprint: string; reply: ManagementReply }

/** One authority for all compact management actions. Ordinary simulation ticks do not invalidate selections. */
export class ManagementAuthority {
  private revision = 0;
  private readonly replay = new Map<string, CachedReply>();
  constructor(private state: GameState, private paused = false, private readonly onCommit?: (state: GameState) => void) {}
  getState(): GameState { return this.state; }
  isPaused(): boolean { return this.paused; }
  setPaused(paused: boolean): void { if (this.paused !== paused) { this.paused = paused; this.revision += 1; } }
  replaceState(next: GameState): void { this.state = parseState(cloneState(next)); this.revision += 1; this.onCommit?.(this.state); }
  snapshot(): ManagementSnapshot {
    const { tick, gold, tickets, pity, combatRules, partyPreset, progress, phase, highestCleared, roster, partyIds, inventory, pendingChoice, stats, balance, pityLegendary, pityNewHero } = this.state;
    const derivedStats = Object.fromEntries(roster.map(hero => [hero.id, heroStats(this.state, hero)]));
    const recruit = { cost: CONFIG.gacha.costTickets, rates: { ...CONFIG.gacha.rates }, epicPlusRemaining: Math.max(0, 30 - pity),
      legendaryRemaining: CONFIG.v14.recruit.legendaryPityEvery ? CONFIG.v14.recruit.legendaryPityEvery - (pityLegendary ?? 0) : null,
      newHeroRemaining: CONFIG.v14.recruit.newHeroGuaranteeEvery && roster.length < CONFIG.heroes.length ? CONFIG.v14.recruit.newHeroGuaranteeEvery - (pityNewHero ?? 0) : null };
    const recentPulls = this.state.events.filter(event => event.data.type === 'pull').slice(-10).map(event => event.data.type === 'pull' ? ({ seq: event.seq, heroId: event.data.heroId,
      rarity: event.data.rarity, duplicate: event.data.duplicate, pity: event.data.pity }) : null).filter((value): value is NonNullable<typeof value> => value !== null);
    return structuredClone({ revision: this.revision, paused: this.paused, tick, gold, tickets, pity, ...(combatRules ? { combatRules } : {}), ...(partyPreset ? { partyPreset } : {}), progress, phase, highestCleared, roster, partyIds, inventory,
      heroStats: derivedStats, recruit, recentPulls, ...(pendingChoice ? { pendingChoice } : {}), stats, balance, ...(pityLegendary === undefined ? {} : { pityLegendary }), ...(pityNewHero === undefined ? {} : { pityNewHero }) });
  }
  compareGear(heroId: string, gearId: string): HeroGearComparison | null {
    const currentHero = this.state.roster.find(hero => hero.id === heroId), currentGear = this.state.inventory.find(item => item.id === gearId);
    if (!currentHero || !currentGear) return null;
    const before = heroStats(this.state, currentHero), draft = { ...this.state, roster: this.state.roster.map(value => ({ ...value, equipment: { ...value.equipment } })) } as GameState;
    const hero = draft.roster.find(value => value.id === heroId)!, gear = draft.inventory.find(value => value.id === gearId)!;
    for (const owned of draft.roster) if (owned.id !== heroId && owned.equipment[gear.slot] === gear.id) owned.equipment[gear.slot] = null;
    hero.equipment[gear.slot] = gear.id;
    const after = heroStats(draft, hero), dps = (value: ReturnType<typeof heroStats>) => this.state.combatRules === 'party-v2'
      ? partyBasicDpsForStats(heroId, value)
      : value.atk * CONFIG.sim.ticksPerSecond / realizedBasicCycleTicks(value);
    return { before, after, delta: { maxHp: after.maxHp - before.maxHp, atk: after.atk - before.atk, def: after.def - before.def,
      attackTicks: after.attackTicks - before.attackTicks, basicDps: dps(after) - dps(before) }, partyUtilityGain: partyGearUtilityGain(this.state, heroId, gear.id) };
  }
  execute(value: unknown): ManagementReply {
    const partial = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
    let raw: z.infer<typeof requestSchema>, action: Action;
    try { raw = requestSchema.parse(value); action = parseAction(raw.action); }
    catch (error) { return this.reply(false, typeof partial.requestId === 'string' ? partial.requestId.slice(0, 120) : '', `Invalid management request: ${error instanceof Error ? error.message : String(error)}`); }
    const fingerprint = JSON.stringify(action), key = `${raw.clientId}:${raw.requestId}`;
    const prior = this.replay.get(key);
    if (prior) return prior.fingerprint === fingerprint ? structuredClone(prior.reply) : this.reply(false, raw.requestId, 'Request id was already used for a different action.');
    let reply: ManagementReply;
    if (raw.expectedRevision !== this.revision) reply = this.reply(false, raw.requestId, 'The view is out of date. Review the refreshed state and try again.');
    else {
      const reason = this.validate(action);
      if (reason) reply = this.reply(false, raw.requestId, reason);
      else {
        const draft = cloneState(this.state), before = JSON.stringify(draft);
        input(draft, action);
        const parsed = parseState(draft);
        if (JSON.stringify(parsed) === before) reply = this.reply(false, raw.requestId, 'That action is no longer available.');
        else { this.state = parsed; this.revision += 1; this.onCommit?.(this.state); reply = this.reply(true, raw.requestId); }
      }
    }
    this.replay.set(key, { fingerprint, reply: structuredClone(reply) });
    while (this.replay.size > 256) this.replay.delete(this.replay.keys().next().value as string);
    return reply;
  }
  executeManyPulls(request: { clientId: string; requestId: string; expectedRevision: number; count: 1 | 10 }): ManagementReply {
    const action = { type: 'pull' as const };
    let raw: z.infer<typeof requestSchema>;
    try { raw = requestSchema.parse({ clientId: request.clientId, requestId: request.requestId, expectedRevision: request.expectedRevision, action: { type: 'pull' } }); }
    catch (error) { return this.reply(false, typeof request.requestId === 'string' ? request.requestId.slice(0, 120) : '', `Invalid management request: ${error instanceof Error ? error.message : String(error)}`); }
    const fingerprint = JSON.stringify({ type: 'pullMany', count: request.count }), key = `${raw.clientId}:${raw.requestId}`;
    const prior = this.replay.get(key);
    if (prior) return prior.fingerprint === fingerprint ? structuredClone(prior.reply) : this.reply(false, raw.requestId, 'Request id was already used for a different action.');
    let reply: ManagementReply;
    if (raw.expectedRevision !== this.revision) reply = this.reply(false, raw.requestId, 'The view is out of date. Review the refreshed state and try again.');
    else if (!Number.isInteger(request.count) || (request.count !== 1 && request.count !== 10) || this.state.tickets < CONFIG.gacha.costTickets * request.count)
      reply = this.reply(false, raw.requestId, `Recruiting x${request.count} requires ${CONFIG.gacha.costTickets * request.count} tickets.`);
    else {
      const draft = cloneState(this.state);
      for (let i = 0; i < request.count; i += 1) input(draft, action);
      this.state = parseState(draft); this.revision += 1; this.onCommit?.(this.state); reply = this.reply(true, raw.requestId);
    }
    this.replay.set(key, { fingerprint, reply: structuredClone(reply) });
    while (this.replay.size > 256) this.replay.delete(this.replay.keys().next().value as string);
    return reply;
  }
  private validate(action: Action): string | undefined {
    const state = this.state;
    switch (action.type) {
      case 'pull': return state.tickets < CONFIG.gacha.costTickets ? `Recruiting requires ${CONFIG.gacha.costTickets} ticket.` : undefined;
      case 'upgrade': {
        const item = state.inventory.find(value => value.id === action.gearId);
        if (!item) return 'That item is no longer in the stash.';
        if (item.level >= CONFIG.gear.upgrade.maxLevel) return 'That item is already at maximum level.';
        const cost = upgradeCost(item); return state.gold < cost ? `Upgrade requires ${cost} gold.` : undefined;
      }
      case 'equip':
        if (!state.roster.some(hero => hero.id === action.heroId)) return 'That hero is not owned.';
        if (!state.inventory.some(item => item.id === action.gearId)) return 'That item is no longer in the stash.';
        return undefined;
      case 'party':
        if (new Set(action.heroIds).size !== action.heroIds.length || action.heroIds.some(id => !state.roster.some(hero => hero.id === id))) return 'Choose three distinct owned heroes.';
        return action.heroIds.every((id, index) => state.partyIds[index] === id) ? 'That party is already assigned.' : undefined;
      case 'lockHero': {
        if (state.combatRules !== 'party-v2') return 'Preset locks are only available in the party preview.';
        const hero = state.roster.find(value => value.id === action.heroId);
        if (!hero) return 'That hero is not owned.';
        return (hero.partyLocked === true) === action.locked ? 'That hero already has this lock setting.' : undefined;
      }
      case 'chooseChest': return state.pendingChoice?.length ? undefined : 'There is no pending chest choice.';
      case 'retry': return state.progress.kind === 'FARMING' || state.progress.kind === 'BOSS_READY' ? undefined : 'Retry is not available now.';
      case 'autoParty': case 'autoEquip': return undefined;
    }
  }
  private reply(accepted: boolean, requestId: string, reason?: string): ManagementReply {
    return { accepted, requestId, revision: this.revision, snapshot: this.snapshot(), ...(reason ? { reason } : {}) };
  }
}
