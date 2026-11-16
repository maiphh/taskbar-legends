import { CONFIG, heroConfig } from '../config';
import { heroStats, getOwned } from './economy';
import type { GameState } from './model';
import { getPartyEnemyDefinition, partyWaveKinds } from './party-enemies';
import { getPartyHeroDefinitions } from './party-definitions';

export interface FarmHeroProof { id: string; maxHp: number; atk: number; def: number; attackTicks: number }
export interface EncounterFarmContext {
  encounter: number; stage: number; startedTick: number; rulesSignature: string; heroes: FarmHeroProof[];
}
export interface StageFarmProof {
  stage: number; rulesSignature: string; heroes: FarmHeroProof[]; nativeSeconds: number[]; wallSeconds: number[];
}
export interface OfflineFarmContext {
  stage: number; nativeSeconds: number; wallSeconds: number; earned: boolean;
  reason: 'no-earned-clear' | 'formation-or-combat-changed' | null;
}

// Bump when targeting, movement, gauge, timing, or resolver semantics change outside the fingerprinted data below.
const PARTY_FARM_RESOLVER_REVISION = 'party-v2-farm-proof-resolver-1';
const enemyIds = ['grunt', 'archer', 'brute', 'boss_ch1', 'boss_ch2', 'assassin', 'bomber'] as const;
function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
export function currentFarmRulesSignature(): string {
  const waves = CONFIG.stages.map(value => ({ stage: value.index, isBoss: value.isBoss, waves: value.waves.map((wave, index) => {
    const original = 'enemies' in wave ? wave.enemies : [wave.boss, ...wave.adds];
    return partyWaveKinds(value.index, index + 1, original, value.isBoss);
  }) }));
  const fingerprint = { revision: PARTY_FARM_RESOLVER_REVISION, version: CONFIG.version, combat: CONFIG.combat, sim: CONFIG.sim,
    enemies: CONFIG.enemies, waves, party: getPartyHeroDefinitions(), enemySpecials: enemyIds.map(id => getPartyEnemyDefinition(id)) };
  return `${PARTY_FARM_RESOLVER_REVISION}-${stableHash(JSON.stringify(fingerprint))}`;
}
export const PARTY_FARM_RULES_SIGNATURE = currentFarmRulesSignature();

function proofStats(id: string, stats: Pick<ReturnType<typeof heroStats>, 'maxHp' | 'atk' | 'def' | 'attackTicks'>): FarmHeroProof {
  return { id, maxHp: stats.maxHp, atk: stats.atk, def: stats.def, attackTicks: stats.attackTicks };
}

/** Capture the freshly spawned permanent formation, before encounter damage or temporary effects can alter it. */
export function captureEncounterFarmContext(state: GameState): EncounterFarmContext {
  if (state.party.length !== CONFIG.sim.partySize) throw new Error('Cannot capture a farm proof without the spawned party');
  return { encounter: state.encounter, stage: state.progress.stage, startedTick: state.stageStartedTick, rulesSignature: currentFarmRulesSignature(),
    heroes: [...state.party].sort((a, b) => a.slot - b.slot).map(unit => proofStats(unit.sourceId, unit)) };
}

function sameStartingFormation(a: StageFarmProof, b: EncounterFarmContext): boolean {
  return a.rulesSignature === b.rulesSignature && JSON.stringify(a.heroes) === JSON.stringify(b.heroes);
}

/** Record only from the matching actual encounter when the game has settled a full successful clear. */
export function recordSettledFarmClear(state: GameState, stage: number, wallSeconds: number, nativeSeconds: number): boolean {
  const context = state.encounterFarmContext;
  if (!context || context.encounter !== state.encounter || context.stage !== stage || context.startedTick !== state.stageStartedTick
    || context.rulesSignature !== currentFarmRulesSignature() || !Number.isFinite(wallSeconds) || wallSeconds <= 0
    || !Number.isFinite(nativeSeconds) || nativeSeconds <= 0) return false;
  const proofs = [...(state.farmProofs ?? [])], existing = proofs.find(value => value.stage === stage);
  if (existing && sameStartingFormation(existing, context)) {
    existing.wallSeconds.push(wallSeconds); existing.nativeSeconds.push(nativeSeconds);
    if (existing.wallSeconds.length > CONFIG.idle.avgFarmClearSecWindow) { existing.wallSeconds.shift(); existing.nativeSeconds.shift(); }
  } else {
    const replacement: StageFarmProof = { stage, rulesSignature: context.rulesSignature, heroes: structuredClone(context.heroes),
      nativeSeconds: [nativeSeconds], wallSeconds: [wallSeconds] };
    const index = proofs.findIndex(value => value.stage === stage);
    if (index < 0) proofs.push(replacement); else proofs[index] = replacement;
  }
  state.farmProofs = proofs.sort((a, b) => a.stage - b.stage);
  delete state.encounterFarmContext;
  return true;
}

function compatible(proof: StageFarmProof, state: GameState, signature: string): boolean {
  if (proof.rulesSignature !== signature || proof.heroes.length !== state.partyIds.length) return false;
  for (let index = 0; index < state.partyIds.length; index += 1) {
    const id = state.partyIds[index], stored = proof.heroes[index];
    if (!id || !stored || id !== stored.id) return false;
    const stats = heroStats(state, getOwned(state, id));
    if (stats.maxHp < stored.maxHp || stats.atk < stored.atk || stats.def < stored.def || stats.attackTicks > stored.attackTicks) return false;
  }
  return true;
}

/** Select the highest actually earned compatible proof; old clear metrics are reporting-only, never authority. */
export function offlineFarmContext(state: GameState): OfflineFarmContext {
  const ceiling = Math.max(1, state.highestCleared);
  const signature = currentFarmRulesSignature();
  const proofs = [...(state.farmProofs ?? [])].filter(proof => proof.stage <= ceiling).sort((a, b) => b.stage - a.stage);
  const found = proofs.find(proof => compatible(proof, state, signature));
  if (found) {
    const nativeSeconds = found.nativeSeconds.reduce((sum, value) => sum + value, 0) / found.nativeSeconds.length;
    const wallSeconds = found.wallSeconds.reduce((sum, value) => sum + value, 0) / found.wallSeconds.length;
    if (Number.isFinite(nativeSeconds) && nativeSeconds > 0 && Number.isFinite(wallSeconds) && wallSeconds > 0)
      return { stage: found.stage, nativeSeconds, wallSeconds, earned: true, reason: null };
  }
  const reason = (state.farmProofs ?? []).length ? 'formation-or-combat-changed' : 'no-earned-clear';
  return { stage: 1, nativeSeconds: CONFIG.idle.avgFarmClearSecDefault, wallSeconds: CONFIG.idle.avgFarmClearSecDefault, earned: false, reason };
}

/** Only used in tests/reports to validate ids while old signatures remain valid-but-incompatible data. */
export function isKnownFarmHero(id: string): boolean { return CONFIG.heroes.some(hero => hero.id === id) && !!heroConfig(id); }
