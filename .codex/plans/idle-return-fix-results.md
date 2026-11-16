# Idle return frame and text fix results

## Changes

- Added one source-width layout for welcome rendering and its panel hit region. At 480/640 widths it fits the 4 or 28 chest slots, three hero level tiles, summaries, close and Collect inside the panel. The 960px layout keeps its wide arrangement. Compact welcome panel height is 424 source pixels within the 488px welcome canvas; normal close restores the 160px canvas.
- Replaced active mojibake separators and unsafe reveal name loops with measured, bounded Unicode ellipsizing.
- Added a transient native presentation event. Native compact runtime expands to the welcome height, clamps against the current work area, enables scrolling if clamped, captures pointer input, and hides its separate controls window. Closing restores the current saved bounds without persisting the temporary size. Pending size commands are serialized so a stale welcome resize cannot win after close.
- Preserved the existing font loading and `PixelUI.text` canvas-font restoration behavior.

## Verification

- `npm test` — exit 0; 40 files, 337 tests passed.
- `npm run lint` — exit 0.
- `npm run typecheck` — exit 0.
- `npm run build` — exit 0.
- `npx vitest run tests/compact-runtime.test.ts tests/compact-runtime-policy.test.ts tests/compact-geometry.test.ts tests/welcome-layout.test.ts` — exit 0; 4 files, 31 tests passed.
- `node scripts/idle-return-layout-check.mjs` — exit 0. Eleven browser cases cover source widths 480/640/960, 4/28 chest slots, DPR 1/1.25/2, zoom 1/2, actual Collect/close DOM bounds and hit targets, bundled font readiness/draw face, unchanged game state on Collect, the 240ms early-Collect hold, and reachable Collect in constrained scroll mode. Evidence: `artifacts/idle-return-layout-check.json`.
- `npx tsx scripts/farm-proof-check.ts` — exit 0; existing 9-case deterministic actual-combat smoke remains green.

Visually inspected full screenshots at 480/640 with 28 chest cells and at 960 wide layout. The welcome text, all 28 cells, three level changes and Collect fit and remain readable. The browser stand-in confirms resized source bounds and click routing. Native overlay sizing/input is covered by Tauri mocks, including startup-open 160→488→160, zoom-2 work-area clamping, preference preservation, controls hide/show, and close during an in-flight open resize. Actual native OS execution was not available; the report makes no OS acceptance claim.

Screenshot examples: `artifacts/idle-return-layout-480-28-z1-dpr1.png`, `artifacts/idle-return-layout-640-28-z1-dpr1.png`, `artifacts/idle-return-layout-960-4-z1-dpr1.png`.
