# Verification — milestone 1

Historical published-M1 checkpoint; on the M2 branch use `M2-VERIFICATION.md` for current measurements. Root sim/shot artifacts on M2 may reflect a newer designer snapshot.

Verified 2026-11-09 12:01 Asia/Saigon (UTC+7). All work local; branch m1-prototype; no remote, push, PR, deploy or merge.

## Automated checks

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run test`: PASS — 23 tests across core and actual art pixels. Includes same-state-every-tick determinism, explicit deterministic hit events, all retry/boss rules, role skills/damage basics, save/offline, deterministic reference policy, one million gacha pulls/distribution/pity.
- `npm run build`: PASS.
- `npm run shot`: PASS — 11 PNGs, browser/asset errors empty, native-pixel DPI emulation, accessible panel controls and real actions.
- `VITE_BASE_PATH=/taskbar-legends/ npm run shot`: PASS; root build restored afterward.
- `npm audit`: 0 vulnerabilities after patched development matcher override.
- Art verification: 18 heroes + 9 enemies / 1285 frames. Actual baked-ink maximum 128px above / 18 below; baseline136 fits y=8..154 exclusive. No forbidden runtime reference/vendor files.

## One-hour no-input simulation

`sim-1h.json`: designer config **v1.1.0**, seed1, 72,000 ticks / 1 open hour. Highest clear **1-6**, farming 1-6 toward failed stage1-7; status **Farming 1-6, next try in 6:02**. Gold **12,377**; losses **10**, retries **9**, boss failures **0**. No boss was entered without input.

`sim-hit-events.json` is the short CLI `--events full` artifact exposing hit attackerId/targetId/damage and enclosing tick.

## Seven-day reference policy, seed1

`sim-ref-7d.json`: designer config **v1.1.0**, seven6h sessions, six capped8h overnight credits, 42h open. Highest clear **2-10** (campaign complete), gold **15,933,311**, roster **18/18**, pulls **126**. Losses **24**, retries/boss-start actions **26**, boss failures **24**.

These are per-seed diagnostics, not claims about100-seed medians. Only the gacha-only10,000-seed cohort was run at population scale.

| Target | Measured | Result |
|---|---|---|
| 1 | 1-5 clear112s (limit600s) | PASS (single seed) |
| 2 | Chapter1 boss2.06278 open hours (target1.5–2.5h) | PASS (single seed) |
| 3 | Chapter2 boss cleared day4 (targetday4–6) | PASS (single seed) |
| 4 | 10,000-seed median124 pulls (target100–140); reference roster complete day3 (targetday6–8) | FAIL reference timing; gacha median PASS |
| 5 | No-input highest clear1-6; never clears1-8 within1h | PASS (single seed) |
| 6 | Farm clears22.75–37.75s,4681 samples (target20–40s) | PASS (single seed) |
| 7 | Maximum non-boss stall32.75s (limit2700s) | PASS (single seed) |

Retune: v1.0 → v1.1 changes XP curve, enemy spawn and pacing, enemy/boss stats, ticket rate, gear stats/upgrades, and some wave compositions. The exact shared JSON is copied to `src/design-config.json`; SHA256 **529080c22c11dff4c8a4075780c73afd971f3027d419b691217017dc74194450**. The first refresh raced a concurrent designer update, so those preliminary results were discarded and the entire verification/sim/shot/standalone sequence was rerun against a digest-stable v1.1.0 delivery. The config remained identical to the shared delivery at completion. The XP test now uses configured first-level XP rather than obsolete hardcoded40. No core logic changed.

Earlier v1 results passed targets1/7, failed2/3/5/6 and left target4 reference timing pending. The designer retune fixes those four seed-1 failures, while reference roster completion is now earlier than the stated window. Population medians remain unverified.

## Visual/browser evidence

- `shots/01-pushing-1280.png`: initial battle, three heroes/enemies, HP bars, damage, gold and status.
- `shots/02-baseline-1h-1280.png`: natural1h farming frontier (retuned config).
- `shots/03-farming-1280.png` / `04-farming-640.png`: labelled failed-frontier fixture and compact layout.
- `shots/05-heroes-panel-1280.png`, `06-gear-panel-1280.png`, `07-recruit-panel-1280.png`: functional management shells compared with supplied mockups.
- `shots/08-strip-reference-1920.png`: reference-width HUD.
- `shots/09-dpi125-canvas.png`: emulated125% physical-pixel rendering.
- `shots/10-hit-flash-1280.png`: tick1 hero+enemy pure white runtime silhouettes.
- `shots/11-hit-recovered-1280.png`: +100ms, runtime flash expired.
- `shots/final-state.json`, `panel-state.json`, `hit-flash-state.json`: exact corresponding state/layout contexts.
- `shots/ui-checks.json`: machine-readable UI assertions.

PNG files were opened with Read and compared to the supplied strip/panel mockups. Main visual corrections included outlined sheets, baseline136, proportional field anchors, native pixel fonts, 9-slice plates, HP bars at coreY-6, field-only clipping, damage label cap/coalescing and compact controls. Uniform flash is generated from every outlined sheet once, not dependent on baked source flashes. The final cleaned plain/outlined art delivery is included and each atlas bakedHitFlash=false is enforced by tests; source animation timing remains independent. `shots/deflash-spot-check.png` visually confirms clean, normally colored hit frames for Hero Knight, Goblin, Skeleton, Mushroom and Evil Wizard. Runtime flash is white only during its90ms window; recovery shot is captured100ms later.

The standalone file demo was rebuilt with `/workspace/taskbar-legends-standalone/build.mjs` and verified under `file://`; three heroes, no console/page/asset errors, debug API present. The external builder remains unmodified.

## Not claimed / remaining scope

No native Windows/Tauri tests: actual click-through even through visible sprite/spell pixels, work-area/taskbar docking, fullscreen policy, monitor transfer, actual WindowsDPI and companion windows remain M2. The browser's CSS input routing is not a substitute. Management panels are functional shells: no manual salvage, animated summon reveal/Skip, inventory filters, Vietnamese localization, 2x zoom setting or separate native compact management window. See UI-CHECKS.md and DECISIONS.md.
