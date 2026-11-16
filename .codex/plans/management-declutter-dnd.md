# Declutter management and add formation drag-and-drop

Planner GPT-6.1 Sol high, 2026-11-16. Implementor GPT-6 Luna high; fresh reviewer GPT-6.1 Sol medium. User: “Current UI is too cramped and too many text, can move info into tool tips, hover. Formation should support drag and drop.” This is authorized implementation following this handoff. Current HEAD `cb4db81` (`feat: adjust idle mechanics`) has the earlier idle/proof/welcome fixes committed by the user and the tree was clean on parent inspection. Preserve that baseline. No commit/push/publish/toolchain installation. No product changes by Planner.

## Diagnosis and bounded direction

`management/view.ts:party()` currently renders a long instruction line, preset/apply/auto-equip/workspace controls, three slots, then a roster and176–190px assignment sidebar. At480px the sidebar uses nearly half the available body. `.px-formation-roster` (`style.css:225–244`) is constrained to `calc(100%-224px)`, leaving only a couple of columns. The loadout repeats the selected hero name/title and footer instructions; Settings leads with four offline-policy lines and all audio buses before placement/zoom controls. Help relies on a few native `title` attributes; there is no consistent accessible tooltip system. Only sliders currently implement pointer dragging.

Keep the existing five tabs, hero-centered loadout, native760x560 variant and compact management dimensions. **Formation becomes a concise toolbar, a full-width row of three deployed slots, then a full-width scrollable roster/bench, with a short explicit Assign action row.** Remove the explanatory sidebar and redundant prose; retain important state/actions. Add one small reusable tooltip/help layer for secondary information, usable through hover, keyboard focus and dedicated tap help controls. Add real PointerEvents formation drag/drop through the existing authoritative `{type:'party',heroIds}` action. No drag-to-equip, implicit inspection mutation, new game rules, combat pause or new tabs.

## Information hierarchy and layout

Always visible: current selected hero and position, selected slot, Front/Middle/Rear labels, deployment/bench cue, item ownership/lock state, actionable price/funds, primary buttons, campaign/boss action, error/warning/pending state. Do not hide anything necessary to understand what a click purchases or changes. Full hero names that ellipsize remain available accessibly.

Move secondary explanations to hover/focus/help:

| Current content | New treatment |
| --- | --- |
| Long formation instructions, enemy direction explanation | one help trigger; retain short slot labels and drag affordance |
| Coverage paragraph and preset-lock/manual-override explanation | compact role/coverage badge; details on hover/focus/tap help; visible warning if a role is missing |
| Assignment sidebar | remove; use full width for roster and bottom short `Assign to Front` + preset lock toggle |
| Repeated loadout hero name and “Select a hero, then choose gear...” footer | keep one main title; remove duplicate/instructions; hover/focus gear/hero shows concise useful details |
| Gear implementation text such as “Party utility gain...” and repeated mechanics prose | secondary explanation tooltip; keep actual stats/comparison deltas/cost/equip/upgrade explicit in inspector |
| Recruit duplicate rules/full odds/extra pity explanations | concise visible ticket spending and primary pity status; `Odds & pity` help with actual configured rates/guarantees/duplicate policy, accessible by tap too |
| Settings offline four-line policy | one compact farm/rate row plus visible earned/fallback badge; XP/chest/carry/cap explanation via help |
| All4 audio sliders displayed at once | master volume visible; existing music/SFX/UI in a simple optional `Mixer` disclosure if needed to regain space (no new tab) |
| Dev/runtime/recovery reminders in normal Settings | remove internal dev copy; put relevant optional recovery help behind Help; actual errors remain visible |

Use whitespace/hierarchy rather than smaller text: body12px, secondary11px; never solve density by shrinking to8–9px. Aim8–12px gaps between sections and usable28–32px controls. Formation slot cards can retain meaningful portraits/names; scale horizontal gaps to available width. Full roster should have considerably more usable room at480 after removing sidebar; scroll normally to all18 heroes. Native layout should use its extra height for larger cards/gaps, not more paragraphs. Header/campaign/wallet must remain aligned and unclipped.

Change CSS for **active management views**; clean conflicting duplicate formation rules when replacing them, but avoid broad unrelated legacy CSS deletion. Prefer scoped grid/flex layouts over inline x offsets for Formation's new toolbar/slots/roster/action row. Retain stable data-action/data-control selectors where useful; update real browser checks when intentional labels change.

## Tooltip/help contract

Suggested small `src/management/tooltip.ts` controller/helper, created once per ManagementView and disposed with its AbortController. One tooltip at a time, with escaped text from current actual data; no HTML injection. Use `role="tooltip"`, stable ID and `aria-describedby` while shown; preserve an existing accessible name. Native `title` alone is insufficient.

- Hover target or keyboard focus reveals after a short delay (roughly250ms); leave/blur hides with a small grace period if helpful. `Escape` dismisses tooltip first, not the entire management menu. Dedicated `?`/info buttons can toggle help on click/touch and close on outside tap. They must be sibling controls, not nested buttons.
- A tap/click on a hero, gear or primary command retains its normal action; never turn its first tap into tooltip-only behavior or issue a gameplay command while showing help. For touch, use dedicated help icons for extra policy text; detailed hero/item inspectors remain available by their existing explicit buttons.
- Tooltip text is read-only; do not put Equip/Assign/confirmation buttons inside role=tooltip. A simple disclosure can hold longer selectable detail if needed. No essential workflow becomes hover-only.
- Render via a body portal/fixed overlay or another strategy that escapes `.px-menu {overflow:hidden}`. Place relative to target `getBoundingClientRect()` and clamp to visible viewport/panel work area; account for native integer panel transform and scroll. No tooltip may overflow480px or sit under a clipped root. Max width about240–280px, wrap,12px/16px readable text.
- Hide and clean aria-describedby on tab/subview changes, close/dispose, scroll/resize, reveal, drag start, missing/removed anchor and external redraw replacing nodes. Delayed timers cannot resurrect a tooltip after close or attach descriptions to stale elements. Avoid rerendering the whole menu just to show a tooltip.
- Maintain tooltip focus dismissal with polling. Fresh snapshots may update data, but do not repeatedly announce/recreate a tooltip at200ms intervals. One controller/listener set, no per-refresh leaks.

## Formation drag/drop behavior

### Data/action semantics

- Source is an owned hero card in Formation roster or an occupied deployed slot. Target is one of the three deployed slots. Mouse dragging should work directly on the card; touch uses an explicit drag grip/handle so vertical roster scrolling stays usable. Indicate drag capability visually and in accessible label/help.
- Deployed->another deployed slot swaps IDs. Dragging a roster hero already deployed uses the same swap. Benched hero->slot replaces that slot and sends displaced hero to bench. Dropping on same slot, outside all slots, invalid hero, canceled pointer, close/tab change or Esc produces **no command**.
- Build exactly3 distinct owned IDs. Existing preset locks protect automatic presets, not deliberate manual changes: manual drag has the same semantics as existing Assign, with lock meaning explained in tooltip. Do not add lock restrictions to DnD only.
- Continue selection-only click inspection. Moving a pointer without meeting drag threshold is a click, not assignment. After an actual drag, suppress the resulting synthetic click so it cannot inspect/select/reassign again.
- Submit a single `{type:'party', heroIds: next}` through existing `command()`/ManagementClient authority. No direct mutation of snapshot/core, no new save writer. Do not optimistically commit party order before accepted reply. Display drop preview/highlight and a small pending state while waiting, then accepted/rejected feedback. Simulation continues throughout.
- Current core queues changed party at next encounter/rebuild. Keep a concise visible “Next encounter” cue for a genuinely pending formation (compare selected partyIds to actual deployed IDs via a small read-only snapshot field if needed); tooltip explains exact timing. Never mutate live combat units to make drag appear immediate.

### Exact integration points

1. Extract a small pure `formationDrop(partyIds,ownedIds,sourceHeroId,targetSlot)` helper (e.g. `src/management/formation.ts`) shared with current `data-assign` handler at view.ts:434, eliminating divergent swap/replacement logic. Validate source/slot/uniqueness and return no-op/null explicitly.
2. Extend `ManagementView` with **separate** formation pointer state; existing `dragging` is for audio sliders. Suggested fields: pointerId, heroId/source slot, startXY, started flag, captured revision/partyIDs, generation and targetSlot; plus formation-command-pending and one-shot click suppression.
3. Route pointerdown/move/up/cancel/lostcapture through stable root listeners (existing view.ts:191–194). Ignore nonprimary button/multitouch and disabled/pending controls. Start real drag after6–8px threshold. Capture pointer on stable root; determine target using client coordinates and `document.elementFromPoint(...).closest('[data-party-slot]')` because captured events target the root. Limit accepted targets to this same open ManagementView.
4. Touch grip alone has `touch-action:none`; roster remains `touch-action:pan-y`/normal scrolling elsewhere. A span grip inside a card button avoids invalid nested buttons. Prevent native browser image dragging (`draggable=false`) and accidental text selection during an actual drag. Do not call preventDefault on all roster pointerdown events. Avoid HTML5-only DnD because touch/native WebView support would be uneven.
5. Optional ghost follows cursor with pointer-events:none; derive it from current portrait/name safely and clip/clamp within menu/viewport. Target has a distinct outline; original slot/card still visible. Cancel restores all classes/cursor/capture/ghost/tooltip state.
6. `refresh()` updates snapshotValue every200ms and `renderContent()` may run from other async paths (comparison/atlas/font loads/commands). While a formation pointer gesture is active, defer content replacement centrally in `renderContent`, not only the refresh caller. Store a dirty flag/replay render after cleanup. Keep stable source/targets while the pointer is captured; header polling need not pause simulation. Dismiss ghost/tooltip before replaying delayed content.
7. Capture selected partyIDs and authority revision at drag start. At drop, compare against latest snapshot/generation/ownership. If a native/other command changed authority revision or party, cancel with refreshed explanation instead of silently applying a stale intent to another arrangement. Use captured/current-equivalent expectedRevision in the actual request; authority still handles a race occurring after local checks. Do not rebase behind the user's back. Harmless tick-only updates do not cancel a drag.
8. Disable further formation submission while one is pending. A second pointerup/click cannot issue another request. On reject/stale, refresh and preserve valid selection; on close, a late reply cannot resurrect drag UI. Use existing generation guard in command/isLive. Escape should cancel active drag before tooltip/menu handling. Clean on pointercancel, lostpointercapture, page blur, tab/subview changes, close/dispose.

### Keyboard alternative

Keep the existing explicit path with concise labels: select hero, select Front/Middle/Rear, activate `Assign to Front`. It uses the same helper/authority as DnD and remains reachable by Tab/Enter/Space. The full hero and target names belong in accessible labels/help. Preserve selection/focus after refresh/assignment. Do not use deprecated aria-dropeffect or claim native accessible drag when the explicit keyboard assignment is the alternative. Announce accepted swap/replacement and rejected stale/canceled action through existing role=status (avoid announcing every pointermove).

## Files and preservation

Primary changes: `src/management/view.ts`, `src/style.css`, new small tooltip and formation helpers, focused unit tests and a reproducible browser script. `management/authority.ts` may add read-only deployed IDs/pending detail if required; action validation and core party behavior already exist and should remain authoritative. Native management uses the same view class; no Rust/new IPC needed. Preserve native temporary welcome expansion/controls/input policy and responsive welcome rendering. No new font package or icon library.

## Acceptance and verification

Focused meaningful tests:

- Pure helper: Front/Middle/Rear swaps, roster deployed swap, bench replacement, same-slot no-op, unknown/not-owned hero, bad slot, duplicate party and invalid length; input arrays unchanged.
- Authority regression: one valid drag-shaped action changes3 distinct owned IDs; replay request has no second effect; stale expectedRevision rejects and refreshes; live encounter units remain unchanged until actual rebuild; preset locks retain manual-override semantics. Existing tests supply patterns.
- Pointer controller/integration: below-threshold click doesn't submit; valid drag submits exactly once; outside/same/cancel/Esc/lostcapture/close do not submit; synthetic click suppressed; pending double drop blocked; tick-only snapshot leaves gesture alive while party/revision conflict cancels; delayed atlas/compare refresh does not replace gesture source; late reply after close doesn't alter UI. Test actual event integration, not only helper output.
- Tooltip: focus/hover/tap-help visibility, proper accessible description cleanup, primary click unchanged, Escape first dismisses, scroll/close/drag cancels pending timers, viewport clamping at480 and native scaling. Keep tests proportionate; a real browser is useful for coordinates.

Run full `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`. Preserve existing gameplay/idle/proof/welcome tests. Do not change balance or snapshot formats to satisfy UI tests.

Actual browser evidence (mandatory, use existing Playwright/local Chrome conventions and port as available):

1. At480/640/960 CSS widths and native760x560 variant, capture before/after Formation and hero loadout; at least480/960 Settings and Stash/Recruit representative after screens. Verify readable text, more empty space, no sidebar crowding, all18 heroes accessible, no clipped controls or accidental horizontal frame overflow. No unnecessary default paragraphs. Main necessary labels/costs remain understandable without hover.
2. Real `page.mouse` down/move/up through pointer events: drag Front to Rear (swap), bench hero to Middle (replacement), deployed hero from roster to another slot (swap). Assert exact authoritative partyIDs and one revision/action. Drop outside and same slot must leave party unchanged. Screenshot mid-drag with visible target and accepted result.
3. Drag while simulation runs/polls for longer than200ms; ensure source remains stable, battle tick advances, and one intended action applies. Trigger a real second authority change midgesture to verify stale cancel/reject, and delayed command reply/double release to verify pending gate. Verify queued encounter behavior and farm-proof validity reacts normally to real selection changes.
4. Keyboard select/slot/Assign path works without pointer. Tooltip on focus shows and Escape hides before closing menu. Touch emulation: roster swipe scrolls, explicit handle drag assigns, tapping card still selects/inspects without equipping. Verify primary action isn't consumed by help.
5. Hover/focus/tap help near panel corners stays in bounds and contains accurate current rules. Scroll/change tab/close/drag clears tooltip and aria-describedby. Reopen repeatedly to check no ghosts/tooltips/listeners accumulate.
6. Native management stand-in with integer scale and constrained viewport: tooltip positioning/drop detection use actual client boxes, not unscaled token coordinates. Real Tauri/native OS execution remains unverified if unavailable; do not install toolchains. Run a quick welcome regression after these shared CSS/view changes to ensure the recently fixed frame does not regress.

Save a concise results report, meaningful screenshots/check JSON under artifacts and `.codex/plans/management-declutter-dnd-results.md`. Record actual tested paths and any limitations. Fresh Sol medium reviews final delta, browser evidence and interaction safety; Luna resolves actionable findings before final delivery. User expects the implemented declutter and DnD, not just this plan.
