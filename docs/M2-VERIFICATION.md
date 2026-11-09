# M2 local verification

Verified 2026-11-09 12:26 Asia/Saigon (UTC+7). M2 remains local only; no M2 push, PR, CI execution or Windows artifact.

## Published M1 is separate

M1 PR: https://github.com/maiphh/taskbar-legends/pull/1 — OPEN, never merged. Preview: https://maiphh.github.io/taskbar-legends/ — HTML/JS/atlas/sprite/font/UI HTTP200, real headless browser debug actions and panel opening verified; no page/asset errors. Embedded raw screenshots return200. Push CI42565503060, PR CI42565763736 and Pages42565503086 pass. First deploy was rejected by environment branch policy; m1-prototype was explicitly allowed, then deployment passed. All shipped third-party assets are CC0, with complete texts/evidence in LICENSES and per-asset CREDITS. Original-code license is not selected.

## M2 checks

- TypeScript, ESLint and all36Vitest tests PASS (22core,13desktop math/controller,1actual-art test). No src/core changes. Brittle damage/XP fixtures were made independent of designer HP/XP tuning.
- Production browser build, npm run shot, npm run shot:desktop PASS.11standard PNGs plus2native-host emulation screenshots; page/asset errors empty. Actual Tauri JS adapter exercised at DPR1/1.25/1.5 with emulated OS IPC; nativeProof=false is explicit.
- Standalone build.mjs and verify.mjs PASS under file:// with3heroes, debug API, no console/page/asset errors. External builder unchanged.
- Rustfmt PASS. Native permissions checked against official Tauri generated-command definitions.
- cargo check/test and debug tauri build attempted; BLOCKED by missing pkg-config/GTK/WebKit prerequisites. Official apt HTTP500/TLS EOF prevented installation. Rust1.99.1 and Tauri2.12 toolchain installed successfully. No signature checking disabled; apt sources restored.
- Windows cross compilation deferred: no Windows SDK, MSVC/resource compiler or LLVM tools. Dedicated windows-latest workflow is ready but held locally. Native runtime and installers are NOT verified.

## Designer configuration snapshot

The latest imported bytes still declare version **1.1.0**, not a completed v1.2 tag. They differ from the published M1 v1.1.0 snapshot and are designer-provided in-flight retuning; no numbers were tuned by the developer. SHA256: `3e5c7bc34a46613c700d0e434aee19c0948133cbbb4ffe4398a42bd06c8ee798`. It was unchanged through the full verification sequence and identical to the shared design config at completion. This fingerprint, not the reused version string, identifies this measurement. Later designer delivery needs another import/run.

Seven-day seed1: highest **2-10**, gold **22,938,527**, roster **18/18**, pulls **250**, losses **18**, retries/boss starts **20**, boss failures **18**.

| Target | Measurement | Diagnostic result |
|---|---|---|
| 1 | `{"openSeconds":139.75}` | PASS |
| 2 | `{"openHours":1.773097222222222}` | PASS |
| 3 | `{"day":3}` | FAIL |
| 4 | `{"seeds":10000,"initialRoster":"3 starter heroes","medianPullsToFullRoster":124,"minPulls":25,"maxPulls":803,"observedRarityRates":{"common":0.49954182649192747,"rare":0.32923887322841905,"epic":0.13088257068862919,"legendary":0.040336729591024266},"referenceRosterDay":3}` | FAIL |
| 5 | `{"highestCleared":7,"firstClear1_8OpenSeconds":null}` | PASS |
| 6 | `{"minSeconds":26.55,"maxSeconds":49.05,"samples":5130}` | FAIL |
| 7 | `{"maxSeconds":44.6,"pending":[]}` | PASS |

Targets requiring100-seed medians remain aggregatePass=null; these are seed1 diagnostics, not population proof. Target4 separately runs10,000gacha seeds. Reports: sim-ref-7d.json, sim-1h.json, docs/M2-RETUNE.json. Published M1 reports/screenshots remain unchanged on m1-prototype; root reports in this M2 branch describe the newer snapshot.

## Native acceptance / scope decisions

The latest160/488logical-pixel native-host requirement is retained while ui.md source pixels stay1:1physical: the canvas is bottom-anchored with extra transparent padding above at high DPI. Windows bounds changes use one main-window-only Win32 SetWindowPos transaction without activation/z-order changes; other platforms use Tauri setters. Hit tests use window-relative CSS regions (including padding), converted to exclusive physical-pixel bounds. See M2-ARCHITECTURE.md and M2-WINDOWS-TESTS.md.

Still requires real Windows: compositor transparency, actual underlying-app clicks through visible sprites/spells/ground, polling boundary races, focus, taskbar/auto-hide changes, hotplug/per-monitor DPI, installers and save behavior. Top/side taskbars retain a horizontal bottom-work-area layout. Tiny-work-area management fallback, automatic exclusive-fullscreen hiding and virtual-desktop policy are not implemented.
