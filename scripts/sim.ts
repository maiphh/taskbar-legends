import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runReferenceAggregate } from '../src/sim/aggregate';
import design from '../src/design-config.json';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { CONFIG, activeV14Rules, parseV14Flag, setV14Rules, ticksForSeconds } from '../src/config';
import { createState, input, step, summary } from '../src/core/game';
import { actionSchema } from '../src/core/model';
import { balanceReport, referencePolicy, runReference } from '../src/core/policy';

const { values } = parseArgs({ options: { seed: { type: 'string', default: '1' }, ticks: { type: 'string' }, hours: { type: 'string' },
  seeds: { type: 'string' }, days: { type: 'string' }, policy: { type: 'string' }, inputs: { type: 'string' }, events: { type: 'string', default: 'summary' }, 'gacha-seeds': { type: 'string', default: '10000' }, v14: { type: 'string', default: 'all' } } });
// --v14 all is the 1.4.2 default; --v14 none opts out. A comma list still selects a subset.
setV14Rules(parseV14Flag(values.v14));
function numberOption(value: string | undefined, fallback: number, name: string): number {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(`Invalid ${name}`);
  return result;
}
if (values.policy !== undefined && values.policy !== 'reference') throw new Error('Only --policy reference is supported');
if (values.events !== 'summary' && values.events !== 'full') throw new Error('--events must be summary or full');
if (values.hours !== undefined && values.ticks !== undefined) throw new Error('Use either --hours or --ticks');
if (values.days !== undefined && (values.policy !== 'reference' || values.hours !== undefined || values.ticks !== undefined || values.inputs !== undefined)) throw new Error('--days requires --policy reference and cannot combine with hours/ticks/inputs');
if (values.seeds !== undefined && (values.policy !== 'reference' || values.hours !== undefined || values.ticks !== undefined || values.inputs !== undefined)) throw new Error('--seeds requires --policy reference and cannot combine with hours/ticks/inputs');
const seed = numberOption(values.seed, 1, 'seed');
const start = performance.now();
const configBytes = readFileSync(new URL('../src/design-config.json', import.meta.url));
const fileDesign: unknown = JSON.parse(configBytes.toString('utf8'));
if (JSON.stringify(fileDesign) !== JSON.stringify(design)) throw new Error('Designer config changed during module load; retry the run');
const configSha256 = createHash('sha256').update(configBytes).digest('hex');
if (values.seeds !== undefined) {
  const gachaSeeds = z.number().int().min(1).max(100000).parse(numberOption(values['gacha-seeds'], 10000, 'gacha-seeds'));
  const report = runReferenceAggregate({ firstSeed: seed, seeds: numberOption(values.seeds, 100, 'seeds'), days: numberOption(values.days, 7, 'days'), gachaSeeds,
    onProgress: (completed, currentSeed) => { if (completed % 10 === 0 || completed === 1) process.stderr.write(`Reference aggregate: ${completed}/${values.seeds} (seed ${currentSeed})\n`); } });
  process.stdout.write(JSON.stringify({ configSha256, v14Rules: activeV14Rules(), configSnapshot: design,
    ...report, elapsedRealMs: Math.round(performance.now() - start) }, null, 2) + '\n');
} else if (values.days !== undefined) {
  const run = runReference(seed, numberOption(values.days, 7, 'days'));
  const gachaSeeds = z.number().int().min(1).max(100000).parse(numberOption(values['gacha-seeds'], 10000, 'gacha-seeds'));
  const report = balanceReport(run, gachaSeeds);
  process.stdout.write(JSON.stringify({ configSha256, v14Rules: activeV14Rules(), final: summary(run.state), days: run.daily, milestones: run.milestones, balance: report,
    events: values.events === 'full' ? run.state.events : run.state.eventCounts, eventsRetained: run.state.events.length,
    eventLogNote: `Structured tail bounded to ${CONFIG.runtime.eventLogLimit}; counts cover entire run`, elapsedRealMs: Math.round(performance.now() - start) }, null, 2) + '\n');
} else {
  const ticks = values.hours !== undefined ? ticksForSeconds(numberOption(values.hours, 1, 'hours') * 3600) : numberOption(values.ticks, 600, 'ticks');
  const state = createState(seed);
  const commands = values.inputs ? z.array(z.object({ tick: z.number().int().nonnegative(), action: actionSchema }).strict())
    .parse(JSON.parse(readFileSync(values.inputs, 'utf8'))).sort((a, b) => a.tick - b.tick) : [];
  if (!Number.isSafeInteger(ticks) || ticks > CONFIG.runtime.maxStepTicks) throw new Error('Invalid tick count');
  let index = 0;
  const cursor = { revision: -1 };
  for (let tick = 0; tick < ticks; tick += 1) {
    while (commands[index]?.tick === tick) { const command = commands[index++]; if (command) input(state, command.action); }
    if (values.policy === 'reference') referencePolicy(state, cursor);
    step(state);
  }
  while (commands[index]?.tick === ticks) { const command = commands[index++]; if (command) input(state, command.action); }
  process.stdout.write(JSON.stringify({ configSha256, v14Rules: activeV14Rules(), final: summary(state), events: values.events === 'full' ? state.events : state.eventCounts,
    eventsRetained: state.events.length, eventLogNote: `Structured tail bounded to ${CONFIG.runtime.eventLogLimit}; counts cover entire run`, elapsedRealMs: Math.round(performance.now() - start) }, null, 2) + '\n');
}
