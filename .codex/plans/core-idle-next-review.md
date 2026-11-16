# Core idle review — 2026-11-16

**GREEN after fix review** — both independently confirmed P1 lifecycle defects below are resolved. Initial findings are retained for traceability.

## P1 — Accepted hidden-page commands are rolled back on foreground restore

`src/main.ts:291–295` checkpoints the account on hiding but leaves `managementAuthority` available. Commands from the separate native management window can therefore mutate the in-memory account after the durable hide checkpoint. Foreground restore loads that earlier checkpoint and replaces the account, silently discarding commands already reported accepted.

Independent actual-app Playwright integration fixture (synthetic visibility events, explicitly not real-tab/native evidence): paused initial account with tickets=6/pulls=0; dispatch hidden; `window.__management.execute` accepts a pull and reports tickets=5/pulls=1; dispatch visible and await restore; account returns to tickets=6/pulls=0.

Disable authority mutation entry when transitioning hidden, and keep it disabled through the committed foreground restore. Add a main integration regression covering accepted/rejected command behavior across hide/restore. Settings/audio preferences need not share account transaction gating.

## P1 — Backward wall-clock shift rewinds the consumed timestamp

`src/core/restore-coordinator.ts:35–38` unconditionally checkpoints the current clock timestamp even when it precedes the durable save timestamp. `resumeSave` correctly gives zero reward for that negative interval, but the checkpoint then makes already consumed time eligible again.

Independent runtime reproduction with real `memorySaveStore` and coordinator: initial savedAt=100000; restore at90000 writes savedAt=90000; restore when clock returns to100000 grants10seconds/+14gold. No new eligible time passed beyond the original consumed timestamp.

Preserve a durable consumed timestamp high-water across restore checkpoints and subsequent ordinary/hide saves, so a temporarily earlier clock cannot reopen paid time. Add backward-clock→catch-up→new-time regression assertions for currencies/banks and timestamps.

## Checks and bounded assessment

- Read planner/results and final product changes, new shared reward functions, optional state bank schema, restore coordinator, and tests. Actual wave pricing now follows party enemy composition/rewardKind and per-event rounding; continuous unit-denominated banks and separate chest-kind balances appear coherent. Zero/negative direct `applyOffline` returns without state mutation.
- Independently ran `tests/offline-continuous.test.ts`, `tests/restore-coordinator.test.ts`, `tests/core.test.ts`, and `tests/m3-core.test.ts`: **4 files, 41 tests passed**. Existing coordinator tests do not catch the two reproduced integration/time defects.
- Inspected actual Settings screenshots at480/640/960 and the960 welcome summary. The offline summary is readable; lower Settings controls remain in its existing scroll container. Welcome reward stage and totals are presented. The implementor explicitly records default640 welcome clipping, missing real two-tab/native lifecycle proof, missing browser quota fixture, and missing broader deterministic economy/real-clear report; those limitations are not treated as passed acceptance.
- Full37file/321test, lint/typecheck/build successes are implementor-reported. No independent full-suite rerun was needed to establish these source/runtime defects.
- No product code modified by reviewer. No additional balance changes or redesign requested.


## Fix review — GREEN

- `main.ts` now sets hidden state and disables authority before the hide checkpoint, gates direct/debug mutations and pause callbacks, and reenables authority only after the visible restore completes successfully. The prior accepted-then-lost command path is closed.
- `RestoreCoordinator` checkpoints `max(current clock, durable savedAtMs)`. The new `SaveTimestamp` observes the durable restore timestamp and supplies monotonic timestamps to both ordinary and hide writes. A restart initializes this policy from the saved high-water through the coordinator, so clock recovery cannot reopen the previously paid interval.
- Independently reran `node scripts/offline-lifecycle-check.mjs` against the actual local Vite app: hidden management pull rejected; hidden debug input ignored; tickets6/pulls0 retained; rollback hide/ordinary saves preserved timestamp100000; foreground/reload retained14gold and0clear equivalents; no page errors.
- Independently ran coordinator, save-timestamp and authority tests: **3 files, 15 tests passed**. The timestamp regression covers paid progress, a backward clock, ordinary/hide writes, a new coordinator instance and clock recovery with unchanged saved fractions.
- Full post-fix suite **38files/322tests**, lint/typecheck/build are implementor-reported passing. No additional blocker identified in the bounded fix/integration review.

This GREEN resolves the two code defects; it does not turn the report's stated limitations into successful acceptance. Real two-tab/native visibility behavior, browser quota recovery, the broader economy simulation/real-combat trace, and default-width welcome clipping remain explicitly documented limitations.
