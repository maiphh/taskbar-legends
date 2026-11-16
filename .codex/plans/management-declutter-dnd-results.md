# Management declutter and formation drag-and-drop results

## Implementation

- Replaced the Formation assignment sidebar and repeated instructions with a full-width preset toolbar, three deployed slots, a scrolling roster, concise coverage state, and an explicit Assign/lock row. Short visible names remain distinct; full names and drag help are available to assistive technology and tooltips.
- Added shared, validated `formationDrop` logic for drag-and-drop and keyboard Assign. Slot-to-slot gestures swap; bench heroes replace; accepted commands go through the existing party authority. The view defers content replacement during a gesture, checks the captured revision/party at drop, and suppresses only the matching immediate pointer click.
- Added a single portal tooltip layer for hover, keyboard focus, and dedicated help buttons, with `role=tooltip`, temporary `aria-describedby`, Escape dismissal, and viewport clamping.
- Reduced secondary text in Recruit and Settings. Actual pull prices, pity counters, offline rates/status, primary controls, and upgrade costs stay visible. Full odds, duplicate rules, offline carry/cap details, and save-recovery guidance are available through help. Music/SFX/UI sliders are in a native Mixer disclosure.

## Verification

- `npm test`: exit 0, **41 test files / 340 tests passed**.
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0.
- `CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node scripts/management-declutter-check.mjs`: exit 0 on three consecutive runs after reviewer fixes (two local runs plus an independent run). The check covers mouse slot swap and bench replacement through authority, same/outside/Escape no-ops, immediate intentional click after drag, stale authority update rejection, keyboard assignment, active simulation ticks during drag, tab/workspace transition cancellation, hover target ARIA handoff, outside click and Escape with focus outside, and close cleanup. Touch coverage uses a real upward roster swipe, a real return swipe to the top, then a stable `elementFromPoint` check at the visible explicit grip before dispatching the touch drag; replacement completed in all three runs. The script also checks 480/640/960 browser layouts, Recruit/Settings help, Mixer disclosure, and a native 760×560 `ManagementView` stand-in. Screenshots are in `artifacts/management-formation-480.png`, `artifacts/management-formation-480-after.png`, `artifacts/management-formation-640.png`, `artifacts/management-formation-960.png`, `artifacts/management-formation-native-760x560.png`, `artifacts/management-recruit-480.png`, and `artifacts/management-settings-480.png`.
- `CHROMIUM_EXECUTABLE_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node scripts/idle-return-layout-check.mjs`: exit 0. Welcome-return checks passed at 480/640/960, with four- and 28-chest layouts, DPR/zoom cases, and early Collect hold; no browser errors. Generated screenshots from this repeat run were restored to their tracked baseline.

The native 760×560 result is a browser stand-in using the production `ManagementView` native variant and a local authority adapter; an actual Tauri OS window was not launched. The initial touch failure was a stale/overlapped grip coordinate after scrolling; the script now reverses the roster scroll with real touch input and verifies the visible grip is the actual hit target before the drag. No gameplay balance, save schema, native host code, or Rust code changed.
