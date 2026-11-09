# M2 — real Windows acceptance checklist

Status: NOT executed on real Windows. Browser IPC emulation and TS math tests are not native click-through, compositor or DPI proof. M2 is local-only until a separate push approval.

## Build / install

1. On Windows 10/11 x64, install stable Rust/MSVC, Visual Studio C++ build tools and the Evergreen WebView2 runtime. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run native:check`, `npm run native:test`.
2. Run `npm run desktop:dev`. For installers run `npm run desktop:build -- --bundles nsis,msi`. MSI may require the Windows VBSCRIPT optional feature. Once M2 may be pushed, `.github/workflows/desktop.yml` builds both formats on windows-latest and uploads `taskbar-legends-windows-x64`; it does not create a release.
3. Install/uninstall both packages on a test account. The build is unsigned: expect SmartScreen; no signing certificate is included. Check `licenses/` includes CREDITS and all third-party notices.
4. Launch: no title bar, rounded/shadow border or taskbar icon; transparent upper region, opaque bottom80 source px; always on top of ordinary desktop windows; no focus steal while idle. Alt+F4 while the HUD has focus closes the app; the tray Save and quit and the HUD **X** button are the normal quit paths. Verify the last save restores after restart.

## Docking / panels

- [ ] Bottom taskbar: window touches work-area bottom, never covers taskbar buttons. Auto-hide toggle, taskbar size, resolution and work-area changes redock within500ms without repeated resize loops.
- [ ] Open Heroes: one height transition160→488 logical px, upward. Close: one488→160. Gear/Recruit tab switches and spells never resize. Record `__shell.getDiagnostics().dockCount`; drift/DPI corrections can legitimately change it.
- [ ] Screen-space unit feet stay fixed throughout open/close. Canvas baseline is136 source pixels closed and464 expanded.
- [ ] Test top/left/right taskbars: current policy is a horizontal strip at the bottom of the usable work area, narrower beside side taskbars. It does not rotate or move above a top-edge taskbar. Check no overlap with excluded bars.
- [ ] Move to another monitor using `await __shell.monitors(); await __shell.selectMonitor(index)`. Test negative desktop coordinates, different resolutions/scales, primary-monitor change, hot-unplug/replug and OS window moves. Current-monitor fallback must not oscillate.
- [ ] Work areas shorter than the requested logical host height clamp to available height. If fewer than488 physical px remain, management can clip: separate scrollable companion-window fallback is NOT implemented. Do not accept that configuration as supported.

## DPI / pixel policy

The latest task explicitly requires160/488 **logical-pixel native hosts**, while ui.md requires160/488 **physical source-pixel framebuffers**. Both are retained: source pixels stay1:1 physical, the canvas is bottom-anchored inside the larger logical host, and extra transparent space appears above at high DPI. No fractional sprite enlargement is used.

| OS scale | Closed native physical height | Canvas physical height | Transparent padding above canvas |
|---|---:|---:|---:|
|100%|160|160|0|
|125%|200|160|40|
|150%|240|160|80|

Expanded native heights are488/610/732 physical px at those scales; source canvas remains488. The window top moves328 logical px; the baseline's screen position remains fixed. Native bounds are rounded physical integers. This is deliberately different from ui.md's original physically160px *host* preference; changing that policy requires only CONFIG.desktop, not combat code.

- [ ] At100/125/150%, inspect physical screenshots: every source pixel is one physical square, no blur/double-DPR scaling. At monitor transfers/DPI-setting changes, bottom edge stays docked and HUD input follows the new CSS offset.
- [ ] Check1920,1366 and2560 physical widths, including a width not divisible by DPI; no overflow or unexpected residual-column gap.
- [ ] Verify sprite outline, pure-white runtime hit silhouette and HP/damage labels over light/dark/busy wallpapers; ceiling alpha is real desktop transparency, not a painted wallpaper.

## Native click-through — essential release gate

1. Put Notepad/Paint/browser buttons behind the overlay. Click in empty ceiling, visible spell pixels, floating damage, heroes, enemies, HP bars and ground. The underlying app MUST receive each click; the game must not activate.
2. Hover/click both HUD islands and the open panel. Those rectangles MUST receive game input. No transparent full-width backdrop may capture clicks. At a boundary, right/bottom are exclusive physical-pixel edges.
3. Rapidly sweep across HUD edges while clicking, double-clicking, dragging, wheel scrolling and using pen/touch if available. The implementation polls the global cursor every16ms, serially, and toggles native `setIgnoreCursorEvents` only on transitions; scheduling/IPC can cause more latency. A wrong recipient is a FAILED native gate, not something CSS can fix. If reliable atomic behavior cannot be demonstrated, use native region handling or companion windows before release.
4. The cursor is a global physical position; `__game.getHitRegions()` returns window-relative CSS rectangles including bottom-anchor padding. Compare diagnostics `ignoring` against actual clicks, not merely the flag's value.
5. Confirm pointer polling does not grab the cursor, steal focus, request accessibility input capture or record clicks/key contents. Only global cursor position and window geometry are read.
6. With the HUD focused, test keyboard panel controls, tab/shift-tab, roster navigation, Escape and game pause. Opening panels must not pause combat implicitly.

## Errors / other pending native policies

- [ ] On a native API error, input is disabled and the host hides; it must never leave an invisible full-monitor blocker. Diagnostics are in `__shell.getDiagnostics().errors`. Terminate/relaunch the process if the fatal adapter error hides it.
- [ ] Lock/unlock, sleep/resume, reconnect displays and restart; verify timestamp catch-up and no duplicate native loops.
- [ ] Exclusive-fullscreen detection/automatic hiding and virtual-desktop policy are NOT implemented. Test manually and quit/hide the overlay when needed; do not claim fullscreen-safe release behavior.
- [ ] Validate ordinary always-on-top behavior versus Task Manager/system dialogs; secure-desktop/UAC and exclusive fullscreen are not promised.

Record OS build, WebView2 version, monitor/work-area rectangles, scale factors, screenshots, diagnostics and pass/fail for every unchecked item. Native acceptance remains blocked until this checklist is run.

## Tray icon and quit

- [ ] Notification-area icon (sword) appears, including in the overflow flyout; tooltip reads Taskbar Legends. Crisp at 100/125/150/200% scaling.
- [ ] Left-click toggles the overlay (Show/Hide); right-click opens the menu with Show/Hide, Opaque window, Save and quit. The Show/Hide label tracks the current state.
- [ ] Opaque window checkbox relaunches into a normal opaque, decorated window with a taskbar button (and back), keeping progress; the choice persists across quit/relaunch (`%APPDATA%\com.taskbarlegends.desktop\shell.json`). `--opaque-window` / `TASKBAR_LEGENDS_OPAQUE=1` force opaque for one launch only.
- [ ] Save and quit (tray) and the HUD **X** button (left of pause; clickable through click-through) exit within ~3 s; relaunch restores progress from the moment of quitting. No leftover process in Task Manager; the tray icon disappears (no ghost icon after hovering the area).
- [ ] Hidden via tray, then Save and quit: progress resumes with offline catch-up for the hidden time.
