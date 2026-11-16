# Idle return frame/text review — 2026-11-16

**GREEN** — no blocking findings in the responsive welcome/text/native presentation delta.

## Assessment

- Welcome paint, panel hit surface and close/Collect controls now use the same source-width geometry. At supported480/640 widths, rewards, all28chest cells, three level summaries, stage/rate/ticket copy and footer fit the frame;960 retains the wide arrangement. Recruit geometry remains separate.
- Active separator/ellipsis source corruption is repaired. The shared ellipsis helper decreases a bounded code-point search interval, handles insufficient space and avoids splitting surrogate pairs. The prior nonterminating remove2/add3 loop is gone. Canvas font restoration after raster sizing and antialiased source text remain intact.
- Native frontend presentation state temporarily overrides physical height without modifying saved CompactPrefs. Input becomes interactive, controls hide, constrained height enables scrolling, and close returns to underlying saved geometry. The bounds queue plus generation checks prevents the pending-open resize from becoming final after close. Reviewed the delayed test: it actually keeps the open IPC unresolved while close queues, then resolves and asserts the final normal160px bounds; it is not an early false pass.
- No reward/proof/restore calculations were changed for this presentation fix. Prior idle/proof deltas remain separately reviewed work.

## Independent verification

- `npx vitest run tests/compact-runtime.test.ts tests/compact-runtime-policy.test.ts tests/compact-geometry.test.ts tests/welcome-layout.test.ts`: **4files,31tests passed**.
- `node scripts/idle-return-layout-check.mjs`: passed all **11width/DPR/zoom cases**, plus early Collect240ms hold and constrained native-scroll stand-in. Actual control bounds/hit targets are contained, requested bundled22px heading draw font is observed, both font weights load, Collect leaves account state unchanged, controls disappear and canvas returns488→160. No page errors.
- Inspected independently regenerated full PNGs:480/640 with28cells and960 with4cells. Frame, text and Collect remain within the canvas; normal UTF-8 labels and readable font rendering are visible.
- Native mock tests cover startup-open expansion/collapse, zoom2work-area clamping/scroll class, controls/input policy, preference-write suppression and close during a pending open resize. These establish frontend contracts; actual native OS behavior remains explicitly unverified.

Full40file/337test, lint/typecheck/build successes are implementor-reported. This review independently reran the focused tests/browser script above. The script primarily verifies paused presentation fixtures; it does not independently exercise every optional acceptance scenario (for example real OS scrollbar/DPI behavior or every extreme-total/choice-copy variant). No claim of native execution or broader economy certification is made.

No product code modified by reviewer. Generated verification artifacts and this review report were written.
