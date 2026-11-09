# Local M2 desktop shell

`src/core/` is unchanged. `src/platform/desktop/math.ts` owns physical monitor rectangles and CSS-to-screen hit conversion; `controller.ts` owns idempotent docking and ignore-state transitions; `tauri.ts` adapts the public Tauri2 window APIs. No game tuning is performed here.

A single serialized16ms cursor loop reads native client position/scale and `__game.getHitRegions()`, then toggles `setIgnoreCursorEvents`. A500ms work-area refresh plus scale/move listeners redock the current monitor; requested panel height is read from UI layout, not combat events. Actual native bounds are checked so OS-initiated movement is corrected. Native setters run only when a size/position changes. A narrow app command applies Windows bounds with one Win32 SetWindowPos transaction (NOACTIVATE/NOZORDER), avoiding the visible intermediate rectangle from separate JS resize/move IPC calls; non-Windows uses the public Tauri setters. Startup stays hidden/click-through until assets and docking are ready. Native API failure switches to click-through and hides the host.

The original browser renderer still uses a native-pixel framebuffer. The Tauri CSS class anchors it at the host bottom; hit regions now include `canvas.getBoundingClientRect()` offsets. See M2-WINDOWS-TESTS for the explicit logical-host versus physical-canvas resolution. Browser builds do not initialize native APIs; the standalone builder still produces one classic script/file with inlined assets.

## Debug / run

- `npm run desktop:dev`: Tauri + Vite; `npm run desktop:build -- --bundles nsis,msi`: Windows installers.
- `npm run native:check`, `npm run native:test`, `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.
- `window.__game` remains unchanged except hit regions now correctly include canvas placement within the native host.
- Native only: `__shell.getDiagnostics()`, `await __shell.monitors()`, `await __shell.selectMonitor(1)`, `await __shell.quit()` (save then exit, same path as the tray/menu-bar Quit and the desktop-only HUD X button).
- `npm run shot:desktop`: Playwright runs the actual production adapter/UI with an explicitly emulated native IPC boundary at100/125/150%; validates logical host heights, one-time panel resize, tab stability, hit transitions, drift correction and fail-safe hiding. This is NOT real OS click-through proof.

Native capabilities are limited to the local main window's monitor/geometry, cursor, ignore-input, visibility and close operations plus listener registration, the main-window-only bounds command, and the shell mode/save-then-exit commands (`shell_mode`, `quit_app`, `relaunch_app`). The tray/menu-bar menu (Show/Hide, Opaque window, Save and quit) is native; it asks the page to flush localStorage before exiting and force-exits after 3 s if the page never answers. The opaque-window choice persists in `shell.json` in the app config directory and applies on relaunch. That command validates dimensions and is explicitly gated by its generated app permission. There is no filesystem/shell/plugin/remote-origin grant. License texts and credits are bundled as application resources. The generated app icon is original geometric placeholder art.

## Build limitation on this box

Stable Rust1.99.1 and TauriCLI/API2.12.4 were installed successfully; Rust crate resolution/lockfile and rustfmt succeed. Official Debian apt repositories could not be reached (HTTP500, then TLS EOF over HTTPS). No signatures/checks were disabled, no mirror/proxy bypass was attempted, and apt sources were restored. pkg-config, GTK/WebKit dev prerequisites therefore remain absent. Default `cargo check`, `cargo test` and a debug `tauri build --no-bundle` were attempted and fail in GTK/GIO dependency build scripts before this app is compiled. Logs are in `/workspace/taskbar-legends-local-backups/m2-*.log` (the initial cargo-check output is also a tool terminal log).

Linux native execution/package generation is not verified. Cross-compiling Windows is deferred: no Windows SDK/MSVC/resource toolchain is installed, and the dedicated windows-latest workflow is the reasonable path for real installers. M2 push is on hold, so that workflow has not run and no Windows artifact exists yet. See the manual Windows checklist for remaining acceptance gates.
