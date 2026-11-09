# UI handoff implementation gates

The seven acceptance gates in ui-v1.md explicitly require **actual Tauri/Windows**, unavailable in this Linux browser M1. The following is the precise browser evidence; no native gate is falsely marked fully passed.

| Gate | Browser/art result | Native result |
|---|---|---|
|1. Click-through air and visible sprites/spells; controls work | PASS input-region shape: exactly two HUD islands, plus open panel; no full-strip capture. Actual buttons/actions exercised. | NOT TESTED: native desktop click-through deferred M2. |
|2. Fixed160 host across every animation; baseline136; outlined envelope | PASS: all1285 actual outlined frames fit128px above/18below at136; top8/bottom6 clearance; combat step1000 causes no resize. | OS window resize callbacks not tested. |
|3. One resize160→488; tabs no resize; one close; feet fixed relative bottom | PASS browser backing-store resize counts; baseline136→464, same24px bottom offset; panel doesn't pause battle. | Screen-space taskbar/outer-window top anchoring deferred M2. |
|4. Readability and baked outlines; HP coreY-6 | PASS outlined sheets default, no runtime second stroke; native pixel text, capped/stroked damage; checker background and supplied mockup comparison. Uniform90ms white flash additionally tested. | Real wallpaper/native compositing remains untested. |
|5. Physical source pixels at100/125/150% DPI; monitor transfer | PASS Chromium emulation:1920×160 backing at DPR1/1.25/1.5, CSS heights160/128/106.6667, no sprite resampling, smoothing false after resize. | Actual Windows DPI/monitor/residual-column transfer untested. |
|6.18 heroes, actual odds/prices, insufficient funds, keyboard, localization | PASS all18 reachable via End/Home/arrows and scroll; inspection doesn't equip; real upgrades/pulls; insufficient ticket buttons disabled; explicit English-only/localization warning. | No claim of Vietnamese/CJK coverage; native compact-window fallback untested. |
|7. Exclude refs/previews/archives/unused vendor; retain licenses | PASS runtime packaging scan. Only four used font faces+CC0 text, derived UI frames/icons+Kenney license, approved sprite atlases. Research and vendor archives excluded. | Applies to eventual package too; rerun guard then. |

## M1 shell limitations, explicitly not hidden

- Management is functional, not a complete polished game UI: manual salvage/confirmation, inventory filters and animated summon Skip are not exposed; current results are immediate with a recent-history view.
- Compact HUD engages below1000 source pixels for browser usability, earlier than the handoff's below608-only island shrink. Below736 it draws two representative enemies plus +N; core still simulates every enemy. The below608 separate normal management-window fallback and explicit2x accessibility zoom are M2.
- All primary UI text is pre-rasterized after FontFace readiness and thresholded to monochrome alpha. Accessible DOM buttons carry names, tooltips and keyboard focus, but no antialiased visible text. Hover/pressed/selected/disabled/focus styles use supplied 9-slices and palette.
- getHitRegions() returns CSS rectangles; getLayout().sourceHitRegions supplies source/physical coordinates. A tested native per-region adapter or companion-window design is still required.

Machine evidence: ../shots/ui-checks.json. Retained source UI specification: ui-v1.md.
