# Implementation results — 2026-11-16

Implemented the planned Noto Sans typography and persistent campaign/boss status. No save schema, combat balance, or Rust changes were made. Noto Sans files match the supplied upstream SHA-256 values; the current source glyph set is covered by Noto plus the bundled Galmuri symbol fallback.

## Checks

- `npm test`: **35 files, 311 tests passed**.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `node scripts/font-canvas-check.mjs`: passed. It instruments the actual browser `fillText` calls and asserts the requested semibold 12px lane face and regular 12px recruit reveal face are used after raster resizing; screenshot: `artifacts/font-canvas-draw-check.png`.
- Playwright with installed Google Chrome: fresh context loaded regular, semibold, and symbol faces locally with no asset errors or page errors; main app reload after blocking non-local requests retained fonts/assets. Separate `/control.html` reload passed the same local font check.
- Browser widths 480/640/960: tab bounds do not overlap; wallet and campaign status share the reserved row below tabs. Visually inspected screenshots, including Vietnamese/Cyrillic raster text. Lane status is placed above combat HP bars.
- All five management tabs retained campaign status; from a paused `BOSS_READY` fixture, the shared `Fight boss` action on Stash entered `BOSS_FIGHT` once (`retries: 1`). Selector tests cover farming, both boss CTA labels, boss-stage vs farm-stage labels, pushing, boss fight, complete, pause, and purity. Authority tests cover explicit boss retry, replay deduplication, and menu snapshots not starting combat.
- Recruit x1 and x10 reveal captures completed; x10 returned ten pulls. DPR contexts 1, 1.25, and 2 kept all bundled faces loaded and the canvas pixel-rendering rule intact. `?shot&menu=native` rendered the 760×560 native management variant.

Evidence is in `artifacts/font-campaign-checks.json` and the screenshots `font-campaign-{480,640,960}.png`, `font-campaign-lane-{480,640,960}.png`, `font-campaign-boss-ready-480.png`, `font-campaign-native-shot.png`, `font-campaign-specimen.png`, `font-campaign-stash-960.png`, and `font-campaign-reveal-x{1,10}-960.png`.

Real Tauri window/OS rendering was not run; the `control.html` browser harness verifies independent local font registration only.
