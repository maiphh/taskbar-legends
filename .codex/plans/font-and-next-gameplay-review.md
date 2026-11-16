# Review — 2026-11-16

**GREEN after fix review** — the confirmed P1 below is resolved. Initial findings are retained for traceability.

## P1: Canvas resize resets the requested font before rendering

`src/pixel-ui.ts:237–240` sets `measure.font`, measures the label, then assigns `raster.width` and `raster.height`. Each canvas dimension assignment resets its context state, including `font`. `fillText` consequently draws with the browser default **10px sans-serif**, although sizing/fit decisions use the requested Noto size and weight. This affects persistent lane status, damage labels, banners, welcome-back and recruit reveal text. It also bypasses the bundled symbol fallback and invalidates the claim that canvas uses the shared Noto font contract.

Restore the exact requested font **after both dimension assignments**, before `fillText`. Verify the real canvas drawing context uses the expected face, size and weight (including 22px headings and multilingual/symbol samples), then refresh affected screenshots. Loaded FontFace checks and cmap tests alone do not catch this.

Independent headless Chrome/Playwright probe reproduced the relevant sequence: requested context font `600 22px GameSans, GameSymbols, system-ui, sans-serif`; after setting canvas width/height, actual draw-context font `10px sans-serif`.

## Review scope and checks

- Read plan/results and final source/test/documentation diff; examined font loading, text measurement/rasterization, presentation selector, authority integration, common button pending/focus behavior, and CSS chrome/layout.
- Independently ran font coverage, selectors, management authority and UI token tests: **4 files, 24 tests passed**.
- Inspected actual screenshots: 480px management, closed lane and paused boss-ready; native 760×560; multilingual specimen; 960px Stash comparison and recruit x10 reveal. Management typography/chrome is readable and wallet/tab bounds are separated. The canvas bug must be corrected before accepting the overall typography outcome.
- Selector correctly distinguishes boss target/farm stage, uses stage presentation IDs, and is read-only. Existing retry authority is reused; no save schema/combat/Rust change found. No additional blocking finding identified in the reviewed behavior.
- Full-suite/lint/typecheck/build successes are implementor-reported (311 tests/35 files); this review independently reran the focused 24 tests above. Real Tauri OS rendering remains explicitly unverified, as permitted by the plan.
- Existing evidence JSON records loaded fonts and viewport/DPR coverage, but lacks a reproducible browser script and does not establish requested-font usage at `fillText`; add a direct runtime rendering assertion for the fix. Recheck 480px Formation/Stash/Recruit/Upgrades/Settings and DPR1/1.25/2 after restoring real font metrics, since label sizes will change.

No product code modified by reviewer.


## Fix review — GREEN

- Confirmed `src/pixel-ui.ts` now restores the requested font after both raster dimension assignments and before `fillText`, resolving the context-reset regression.
- Read and independently reran `node scripts/font-canvas-check.mjs` successfully against the running local app. Its interception of actual application `fillText` observed `600 12px GameSans, GameSymbols, system-ui, sans-serif` for the persistent lane and `12px GameSans, GameSymbols, system-ui, sans-serif` for recruit reveal text; all three bundled faces were loaded. The script uses an existing dev server (default `http://127.0.0.1:5173/`, configurable via `FONT_CHECK_URL`).
- Inspected regenerated 480px closed lane, 960px x10 reveal, and the independently regenerated `font-canvas-draw-check.png` x1 reveal. Lane text now uses the expected readable semibold size; reveal labels use the intended font and fit their cards. No new clipping/overlap regression found in these representative images.
- Post-fix full suite (311 tests/35 files), lint, typecheck and build are implementor-reported passing. Earlier focused independent checks remain 24/24 passing. No save or authority code changed during this fix.

No remaining blocking review findings. Real Tauri OS rendering remains unverified as previously disclosed. The browser regression script covers actual 12px regular/semibold calls; it does not independently establish every heading/sample/DPR combination, so the conclusion is bounded to source inspection and the recorded browser evidence rather than native acceptance.
