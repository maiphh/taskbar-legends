# v1.2 measured balance and verification

## v1.3.0 (current)

Config `src/design-config.json` = Designer v1.3.0 verbatim. SHA-256 `9cbbace2040cbe8963f263547f72f991fb85c064acc96f478626bdbb6486c76c`, identical to `/workspace/game-assets/idle-battler/design/config.json` (the report embeds the SHA and the full config). Report: `sim-ref-v13-25seeds-9d.json` (`npm run --silent sim -- --policy reference --days 9 --seeds 25`), 25 seeds × 9 days, 6 open h/day.

| Target | p10 | Median | p90 | Result |
|---|---:|---:|---:|---|
| 1 · 1-5 within 600 open s | 103.2 | 123.6 | 150.4 | PASS (25/25) |
| 2 · ch1 boss, open h (1.5–2.5) | 0.21 | 2.01 | 3.72 | PASS (median) |
| 3 · ch2 boss day (4–6) | 4 | 6 | 8.6 | PASS (median) |
| 4 · full roster day (6–8) + gacha pulls (100–140) | 1.4 | 5 | — (4/25 censored at day 9) | **FAIL**: roster median 5; gacha median 124 pulls passes |
| 5 · no-input starter < 1-8 after 1 h | 7 | 7 | 7 | PASS |
| 6 · farm clear 20–40 s (per-seed max) | 25.37 | 26.35 | 26.95 | PASS |
| 7 · non-boss stall ≤ 2700 open s (per-seed max) | 39.75 | 48.55 | 63.39 | PASS |

T6 across all successful cycles: 225,018 cycles; min/p10/median/p90/max = 20/20/20/24.55/30.25 s.

**T4b (roster median day 5 vs 6–8) is an accepted known miss for v1.4.** The cause is structural (design.md "Tuning log v1.3"): chapter-2 tickets all land on day 1 and the finale's +100 tickets complete most rosters. These numbers match Designer's own v1.3 measurement.


Branch balance-v1.2 is based on licensed m1-prototype 8859a5b and targets main, explicitly building on PR #1. No Tauri/M2 commits are included. Shared checkout /workspace/taskbar-legends was not changed for this work; all work is isolated in /workspace/tl-v12.

## Inputs

Designer source v1.2.0 SHA256 6e9afc12efd1eeb1d7e11127e1899935cc637a8d84d096eb5395b68f7d284ef2. Imported verbatim, then only requested keys appended: combat.nonBossFarmTimeScale3, combat.nonBossFarmMinCycleSec20, absent progression.powerGainRetryMinSec0. No other balance edits. Result SHA256`bf5c353492f45e5627d2d3cd075c9d9775e03ea329355339015723136f236234`. Aggregate JSON embeds all config values.

## Measurement

`npm run --silent sim -- --seed 1 --policy reference --days 9 --seeds 25 > sim-ref-v12-25seeds-9d.json` (v1.2 report; superseded by the v1.3 report above and removed from the branch)

25 seeds,9 days each,6 open hours/day, deterministic greedy policy and capped offline sessions. Independent10,000-seed gacha cohort. Runtime about5minutes on this shared box, one run; no comparative speedup claim.

### T6: real successful farm cycles (boss repeats included, unscaled)

218166cycles; exact pooled min/p10/median/p90/max = **20/20/20.6/24.55/31.7seconds**. **PASS20–40s** for every observed successful clear. Counts sum to every seed's farmSamples. This is a full integer-wall-tick histogram, not last-ten samples, metric clamping, a projection or discarded outliers. Failed/aborted encounters are not falsely recorded as clears. The nine-day report includes all actual successful boss farming too.

### All seven targets

| Target | p10 | Median | p90 | Diagnostic result |
|---|---:|---:|---:|---|
| 1 | 106.8 | 123.3 | 136.11 | PASS |
| 2 | 0.411506 | 0.954958 | 1.93181 | FAIL |
| 3 | 3.4 | 5 | 6.6 | PASS |
| 4 | 3 | 4 | 6.6 | FAIL |
| 5 | 7 | 7 | 7 | PASS |
| 6 | 25.51 | 25.85 | 26.95 | PASS |
| 7 | 40.05 | 43.65 | 65.67 | PASS |

Units:1open seconds (25/25clear1-5within600s);2chapter1boss open hours;3chapter2boss day;4full-roster day;5no-input highest stage index after1h;6per-seed maximum farm seconds;7per-seed maximum non-boss stall open seconds. T6 row is the distribution of per-seed extrema, **not** the pooled cycle distribution above. Gacha pull p10/median/p90=65/124/246, so its median criterion passes; T4 fails because reference collection is too early (median day4, target6–8). T2also fails early (median0.955h, target1.5–2.5h). No balance compensation was made; Designer must retune the faster online economy.25 seeds are diagnostics, not the requested100-seed population certification. No censoring remains at the nine-day horizon.

## Verification and known decisions

46 Vitest tests, TypeScript and ESLint pass. Production build and14 Playwright screenshots pass with no page/asset errors. Countdown PNGs were opened and visually checked at1280and640width, plus a red final-five frame. Pixel Operator bold16px, existing gold/red palette and opaque left island are reused; no dedicated timer token exists, so placement needs Game Graphic Designer review. Actual imported boss timeouts are 22s and 21s (config wins over the approximate21s prose).

Tests cover defaults1/0 versus a frozen legacy scheduler (byte-identical state/events/rewards on native farming), controlled20/36s wall cycles, all native hit/skill/death/reward ordering, no padding RNG/XP, timer/manual boss/push cancellation, no push/boss scaling, native8h/12h offline equivalence, mid-combat/padding snapshot/load, exact failureT+599/T+600 and zero-gate gain-action behavior, old-save migration and fractional minimum rounding. Saved native average and wall telemetry are distinct. The latest steering intentionally changes early power retry from legacy encounter-boundary checks to exact eligible wall/input ticks; whole-replay identity across that policy change is not claimed. Status still counts down to retryAtTick. Reference BOSS_READY logic is unchanged.

Shots: shots/12-boss-countdown-1280.png, shots/13-boss-countdown-640.png, shots/14-boss-final-five-1280.png, metadata shots/boss-countdown-state.json. Their HP-protected boss-wave fixture is visual evidence, not a balance measurement. Regular one-hour/seven-day outputs are refreshed too.

## Earlier M2 Windows deliverable

Draft PRhttps://github.com/maiphh/taskbar-legends/pull/2, base m1-prototype, never merged; all standard/native PR checks pass. Artifact https://github.com/maiphh/taskbar-legends/actions/runs/42569924005/artifacts/13652871616 — taskbar-legends-windows-x64; raw .exe, NSIS .exe and MSI headers downloaded/verified. Unsigned, GitHub sign-in,14-day retention. This artifact is M2commit57e15b2 and does **not** contain this separate balance branch. Real Windows interaction/DPI/installer acceptance remains pending docs/M2-WINDOWS-TESTS.md on M2. M1preview remains unchanged.

CI verified: https://github.com/maiphh/taskbar-legends/actions/runs/42572119299 (PR) and https://github.com/maiphh/taskbar-legends/actions/runs/42572098696 (push). Both pass. No PR was merged.
