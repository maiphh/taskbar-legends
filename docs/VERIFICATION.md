# Verification — milestone 1

Verified 2026-11-09 11:45 Asia/Saigon (UTC+7). All work local; branch m1-prototype; no remote, push, PR, deploy or merge.

## Automated checks

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run test`: PASS — 23 tests across core and actual art pixels. Includes same-state-every-tick determinism, explicit deterministic hit events, all retry/boss rules, role skills/damage basics, save/offline, deterministic reference policy, one million gacha pulls/distribution/pity.
- `npm run build`: PASS.
- `npm run shot`: PASS — 11 PNGs, browser/asset errors empty, native-pixel DPI emulation, accessible panel controls and real actions.
- `VITE_BASE_PATH=/taskbar-preview/ npm run shot`: PASS; root build restored afterward.
- `npm audit`: 0 vulnerabilities after patched development matcher override.
- Art verification: 18 heroes + 9 enemies / 1285 frames. Actual baked-ink maximum 128px above / 18 below; baseline136 fits y=8..154 exclusive. No forbidden runtime reference/vendor files.

## One-hour no-input simulation

`sim-1h.json`: seed1, 72,000 ticks / 1 open hour. Highest clear **1-9**, farming 1-9; status **Boss 1-10 ready, click to fight**. Gold **13,331**; losses **1**, retries **1**, boss failures **0**. A boss was never entered without input.

`sim-hit-events.json` is the short CLI `--events full` artifact exposing hit attackerId/targetId/damage and enclosing tick.

## Seven-day reference policy, seed1

`sim-ref-7d.json`: seven6h sessions, six capped8h overnight credits, 42h open. Highest clear **2-9**, **Boss 2-10 failed, tap to retry**, gold **3,303,842**, roster **17/18**, pulls **117**. Losses **27**, retries/boss-start actions **28**, boss failures **23**.

These are per-seed diagnostics, not claims about100-seed medians. Only the gacha-only10,000-seed cohort was run at population scale.

| Target | Measured | Result |
|---|---|---|
| 1 | 1-5 clear 110.95s (limit600s) | PASS (single seed) |
| 2 | Chapter1 boss 0.4469 open hours (target1.5–2.5h) | FAIL (single seed) |
| 3 | Chapter2 boss not cleared by day7 (targetday4–6) | FAIL (single seed) |
| 4 | 10,000-seed median 124 pulls (target100–140), reference roster17/18 atday7 | Gacha PASS; reference roster PENDING through day8 |
| 5 | No-input 1-8 clear at 221.95s (must never clear within1h) | FAIL (single seed) |
| 6 | Farm clears 33.85–90.9s (target20–40s) | FAIL (single seed) |
| 7 | Maximum non-boss stall 628.85s (limit2700s) | PASS (single seed) |

The delivered v1 balance was deliberately preserved. Designer tuning is needed for targets2,3,5,6; target4 reference timing remains observable throughday8. Pending population medians are explicitly null in JSON.

## Visual/browser evidence

- `shots/01-pushing-1280.png`: initial battle, three heroes/enemies, HP bars, damage, gold and status.
- `shots/02-boss-ready-1280.png`: natural1h boss gate.
- `shots/03-farming-1280.png` / `04-farming-640.png`: labelled failed-frontier fixture and compact layout.
- `shots/05-heroes-panel-1280.png`, `06-gear-panel-1280.png`, `07-recruit-panel-1280.png`: functional management shells compared with supplied mockups.
- `shots/08-strip-reference-1920.png`: reference-width HUD.
- `shots/09-dpi125-canvas.png`: emulated125% physical-pixel rendering.
- `shots/10-hit-flash-1280.png`: tick1 hero+enemy pure white runtime silhouettes.
- `shots/11-hit-recovered-1280.png`: +100ms, runtime flash expired.
- `shots/final-state.json`, `panel-state.json`, `hit-flash-state.json`: exact corresponding state/layout contexts.
- `shots/ui-checks.json`: machine-readable UI assertions.

PNG files were opened with Read and compared to the supplied strip/panel mockups. Main visual corrections included outlined sheets, baseline136, proportional field anchors, native pixel fonts, 9-slice plates, HP bars at coreY-6, field-only clipping, damage label cap/coalescing and compact controls. Uniform flash is generated from every outlined sheet once, not dependent on baked source flashes. The final cleaned plain/outlined art delivery is included and each atlas bakedHitFlash=false is enforced by tests; source animation timing remains independent.

## Not claimed / remaining scope

No native Windows/Tauri tests: actual click-through even through visible sprite/spell pixels, work-area/taskbar docking, fullscreen policy, monitor transfer, actual WindowsDPI and companion windows remain M2. The browser's CSS input routing is not a substitute. Management panels are functional shells: no manual salvage, animated summon reveal/Skip, inventory filters, Vietnamese localization, 2x zoom setting or separate native compact management window. See UI-CHECKS.md and DECISIONS.md.
