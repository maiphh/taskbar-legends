// v1.4 target report (design.md §15.1 / §17) for the reference player with v14 rules switched on.
//   npx tsx scripts/v14-targets.ts [--rules all|none|a,b,…] [--seeds 25] [--days 9] [--salvage on|off] [--slot-relative file|on|off] [--legendary-floor file|on|off] [--out shots/v14-targets.json]
// Each seed runs in a worker process. The instrumented policy mirrors referencePolicy action-for-action; every seed's final
// state is checked against runReference() with the same rules, so the decision log describes the real reference run.
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { CONFIG, V14_DESIGN, activeSalvageRules, activeV14Rules, heroConfig, setSalvageRules, setV14Rules, ticksForSeconds, v14RuleSchema } from '../src/config';
import type { V14Rule } from '../src/config';
import { autoEquip, autoParty, bestChoice, cheapestEquippedUpgrade, chooseChest, getOwned, partyPower, pull, upgrade, upgradeCost } from '../src/core/economy';
import { createState, input, snapshot, step } from '../src/core/game';
import { cloneState } from '../src/core/model';
import type { GameState } from '../src/core/model';
import { farmClearInTarget, gachaCohort, runReference } from '../src/core/policy';
import { applyOffline } from '../src/core/save';
import { distribution } from '../src/core/statistics';

const { values } = parseArgs({ options: { rules: { type: 'string', default: 'all' }, seeds: { type: 'string', default: '25' }, days: { type: 'string', default: '9' },
  worker: { type: 'string' }, out: { type: 'string', default: 'shots/v14-targets.json' }, 'gacha-seeds': { type: 'string', default: '10000' }, salvage: { type: 'string', default: 'on' }, 'slot-relative': { type: 'string', default: 'file' }, 'legendary-floor': { type: 'string', default: 'file' } } });
const rules = (values.rules === 'none' ? [] : values.rules === 'all' ? [...v14RuleSchema.options] : (values.rules ?? '').split(',').filter(Boolean)).map(rule => v14RuleSchema.parse(rule)) satisfies V14Rule[];
const days = Number(values.days), SESSION = CONFIG.referencePlayer.openHoursPerDay * 3600, HOUR_TICKS = 3600 * CONFIG.sim.ticksPerSecond;
setV14Rules(rules);
setSalvageRules(values.salvage === 'off' ? 'default' : 'design');
// 1.4.5 ships gear.salvage.slotRelative and §21 legendaryFloor on; 'file' keeps the file's value, on/off override it on top of the salvage block.
for (const [flag, key] of [['slot-relative', 'slotRelative'], ['legendary-floor', 'legendaryFloor']] as const) {
  const value = values[flag];
  if (value === 'on' || value === 'off') setSalvageRules({ ...activeSalvageRules(), [key]: value === 'on' });
}

type Decision = [day: number, seconds: number, types: string[]];
const equipped = (state: GameState): Set<string> => new Set(state.partyIds.flatMap(id => Object.values(getOwned(state, id).equipment)).filter((id): id is NonNullable<typeof id> => id !== null));
function runSeed(seed: number) {
  const state = createState(seed), decisions: Decision[] = [], forks: { day: number; hour: number; types: string[]; offlineChests: number }[] = [];
  let revision = -1, upgradeAcc = 0;
  // Mirrors referencePolicy exactly, recording the §15.1 meaningful decisions plus chest choices (CR-14-08).
  const policy = (): string[] => {
    const types: string[] = [];
    if (revision !== state.economyRevision) {
      let choices = 0;
      while (state.pendingChoice?.length) { chooseChest(state, bestChoice(state.pendingChoice[0])); choices += 1; }
      const roster0 = state.roster.length; let pulls = 0;
      while (state.tickets >= CONFIG.gacha.costTickets) { pull(state); pulls += 1; }
      autoParty(state);
      const p1 = partyPower(state), eq0 = equipped(state);
      autoEquip(state);
      const p2 = partyPower(state), eq1 = equipped(state);
      for (;;) { const item = cheapestEquippedUpgrade(state); if (!item || upgradeCost(item) > state.gold) break; upgrade(state, item.id); }
      const p3 = partyPower(state);
      if (choices) types.push('chestChoice');
      if (pulls) types.push(state.roster.length > roster0 ? 'recruitNew' : 'recruitDupe');
      if ([...eq1].some(id => !eq0.has(id)) && p1 && (p2 - p1) / p1 >= 0.01) types.push('gear');
      if (p2) upgradeAcc += (p3 - p2) / p2;
      if (upgradeAcc >= 0.03) { types.push('upgrade'); upgradeAcc = 0; }
      revision = state.economyRevision;
    }
    const progress = state.progress;
    if (progress.kind === 'BOSS_READY' && (progress.bossLosses === 0 || partyPower(state) >= progress.failedPower * (1 + CONFIG.progression.powerGainRetryPct))) { input(state, { type: 'retry' }); types.push('boss'); }
    return types;
  };
  // T10: fork, apply 1 h offline, ask what the reference player could now do (no state leaks back).
  const returnCheck = (day: number, hour: number): void => {
    const fork = cloneState(state), offline = applyOffline(fork, 3600 * 1000), types: string[] = [];
    if (fork.pendingChoice?.length) types.push('chestChoice');
    while (fork.pendingChoice?.length) chooseChest(fork, bestChoice(fork.pendingChoice[0]));
    if (fork.tickets >= CONFIG.gacha.costTickets) types.push('recruit');
    autoParty(fork); const a = partyPower(fork), eq0 = equipped(fork); autoEquip(fork); const b = partyPower(fork);
    if ([...equipped(fork)].some(id => !eq0.has(id)) && a && (b - a) / a >= 0.01) types.push('gear');
    for (;;) { const item = cheapestEquippedUpgrade(fork); if (!item || upgradeCost(item) > fork.gold) break; upgrade(fork, item.id); }
    const d = partyPower(fork); if (b && (d - b) / b >= 0.03) types.push('upgrade');
    const progress = fork.progress; if (progress.kind === 'BOSS_READY' && (progress.bossLosses === 0 || d >= progress.failedPower * (1 + CONFIG.progression.powerGainRetryPct))) types.push('boss');
    forks.push({ day, hour, types, offlineChests: offline.chests });
  };
  // T8 observers. One gear roll per chest: a pick-1-of-2 chest counts once (Fortune units), Legendary if either option was.
  const pullsRarity: string[] = [], pullsDupe: boolean[] = [], gearRarity: string[] = [], gearIndex = new Map<string, number>();
  // Overflow salvage by slot × rarity (salvage events exist only with protection on). Age = online ticks since the item's gear event;
  // offline time does not advance ticks, so an item that arrived offline and left in the same return has age 0.
  const arrivedTick = new Map<string, number>(), salvaged: Record<string, Record<string, { total: number; incoming: number; within10Min: number }>> = {};
  let lostEvents = 0; const choiceLoser: Record<string, number> = {};
  let seen = state.eventSeq, rosterDay: number | null = null, onlineChests = 0, offlineChests = 0, onlineOpenSeconds = 0, offlineSeconds = 0;
  let dry = 0, maxDry = 0, farmChestsHigh = 0, farmClearsHigh = 0;
  const scan = (): void => {
    for (const event of state.events) {
      if (event.seq <= seen) continue; if (event.seq > seen + 1) lostEvents += event.seq - seen - 1; seen = event.seq; const data = event.data;
      if (data.type === 'gear') arrivedTick.set(data.gearId, event.tick);
      if (data.type === 'salvage') {
        const age = event.tick - (arrivedTick.get(data.gearId) ?? event.tick), cell = ((salvaged[data.slot] ??= {})[data.rarity] ??= { total: 0, incoming: 0, within10Min: 0 });
        cell.total += 1; if (data.reason === 'incoming') cell.incoming += 1; if (age <= 600 * CONFIG.sim.ticksPerSecond) cell.within10Min += 1;
        arrivedTick.delete(data.gearId);
      }
      if (data.type === 'pull' && state.metrics.fullRosterTick === null) { pullsRarity.push(data.rarity); pullsDupe.push(data.duplicate); }
      if (data.type === 'gear') { gearIndex.set(data.gearId, gearRarity.length); gearRarity.push(data.rarity); }
      if (data.type === 'chestChoice' && data.rarities) { const lost = data.rarities[data.options[0] === data.kept ? 1 : 0]; choiceLoser[lost] = (choiceLoser[lost] ?? 0) + 1; }
      if (data.type === 'chestChoice' && data.rarities) { const index = gearIndex.get(data.kept); if (index !== undefined) gearRarity[index] = data.rarities.includes('legendary') ? 'legendary' : data.rarities[0]; }
    }
  };
  // T8 offline rate in roll units: an Expedition Chest is rollUnits.expeditionChest (4), a 1.3.0 offline chest 1.
  const offlineUnits = activeV14Rules().includes('expeditionChests') ? V14_DESIGN.gearPity.rollUnits.expeditionChest : 1;
  const milestones: Record<string, number> = {};
  for (let day = 1; day <= days; day += 1) {
    if (day > 1) { const away = applyOffline(state, (24 * 3600 - SESSION) * 1000); offlineChests += away.chests * offlineUnits; offlineSeconds += away.seconds; scan(); }
    const sessionChests = state.stats.chests;
    const start = state.tick, end = start + SESSION * CONFIG.sim.ticksPerSecond;
    while (state.tick < end) {
      const types = policy(); scan(); if (types.length) decisions.push([day, (state.tick - start) / CONFIG.sim.ticksPerSecond, types]);
      const clears = state.metrics.farmSamples, chests = state.stats.chests, stage = state.progress.stage;
      step(state); scan();
      if (state.metrics.farmSamples > clears && stage >= 10) {
        farmClearsHigh += 1; dry += 1;
        // A first clear can't change farmSamples, so a chest counted here came from the farm clear.
        if (state.stats.chests > chests) { farmChestsHigh += 1; dry = 0; } else maxDry = Math.max(maxDry, dry);
      }
      if ((state.tick - start) % HOUR_TICKS === 0) returnCheck(day, (state.tick - start) / HOUR_TICKS);
      if (state.metrics.fullRosterTick !== null) rosterDay ??= day;
      for (const key of Object.keys(state.metrics.firstClearTicks)) milestones[key] ??= day;
    }
    onlineOpenSeconds += SESSION; onlineChests += state.stats.chests - sessionChests;
    policy(); scan();
  }
  const reference = runReference(seed, days);
  if (snapshot(reference.state) !== snapshot(state)) throw new Error(`Instrumented policy diverged from referencePolicy on seed ${seed}`);
  // Longest run of pulls without a Legendary / of duplicates before the roster completed.
  let window = 0, maxNoLegendary = 0, streak = 0, maxDupes = 0;
  pullsRarity.forEach((rarity, index) => { window = rarity === 'legendary' ? 0 : window + 1; maxNoLegendary = Math.max(maxNoLegendary, window); streak = pullsDupe[index] ? streak + 1 : 0; maxDupes = Math.max(maxDupes, streak); });
  const legendaryRolls = gearRarity.flatMap((rarity, index) => rarity === 'legendary' ? [index + 1] : []);
  const gaps = legendaryRolls.slice(1).map((roll, index) => roll - (legendaryRolls[index] ?? 0));
  const boss1 = state.metrics.firstClearTicks['10'], first5 = state.metrics.firstClearTicks['5'];
  const starter = createState(seed); step(starter, ticksForSeconds(3600));
  const pendingStalls = Object.entries(state.metrics.firstAttemptTicks)
    .filter(([stage]) => !state.metrics.firstClearTicks[stage] && !CONFIG.stages[Number(stage) - 1]?.isBoss)
    .map(([, tick]) => (state.tick - tick) / CONFIG.sim.ticksPerSecond);
  return { seed, firstFiveOpenSeconds: first5 === undefined ? null : first5 / CONFIG.sim.ticksPerSecond,
    bossOneOpenHours: boss1 === undefined ? null : boss1 / CONFIG.sim.ticksPerSecond / 3600, bossTwoDay: milestones['20'] ?? null, rosterDay,
    starterHighestCleared: starter.highestCleared, farmMinSeconds: state.metrics.farmMinSeconds, farmMaxSeconds: state.metrics.farmMaxSeconds,
    farmSamples: state.metrics.farmSamples, maxNonBossStallSeconds: Math.max(state.metrics.maxNonBossStallSeconds, ...pendingStalls),
    decisions, forks, t8: { maxPullsWithoutLegendary: maxNoLegendary, maxDuplicateStreak: maxDupes, firstLegendaryGearRoll: legendaryRolls[0] ?? null,
      maxLegendaryGearGap: gaps.length ? Math.max(...gaps) : null, gearRolls: gearRarity.length,
      onlineChestsPerHour: onlineChests / (onlineOpenSeconds / 3600), offlineRollUnitsPerHour: offlineSeconds ? offlineChests / (offlineSeconds / 3600) : 0 },
    farmChest: { clearsAtStage10Plus: farmClearsHigh, chests: farmChestsHigh, maxDryRun: maxDry, meanInterval: farmChestsHigh ? farmClearsHigh / farmChestsHigh : null },
    salvageEquippedRemoved: state.metrics.salvageEquippedRemoved ?? 0,
    salvageBySlot: salvaged, salvageLostEvents: lostEvents, choiceLoserByRarity: choiceLoser,
    bagLegendary: state.inventory.filter(item => item.rarity === 'legendary').length, equippedCount: state.roster.reduce((n, hero) => n + Object.values(hero.equipment).filter(id => id !== null).length, 0),
    bagBySlot: Object.fromEntries(['weapon', 'armor', 'charm'].map(slot => [slot, state.inventory.filter(item => item.slot === slot).length])),
    partyRoles: state.partyIds.map(id => heroConfig(id).role) };
}
type SeedResult = ReturnType<typeof runSeed>;
if (values.worker !== undefined) { process.stdout.write(JSON.stringify(runSeed(Number(values.worker)))); process.exit(0); }

const seeds = Array.from({ length: Number(values.seeds) }, (_, index) => index + 1);
const worker = (seed: number): Promise<SeedResult> => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1] ?? '', '--worker', String(seed), '--rules', values.rules ?? 'none', '--days', String(days), '--salvage', values.salvage ?? 'on', '--slot-relative', values['slot-relative'] ?? 'file', '--legendary-floor', values['legendary-floor'] ?? 'file'], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = ''; child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); });
  child.on('exit', code => { if (code === 0) resolve(JSON.parse(out) as SeedResult); else reject(new Error(`seed ${seed} exited ${code}`)); });
});
const results: SeedResult[] = []; const queue = [...seeds];
await Promise.all(Array.from({ length: Math.min(availableParallelism(), seeds.length) }, async () => {
  for (let seed = queue.shift(); seed !== undefined; seed = queue.shift()) { results.push(await worker(seed)); process.stderr.write(`v14 targets: ${results.length}/${seeds.length}\n`); }
}));
results.sort((a, b) => a.seed - b.seed);

// §15.1 / dec_report.py: decisions within 5 s merge; session start and end bound the first/last gap; a gap belongs to the phase it starts in.
const MERGE_SECONDS = 5;
const phase = (day: number, seconds: number): string => day === 1 ? (seconds < 3600 ? 'd1 h0-1' : seconds < 7200 ? 'd1 h1-2' : 'd1 h2-6') : day <= 5 ? 'd2-5' : 'd6-9';
const gaps: Record<string, number[]> = {};
for (const result of results) for (let day = 1; day <= days; day += 1) {
  const times = result.decisions.filter(([d]) => d === day).map(([, t]) => t).sort((a, b) => a - b), merged: number[] = [];
  for (const time of times) if (!merged.length || time - (merged.at(-1) ?? 0) > MERGE_SECONDS) merged.push(time);
  const points = [0, ...merged, SESSION];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] ?? 0, gap = (points[index] ?? 0) - from; if (gap <= 0) continue;
    for (const key of [phase(day, from), ...(day === 1 && from < 7200 ? ['d1 h0-2'] : [])]) (gaps[key] ??= []).push(gap / 60);
  }
}
const round = (value: number | null, digits = 2): number | null => value === null ? null : Number(value.toFixed(digits));
const dist = (list: readonly (number | null)[], digits = 2) => { const d = distribution(list); return { p10: round(d.p10, digits), median: round(d.median, digits), p90: round(d.p90, digits), n: d.count, censored: d.censored }; };
const t9Phases = ['d1 h0-2', 'd2-5', 'd6-9', 'd1 h2-6'];
const t9 = Object.fromEntries(['d1 h0-1', 'd1 h1-2', ...t9Phases].map(key => [key, dist(gaps[key] ?? [])]));
const t9Pass = t9Phases.every(key => { const d = t9[key]; return d !== undefined && d.median !== null && d.p90 !== null && d.median <= 3 && d.p90 <= 5; });
const forkOk = (list: SeedResult['forks']) => list.filter(fork => fork.types.length > 0).length / Math.max(1, list.length);
const allForks = results.flatMap(result => result.forks);
const t10 = { fraction: round(forkOk(allForks), 4), forks: allForks.length, perSeedFraction: dist(results.map(result => forkOk(result.forks)), 3),
  byPhase: { d1: round(forkOk(allForks.filter(f => f.day === 1)), 3), 'd2-5': round(forkOk(allForks.filter(f => f.day > 1 && f.day <= 5)), 3), 'd6-9': round(forkOk(allForks.filter(f => f.day > 5)), 3) },
  decisionTypes: allForks.flatMap(fork => fork.types).reduce<Record<string, number>>((count, type) => ({ ...count, [type]: (count[type] ?? 0) + 1 }), {}) };
const t2 = dist(results.map(result => result.bossOneOpenHours), 3);
const roster = dist(results.map(result => result.rosterDay), 1), cohort = gachaCohort(Number(values['gacha-seeds']));
const t8 = {
  maxPullsWithoutLegendary: dist(results.map(r => r.t8.maxPullsWithoutLegendary), 0), maxDuplicateStreak: dist(results.map(r => r.t8.maxDuplicateStreak), 0),
  firstLegendaryGearRoll: dist(results.map(r => r.t8.firstLegendaryGearRoll), 0), maxLegendaryGearGap: dist(results.map(r => r.t8.maxLegendaryGearGap), 0),
  offlineVsOnlineRollRate: dist(results.map(r => r.t8.offlineRollUnitsPerHour / r.t8.onlineChestsPerHour), 3),
};
const t8Checks = { recruit60: results.every(r => r.t8.maxPullsWithoutLegendary < 60), dupes20: results.every(r => r.t8.maxDuplicateStreak < 20),
  gearFirst40: results.every(r => r.t8.firstLegendaryGearRoll !== null && r.t8.firstLegendaryGearRoll <= 40), gearGap100: results.every(r => (r.t8.maxLegendaryGearGap ?? 0) <= 100),
  offline50pct: results.every(r => r.t8.offlineRollUnitsPerHour >= 0.5 * r.t8.onlineChestsPerHour), goblin300: null };
const farm = results.reduce((sum, r) => ({ clears: sum.clears + r.farmChest.clearsAtStage10Plus, chests: sum.chests + r.farmChest.chests, maxDry: Math.max(sum.maxDry, r.farmChest.maxDryRun) }), { clears: 0, chests: 0, maxDry: 0 });
const report = {
  rules: activeV14Rules(), salvage: activeSalvageRules(), v14: CONFIG.v14, seeds: seeds.length, days, policy: 'referencePolicy (instrumented mirror, final state checked equal on every seed)',
  quantiles: 'R-7 linear; censored (unreached) values rank last', decisionMergeSeconds: MERGE_SECONDS,
  targets: {
    T1: { target: 'At least 95% clear 1-5 within 600 open seconds', unit: 'open seconds', ...dist(results.map(r => r.firstFiveOpenSeconds), 1),
      clearedWithin600: results.filter(r => r.firstFiveOpenSeconds !== null && r.firstFiveOpenSeconds <= 600).length,
      fractionWithin600: round(results.filter(r => r.firstFiveOpenSeconds !== null && r.firstFiveOpenSeconds <= 600).length / results.length, 4),
      pass: results.filter(r => r.firstFiveOpenSeconds !== null && r.firstFiveOpenSeconds <= 600).length / results.length >= 0.95 },
    T2: { target: 'boss1 median 1.5–2.5 open h, p90 ≤ 4', unit: 'open hours', ...t2, pass: t2.median !== null && t2.median >= 1.5 && t2.median <= 2.5 && t2.p90 !== null && t2.p90 <= 4 },
    T3: { target: 'Median chapter 2 boss clear day 4–6', unit: 'day', ...dist(results.map(r => r.bossTwoDay), 1),
      byDay9: results.filter(r => r.bossTwoDay !== null && r.bossTwoDay <= 9).length,
      pass: (() => { const d = dist(results.map(r => r.bossTwoDay), 1); return d.median !== null && d.median >= 4 && d.median <= 6; })() },
    T4: { T4a: { target: 'median pulls to full roster 70–90 (10k cohort; v1.3 band 100–140)', p10: cohort.pullDistribution.p10, median: cohort.medianPullsToFullRoster, p90: cohort.pullDistribution.p90,
        passV14Band: cohort.medianPullsToFullRoster >= 70 && cohort.medianPullsToFullRoster <= 90, passV13Band: cohort.medianPullsToFullRoster >= 100 && cohort.medianPullsToFullRoster <= 140 },
      T4b: { target: 'roster median day 6–8, ≥ 80% by day 8', unit: 'day', ...roster, byDay8: results.filter(r => r.rosterDay !== null && r.rosterDay <= 8).length,
        pass: roster.median !== null && roster.median >= 6 && roster.median <= 8 && results.filter(r => r.rosterDay !== null && r.rosterDay <= 8).length >= Math.ceil(results.length * 0.8) } },
    T5: { target: 'Every no-input starter seed remains below 1-8 after 1 open hour', unit: 'highest cleared stage index',
      ...dist(results.map(r => r.starterHighestCleared), 0),
      violatingSeeds: results.filter(r => r.starterHighestCleared >= 8).map(r => r.seed),
      pass: results.every(r => r.starterHighestCleared < 8) },
    T6: { target: 'Every farm clear takes 20–40 seconds (1-tick / 0.05 s epsilon)', unit: 'seconds',
      minimumPerSeed: dist(results.map(r => r.farmMinSeconds), 2), maximumPerSeed: dist(results.map(r => r.farmMaxSeconds), 2),
      samples: results.reduce((sum, r) => sum + r.farmSamples, 0),
      violatingSeeds: results.filter(r => farmClearInTarget(r.farmMinSeconds, r.farmMaxSeconds) === false).map(r => ({ seed: r.seed, farmMinSeconds: r.farmMinSeconds, farmMaxSeconds: r.farmMaxSeconds })),
      pass: results.some(r => farmClearInTarget(r.farmMinSeconds, r.farmMaxSeconds) === false) ? false
        : results.some(r => r.farmSamples === 0) ? null : true },
    T7: { target: 'Every non-boss clears within 2700 open seconds of first attempt', unit: 'open seconds',
      ...dist(results.map(r => r.maxNonBossStallSeconds), 2),
      pass: results.every(r => r.maxNonBossStallSeconds <= 2700) },
    T8: { target: 'luck bounds: no 60-pull window without Legendary, no 20 dupes in a row (pre-roster); first Legendary gear by roll 40, then ≤ 100-roll gaps; goblin ≤ 300 clears; offline roll units ≥ 50% of online chest rate',
      ...t8, checks: t8Checks, pass: Object.values(t8Checks).every(value => value !== false) && t8Checks.goblin300 !== null, note: 'Recruit pity (CR-14-01/02) and gear Fortune (CR-14-03) are guaranteed when their rules are on; offline50pct counts Expedition Chests × 4 roll units (CR-14-04); overall T8 cannot pass yet: goblin (CR-14-06) is not implemented, so goblin300 is unmeasured.' },
    T9: { target: 'median gap ≤ 3 min and p90 ≤ 5 min in every phase (d1 h0–2, h2–6, d2–5, d6–9)', unit: 'minutes', phases: t9, pass: t9Pass },
    T10: { target: '≥ 95% of 1 h absences offer a meaningful decision on return', ...t10, pass: (t10.fraction ?? 0) >= 0.95 },
  },
  farmChest: { ...farm, meanInterval: farm.chests ? round(farm.clears / farm.chests, 3) : null },
  salvageEquipped: { removedEquipped: results.reduce((sum, r) => sum + r.salvageEquippedRemoved, 0),
    violatingSeeds: results.filter(r => r.salvageEquippedRemoved > 0).map(r => ({ seed: r.seed, removed: r.salvageEquippedRemoved })),
    pass: results.every(r => r.salvageEquippedRemoved === 0) },
  // Overflow salvage summed over seeds: per slot × rarity, total / incoming (salvaged on arrival) / within 10 online minutes of arrival.
  salvageBySlot: (() => {
    const sum: Record<string, Record<string, { total: number; incoming: number; within10Min: number }>> = {};
    for (const r of results) for (const [slot, byRarity] of Object.entries(r.salvageBySlot)) for (const [rarity, cell] of Object.entries(byRarity)) {
      const into = ((sum[slot] ??= {})[rarity] ??= { total: 0, incoming: 0, within10Min: 0 }); into.total += cell.total; into.incoming += cell.incoming; into.within10Min += cell.within10Min;
    }
    return { bySlotRarity: sum, lostEvents: results.reduce((total, r) => total + r.salvageLostEvents, 0),
      finalBagBySlot: Object.fromEntries(['weapon', 'armor', 'charm'].map(slot => [slot, dist(results.map(r => r.bagBySlot[slot] ?? 0), 1)])) };
  })(),
  perSeed: results.map(({ decisions, forks, ...rest }) => { const { salvageBySlot, ...seed } = rest; void salvageBySlot; return { ...seed, decisions: decisions.length, forks: forks.length }; }),
};
await writeFile(values.out ?? 'shots/v14-targets.json', JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify({ rules: report.rules, targets: report.targets, farmChest: report.farmChest }, null, 2) + '\n');
