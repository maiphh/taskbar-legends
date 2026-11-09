# M2 macOS test build (manual acceptance pending)

This test build is on draft PR #2 (`m2-tauri-shell`), not a separate PR. The game core, balance config, Windows bounds transaction, and Windows configuration are unchanged.

## Download and first launch

1. Download `taskbar-legends-macos-universal-unsigned` from the latest successful **Desktop shell builds** run on PR #2. It contains a universal `.app.zip`, a `.dmg`, and SHA256SUMS. Both arm64/Apple Silicon and x86_64/Intel slices are checked with `lipo`. macOS 14+ is required.
2. Mount the DMG and drag **Taskbar Legends.app** into Applications, or unpack the app zip with Archive Utility. Do not run a partially unpacked `.app` or run directly from the GitHub artifact zip. Keep only one instance running to avoid competing save writers.
3. This is not Developer-ID signed and is not notarized. It uses only a local ad-hoc signature (`-`), with no certificate or Apple account, because Apple Silicon needs a valid bundle signature. Gatekeeper will still block it initially. The artifact's "unsigned" label means no Apple-authenticated publisher, not the complete absence of an ad-hoc signature.
4. Try **right-click → Open → Open**. On newer macOS, use **System Settings → Privacy & Security → Open Anyway** after attempting launch. Only approve the artifact you deliberately downloaded from this repo.
5. If quarantine still prevents this trusted test build from launching, inspect its checksum and remove quarantine only from this app, not globally:

   ```sh
   xattr -dr com.apple.quarantine "/Applications/Taskbar Legends.app"
   ```

   Do not disable Gatekeeper globally. If it still fails, capture the exact error and macOS version. Do not infer that a green CI build proves first-launch behavior.

## Opaque normal-window fallback

Quit the existing process first. Then either:

```sh
open -n "/Applications/Taskbar Legends.app" --args --opaque-window
```

or:

```sh
TASKBAR_LEGENDS_OPAQUE=1 "/Applications/Taskbar Legends.app/Contents/MacOS/taskbar-legends"
```

Fallback is an 800×488 logical-pixel, opaque, decorated, resizable normal window, with a Dock icon and normal focus. It is not always-on-top; native docking, monitor selection and cursor click-through polling are disabled. Panels stay inside this ordinary window. The native window itself is created with transparency **off**, not merely covered with opaque CSS. The same fallback (flag and tray checkbox) now also exists on Windows; the default Windows overlay is unchanged. Quit and reopen without the flag to restore overlay mode.

The menu-bar **Opaque window** checkbox is the persistent way to switch: it saves the choice to `shell.json` in the app config directory (`~/Library/Application Support/com.taskbarlegends.desktop/`), flushes the game save, and relaunches into the chosen mode (transparency cannot change on a live window). The flag/env var only forces opaque for that one launch and is dropped on relaunch, so the saved choice then applies.

## Overlay behavior and deliberate limits

- Transparent, frameless, topmost overlay; `macOSPrivateApi` plus Tauri's required `macos-private-api` feature are enabled in shared config because `tauri-build` validates that pair on every target; the API is AppKit-only and does not change Windows window settings (Tauri 2.12.1+ already enables these APIs on macOS). This is outside the Mac App Store.
- Accessory activation policy is set **before** creating the Mac window: no Dock icon in overlay mode. Normal fallback uses Regular policy.
- Visible on all ordinary Spaces. `accept_first_mouse` allows the initial HUD click. There is no custom NSPanel conversion or elevated fullscreen-app overlay level in this small test build. A fullscreen app's dedicated Space may hide the overlay; record this limitation rather than marking fullscreen acceptance as passed.
- Same monitor work-area adapter and global-cursor `setIgnoreCursorEvents` loop as Windows. Fixed 160/488 logical host, upward panel expansion, native-pixel art and bottom anchoring remain unchanged. Work areas are polled and re-docked on monitor/scale changes.
- Left/right Dock positions use the excluded work-area width and origin; the strip remains horizontal at the bottom of the usable area. Bottom Dock uses the work-area bottom. No fixed Dock-height assumption.
- Auto-hide follows the work area macOS actually reports. Click-through outer gutters permit reaching the Dock activation edge. Some macOS versions do not shrink `visibleFrame` when an auto-hidden Dock is temporarily revealed; in that case the Dock can cover the strip temporarily. No Dock preferences are changed, no extra global input permissions are requested, and no private Dock-size heuristics are used. This behavior needs real-device review.
- WebKit background throttling is disabled on supported macOS 14+; verify actual idle/Spaces behavior, rather than claiming the game remains active from compilation alone.
- Menu-bar icon (template image, adapts to light/dark menu bar) with **Show/Hide**, **Opaque window** and **Save and quit**. Clicking the icon opens the menu (standard macOS behavior). The desktop HUD also has an **X** button (left of pause) that runs the same save-then-exit path; it is part of `getHitRegions()` so it stays clickable through click-through. No global quit shortcut.

## Manual checklist — all require a real Mac

- [ ] Install and first-launch the app zip and DMG on Apple Silicon; repeat on Intel if available. Check the expected Gatekeeper warning and successful explicit approval.
- [ ] Overlay has transparent upper pixels, readable sprites/HUD, no frame/shadow and no Dock icon. Fallback has opaque pixels, title bar, normal focus and Dock icon.
- [ ] Underlying app receives clicks through transparent pixels and the battlefield; HUD islands capture only their hit regions. An open panel captures its rectangle, then releases it after closing. No invisible full-width blocker after a native cursor failure.
- [ ] Open/close a panel: one 160↔488 logical resize per edge, growing upward without moving the strip's screen-space baseline. Switching tabs does not resize again.
- [ ] Dock bottom, left and right: overlay stays within the reported usable area and never covers a permanently visible Dock. Check menu-bar/notch interaction.
- [ ] Enable Dock auto-hide; reveal/hide it at every edge and on each monitor. Check activation works and record temporary overlap versus stable work-area re-docking.
- [ ] Retina 2× and non-Retina 1×: crisp art, consistent physical-pixel baseline/hit regions, correct click boundaries, no drift on moving to another scale.
- [ ] Multiple monitors with negative origins/different scaling; select a display through `__shell.selectMonitor(index)` in a dev build, hotplug, and change primary display. Check fallback can be dragged normally without being forced back.
- [ ] Switch ordinary Spaces and Mission Control; check the all-Spaces request. Enter/leave another app's fullscreen Space and record the known NSWindow limitation. Also test Stage Manager if used.
- [ ] Let the overlay idle in the background; confirm simulation/save/load and offline catch-up, with no duplicate app process writing the same save.
- [ ] Menu-bar icon is visible and crisp in light and dark menu bars (template tinting), including on a notched display with a crowded menu bar.
- [ ] Show/Hide hides and restores the overlay; label flips between Hide and Show. Game saves on hide and catches up on show.
- [ ] Opaque window checkbox: toggling relaunches into the other mode within a few seconds, with progress intact; the checkbox state matches the mode after relaunch, and the choice survives a normal quit/relaunch.
- [ ] Save and quit (menu-bar and HUD X): app exits within ~3 s; relaunch shows the progress from the moment of quitting (not the last 5 s autosave). Exactly one process remains after relaunch (Activity Monitor).
- [ ] Quit/relaunch in overlay and fallback modes. Windows acceptance checklist remains separate in `M2-WINDOWS-TESTS.md`.

## What CI and emulation prove

CI compiles/tests on macOS, Windows and Linux, verifies the universal binary's two architectures and ad-hoc signature, and preserves app executable bits/symlinks with `ditto`. The browser-native IPC emulator covers 100/125/150/200% scaling plus the opaque fallback's no-docking/no-click-through path. None of those is proof of macOS compositor, Gatekeeper, Dock, Spaces or real pointer behavior.

References: [Tauri config](https://v2.tauri.app/reference/config/), [macOS signing/ad-hoc](https://v2.tauri.app/distribute/sign/macos/), [DMG](https://v2.tauri.app/distribute/dmg/), [fullscreen NSWindow limitation](https://github.com/tauri-apps/tauri/issues/11488).
