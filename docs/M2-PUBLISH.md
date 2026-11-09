# M2 published draft evidence

Draft PR: https://github.com/maiphh/taskbar-legends/pull/2 — base m1-prototype; neither PR merged.
M1 preview: https://maiphh.github.io/taskbar-legends/ — remains M1-only. Pages push trigger and explicit guards require m1-prototype. M1 copyright commit8859a5b has passing CI/Pages. Original game code is all rights reserved; assets remain CC0. Root code notice and third-party notices are included in installers.

## Verification

Typecheck, lint, all40Vitest tests, browser build,11standard screenshots and DPR100/125/150% native-IPC adapter emulation pass. Standalone file:// builder/verification passed in the main workspace. Native Rust checks/tests passed on Linux and Windows CI. First Windows push run42567743528 produced raw exe, NSIS exe and MSI. The parallel PR run hit HTTP504 downloading an official NSIS plugin; bounded retries now handle only recognized transient download failures. Compiler/hash/validation failures still fail immediately. Current run/artifact links are in the PR.

Artifacts are unsigned, named taskbar-legends-windows-x64, require GitHub sign-in, and expire after14days. Native compilation is not native interaction proof. [Windows manual checklist](M2-WINDOWS-TESTS.md) remains unexecuted: compositor transparency, actual click-through/focus, taskbar/auto-hide, hotplug/DPI, installer and persistence acceptance.

Native host is160/488logical pixels. Pixel art stays1:1physical, bottom-anchored with additional transparent space above at higher DPI. Top/side taskbars retain a horizontal strip at the bottom of the work area. Tiny-work-area fallback, exclusive-fullscreen auto-hide and virtual-desktop policy remain later work.

## Designer snapshots and concurrency

Designer edits the canonical config and original working tree concurrently. Verification therefore runs in a separate git worktree with a fixed verbatim import. No developer balance tuning. Every simulation now records its input SHA256, and aggregate mode additionally embeds the full loaded config. Module-load mismatch fails rather than silently labeling different inputs.

Latest imported seed-1 snapshot (2026-11-09 12:51 Asia/Saigon (UTC+7)): version1.1.0, SHA256`6e9afc12efd1eeb1d7e11127e1899935cc637a8d84d096eb5395b68f7d284ef2`. Later deliveries require another import/run. These are diagnostics, not population medians:

| Target | Latest seed-1 measurement | Diagnostic |
|---|---|---|
| 1 | `{"openSeconds":123.3}` | PASS |
| 2 | `{"openHours":3.6082222222222224}` | FAIL |
| 3 | `{"day":6}` | PASS |
| 4 | `{"seeds":10000,"initialRoster":"3 starter heroes","medianPullsToFullRoster":124,"minPulls":25,"maxPulls":803,"pullDistribution":{"count":10000,"observed":10000,"censored":0,"p10":65,"median":124,"p90":246},"observedRarityRates":{"common":0.49954182649192747,"rare":0.32923887322841905,"epic":0.13088257068862919,"legendary":0.040336729591024266},"referenceRosterDay":6}` | PASS |
| 5 | `{"highestCleared":7,"firstClear1_8OpenSeconds":null}` | PASS |
| 6 | `{"minSeconds":25.15,"maxSeconds":46.05,"samples":4542}` | FAIL |
| 7 | `{"maxSeconds":42.6,"pending":[]}` | PASS |

## Completed100-seed reference cohort

`npm run --silent sim -- --seed 1 --policy reference --days 7 --seeds 100`

Report: [sim-ref-100seeds-966fd29d.json](../sim-ref-100seeds-966fd29d.json). Reference seeds1..100, seven days, six open hours/day, deterministic greedy policy, capped offline sessions. Independent gacha cohort:10,000seeds.

**This run's actual startup fingerprint is `966fd29d803143b510e239ac783e6d2f6f93cd0853fd8ed7f526cd9ef1c812e7`, NOT787f61ad and NOT the later imported retune above.** It took about15minutes while Designer continued changing config. The post-run live-file comparison intentionally failed, but all100samples and quantiles completed; it is valid for its startup snapshot, not a current-balance certification. That first run predates embedded full-config output, so only its fingerprint/report remain archived; later runs embed the complete loaded config for exact replay.

| Target | p10 | Median | p90 | Result |
|---|---:|---:|---:|---|
| 1 | 102.145 | 121.55 | 138.015 | PASS |
| 2 | 0.887585 | 1.56049 | 4.57692 | PASS |
| 3 | 3 | 6 | unreached/censored | PASS |
| 4 | 1.9 | 5 | unreached/censored | FAIL |
| 5 | 7 | 7 | 7 | PASS |
| 6 | 44.05 | 46.35 | 56.91 | FAIL |
| 7 | 40.05 | 43.575 | 57.36 | PASS |

Units:1open seconds;2open hours;3chapter-2boss day;4full-roster day;5no-input highest stage index;6per-seed maximum farm-clear seconds;7per-seed maximum non-boss-stall open seconds. Target1:100/100cleared1-5within600seconds. Target4gacha pull p10/median/p90=65/124/246 (gacha passes; roster median day5fails day6..8). Target6minimum-clear p10/median/p90=21.25/22.95/30.85seconds; maximum-clear bounds fail across the cohort. Target3has28censored seeds and target4has25at the seven-day horizon. Censored quantiles remain null, not excluded. R-7 linear quantiles; criteria preserve percentage/universal conditions instead of median-only checks. README documents CLI usage.
