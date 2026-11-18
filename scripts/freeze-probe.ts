/** Headless combat freeze probe. Reports stalls, timeouts, and synthetic stuck presentations. */
import { CONFIG, heroConfig, parseV14Flag, setSalvageRules, setV14Rules, stageConfig, ticksForSeconds } from '../src/config';
import { beginEncounter } from '../src/core/combat';
import { combatTime } from '../src/core/clock';
import { createState, step } from '../src/core/game';
import type { GameState, Unit } from '../src/core/model';
import { actionBoundaries, createActionTimeline, sampleActionPresentation } from '../src/core/turn/animation-timing';
import { LegendaryEffects } from '../src/legendary-effects';
import { triggerLegendaryEvent } from '../src/legendary-events';
import { presentationHitstop, PresentationLaneClock } from '../src/legendary-presentation';
import { referencePolicy, type PolicyCursor } from '../src/core/policy';

setV14Rules(parseV14Flag('all'));
setSalvageRules('design');

const TPS = CONFIG.sim.ticksPerSecond;
const STALL_SEC = 2.5;

function nowOf(state: GameState): number { return combatTime(state); }

function describeUnit(state: GameState, unit: Unit) {
  const now = nowOf(state);
  const action = unit.action;
  const special = unit.specialAction;
  let sample = 'none';
  if (action && action.state !== 'idle') {
    const delivery = action.delivery ?? (action.kind === 'heal' ? 'cast' : 'leap');
    const sampled = sampleActionPresentation(delivery, actionBoundaries(unit.sourceId, delivery, action), now);
    sample = `${sampled.phase}:${Math.floor(sampled.ageMs)}:${sampled.progress.toFixed(2)}`;
  }
  return {
    id: unit.id, source: unit.sourceId, hp: unit.hp, moving: !!unit.moving, gauge: unit.gauge ?? 0,
    action: action?.state ?? 'none',
    start: action && action.state !== 'idle' ? action.startTick : special?.startTick,
    impact: action && action.state !== 'idle' ? action.impactTick : special?.impactTick,
    ready: action && action.state !== 'idle' ? action.readyTick : undefined,
    special: special?.state, sample, now,
    overdue: action && action.state !== 'idle' && action.readyTick !== undefined && action.readyTick + 1 < now
      || special !== undefined && special.impactTick + ticksForSeconds(3) < now,
  };
}

function signature(state: GameState): string {
  return [...state.party, ...state.enemies].filter(unit => unit.hp > 0).map(unit => {
    const row = describeUnit(state, unit);
    return `${row.id}:${row.gauge}:${row.action}:${row.start}:${row.special}:${row.sample}:${row.moving}`;
  }).join('|');
}

interface Finding { seed: number; stage: number; wave: number; seconds: number; kind: string; rows: ReturnType<typeof describeUnit>[] }

function watch(state: GameState, ticks: number, seed: number): { findings: Finding[]; losses: number; clears: number; maxActionSec: number; maxChainSec: number; maxGaugeSec: number; maxMovingSec: number; timeouts: { stage: number; wave: number; boss: boolean; actionSec: number }[] } {
  let last = '';
  let stall = 0;
  let stallStart = 0;
  let gaugeStall = 0;
  let lastGauge = '';
  let moving = 0;
  let chain = 0;
  let maxAction = 0;
  let maxChain = 0;
  let maxGauge = 0;
  let maxMoving = 0;
  const actionStart = new Map<string, number>();
  const findings: Finding[] = [];
  const timeouts: { stage: number; wave: number; boss: boolean; actionSec: number }[] = [];
  for (let i = 0; i < ticks; i += 1) {
    const stage = state.progress.stage;
    const wave = state.wave;
    const boss = stageConfig(stage).isBoss;
    const before = state.stats.losses;
    step(state, 1);
    if (state.stats.losses > before) {
      const longest = Math.max(0, ...[...actionStart.values()].map(start => state.tick - start));
      timeouts.push({ stage, wave, boss, actionSec: longest / TPS });
    }
    const battle = state.phase.kind === 'battle' && state.enemies.some(unit => unit.hp > 0) && state.party.some(unit => unit.hp > 0);
    if (!battle) { stall = 0; gaugeStall = 0; moving = 0; chain = 0; actionStart.clear(); last = ''; lastGauge = ''; continue; }
    const rows = [...state.party, ...state.enemies].filter(unit => unit.hp > 0).map(unit => describeUnit(state, unit));
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.action === 'windup' || row.action === 'recovery' || row.special) {
        const key = `${row.id}:${row.action}:${row.start}:${row.special}`;
        seen.add(key);
        if (!actionStart.has(key)) actionStart.set(key, state.tick);
        maxAction = Math.max(maxAction, state.tick - (actionStart.get(key) ?? state.tick) + 1);
      }
    }
    for (const key of [...actionStart.keys()]) if (!seen.has(key)) actionStart.delete(key);
    const presenting = rows.some(row => row.action === 'windup' || row.action === 'recovery' || row.special);
    if (presenting) chain += 1; else chain = 0;
    maxChain = Math.max(maxChain, chain);
    if (rows.some(row => row.moving)) moving += 1; else moving = 0;
    maxMoving = Math.max(maxMoving, moving);
    const sig = signature(state);
    const gauges = rows.map(row => `${row.id}:${row.gauge}`).join('|');
    if (sig === last && (presenting || rows.some(row => row.moving))) {
      if (stall === 0) stallStart = state.tick;
      stall += 1;
      if (stall === ticksForSeconds(STALL_SEC) || (stall > ticksForSeconds(STALL_SEC) && stall % TPS === 0)) {
        findings.push({ seed, stage, wave, seconds: stall / TPS, kind: presenting ? 'stuck-presentation' : 'stuck-moving', rows });
      }
    } else stall = 0;
    if (gauges === lastGauge) { gaugeStall += 1; maxGauge = Math.max(maxGauge, gaugeStall); } else gaugeStall = 0;
    last = sig; lastGauge = gauges;
    void stallStart;
  }
  return { findings, losses: state.stats.losses, clears: state.stats.clears, maxActionSec: maxAction / TPS, maxChainSec: maxChain / TPS, maxGaugeSec: maxGauge / TPS, maxMovingSec: maxMoving / TPS, timeouts };
}

function fightStage(seed: number, stage: number, seconds: number, party?: string[]): ReturnType<typeof watch> & { endKind: string; endStage: number } {
  const state = createState(seed);
  if (party) {
    for (const id of party) if (!state.roster.some(hero => hero.id === id)) state.roster.push({ id, level: 1, xp: 0, stars: 1, equipment: { weapon: null, armor: null, charm: null } });
    state.partyIds = party;
  }
  state.highestCleared = Math.max(0, stage - 1);
  state.progress = { kind: 'PUSHING', stage };
  beginEncounter(state);
  const watched = watch(state, ticksForSeconds(seconds), seed);
  return { ...watched, endKind: state.progress.kind, endStage: state.progress.stage };
}

function lowFps(seed: number, fps: number, seconds: number) {
  const state = createState(seed);
  const clock = new PresentationLaneClock();
  const effects = new LegendaryEffects();
  let eventSeq = state.eventSeq;
  let wall = 0;
  const frameMs = 1000 / fps;
  const frames = Math.round(seconds * fps);
  let maxDebt = 0;
  let frozen = 0;
  let maxFrozen = 0;
  let resetsWhileFrozen = 0;
  let lastVisual = '';
  let lastGauge = '';
  for (let frame = 0; frame < frames; frame += 1) {
    wall += frameMs;
    const ticks = Math.max(1, Math.round(frameMs / (1000 / TPS)));
    const before = state.stats.losses;
    step(state, ticks);
    const loss = state.stats.losses > before;
    if (state.eventSeq > eventSeq) {
      for (const event of state.events) if (event.seq > eventSeq) triggerLegendaryEvent(event, state.party, state.enemies, value => effects.trigger(value.kind, wall, value.label, value));
      eventSeq = state.eventSeq;
    }
    const effect = effects.current(wall, false);
    const hit = effect?.layers.find(layer => layer.type === 'hitstop');
    const hold = Number(hit?.params.holdMs ?? 0), slow = Number(hit?.params.slowFactor ?? 1);
    const sample = clock.sample(nowOf(state), presentationHitstop(hit && effect ? { holdMs: hold, slowFactor: slow } : null, ticks, 1000 / TPS), effect?.age ?? 0, false, false, `${state.seed}:${state.encounter}`);
    maxDebt = Math.max(maxDebt, sample.debtTicks);
    const visual = [...state.party, ...state.enemies].map(unit => {
      const action = unit.action;
      if (!action || action.state === 'idle' || unit.hp <= 0) return `${unit.id}:idle`;
      const delivery = action.delivery ?? 'leap';
      const posed = sampleActionPresentation(delivery, actionBoundaries(unit.sourceId, delivery, action), sample.time);
      return `${unit.id}:${posed.phase}:${Math.floor(posed.ageMs)}:${posed.progress.toFixed(2)}`;
    }).join('|');
    const gauges = [...state.party, ...state.enemies].filter(unit => unit.hp > 0).map(unit => unit.gauge ?? 0).join(',');
    const battle = state.phase.kind === 'battle' && state.enemies.some(unit => unit.hp > 0);
    if (battle && visual === lastVisual && gauges === lastGauge) frozen += 1; else frozen = 0;
    maxFrozen = Math.max(maxFrozen, frozen);
    if (loss && frozen > Math.max(1, fps)) resetsWhileFrozen += 1;
    lastVisual = visual; lastGauge = gauges;
  }
  return { fps, maxDebtTicks: maxDebt, maxFrozenSec: maxFrozen / fps, resetsWhileFrozen, losses: state.stats.losses, clears: state.stats.clears };
}

function synthetic() {
  const cases: { name: string; stuckSec: number; outcome: string }[] = [];
  const run = (name: string, setup: (state: GameState) => void, ticks = ticksForSeconds(30)) => {
    const state = createState(9000 + cases.length);
    state.enemies.forEach(enemy => { enemy.moving = false; });
    setup(state);
    let stuck = 0; let maxStuck = 0; let last = signature(state);
    let resolved = false;
    for (let i = 0; i < ticks; i += 1) {
      const beforePhase = state.phase.kind;
      const beforeLoss = state.stats.losses;
      step(state, 1);
      const sig = signature(state);
      const busy = [...state.party, ...state.enemies].some(unit => unit.hp > 0 && (unit.action?.state === 'windup' || unit.action?.state === 'recovery' || unit.specialAction));
      if (sig === last && busy && state.phase.kind === 'battle') { stuck += 1; maxStuck = Math.max(maxStuck, stuck); } else stuck = 0;
      last = sig;
      if (state.stats.losses > beforeLoss || state.phase.kind !== beforePhase && state.phase.kind !== 'battle') { resolved = true; break; }
    }
    const busyLeft = [...state.party, ...state.enemies].filter(unit => unit.hp > 0 && (unit.action?.state === 'windup' || unit.action?.state === 'recovery' || unit.specialAction)).map(unit => describeUnit(state, unit));
    cases.push({ name, stuckSec: maxStuck / TPS, outcome: `${state.phase.kind} losses=${state.stats.losses} resolved=${resolved} busy=${JSON.stringify(busyLeft)}` });
  };

  run('dead-actor-mid-windup', state => {
    const hero = state.party[0]!, enemy = state.enemies[0]!;
    const timeline = createActionTimeline(hero.sourceId, 'leap', state.tick);
    hero.action = { state: 'windup', kind: 'attack', targetId: enemy.id, ...timeline, delivery: 'leap' };
    hero.hp = 0;
  });
  run('target-killed-before-impact', state => {
    const hero = state.party[0]!, enemy = state.enemies[0]!;
    const timeline = createActionTimeline(hero.sourceId, 'leap', nowOf(state));
    hero.action = { state: 'windup', kind: 'attack', targetId: enemy.id, targetSide: 'enemy', targetSlot: enemy.slot, ...timeline, delivery: 'leap' };
    enemy.hp = 0;
    state.enemies.slice(1).forEach(other => { other.hp = 0; });
  });
  run('windup-past-ready', state => {
    const hero = state.party[0]!, enemy = state.enemies[0]!;
    hero.action = { state: 'windup', kind: 'attack', targetId: enemy.id, targetSide: 'enemy', targetSlot: enemy.slot, startTick: 0, impactTick: 5, contactTick: 2, attackEndTick: 8, returnEndTick: 11, readyTick: 12, delivery: 'leap' };
    state.tick = 100;
  });
  run('recovery-ready-in-absolute-ticks-while-farm-clock', state => {
    state.progress = { kind: 'FARMING', stage: 1, failedStage: 2, retryAtTick: Number.MAX_SAFE_INTEGER, failTick: 0, failedPower: Number.MAX_SAFE_INTEGER, failures: 1 };
    state.highestCleared = 1;
    beginEncounter(state);
    const hero = state.party[0]!, enemy = state.enemies.find(unit => unit.hp > 0)!;
    enemy.moving = false;
    hero.action = { state: 'recovery', kind: 'attack', targetId: enemy.id, startTick: state.tick, impactTick: state.tick, contactTick: state.tick, attackEndTick: state.tick + 4, returnEndTick: state.tick + 8, readyTick: state.tick + ticksForSeconds(120), delivery: 'leap' };
  });
  run('enemy-special-never-due', state => {
    const enemy = state.enemies[0]!;
    enemy.sourceId = 'bomber'; enemy.moving = false;
    enemy.specialAction = { state: 'areaMark', targetId: state.party[0]!.id, centerX: state.party[0]!.x, radius: 48, startTick: nowOf(state), impactTick: nowOf(state) + ticksForSeconds(120), abilityId: 'bomber-blast' };
  });
  run('assassin-mark-target-removed', state => {
    const enemy = state.enemies[0]!;
    enemy.sourceId = 'assassin'; enemy.moving = false;
    enemy.specialAction = { state: 'assassinMark', targetId: 'missing-hero', startTick: nowOf(state), impactTick: nowOf(state) + 5 };
  });
  run('projectile-target-already-dead', state => {
    const enemy = state.enemies[0]!, hero = state.party[0]!;
    enemy.moving = false;
    state.projectiles = [{ id: 'stuck-arrow', sourceId: enemy.id, sourceSide: 'enemy', targetId: hero.id, targetSide: 'hero', abilityId: 'enemy-basic', delivery: 'homing', x: hero.x - 80, speed: 1, atk: 10, coefficient: 1, releasedAtTick: nowOf(state), impactNotBeforeTick: nowOf(state) + ticksForSeconds(30), expiresAtTick: nowOf(state) + ticksForSeconds(120) }];
    hero.hp = 0;
  });
  run('march-blocks-in-progress-windup', state => {
    const hero = state.party[0]!, enemy = state.enemies[0]!;
    const timeline = createActionTimeline(hero.sourceId, 'leap', nowOf(state));
    hero.action = { state: 'windup', kind: 'attack', targetId: enemy.id, targetSide: 'enemy', targetSlot: enemy.slot, ...timeline, delivery: 'leap' };
    enemy.moving = true; enemy.x = 2000;
  });
  run('unit-removed-while-busy', state => {
    const hero = state.party[0]!, enemy = state.enemies[0]!;
    const timeline = createActionTimeline(hero.sourceId, 'leap', nowOf(state));
    hero.action = { state: 'windup', kind: 'attack', targetId: enemy.id, ...timeline, delivery: 'leap' };
    state.party = state.party.filter(unit => unit !== hero);
  });
  run('legacy-dash-while-moving', state => {
    const enemy = state.enemies[0]!, hero = state.party[2] ?? state.party[0]!;
    enemy.sourceId = 'assassin'; enemy.moving = true; enemy.x = 900;
    enemy.specialAction = { state: 'assassinDash', targetId: hero.id, targetX: hero.x, startX: enemy.x, startTick: nowOf(state), impactTick: nowOf(state) + 4 };
  });
  return cases;
}

const stageSweep = [];
for (const stage of [1, 10, 12, 13, 20]) {
  for (const seed of [1, 2, 7]) {
    const party = stage >= 12 ? ['mw2', 'ew3', 'priest'] : undefined;
    const result = fightStage(seed, stage, stageConfig(stage).timeoutSec + 30, party);
    stageSweep.push({ seed, stage, findings: result.findings.length, first: result.findings[0], losses: result.losses, clears: result.clears, endKind: result.endKind, endStage: result.endStage, maxActionSec: result.maxActionSec, maxChainSec: result.maxChainSec, maxGaugeSec: result.maxGaugeSec, maxMovingSec: result.maxMovingSec, timeouts: result.timeouts });
    process.stderr.write(`stage ${stage} seed ${seed} findings ${result.findings.length} losses ${result.losses} clears ${result.clears} maxAction ${result.maxActionSec.toFixed(2)} gauge ${result.maxGaugeSec.toFixed(2)} moving ${result.maxMovingSec.toFixed(2)} timeouts ${result.timeouts.length}\n`);
  }
}

const natural = (() => {
  const state = createState(1);
  const cursor: PolicyCursor = { revision: -1 };
  const ticks = ticksForSeconds(20 * 60);
  let last = ''; let stall = 0; const findings: Finding[] = [];
  let maxAction = 0; const actionStart = new Map<string, number>();
  const timeouts: { stage: number; wave: number; boss: boolean }[] = [];
  for (let i = 0; i < ticks; i += 1) {
    referencePolicy(state, cursor);
    const stage = state.progress.stage; const wave = state.wave; const boss = stageConfig(stage).isBoss;
    const before = state.stats.losses;
    step(state, 1);
    if (state.stats.losses > before) timeouts.push({ stage, wave, boss });
    const battle = state.phase.kind === 'battle' && state.enemies.some(unit => unit.hp > 0);
    if (!battle) { stall = 0; actionStart.clear(); continue; }
    const rows = [...state.party, ...state.enemies].filter(unit => unit.hp > 0).map(unit => describeUnit(state, unit));
    const seen = new Set<string>();
    for (const row of rows) if (row.action === 'windup' || row.action === 'recovery' || row.special) {
      const key = `${row.id}:${row.start}:${row.special ?? ''}:${row.action}`;
      seen.add(key);
      if (!actionStart.has(key)) actionStart.set(key, state.tick);
      maxAction = Math.max(maxAction, state.tick - (actionStart.get(key) ?? state.tick) + 1);
    }
    for (const key of [...actionStart.keys()]) if (!seen.has(key)) actionStart.delete(key);
    const sig = signature(state);
    const presenting = rows.some(row => row.action === 'windup' || row.action === 'recovery' || row.special || row.moving);
    if (sig === last && presenting) {
      stall += 1;
      if (stall === ticksForSeconds(STALL_SEC)) findings.push({ seed: 1, stage, wave, seconds: stall / TPS, kind: 'natural', rows });
    } else stall = 0;
    last = sig;
  }
  return { findings: findings.length, sample: findings[0], losses: state.stats.losses, clears: state.stats.clears, stage: state.progress.stage, kind: state.progress.kind, maxActionSec: maxAction / TPS, timeouts: timeouts.slice(0, 12), timeoutCount: timeouts.length, bossTimeouts: timeouts.filter(row => row.boss).length };
})();

const fpsRows = [60, 10, 4, 1].map(fps => lowFps(1, fps, 60));
const legendaryFps = (() => {
  const state = createState(3);
  for (const id of ['ew3', 'mh3', 'mk2']) state.roster.push({ id, level: 10, xp: 0, stars: 3, equipment: { weapon: null, armor: null, charm: null } });
  state.partyIds = ['ew3', 'mh3', 'mk2'];
  state.progress = { kind: 'PUSHING', stage: 10 };
  state.highestCleared = 9;
  beginEncounter(state);
  const clock = new PresentationLaneClock();
  const effects = new LegendaryEffects();
  let eventSeq = state.eventSeq;
  let wall = 0;
  let maxDebt = 0;
  let frozen = 0;
  let maxFrozen = 0;
  let last = '';
  const fps = 4;
  for (let frame = 0; frame < 60 * fps; frame += 1) {
    wall += 1000 / fps;
    step(state, Math.round((1000 / fps) / (1000 / TPS)));
    if (state.eventSeq > eventSeq) {
      for (const event of state.events) if (event.seq > eventSeq) triggerLegendaryEvent(event, state.party, state.enemies, value => effects.trigger(value.kind, wall, value.label, value));
      eventSeq = state.eventSeq;
    }
    const effect = effects.current(wall, false);
    const hit = effect?.layers.find(layer => layer.type === 'hitstop');
    const hold = Number(hit?.params.holdMs ?? 0), slow = Number(hit?.params.slowFactor ?? 1);
    const jump = Math.round((1000 / fps) / (1000 / TPS));
    const sample = clock.sample(nowOf(state), presentationHitstop(hit && effect ? { holdMs: hold, slowFactor: slow } : null, jump, 1000 / TPS), effect?.age ?? 0, false, false, `${state.seed}:${state.encounter}`);
    maxDebt = Math.max(maxDebt, sample.debtTicks);
    const visual = `${sample.time.toFixed(2)}:${sample.rate}:${state.party.map(unit => unit.action?.state).join(',')}`;
    if (visual === last && state.phase.kind === 'battle') frozen += 1; else frozen = 0;
    maxFrozen = Math.max(maxFrozen, frozen);
    last = visual;
  }
  return { maxDebt, maxFrozenSec: maxFrozen / fps, losses: state.stats.losses, clears: state.stats.clears, rarity: state.party.map(unit => heroConfig(unit.sourceId).rarity) };
})();

process.stdout.write(JSON.stringify({ stallSec: STALL_SEC, stageSweep, natural, synthetic: synthetic(), fpsRows, legendaryFps }, null, 2) + '\n');
