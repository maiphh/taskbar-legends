/* global console, performance */
import assert from 'node:assert/strict';
import * as Core from '../supabase/functions/_shared/generated-game-core.js';

const samples = [];
for (const seed of [1, 2026, 0x7fffffff]) {
  const state = Core.createAccount(seed), pullsBefore = state.stats.pulls;
  state.tickets = 1000;
  const start = performance.now();
  const settled = Core.settleInterval(state, 15_000, 8 * 60 * 60 * 1000, 0);
  const action = Core.applyCommand(state, { type: 'pullMany', count: 10 }, 10);
  const elapsedMs = performance.now() - start;
  assert.equal(settled.ticks, 300, 'benchmark covers the full active lease');
  assert.equal(settled.offline?.seconds, 8 * 3600, 'benchmark covers the full offline cap');
  assert.equal(action.reason, undefined, 'benchmark ten-pull is valid');
  assert.equal(action.state.stats.pulls, pullsBefore + 10, 'benchmark command completes all ten pulls');
  samples.push({ seed, elapsedMs: Number(elapsedMs.toFixed(2)) });
}
const maxMs = Math.max(...samples.map(sample => sample.elapsedMs));
console.log(JSON.stringify({ case: 'generated bundle: 300 active ticks + 8h offline settlement + x10 pull', samples, maxMs }, null, 2));
assert.ok(maxMs < 2000, `generated server operation must stay below 2s wall proxy; observed ${maxMs}ms`);
