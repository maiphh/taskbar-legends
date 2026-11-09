# M2 draft publication evidence

PR: https://github.com/maiphh/taskbar-legends/pull/2 (draft, base m1-prototype; never merged).
M1 preview remains https://maiphh.github.io/taskbar-legends/. Its HTML SHA256 was unchanged after the M2 push. Pages trigger and both job guards restrict deployment to m1-prototype.

40 Vitest tests, typecheck, lint, browser build, standard screenshots, native-IPC-emulated adapter screenshots pass. The standalone file:// builder also passed on the main workspace. Native cargo checks and Rust tests passed on Linux and Windows in CI. Initial push Windows CI produced exe/MSI/NSIS artifacts. The parallel PR run hit HTTP504 downloading the official NSIS plugin, so packaging now retries only recognized transient HTTP429/5xx, timeout/reset failures up to three times. Compiler or validation failures fail immediately. See PR for current CI/artifact link.

Installers are unsigned. Artifact name: taskbar-legends-windows-x64 (raw exe, NSIS exe, MSI), 14-day retention, GitHub sign-in required. Compilation does not prove native behavior. [Real Windows checklist](M2-WINDOWS-TESTS.md) remains unexecuted. Screenshots emulate IPC, not OS click-through.

## Designer snapshot

Verified 2026-11-09 12:45 Asia/Saigon (UTC+7). Shared and main workspace configs are being edited concurrently by Designer. Publishing checks now run in an isolated git worktree, importing a verbatim snapshot before the suite; the snapshot is fixed for each measurement. No developer balance tuning. Still labeled 1.1.0, fingerprint: `cbc1ee67a0290c29783c088873dc372950c29cbe35f349f1e455603e89e8a8d4`.

Latest imported seven-day seed-1 diagnostics (not population medians):

| Target | Measurement | Result |
|---|---|---|
| 1 | `{"openSeconds":119.3}` | PASS |
| 2 | `{"openHours":3.525166666666667}` | FAIL |
| 3 | `{"day":7}` | FAIL |
| 4 | `{"seeds":10000,"initialRoster":"3 starter heroes","medianPullsToFullRoster":124,"minPulls":25,"maxPulls":803,"pullDistribution":{"count":10000,"observed":10000,"censored":0,"p10":65,"median":124,"p90":246},"observedRarityRates":{"common":0.49954182649192747,"rare":0.32923887322841905,"epic":0.13088257068862919,"legendary":0.040336729591024266},"referenceRosterDay":7}` | PASS |
| 5 | `{"highestCleared":7,"firstClear1_8OpenSeconds":null}` | PASS |
| 6 | `{"minSeconds":25.35,"maxSeconds":45.05,"samples":4553}` | FAIL |
| 7 | `{"maxSeconds":42.6,"pending":[]}` | PASS |

A 100-seed run began on request-time snapshot `787f61ad785decb1070272d8fdcfb42826d96e184a10d8044e85d4286598d5bc`. Its results must not be relabeled as this later designer retune. Further deliveries require another import/run.

## Aggregate CLI

`npm run --silent sim -- --policy reference --days 7 --seeds 100 > sim-ref-100seeds.json`

All seven targets have p10/median/p90, explicit censoring and per-seed audit rows. Criteria preserve percentage/universal conditions rather than replacing them with medians. Target4 includes independent 10k-gacha pull quantiles, computed once. Target6 includes farm-minimum and farm-maximum distributions. Config fingerprint captured at module load; later edits cannot silently relabel a running cohort. Combat RNG/timing are untouched; existing policy-report gacha output only adds percentile observations. See README.
