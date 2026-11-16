# Management declutter / formation DnD review — 2026-11-16

**GREEN after fix review** — both P2 cleanup defects and the failed touch acceptance check below are resolved. Initial findings are retained for traceability.

## P2 — Leaving Formation does not cancel an active drag

`src/management/view.ts:191–195,527` changes tab/workspace without calling `cancelFormationGesture`. Content replacement is deferred by the gesture, and drop validity checks only revision/party, so the old formation targets can still submit after navigating away.

Independent real-browser reproduction: pause; open Formation; hold Front and move over Rear; focus Recruit tab and press Enter while mouse remains held; release. Selected tab becomes Recruit but authoritative party changes from `[mw2,mw1,priest]` to `[priest,mw1,mw2]`. Switching away must cancel with no command. Cancel before tab/workspace transitions and guard drop against inactive Formation. Add integration coverage. Also route below-threshold pointerup through gesture cleanup so any deferred render is replayed even when no subsequent click occurs.

## P2 — Hover target changes leak tooltip ARIA descriptions

`src/management/tooltip.ts:33–37` overwrites `this.target` before removing the old target's description. When the timer calls `show(newTarget)`, its old-target cleanup cannot find the previous element. Moving directly from a visible Front tooltip to Rear leaves Front permanently referencing the singleton tooltip. Future tooltip text can then describe multiple unrelated controls; hide only cleans the latest target.

Reproduced by real hover Front, wait300ms, hover Rear, wait300ms: both elements retain `aria-describedby="px-management-tooltip"`. Clean the previous anchor before replacing it (or keep pending and visible anchors separate), and assert all descriptions are removed after dismissal. The pinned outside-tap listener is also attached only to the management root (`:20–24`), so a tap outside the sheet cannot dismiss it; use document-level outside handling with disposal. Ensure Escape works for a hover tooltip even when current focus is outside the root, rather than depending only on root keydown.

## Mandatory touch verification currently fails reproducibly

Independently ran `node scripts/management-declutter-check.mjs` twice; both exit1 at line122: `touch grip did not assign`. After the successful roster swipe, the attempted640px grip gesture's pointerdown targets the card instead of the grip; party remains `[mw2,mw1,priest]`, scrollTop84, status empty. No product root cause is asserted from this alone: the script may be using coordinates while scroll motion/layout is still changing. Stabilize and assert the actual grip hit point, then verify the intended touch route. Do not retain a reported passing touch check while the reproducible acceptance script fails.

## Checks and visual assessment

- Independently ran formation helper and management authority tests: **2files/13tests passed**.
- The browser script completes its mouse swaps/replacement, no-op/Escape/stale gesture and keyboard checks before failing at touch. This does not establish the later native branch as independently passed.
- Inspected actual480 Formation,480 Settings/Recruit and native760×560 Formation PNGs. Full-width roster/slots are substantially less crowded; costs, pity counters, selection/Assign and pending encounter cue remain visible. Font sizes are readable. No additional visual blocker found.
- Reviewed shared helper purity, revision use, render deferral, pointer capture, touch-action rules, pending command gate and late command generation checks. No direct core/save mutation added. Full340test/lint/typecheck/build results are implementor-reported; focused independent tests above pass.

No product code modified by reviewer. No native OS acceptance claimed.


## Fix review — GREEN

- Verified tab/workspace/open transitions now cancel the gesture, drop requires active Formation, and below-threshold release runs central cleanup/deferred-render replay.
- Tooltip hover state is separated from the visible target; replacing a target clears its old ARIA description. Document-level outside-pointer and Escape handlers dismiss pinned/hover help even with focus outside the sheet and are disposed through the shared AbortController.
- Independently reran `node scripts/management-declutter-check.mjs`: **exit0**. The revised real-browser checks exercise held-drag tab/workspace cancellation without assignment, Front→Rear tooltip ARIA cleanup, outside/Escape dismissal, mouse/keyboard assignment, concurrent-authority stale cancellation, and native760×560 drop/tooltip stand-in. Battle ticks advanced28→34 during the held gesture.
- The640px touch fixture now first verifies real upward roster scrolling, swipes back down to the top, then requires three stable handle bounds and an actual `elementFromPoint` grip hit before injecting the real CDP touch drag. This resolves the prior clipped-coordinate false assumption; the reproduced grip assignment passes. It demonstrates scrolling plus a visible top-row grip drag, **not arbitrary clipped lower-row grip dragging or480px touch acceptance**.
- Independently reran helper/authority tests: **2files/13tests passed**. Full41file/340test, lint/typecheck/build remain implementor-reported passing.

No remaining blocking review finding. Actual native OS behavior remains unverified; the native evidence is a browser stand-in. No product code modified by reviewer.
