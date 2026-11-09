# v1.2 repeat-only tempo design

## Work phases
- [x] Ground: read designer section12; combat, progression, persistence and policy runners.
- [x] Sketch two alternatives; choose explicit clocks.
- [x] Agree: autonomous implementation requested; no human checkpoint.
- [x] Implement, test, measure25 seeds over9 days, and inspect boss countdown shot.
- [x] Verify CI and report; scrap/re-design only if invariants fail.

## Grounding
The20Hz wall step owns retries and encounter/stage transitions. Combat currently uses wall tick for shields, births/enrage and timeout, and rest/wave gaps share the same phase. Clear rewards happen at final kill followed by a normal stage gap. Offline averages currently read the last10reported farm durations. The reference policy runs before each global step and never automatically starts a boss without its own input action.

## Alternatives
A: temporarily replace state.tick with a faster clock during combat and remap events afterwards. Rejected: borrowing the global clock makes retries, timestamps and save observability fragile, and loses per-substep event ordering.
B (chosen): optional serialized encounter-only native clock, a combat-time accessor, and a farm-padding phase. Global ticks never change except once per wall step. Eligibility captured on beginEncounter; bosses/pushes remain on legacy clock. Native duration history is separate from wall telemetry/offline-safe.
No subagent runner tools are available in this local executor; both sketches were evaluated locally.

## Caller-first contract
`step(state,1)` advances one wall tick and at most the captured1..4native combat substeps. `input(state,{type:'retry'})` may abort combat/padding. `snapshot/load` preserves optional native clock, unused substep remainder and padding deadline. `applyOffline` reads native duration history, never speed/floor knobs. `runReference(...,collectFarmTimings=true)` collects every successful real wall cycle into an auxiliary histogram, not a sampled/clamped range.

Planned state: optional farmClock `{scale,minCycleTicks,elapsedTicks,remainder}`; `phase.kind='farmPad'` with wall settlement tick and native duration; optional enemy nativeBornTick; optional metrics.nativeFarmClearSeconds. Only scaled/floored eligible encounters allocate these fields. Default1/0 follows legacy settlement/rest and omits native history until needed.

## Latest steering / compatibility decision
The added powerGainRetryMinSec gate applies to power retries only; timer/manual/BOSS_READY policy and status countdown remain unchanged. New losses store failTick; old saves may omit it and infer the original loss from retryAtTick/backoff. Latest steering requires a power retry on the exact eligible wall tick, including with gate0. Legacy code checked power only at next encounter boundaries; this exact-tick change is intentional and takes precedence over literal whole-state legacy replay identity. Tempo defaults are tested independently for unchanged combat/reward/rest behavior. Adding failTick itself also necessarily changes new serialized loss states. Supported1.1saves migrate balance metadata to1.2without losing progress.

Source designer config SHA256: `6e9afc12efd1eeb1d7e11127e1899935cc637a8d84d096eb5395b68f7d284ef2`. Imported verbatim, then only the explicitly requested farm3/20 and absent retry-gate0keys are added; no other balance tuning.
