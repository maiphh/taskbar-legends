# Phase 2 contract: compact shell and management

Status: prepared by orchestrator; do not implement until Phase 1 passes review. Applies to the `party-v2` preview first. Legacy presentation remains available until Phase 4 activation/migration.

## Deliverable and invariants

The preview opens as a short battlefield, initially 640x160 source pixels, with a small Menu button. It can be moved/resized. Menu opens management without changing the battlefield's world state, native bounds, camera scale, or baseline. Closing management does not quit or pause combat. The main runtime remains the only simulator and save writer.

No character kit, enemy mechanic, economy retune, save migration, automatic application updater, or network feature belongs to this phase. Phase 0 recovery remains usable.

## Pure geometry policy

Add typed, independently testable geometry helpers rather than extending `dockRect` with ad hoc conditionals:

- Preferences contain a version, source viewport width/height, integer zoom `1 | 2`, placement `free | snapped`, optional snapped edge, saved monitor identity, and normalized anchor fractions in [0,1]. Corrupt/missing preferences use safe defaults.
- Initial source viewport is 640x160. Requested source width clamps to [480,1280], height to [160,256], then available physical work area limits the actual window. On unusually small work areas prioritize fitting the window and keeping the Menu/recovery controls reachable over pretending all source limits can be satisfied. Document the small-display fallback.
- Physical width/height are source dimensions multiplied by zoom, rounded to whole physical pixels. CSS dimensions divide by current DPR once. OS DPI does not silently change zoom.
- Given physical work area `(wx,wy,ww,wh)` and window `(w,h)`, restore x as `wx + round(anchorX * max(0,ww-w))`, with analogous y. Clamp x/y so the complete window is reachable. Negative work-area origins are valid.
- In free placement polling never overwrites user x/y or width. On a work-area/DPI change, recompute physical constraints and clamp once only if necessary. On monitor removal choose an available current/primary fallback. Normal monitor moves do not continually fall back to primary.
- Bottom snapping sets y to work-area bottom minus physical height while preserving width and valid x. Dragging out of the snap threshold returns to free mode. Use a named threshold, initially 12 logical pixels converted to physical at the active monitor's scale.
- Preferences are persisted after native move/resize completion, not on every animation/frame. Use a short settle debounce if the platform exposes events rather than an explicit end event. A generation token prevents an old asynchronous monitor query from applying stale bounds after a newer gesture.

Keep `idle | moving | resizing` interaction state separate from `free | snapped` placement. Never call full-width `dockRect()` for the compact preview.

## Native interaction surfaces

Use native drag and resize gestures with explicit Tauri capabilities. Do not implement drag by sampling mouse coordinates and repeatedly fighting the native window manager.

The compact battlefield must remain pass-through outside intentional controls. Prototype a separate small control surface/window (Menu and Edit), with the visual battlefield passive, rather than declaring the existing 16ms cursor polling to be atomic hit routing. If a single-window solution is chosen, demonstrate actual cross-process routing at boundaries before calling it accepted; a diagnostic boolean or CSS test is insufficient.

Edit mode reveals clearly bounded move/resize handles. Clicking the explicit drag handle calls native startDragging; resize handles call startResizeDragging with the correct direction. Entering edit mode may capture the compact battlefield temporarily; Escape exits and restores pass-through. Normal sprites, spell effects, HP bars, and empty transparent space never become hidden drag targets. Edit handles are not active outside their visible regions.

All control/management windows follow Show/Hide and Quit correctly: closing a management window hides/destroys that view only, while Quit flushes the main save once and exits all owned windows. Do not allow a secondary window to call the main-only bounds command for another surface. Capabilities should name intended window labels and only the APIs needed. Retain the existing opaque fallback.

Tray commands must include Show/Hide, Open management, Reset position, Reset size, Opaque window, and Save and quit. Reset works even if saved placement is invalid or the main window is off-screen. No global keyboard hooks are required.

## Runtime and management separation

Use a separate entry/bootstrap branch for management. A management page must not import a module that eagerly starts the game loop or restores a save before detecting its role. A dedicated HTML/JS entry is acceptable. A query parameter alone must not grant extra native authority; check native window labels for privileged commands.

Implement a small command/snapshot boundary shared by browser and native views:

1. The authority owns current GameState, pause state, save store, and a monotonically increasing command revision. Management receives structured-cloned display snapshots, never a mutable reference.
2. Management sends `{requestId, expectedRevision, action}`. Parse the action with the existing schema or a narrow new schema for management actions. Reject unknown actions, missing items, unavailable heroes, insufficient funds, and stale selection/ownership revisions without modifying state.
3. Deduplicate request IDs in a bounded cache. A replay receives the previous result and must not spend or grant anything again. Only acknowledged successful commands increase the command revision.
4. Avoid tying stale-command validation to every simulation tick: ordinary combat progress must not make every click fail. Use a management/economy revision representing the state that the command depends on; document which mutations increment it. Always validate current ownership/funds even when the revision matches.
5. Reply with accepted/rejected status, request ID, current revision, and a fresh snapshot. The view refreshes rejected commands and shows a concise reason. It does not automatically retry a purchase or destructive operation.
6. Publish display snapshots at a bounded cadence (initially <=5Hz) plus immediately after commands. Do not serialize the full event log on every animation frame. Opening a view requests one fresh snapshot; closing it unsubscribes timers/listeners.
7. The native bridge restricts commands to owned local windows and validates payloads at the authority. Management never writes localStorage saves, awards offline progress, creates its own RNG, or starts requestAnimationFrame combat.
8. Browser preview uses the same authority API with an in-page management view. Opening/closing it changes only view state, not the canvas source dimensions. Native management uses a separate resizable window, initially about 760x560 logical pixels, with scrollable content on small work areas.

## Compact battlefield UI

Remove the permanent left/right management islands for party-v2. The whole lane, apart from a restrained status/menu area, becomes available to the shared world projection. Keep stage/boss status and important HP information legible. Boss retry/start is contextual, always explicit, and never triggered by merely opening management.

Keep Menu reachable through both the small visible affordance and the tray. Optionally hide nonessential chrome in quiet mode, but do not make recovery depend on discovering an invisible hot spot.

Resize changes the viewport/camera only. Camera translation and integer art scale must not change attack reach, target selection, unit speed, enemy count, reward rate, or simulation outcome. Active threats and committed attack markers must not be replaced by `+N` when space becomes tight. With the Phase 1 slice there is no reason to omit an attacking unit from rendering.

## Management view content

Tabs and minimum functioning controls:

- Party: selected hero stats, owned roster, assign to three formation slots, auto-party/equip, and pending-stat-change explanation. Keep IDs stable for browser checks.
- Stash: inventory with slot/rarity/owner filters, selected-item comparison, equip target, upgrade action, and pending chest-choice subview. Inventory remains inspectable while a choice waits. Item locks and explicit salvage are completed in Phase 4; do not show a nonfunctional button that implies protection exists already.
- Recruit: ticket balance, actual odds, pity where enabled, x1/x10, and result/history presentation. All spending remains authority validated. No fake banners or click handlers that mutate only the management copy.
- Upgrades: select equipped item and perform the existing upgrade action; expose actual cost/funds/max-level state. No new currency.
- Settings: audio, pause/resume, zoom, placement/reset controls where supported, and readable save recovery/export status. Do not bind pause or purchase shortcuts while the user types in an input field.

Reuse existing working rendering/actions where appropriate, but do not duplicate a second PixelUI/GameState runtime just to get a management window. A DOM management adapter is acceptable if it consumes the same validated authority and displays actual state.

Offline summaries in compact mode become a quiet reviewable notification/badge rather than automatically increasing the battlefield's height. Rewards apply once at the main authority. Closing a summary merely acknowledges it.

## Acceptance checks

1. Geometry tests across work areas with positive/negative coordinates, all taskbar edges, mixed DPI 1/1.25/1.5/2, invalid preferences, monitor removal, and a work area smaller than nominal minimum. No NaNs, off-screen Menu, or oscillating full-width reset.
2. Move/resize event tests: user changes survive the next poll; stale asynchronous polls cannot undo newer placement; a settled gesture persists once; reopening uses saved width/position.
3. Native source/API checks: every invoked command is registered, expected window labels exist, capability grants match use, Rust state is initialized before dependent commands, and paths/resources build under the Tauri packaging layout. Run native check/tests when a toolchain is available; otherwise explicitly report NOT RUN and retain the native acceptance gate.
4. Authority tests: duplicate request, stale revision, double click, insufficient tickets, invalid item/hero, and request after view close do not duplicate spending/rewards. A successful equip/upgrade appears in the real core state.
5. Browser: opening and closing management 100 times preserves canvas dimensions/baseline, creates one simulator/save writer, and leaves no growing listeners/timers. Commands function in every tab; keyboard navigation, Escape, focus return, and scrolling work.
6. Browser determinism: pause/step identical seed/input sequences with menu operations and resize in one context; compare core snapshots with an untouched control. UI frame timing must not advance or reset combat.
7. Native manual/automated runtime acceptance records actual pointer recipients using another app behind the overlay; buttons work and transparent battlefield clicks go through. Verify dragging/resizing, reset, tray hide/show, quit, and mixed-DPI monitor transfer. No runtime acceptance claim from mocked IPC alone.
8. Preserve Phase 0 recovery/browser tests, all existing legacy tests, full lint/build, and Phase 1 combat tests. Capture compact closed and management-open screenshots at widths 480/640/960 and zoom 1/2 where they fit.

## Handoff

Update the implementation log with exact APIs/files, commands/results, and native gaps. Stop at implemented/awaiting review. The orchestrator spawns a fresh Sol 6.1 medium reviewer and routes defects back to Luna before Phase 3 starts.
