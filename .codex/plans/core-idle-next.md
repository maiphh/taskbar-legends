# Next core slice: continuous, correct idle income across short sessions

Planner: GPT-6.1 Sol high, 2026-11-16. Implementor: GPT-6 Luna high. Reviewer: fresh GPT-6.1 Sol medium. Repository is `/Users/phu.mai/Projects/taskbar-legends`. Preserve current HEAD and the completed font/campaign work. No AGENTS.md was found in the earlier repository/ancestor inspection; recheck if new instructions appear.

## Decision and concrete evidence

Develop the existing idle economy into **continuous offline income that survives short visits**, with actual party encounter reward prices, saved partial progress, one consumed interval per restore, and a small useful offline estimate/progress view in Settings. This is a core reward/save slice with supporting UI, not another cosmetic feature.

Confirmed current gaps:

1. `src/core/save.ts:expectedFarmRewards()` enumerates the authored legacy `stage.waves` directly. Online `combat.ts:spawnWave()` calls `partyWaveKinds()` which pads/caps waves and replaces some enemies with assassin/bomber; online `party-combat.ts:rewardDeath()` prices `getPartyEnemyDefinition(sourceId).rewardKind`. Therefore offline prices differ from the actual game. Read-only measured totals per successful farm clear: stage9 offline262 gold vs live226; stage11 offline143 vs live119; stage20 offline2647 vs live2719. These numbers include configured clear gold.
2. `applyOffline()` floors clears separately for each absence and then calculates gold/XP from whole clears. Repeated10-second background sessions yield zero gold/XP with a30-second estimate, while one30-second absence pays. Ordinary/expedition chest counts independently floor every absence, so frequent short visits never reach their chest threshold. Tickets already have fractional carry: preserve that functionality.
3. `main.ts:restore()` loads and resumes a clone but does not immediately checkpoint the consumed timestamp/rewards before exposing it. Frame stepping is not gated by `restoring`, and management/keyboard actions can mutate a provisional account. Restores have no in-flight serialization/generation protection. A delayed restore can replace newer gameplay, and rapid transitions are not a reliable exactly-once boundary.

Product choice: **keep the documented stage1 fallback when highestCleared is0**. Removing it would change the existing onboarding promise. Preserve the8-hour cap, no offline campaign/retry/open-tick advancement, native-duration gold/XP vs wall-duration ticket semantics, configurable expedition/chest rates, and rule flags. Do not automatically recruit, equip, upgrade, or fight bosses. Do not change balance values merely to make a report green.

`docs/COMPACT-PARTY-PHASE-4-SPEC.md` also proposes farm-team proofs, shared XP for dead deployed heroes, transactional account migration, and manual salvage/import. Those are concrete future gaps but **outside this slice**. Do not claim these are fixed. Current universal farm sample validity remains a documented limitation. `DEFAULT-PARTY-RUNTIME-CLEANUP-PLAN.md` superseded the old multi-mode/migration activation instructions; never reintroduce a legacy runtime to follow obsolete prose.

## Gameplay contract: continuous offline production

This deliberately improves the old whole-clear-only payout rule. Price work continuously at the existing expected farm rate; pay whole gold/XP units as they become available, save the fractional remainder. This avoids losing progress or repricing previously earned work when the stage/party/rate changes.

For `seconds = min(max(elapsedMs,0)/1000, capSeconds)`:

- Get farm reward stage `max(1,highestCleared)` exactly as today.
- Get gold/XP clear duration from existing `nativeFarmClearSeconds ?? farmClearSeconds`, falling back to configured default. Keep positive/finite validation and explicit fallback for absent/empty samples. Ticket duration remains `avgWallFarmClearSec()`.
- `clearWork = seconds / rewardClearSeconds`.
- `goldOwed = oldGoldFraction + clearWork * expectedGoldPerClear * offlineEfficiency`; grant its whole part and retain fraction.
- `xpOwed = oldXpFraction + clearWork * expectedXpPerClear * offlineEfficiency`; grant its whole part to the currently selected offline party through the existing explicit-IDs `grantXp` path and retain fraction.
- `clearsOwed = oldClearFraction + clearWork`; increment `stats.offlineClears` only by completed equivalents, preserving fractional clear work separately. Clears are a reporting counter; they do not trigger first-clear rewards, farm drops, retries, progression, or a second payout.
- Accrue normal chest units or expedition chest units from this interval's capped seconds using the active rule. Grant whole units through existing `chest()`; retain the fractional unit in the corresponding bank. **Keep separate normal and expedition banks** so toggling rules cannot convert one chest kind into another. Inactive bank stays unchanged.
- Keep current per-interval chest maxima. Do not bank discarded whole chests or capped-away hours for later payout. Prior fractional balances survive an over-cap absence; only new elapsed time is capped. With current rates,8hours yields exactly4 normal or28 expedition chests plus a remainder below1.
- Keep `offlineTicketFrac` as-is and reuse current ticket arithmetic; do not create a second ticket balance. No RNG for gold/XP/clear/ticket arithmetic. Actual chest rolls use the current deterministic RNG and existing Fortune/choice/overflow logic.
- For zero/negative elapsed time, grant nothing and leave every fractional bank/RNG/currency/progression field unchanged. Existing result shape should still report zero raw/applied seconds appropriately. Nonfinite inputs still reject. A negative wall-clock shift must never create a second payment or extra banked time.

Suggested optional plain-JSON state field in `core/model.ts`:

```ts
offlineAccrual?: {
  goldFraction: number; xpFraction: number; clearFraction: number;
  normalChestFraction: number; expeditionChestFraction: number;
  secondsFraction?: number; // only if needed for exact stats.offlineSeconds bookkeeping
}
```

All fractions must be finite in `[0,1)`; absent field means zeros. Initialize lazily on real positive accrual; old saves and zero-time snapshot roundtrips must stay valid. A small pure `splitWholeAndFraction` helper can centralize numerical normalization. Handle near-integer floating arithmetic deliberately (tiny documented tolerance, never a broad epsilon that mints measurable currency); test boundaries and many small partitions. Do not introduce a database, arbitrary-precision library, per-stage ledger, or second save envelope. Fractional gold/XP are already denominated in earned units, so a stage/rate change cannot reprice them. Fractional clear work only affects its reporting counter. Fractional XP crossing a unit boundary uses the selected offline party, matching the current offline recipient contract; do not change encounter XP in this task.

Partition equivalence is for identical fixed context and total eligible time within one cap: wallet/XP earned, completed-equivalent counters, chests, ticket totals and fractions must agree between a single absence and many absences within numerical tolerance. Event logs/level summaries can differ in count; do not require byte-identical events. With chest choices enabled, unchanged party and no intervening actions, chest/loot outcomes and final RNG should agree because exactly the same sequence of chest calls occurs. Separate absences over multiple calendar sessions legitimately get separate8-hour caps; do not equate2x8h with one16h capped absence.

## Exact source work

### A. Price actual encounters

- `src/core/save.ts:expectedFarmRewards(stage)` must use the same `partyWaveKinds(stage,waveIndex,original,isBoss)` and rewardKind definitions as spawning/kills. Include per-enemy rounding before summation, kill stage scaling, and clear reward rounding exactly as online.
- Prefer a small shared pure kill/clear reward getter module if it prevents online/offline formula drift; `party-combat.ts:rewardDeath` and `game.ts:awardClear` can consume it without changing their event behavior. Avoid import cycles with economy/game.
- Keep existing function names/callers where practical. Current runtime is exclusively party-v2; no legacy reward branch is needed. Do not edit authored wave counts or balance values to match the old helper.

### B. Saved fractional production

- Add the optional validated state field in `src/core/model.ts`; preserve current v2 encoder/decoder and v1-compatible party migration. `encodeSave()` already stores additional state fields in its rest object.
- Refactor `applyOffline()` around a pure computed quote if useful: calculate rates/payout/remainders first, then apply whole grants exactly once. Keep original state unchanged when invalid input rejects. `applyOffline` is deterministic and owns no clock; callers provide elapsedMs.
- Return a clear `stage`/reward-stage field or derived projection where needed so the summary displays the actual priced stage. Preserve `seconds`, `rawSeconds`, `capped`, `clears`, `gold`, `xp`, `chests`, per-hero before/after, and conditional v14 fields. Do not rewrite historical offline events unnecessarily; newly optional event fields must remain backwards compatible if added.
- Keep `seconds` as credited capped elapsed time, independent of whether a whole reward is produced. Consider carrying fractional seconds in offlineSeconds stats so short millisecond intervals do not disappear from that metric, but keep this bounded.

### C. Serialize and checkpoint real restores

- Main game remains the only save writer; management/native windows must never call offline catch-up.
- In `src/main.ts`, serialize restore work with an in-flight guard and generation/state-ownership policy. A simple isolated session/restore helper using `SaveStore` may make race/failure testing easier than DOM-heavy tests.
- On restore: read/decode -> clone/resume at one captured timestamp -> persist the resulting state, remainderMs and consumed timestamp -> expose the committed state to authority/UI and welcome summary. If checkpoint save fails, leave the prior durable raw save recoverable and block automatic writes; do not expose a fully playable unpersisted credited account and claim consumption succeeded.
- Gate frame stepping, keyboard actions and browser/native authority command entry while restore owns state. Existing `restoring`/failed-save guards already block ordinary save(); extend carefully to actual state mutations. Keep `lastFrame`/accumulator handling so waiting for restore is not replayed as online time after offline catch-up.
- Visibility policy remains: unfocused/management closed continues online; document hidden gets the current hidden/offline policy. Save the latest online state synchronously on transition to hidden before freezing online ticks. On foreground, consume only time since that hide checkpoint. Avoid awarding both the final online frame delta and the same offline interval. Management visibility changes alone do nothing.
- A return while an earlier async restore is pending cannot overwrite subsequent gameplay or clear a newer error. Coalesce/retry based on latest visibility state. While hidden, do not start an online loop following a delayed restore. Keep the actual hidden flag synchronized.
- Checkpoint the initial restore even before the next5-second autosave, so immediate repeated restores read the consumed timestamp and banks. Welcome Collect/close only acknowledges presentation. Reloading or opening management cannot award the same interval again.
- Preserve quarantine, failed raw export/discard, canonical key, legacy preservation, and native flush behavior. Do not reset a valid save when checkpoint fails. A persistent actionable storage notice is sufficient; avoid conflating a storage write failure with malformed account bytes.

### D. Show useful idle progress

- Add a pure `offlineProjection(state)` (or equivalent) based on the same rate/context helpers: reward stage, estimated gold/hour, XP/hour per selected hero, cap hours, active chest kind, remaining credited-away seconds until its next whole chest, and optional saved partial-production indicator.
- Include this derived read-only data in `ManagementSnapshot` from `management/authority.ts`; native bridge already transports snapshots. No new management mutation action is needed.
- In `management/view.ts:settings()`, add a compact Offline progress section showing `Farm 1-9`, `~… gold/h · ~… XP/h per hero`, `Next chest after … away`, and `Partial rewards carry between visits`. Use existing shared typography and fit within current panel, with scrolling if necessary. Do not show raw JSON, numeric fractional ledger fields, or implementation clock labels to players.
- Update welcome-back copy to work with `gold>0/xp>0` and `clears=0` (valid under continuous production); do not claim a full clear occurred. `PixelUI.showWelcome` currently has a minimum60sec threshold, so a short return may use existing notice instead. No new blocking modal is required. Make the reward stage accurate using the result/projection, preserving the current presentation.
- README active offline behavior and a short dated design/verification note must explain continuous production, partial progress, rates/caps and preserved stage1 fallback. Historical reports and designer JSON remain historical, not silently regenerated.

## Meaningful deterministic verification

Run focused tests first, then full `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Fix genuine regressions without disabling coverage. Existing test fixtures that assume per-absence whole-clear payout need explicit expected values for the new contract, not replacement with assertions that call the same helper twice.

1. **Live reward parity:** for every configured stage, independently enumerate actual spawned wave source IDs and compare summed online kill bases/rounding plus clear award to expectedFarmRewards. Include concrete stage9/11/20 totals above, assassin/bomber grunt reward bases, padded boss adds and capped waves. At least one controlled real combat clear should match expected gold/XP events with farm random drops disabled or excluded by event reason. Do not fake kills by setting hp0 (that skips rewardDeath).
2. **Short-session benefit:** fixed30sec estimate, e.g.3x10sec versus30sec; many1sec versus a few longer intervals; chest threshold crossed across saved/reloaded absences. Whole currencies accrue even before the first whole-clear equivalent; no duplicate first-clear rewards or tickets. Default rules and all v14 rules tested separately.
3. **Boundary arithmetic:** just below/at/above one gold/XP/clear/chest/ticket unit, exact1h/8h expedition boundaries, fractions near1, fractional milliseconds, thousands of small partitions. Assert whole grants match and remainders stay `[0,1)`; use tolerances only for fractional comparisons.
4. **Stage/rate changes:** accrue fractional resource units at stageA and slow rate; change to stageB/fast rate; calculate the sum of each segment's resource production by hand and assert no repricing of the old gold/XP bank. Similarly verify normal/expedition bank isolation across flags. Maintain current ticket native/wall distinctions.
5. **Cap/negative:**8h and12h award identical values with the same starting banks apart from uncapped metadata; capped-away time does not become later progress. Zero/negative intervals leave state/banks/RNG unchanged. NaN/Infinity reject. Stats remain nonnegative, no open ticks/progress/retry deadline advances.
6. **Persistence:** old saves missing all new fields load with effective zero bank; encode/decode preserves fractions exactly. Invalid negative/NaN/Infinity/>=1 fractions reject before replacement. Preserve existing offlineTicketFrac and all gear/pity/choice/lock values. Snapshot/load continuation remains deterministic.
7. **Lifecycle/once-only:** unit test the isolated restore coordinator with an in-memory/delayed/failing SaveStore. Two overlapping restores, visible-hidden-visible during load, immediate second restore after checkpoint, checkpoint write failure, and command/frame attempts while loading. Verify one payment, latest-state ownership, original bytes recoverable, and no offline/online time overlap. Check `main.ts` integration rather than testing an unused helper.
8. **Bounded gameplay simulation report:** add/run a reproducible script (e.g. `scripts/idle-economy-check.ts`) for a small documented matrix of stages1/9/11/20, fixed rate contexts, seeds1..5, rules default/all-on. Compare one8h absence vs partitioned8h with save roundtrips; report resource/loot/RNG agreement and unchanged progression. Include a separate short real online farm trace as reward-price evidence. Label this deterministic economy validation, not population balance, native soak or8h real-time performance.

Browser acceptance using existing Playwright/browser tooling:

- Fresh context on bare `/`; resume a valid current save with partial banks; check Settings estimate/next-chest progress and actual return notice/welcome values. Capture480/640/960 Settings and one representative return summary; preserve fonts and shared boss controls.
- Use a real second page/tab to background then foreground the game for at least one lifecycle check; synthetic visibility events alone are insufficient. For longer deterministic away windows seed a timed save or use explicit debug away in separate fixtures, clearly labeled. Close/reopen management and Collect cannot mint rewards.
- Reload immediately after credited return and assert the checkpointed timestamp prevents repeat payment. Test a storage-write failure fixture without losing the original canonical raw account. Verify no page errors and stable authority snapshot.
- Native browser variant can be checked with `?shot&menu=native`; do not claim real Tauri/native acceptance. Do not install toolchains, publish, push or produce releases.

Write a concise results note plus machine-readable report and screenshots under `artifacts/` (or existing project convention), including actual commands, source/rules identification and limitations. Do not run100-seed/9-day balance certification for this bounded change. Fresh Sol medium reviews the final code, tests, report and key images; Luna fixes actionable findings before handoff.
