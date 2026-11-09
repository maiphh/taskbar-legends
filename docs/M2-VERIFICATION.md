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

The latest imported bytes still declare version **1.1.0**, not a completed v1.2 tag. They differ from the published M1 v1.1.0 snapshot and are designer-provided in-flight retuning; no numbers were tuned by the developer. SHA256: `787f61ad785decb1070272d8fdcfb42826d96e184a10d8044e85d4286598d5bc`. It was unchanged through the full verification sequence and identical to the shared design config at completion. This fingerprint, not the reused version string, identifies this measurement. Later designer delivery needs another import/run.

Seven-day seed1: highest **2-10**, gold **20,963,172**, roster **18/18**, pulls **296**, losses **16**, retries/boss starts **18**, boss failures **16**.

| Target | Measurement | Diagnostic result |
|---|---|---|
| 1 | `{"openSeconds":121.75}` | PASS |
| 2 | `{"openHours":2.3558055555555555}` | PASS |
| 3 | `{"day":4}` | PASS |
| 4 | `{"seeds":10000,"initialRoster":"3 starter heroes","medianPullsToFullRoster":124,"minPulls":25,"maxPulls":803,"observedRarityRates":{"common":0.49954182649192747,"rare":0.32923887322841905,"epic":0.13088257068862919,"legendary":0.040336729591024266},"referenceRosterDay":4}` | FAIL |
| 5 | `{"highestCleared":7,"firstClear1_8OpenSeconds":null}` | PASS |
| 6 | `{"minSeconds":24.05,"maxSeconds":45.05,"samples":5518}` | FAIL |
| 7 | `{"maxSeconds":42.6,"pending":[]}` | PASS |

Targets requiring100-seed medians remain aggregatePass=null; these are seed1 diagnostics, not population proof. Target4 separately runs10,000gacha seeds. Reports: sim-ref-7d.json, sim-1h.json, docs/M2-RETUNE.json. Published M1 reports/screenshots remain unchanged on m1-prototype; root reports in this M2 branch describe the newer snapshot.

## Native acceptance / scope decisions

The latest160/488logical-pixel native-host requirement is retained while ui.md source pixels stay1:1physical: the canvas is bottom-anchored with extra transparent padding above at high DPI. Windows bounds changes use one main-window-only Win32 SetWindowPos transaction without activation/z-order changes; other platforms use Tauri setters. Hit tests use window-relative CSS regions (including padding), converted to exclusive physical-pixel bounds. See M2-ARCHITECTURE.md and M2-WINDOWS-TESTS.md.

Still requires real Windows: compositor transparency, actual underlying-app clicks through visible sprites/spells/ground, polling boundary races, focus, taskbar/auto-hide changes, hotplug/per-monitor DPI, installers and save behavior. Top/side taskbars retain a horizontal bottom-work-area layout. Tiny-work-area management fallback, automatic exclusive-fullscreen hiding and virtual-desktop policy are not implemented.
