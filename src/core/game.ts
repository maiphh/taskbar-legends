import { CONFIG, stageConfig, ticksForSeconds } from '../config';
import { beginEncounter, combatTick, spawnWave } from './combat';
import { cancelPartyEncounterEffects, expireFriendlyDeadTargetProjectiles, hasPendingHostileImpact } from './party-combat';
import { autoEquip, autoParty, blankEquipment, chest, chooseChest, equip, farmChestRoll, grantXp, partyPower, pull, setParty, upgrade, togglePartyLock } from './economy';
import { emit, goldChange } from './events';
import { cloneState, gearTemplateId, itemId, parseState } from './model';
import type { Action, GameState } from './model';
import { normalizeSeed, random } from './rng';

export function stageName(stage: number): string { return stageConfig(stage).id; }
export function isBoss(stage: number): boolean { return stageConfig(stage).isBoss; }
export function createState(seed = 1): GameState {
  const normalized = normalizeSeed(seed);
  const starters = CONFIG.heroes.filter(hero => hero.starter);
  const state: GameState = {
    version: 2, balance: CONFIG.version, tick: 0, rng: normalized, seed: normalized, gold: 0,
    tickets: CONFIG.rewards.startingTickets, pity: 0, highestCleared: 0, progress: { kind: 'PUSHING', stage: 1 },
    phase: { kind: 'battle' }, wave: 1, encounter: 0, stageStartedTick: 0, attemptPower: 0,
    roster: starters.map(hero => ({ id: hero.id, level: 1, xp: 0, stars: 1, equipment: blankEquipment() })),
    partyIds: starters.map(hero => hero.id), inventory: [], nextGearId: 1, party: [], enemies: [], retryFailures: 0, economyRevision: 0,
    stats: { clears: 0, losses: 0, retries: 0, bossFailures: 0, goldEarned: 0, pulls: 0, chests: 0, offlineClears: 0, offlineSeconds: 0 },
    metrics: { firstAttemptTicks: {}, firstClearTicks: {}, fullRosterTick: null, farmClearSeconds: [], farmMinSeconds: null,
      farmMaxSeconds: null, farmSamples: 0, maxNonBossStallSeconds: 0 }, eventSeq: 0, eventCounts: {}, events: [],
  };
  beginEncounter(state);
  return state;
}
/**
 * Party-v2 fresh-account kit: one common weapon (melee DPS), armor (tank) and charm (healer), equipped, so Stash and Upgrades
 * are not empty on a new seed. Deterministic: fixed stage-1 common stats (`gear.mainRoll` is [1, 1]; charm uses the low end of
 * its range), ids from `nextGearId`, no RNG drawn. Only `createPartyState(seed, { starterGear: true })` (the browser/native
 * party preview) calls it; legacy `createState` and its golden output are unchanged.
 */
export function addStarterGear(state: GameState): void {
  const kit = [['mw1', 'weapon'], ['mw2', 'armor'], ['priest', 'charm']] as const, slots = CONFIG.gear.slots;
  for (const [heroId, slot] of kit) {
    const hero = state.roster.find(value => value.id === heroId); if (!hero || hero.equipment[slot]) continue;
    const stats = { hp: 0, atk: 0, def: 0, hpPct: 0, atkPct: 0, speedPct: 0 };
    if (slot === 'weapon') stats.atk = slots.weapon.main.atk;
    if (slot === 'armor') { stats.hp = slots.armor.main.hp; stats.def = slots.armor.main.def; }
    if (slot === 'charm') stats.atkPct = slots.charm.oneOf.atkPct[0] ?? 0;
    const id = itemId(state.seed, state.nextGearId++);
    state.inventory.push({ id, templateId: gearTemplateId(slot, 'common'), tradeable: false, acquiredAt: { tick: state.tick, source: 'starter' },
      slot, rarity: 'common', dropStage: 1, level: 0, spent: 0, stats });
    hero.equipment[slot] = id;
  }
}
/** Isolated opt-in rules preview. Legacy createState and its serialized output remain unchanged. */
export function createPartyState(seed = 1, options: { starterGear?: boolean } = {}): GameState {
  const state = createState(seed);
  state.combatRules = 'party-v2';
  for (const id of ['mw1', 'priest']) if (!state.roster.some(hero => hero.id === id)) {
    state.roster.push({ id, level: 1, xp: 0, stars: 1, equipment: blankEquipment() });
  }
  state.partyIds = ['mw2', 'mw1', 'priest'];
  if (options.starterGear) addStarterGear(state);
  state.party = []; state.enemies = []; state.encounter = 0; state.wave = 1;
  state.events = []; state.eventSeq = 0; state.eventCounts = {};
  beginEncounter(state);
  return parseState(state);
}
function rest(state: GameState, next: 'encounter' | 'wave'): void {
  state.phase = { kind: 'rest', remainingTicks: ticksForSeconds(next === 'wave' ? CONFIG.sim.waveGapSec : CONFIG.sim.stageGapSec), next };
}
export function retry(state: GameState, manual: boolean): void {
  const progress = state.progress;
  if (progress.kind === 'FARMING') {
    state.progress = { kind: 'PUSHING', stage: progress.failedStage };
  } else if (progress.kind === 'BOSS_READY' && manual) {
    state.progress = { kind: 'BOSS_FIGHT', stage: progress.bossStage, failedPower: progress.failedPower, bossLosses: progress.bossLosses };
  } else return;
  state.stats.retries += 1;
  emit(state, { type: 'retry', stage: state.progress.stage, manual });
  beginEncounter(state);
}
function lose(state: GameState): void {
  const progress = state.progress;
  const boss = progress.kind === 'BOSS_FIGHT';
  state.stats.losses += 1;
  if (boss) state.stats.bossFailures += 1;
  emit(state, { type: 'loss', stage: progress.stage, boss });
  if (boss) state.progress = { kind: 'BOSS_READY', stage: state.highestCleared, bossStage: progress.stage,
    failedPower: state.attemptPower, bossLosses: progress.bossLosses + 1 };
  else if (progress.kind === 'PUSHING') {
    state.retryFailures += 1;
    const backoff = CONFIG.progression.retryBackoff[Math.min(state.retryFailures - 1, CONFIG.progression.retryBackoff.length - 1)] ?? CONFIG.progression.retryIntervalSec;
    state.progress = { kind: 'FARMING', stage: Math.max(1, state.highestCleared), failedStage: progress.stage,
      retryAtTick: state.tick + ticksForSeconds(backoff), failTick: state.tick, failedPower: state.attemptPower, failures: state.retryFailures };
  }
  delete state.farmClock;
  rest(state, 'encounter');
}
function awardClear(state: GameState, duration: number, nativeDuration = duration): void {
  const stage = stageConfig(state.progress.stage);
  const first = state.progress.kind === 'PUSHING' || state.progress.kind === 'BOSS_FIGHT';
  const mult = CONFIG.rewards.clearScaling ** (stage.index - 1);
  goldChange(state, Math.round(CONFIG.rewards.clearGold * mult), 'clear');
  grantXp(state, Math.round(CONFIG.rewards.clearXp * mult));
  state.stats.clears += 1;
  emit(state, { type: 'clear', stage: stage.index, first, durationSeconds: duration });
  if (first) {
    state.highestCleared = stage.index; state.retryFailures = 0;
    state.metrics.firstClearTicks[String(stage.index)] ??= state.tick;
    if (!stage.isBoss) {
      const start = state.metrics.firstAttemptTicks[String(stage.index)] ?? state.tick;
      state.metrics.maxNonBossStallSeconds = Math.max(state.metrics.maxNonBossStallSeconds, (state.tick - start) / CONFIG.sim.ticksPerSecond);
    }
    if (CONFIG.rewards.firstClearChest) chest(state, stage.index);
    state.tickets += stage.firstClearTickets; state.economyRevision += 1;
    // A 0-ticket stage grants nothing, so it logs nothing (the tickets event keeps amount: positive).
    if (stage.firstClearTickets > 0) emit(state, { type: 'tickets', amount: stage.firstClearTickets, total: state.tickets });
    if (stage.index === CONFIG.stages.length) state.progress = { kind: 'COMPLETE', stage: stage.index };
    else if (isBoss(stage.index + 1)) state.progress = { kind: 'BOSS_READY', stage: stage.index, bossStage: stage.index + 1, failedPower: 0, bossLosses: 0 };
    else state.progress = { kind: 'PUSHING', stage: stage.index + 1 };
  } else {
    if (state.farmClock || state.metrics.nativeFarmClearSeconds) {
      state.metrics.nativeFarmClearSeconds ??= [...state.metrics.farmClearSeconds];
      state.metrics.nativeFarmClearSeconds.push(nativeDuration);
      if (state.metrics.nativeFarmClearSeconds.length > CONFIG.idle.avgFarmClearSecWindow) state.metrics.nativeFarmClearSeconds.shift();
    }
    state.metrics.farmClearSeconds.push(duration);
    if (state.metrics.farmClearSeconds.length > CONFIG.idle.avgFarmClearSecWindow) state.metrics.farmClearSeconds.shift();
    state.metrics.farmMinSeconds = Math.min(state.metrics.farmMinSeconds ?? duration, duration);
    state.metrics.farmMaxSeconds = Math.max(state.metrics.farmMaxSeconds ?? duration, duration);
    state.metrics.farmSamples += 1;
    farmChestRoll(state, stage.index);
    if (random(state) < CONFIG.rewards.farmTicketChance) { state.tickets += 1; state.economyRevision += 1; emit(state, { type: 'tickets', amount: 1, total: state.tickets }); }
  }
}
function win(state: GameState): void {
  const stage = stageConfig(state.progress.stage);
  if (state.wave < stage.waves.length) { state.wave += 1; rest(state, 'wave'); return; }
  const clock = state.farmClock;
  if (clock) {
    const gapTicks = ticksForSeconds(CONFIG.sim.stageGapSec);
    state.phase = { kind: 'farmPad', settleAtTick: Math.max(state.tick + gapTicks, state.stageStartedTick + clock.minCycleTicks),
      nativeDurationTicks: clock.elapsedTicks + gapTicks, ...(state.combatRules === 'party-v2' ? { presentationStartedAtTick: state.tick } : {}) };
    return;
  }
  awardClear(state, (state.tick - state.stageStartedTick) / CONFIG.sim.ticksPerSecond + CONFIG.sim.stageGapSec);
  rest(state, 'encounter');
}
function inferredFailTick(state: GameState): number {
  const progress = state.progress;
  if (progress.kind !== 'FARMING') return state.tick;
  const backoff = CONFIG.progression.retryBackoff[Math.min(progress.failures - 1, CONFIG.progression.retryBackoff.length - 1)] ?? CONFIG.progression.retryIntervalSec;
  return progress.failTick ?? Math.min(state.tick, Math.max(0, progress.retryAtTick - ticksForSeconds(backoff)));
}
function powerRetry(state: GameState): void {
  const progress = state.progress;
  if (progress.kind === 'FARMING' && state.tick >= inferredFailTick(state) + CONFIG.progression.powerGainRetryMinSec * CONFIG.sim.ticksPerSecond
    && partyPower(state) >= progress.failedPower * (1 + CONFIG.progression.powerGainRetryPct)) retry(state, false);
}
export function input(state: GameState, action: Action): void {
  switch (action.type) {
    case 'retry': retry(state, true); return;
    case 'pull': pull(state); powerRetry(state); return;
    case 'autoEquip': autoEquip(state); powerRetry(state); return;
    case 'autoParty': autoParty(state, action.preset); powerRetry(state); return;
    case 'lockHero': togglePartyLock(state, action.heroId, action.locked); return;
    case 'upgrade': upgrade(state, action.gearId); powerRetry(state); return;
    case 'equip': equip(state, action.heroId, action.gearId); powerRetry(state); return;
    case 'party': setParty(state, action.heroIds); powerRetry(state); return;
    case 'chooseChest': chooseChest(state, action.keep); powerRetry(state); return;
    default: { const exhaustive: never = action; return exhaustive; }
  }
}
function encounterSubstep(state: GameState): void {
  if (state.phase.kind === 'rest') {
    state.phase.remainingTicks -= 1;
    if (state.phase.remainingTicks <= 0) spawnWave(state);
    return;
  }
  if (state.phase.kind !== 'battle') return;
  const elapsed = state.farmClock?.elapsedTicks ?? state.tick - state.stageStartedTick;
  if (elapsed >= ticksForSeconds(stageConfig(state.progress.stage).timeoutSec)) { lose(state); return; }
  combatTick(state);
  if (state.party.every(hero => hero.hp <= 0)) { if (state.combatRules === 'party-v2') cancelPartyEncounterEffects(state); lose(state); }
  else if (state.enemies.every(enemy => enemy.hp <= 0)) {
    if (state.combatRules === 'party-v2') expireFriendlyDeadTargetProjectiles(state);
    if (state.combatRules !== 'party-v2' || !hasPendingHostileImpact(state)) win(state);
  }
}
function tick(state: GameState): void {
  state.tick += 1;
  const progress = state.progress;
  if (progress.kind === 'FARMING' && state.tick >= progress.retryAtTick) retry(state, false);
  powerRetry(state);
  if (state.phase.kind === 'farmPad') {
    if (state.tick >= state.phase.settleAtTick) {
      const nativeSeconds = state.phase.nativeDurationTicks / CONFIG.sim.ticksPerSecond;
      awardClear(state, (state.tick - state.stageStartedTick) / CONFIG.sim.ticksPerSecond, nativeSeconds);
      powerRetry(state);
      // A power retry already started its push; do not spawn it twice.
      if (state.phase.kind === 'farmPad') beginEncounter(state);
    }
    return;
  }
  if (state.phase.kind === 'rest' && state.phase.next === 'encounter') {
    state.phase.remainingTicks -= 1;
    if (state.phase.remainingTicks <= 0) beginEncounter(state);
    return;
  }
  const farmScale = state.farmClock?.scale ?? 1;
  const readableBeat = state.combatRules === 'party-v2'
    && (state.phase.kind === 'battle' || (state.phase.kind === 'rest' && state.phase.next === 'wave'));
  const scale = readableBeat ? 1 : farmScale;
  for (let substep = 0; substep < scale; substep += 1) {
    if (state.farmClock) { state.farmClock.remainder = scale - substep - 1; state.farmClock.elapsedTicks += 1; }
    encounterSubstep(state);
    if (state.phase.kind !== 'battle' && !(state.phase.kind === 'rest' && state.phase.next === 'wave')) break;
  }
  powerRetry(state);
}
// Mutates only the provided JSON state; never reads a clock, DOM, asset or global RNG.
export function step(state: GameState, ticks = 1): GameState {
  if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > CONFIG.runtime.maxStepTicks) throw new Error(`Ticks must be an integer from 0 to ${CONFIG.runtime.maxStepTicks}`);
  for (let i = 0; i < ticks; i += 1) tick(state);
  return state;
}
export function snapshot(state: GameState): string { return JSON.stringify(parseState(state)); }
export function load(snapshotValue: unknown): GameState {
  const value: unknown = typeof snapshotValue === 'string' ? JSON.parse(snapshotValue) : snapshotValue;
  return cloneState(parseState(value));
}
export function bossSecondsRemaining(state: GameState): number | null {
  if (!isBoss(state.progress.stage) || (state.phase.kind === 'rest' && state.phase.next === 'encounter')) return null;
  return Math.max(0, Math.ceil(stageConfig(state.progress.stage).timeoutSec - (state.tick - state.stageStartedTick) / CONFIG.sim.ticksPerSecond));
}
export function statusText(state: GameState): string {
  const progress = state.progress;
  switch (progress.kind) {
    case 'PUSHING': return `Pushing ${stageName(progress.stage)}`;
    case 'BOSS_FIGHT': return `Boss ${stageName(progress.stage)}!`;
    case 'BOSS_READY': return `Boss ${stageName(progress.bossStage)} ${progress.bossLosses ? 'failed, tap to retry' : 'ready, click to fight'}`;
    case 'COMPLETE': return `Campaign clear · Farming ${stageName(progress.stage)}`;
    case 'FARMING': {
      const seconds = Math.max(0, Math.ceil((progress.retryAtTick - state.tick) / CONFIG.sim.ticksPerSecond));
      return `Farming ${stageName(progress.stage)}, next try in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
    default: { const exhaustive: never = progress; return exhaustive; }
  }
}
export function summary(state: GameState) {
  return { balanceVersion: state.balance, tick: state.tick, simulatedOpenSeconds: state.tick / CONFIG.sim.ticksPerSecond, seed: state.seed,
    stage: stageName(state.progress.stage), highestCleared: state.highestCleared ? stageName(state.highestCleared) : null,
    status: statusText(state), gold: state.gold, tickets: state.tickets, partyPower: partyPower(state),
    ownedHeroes: state.roster.length, inventory: state.inventory.length,
    party: state.partyIds.map(id => { const hero = state.roster.find(hero => hero.id === id); return { id, level: hero?.level, stars: hero?.stars }; }),
    progress: { ...state.progress }, stats: { ...state.stats }, metrics: structuredClone(state.metrics), totalEvents: state.eventSeq };
}
