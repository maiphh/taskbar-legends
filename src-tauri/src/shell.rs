//! Desktop-only window mode, tray/menu-bar menu and save-then-exit lifecycle.
//! The deterministic game core never sees any of this.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

/// How long the webview gets to flush localStorage before the process exits anyway.
pub const EXIT_GRACE: Duration = Duration::from_secs(3);
/// Short settle after the webview acknowledges, so the engine can persist storage.
pub const EXIT_SETTLE: Duration = Duration::from_millis(250);
pub const QUIT_EVENT: &str = "shell://quit";
pub const RELAUNCH_EVENT: &str = "shell://relaunch";
const PREFS_FILE: &str = "shell.json";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PixelRect { x: i32, y: i32, width: u32, height: u32 }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Insets { left: u32, top: u32, right: u32, bottom: u32 }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ManagedBounds { frame: PixelRect, client_width: u32, client_height: u32 }

fn fit_managed_bounds(frame: PixelRect, client_width: u32, client_height: u32, insets: Insets, work: PixelRect) -> ManagedBounds {
    let fits = frame.x >= work.x && frame.y >= work.y
        && i64::from(frame.x) + i64::from(frame.width) <= i64::from(work.x) + i64::from(work.width)
        && i64::from(frame.y) + i64::from(frame.height) <= i64::from(work.y) + i64::from(work.height);
    if fits { return ManagedBounds { frame, client_width, client_height }; }
    let max_client_width = work.width.saturating_sub(insets.left.saturating_add(insets.right)).max(1);
    let max_client_height = work.height.saturating_sub(insets.top.saturating_add(insets.bottom)).max(1);
    let client_width = client_width.min(max_client_width).max(1);
    let client_height = client_height.min(max_client_height).max(1);
    let width = client_width.saturating_add(insets.left).saturating_add(insets.right).min(work.width);
    let height = client_height.saturating_add(insets.top).saturating_add(insets.bottom).min(work.height);
    let max_x = i64::from(work.x) + i64::from(work.width - width);
    let max_y = i64::from(work.y) + i64::from(work.height - height);
    ManagedBounds { frame: PixelRect { x: i64::from(frame.x).clamp(i64::from(work.x), max_x) as i32,
      y: i64::from(frame.y).clamp(i64::from(work.y), max_y) as i32, width, height }, client_width, client_height }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ShellMode {
    Overlay,
    Window,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExitKind {
    Quit,
    Relaunch,
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellPrefs {
    #[serde(default)]
    pub opaque_window: bool,
}

/// Missing, unreadable or malformed preferences fall back to the transparent overlay.
pub fn parse_prefs(bytes: Option<&[u8]>) -> ShellPrefs {
    bytes
        .and_then(|bytes| serde_json::from_slice(bytes).ok())
        .unwrap_or_default()
}

/// Explicit one-launch override; it never rewrites the saved preference.
pub fn opaque_forced(env: Option<&str>, args: &[String]) -> bool {
    env == Some("1") || args.iter().any(|arg| arg == "--opaque-window")
}

pub fn resolve_mode(forced: bool, prefs: &ShellPrefs) -> ShellMode {
    if forced || prefs.opaque_window {
        ShellMode::Window
    } else {
        ShellMode::Overlay
    }
}

/// Label for the Show/Hide item given the window's current visibility.
pub fn visibility_label(visible: bool) -> &'static str {
    if visible {
        "Hide"
    } else {
        "Show"
    }
}

fn relaunch_arguments(party_preview: bool) -> Vec<&'static str> {
    if party_preview { vec!["--party-preview"] } else { Vec::new() }
}

/// Exit requests are idempotent: the first one wins, the rest are ignored.
#[derive(Default)]
pub struct ExitGate {
    requested: AtomicBool,
    finished: AtomicBool,
}

impl ExitGate {
    pub fn request(&self) -> bool {
        !self.requested.swap(true, Ordering::SeqCst)
    }
    pub fn finish(&self) -> bool {
        self.requested.store(true, Ordering::SeqCst);
        !self.finished.swap(true, Ordering::SeqCst)
    }
}

pub struct ShellState {
    pub mode: ShellMode,
    pub prefs_path: Option<PathBuf>,
    pub party_preview: bool,
    pub exit: ExitGate,
    visibility: Mutex<VisibilitySnapshot>,
}

#[derive(Default)]
struct VisibilitySnapshot { hidden_by_tray: bool, controls: bool, management: bool }

pub fn write_prefs(path: &std::path::Path, prefs: &ShellPrefs) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension("json.tmp");
    std::fs::write(
        &temp,
        serde_json::to_vec_pretty(prefs).map_err(std::io::Error::other)?,
    )?;
    std::fs::rename(temp, path)
}

#[cfg(desktop)]
pub mod native {
    use super::*;
    use tauri::menu::{CheckMenuItem, MenuBuilder, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{AppHandle, Emitter, Manager, State, Wry, WebviewUrl};

    pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
        let prefs_path = app
            .path()
            .app_config_dir()
            .ok()
            .map(|dir| dir.join(PREFS_FILE));
        let prefs = parse_prefs(
            prefs_path
                .as_ref()
                .and_then(|path| std::fs::read(path).ok())
                .as_deref(),
        );
        let forced = opaque_forced(
            std::env::var("TASKBAR_LEGENDS_OPAQUE").ok().as_deref(),
            &std::env::args().collect::<Vec<_>>(),
        );
        let mode = resolve_mode(forced, &prefs);
        // macOS reads the activation policy when a window is created.
        #[cfg(target_os = "macos")]
        app.set_activation_policy(match mode {
            ShellMode::Window => tauri::ActivationPolicy::Regular,
            ShellMode::Overlay => tauri::ActivationPolicy::Accessory,
        });
        let mut config = app
            .config()
            .app
            .windows
            .first()
            .ok_or("Missing main window")?
            .clone();
        let party_preview = std::env::args().any(|arg| arg == "--party-preview");
        if party_preview { config.url = WebviewUrl::App("party-preview.html".into()); }
        let builder = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
        let builder = match mode {
            ShellMode::Window => builder
                .title("Taskbar Legends — opaque window")
                .transparent(false)
                .background_color(tauri::window::Color(23, 33, 45, 255))
                .decorations(true)
                .always_on_top(false)
                .skip_taskbar(false)
                .shadow(true)
                .resizable(true)
                .focused(true)
                .inner_size(800.0, 488.0)
                .center(),
            // Windows/Linux overlay is exactly the declarative tauri.conf.json window.
            ShellMode::Overlay => overlay_platform(builder).resizable(party_preview),
        };
        app.manage(ShellState {
            mode,
            prefs_path,
            party_preview,
            exit: ExitGate::default(),
            visibility: Mutex::new(VisibilitySnapshot::default()),
        });
        builder.build()?;
        let extra_windows = &app.config().app.windows;
        let controls = extra_windows.iter().find(|window| window.label == "controls").ok_or("Missing controls window config")?;
        tauri::WebviewWindowBuilder::from_config(app.handle(), controls)?.build()?;
        let management = extra_windows.iter().find(|window| window.label == "management").ok_or("Missing management window config")?;
        let management_window = tauri::WebviewWindowBuilder::from_config(app.handle(), management)?.build()?;
        let management_for_close = management_window.clone();
        management_window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = management_for_close.hide();
                let _ = management_for_close.emit("management://native-close", ());
            }
        });
        build_tray(app.handle(), mode)?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn overlay_platform<'a>(
        builder: tauri::WebviewWindowBuilder<'a, Wry, AppHandle>,
    ) -> tauri::WebviewWindowBuilder<'a, Wry, AppHandle> {
        builder
            .visible_on_all_workspaces(true)
            .accept_first_mouse(true)
            .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
    }

    #[cfg(not(target_os = "macos"))]
    fn overlay_platform<'a>(
        builder: tauri::WebviewWindowBuilder<'a, Wry, AppHandle>,
    ) -> tauri::WebviewWindowBuilder<'a, Wry, AppHandle> {
        builder
    }

    fn build_tray(app: &AppHandle, mode: ShellMode) -> tauri::Result<()> {
        let show_hide =
            MenuItem::with_id(app, "show-hide", visibility_label(true), true, None::<&str>)?;
        let open_management = MenuItem::with_id(app, "management", "Open management", true, None::<&str>)?;
        let reset_position = MenuItem::with_id(app, "reset-position", "Reset position", true, None::<&str>)?;
        let reset_size = MenuItem::with_id(app, "reset-size", "Reset size", true, None::<&str>)?;
        let opaque = CheckMenuItem::with_id(
            app,
            "opaque",
            "Opaque window",
            true,
            mode == ShellMode::Window,
            None::<&str>,
        )?;
        let quit = MenuItem::with_id(app, "quit", "Save and quit", true, None::<&str>)?;
        let menu = MenuBuilder::new(app)
            .item(&show_hide)
            .item(&open_management)
            .item(&reset_position)
            .item(&reset_size)
            .separator()
            .item(&opaque)
            .separator()
            .item(&quit)
            .build()?;
        #[cfg(target_os = "macos")]
        let tray = TrayIconBuilder::with_id("main")
            .icon(tauri::include_image!("icons/tray-template.png"))
            .icon_as_template(true);
        // Windows: left-click toggles, right-click opens the menu.
        #[cfg(not(target_os = "macos"))]
        let tray = TrayIconBuilder::with_id("main")
            .icon(tauri::include_image!("icons/tray.png"))
            .show_menu_on_left_click(false);
        let menu_label = show_hide.clone();
        let click_label = show_hide.clone();
        tray.tooltip("Taskbar Legends")
            .menu(&menu)
            .on_menu_event(move |app, event| match event.id().as_ref() {
                "show-hide" => toggle_visibility(app, &menu_label),
                "management" => show_management(app),
                "reset-position" => { let _ = app.emit_to("main", "compact://reset-position", ()); }
                "reset-size" => { let _ = app.emit_to("main", "compact://reset-size", ()); }
                "opaque" => switch_mode(app, &opaque),
                "quit" => request_exit(app, ExitKind::Quit),
                _ => {}
            })
            .on_tray_icon_event(move |tray, event| {
                if cfg!(target_os = "macos") {
                    return; // macOS menu-bar extras open their menu on click.
                }
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    toggle_visibility(tray.app_handle(), &click_label);
                }
            })
            .build(app)?;
        Ok(())
    }

    fn toggle_visibility(app: &AppHandle, label: &MenuItem<Wry>) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let visible = window.is_visible().unwrap_or(false);
        let state = app.state::<ShellState>();
        let mut snapshot = state.visibility.lock().unwrap_or_else(|poison| poison.into_inner());
        let control = app.get_webview_window("controls");
        let management = app.get_webview_window("management");
        if visible {
            snapshot.hidden_by_tray = true;
            snapshot.controls = control.as_ref().is_some_and(|value| value.is_visible().unwrap_or(false));
            snapshot.management = management.as_ref().is_some_and(|value| value.is_visible().unwrap_or(false));
            let _ = window.hide(); if let Some(value) = control { let _ = value.hide(); } if let Some(value) = management { let _ = value.hide(); }
        } else {
            if window.show().is_ok() {
                if snapshot.hidden_by_tray && snapshot.controls { if let Some(value) = control { let _ = value.show(); } }
                if snapshot.hidden_by_tray && snapshot.management { if let Some(value) = management { fit_management_window(app, &value); let _ = value.show(); let _ = value.emit("management://open", ()); } }
                snapshot.hidden_by_tray = false;
            }
        }
        let _ = label.set_text(visibility_label(!visible));
    }

    fn show_management(app: &AppHandle) {
        if let Some(window) = app.get_webview_window("management") {
            fit_management_window(app, &window);
            let _ = window.show(); let _ = window.set_focus(); let _ = window.emit("management://open", ());
        }
    }

    /// Preserve a contained manager frame; otherwise fit the decorated frame and client to a live work area.
    fn fit_management_window(app: &AppHandle, window: &tauri::WebviewWindow) {
        let monitor = window.current_monitor().ok().flatten()
            .or_else(|| app.get_webview_window("main").and_then(|main| main.current_monitor().ok().flatten()))
            .or_else(|| window.primary_monitor().ok().flatten())
            .or_else(|| window.available_monitors().ok().and_then(|all| all.into_iter().next()));
        let Some(monitor) = monitor else { return; };
        let work_area = monitor.work_area();
        let Ok(outer_position) = window.outer_position() else { return; };
        let Ok(outer_size) = window.outer_size() else { return; };
        let Ok(inner_position) = window.inner_position() else { return; };
        let Ok(inner_size) = window.inner_size() else { return; };
        let left = u32::try_from((inner_position.x - outer_position.x).max(0)).unwrap_or(0);
        let top = u32::try_from((inner_position.y - outer_position.y).max(0)).unwrap_or(0);
        let insets = Insets { left, top,
            right: outer_size.width.saturating_sub(inner_size.width).saturating_sub(left),
            bottom: outer_size.height.saturating_sub(inner_size.height).saturating_sub(top) };
        let frame = PixelRect { x: outer_position.x, y: outer_position.y, width: outer_size.width, height: outer_size.height };
        let work = PixelRect { x: work_area.position.x, y: work_area.position.y, width: work_area.size.width, height: work_area.size.height };
        let target = fit_managed_bounds(frame, inner_size.width, inner_size.height, insets, work);
        if target.frame != frame {
            let _ = window.set_size(tauri::PhysicalSize::new(target.client_width, target.client_height));
            let _ = window.set_position(tauri::PhysicalPosition::new(target.frame.x, target.frame.y));
        }
    }

    fn switch_mode(app: &AppHandle, item: &CheckMenuItem<Wry>) {
        let state = app.state::<ShellState>();
        let checked = item.is_checked().unwrap_or(state.mode == ShellMode::Window);
        let saved = state
            .prefs_path
            .as_ref()
            .ok_or_else(|| std::io::Error::other("No config directory"))
            .and_then(|path| {
                write_prefs(
                    path,
                    &ShellPrefs {
                        opaque_window: checked,
                    },
                )
            });
        match saved {
            // Relaunch into the chosen native window type; transparency cannot change live.
            Ok(()) => request_exit(app, ExitKind::Relaunch),
            Err(_) => {
                let _ = item.set_checked(!checked);
            }
        }
    }

    /// Ask the webview to flush its save; it answers with quit_app/relaunch_app.
    /// If it never answers (crashed/hung page), exit after a bounded grace period.
    pub fn request_exit(app: &AppHandle, kind: ExitKind) {
        if !app.state::<ShellState>().exit.request() {
            return;
        }
        let event = match kind {
            ExitKind::Quit => QUIT_EVENT,
            ExitKind::Relaunch => RELAUNCH_EVENT,
        };
        let delivered = app
            .get_webview_window("main")
            .is_some_and(|window| window.emit(event, ()).is_ok());
        let handle = app.clone();
        std::thread::spawn(move || {
            if delivered {
                std::thread::sleep(EXIT_GRACE);
            }
            finish(&handle, kind);
        });
    }

    fn finish(app: &AppHandle, kind: ExitKind) {
        if !app.state::<ShellState>().exit.finish() {
            return;
        }
        std::thread::sleep(EXIT_SETTLE);
        if kind == ExitKind::Relaunch {
            // Relaunch without the one-shot override so the saved choice applies.
            if let Ok(exe) = std::env::current_exe() {
                let _ = std::process::Command::new(exe)
                    .args(relaunch_arguments(app.state::<ShellState>().party_preview))
                    .env_remove("TASKBAR_LEGENDS_OPAQUE")
                    .spawn();
            }
        }
        app.exit(0);
    }

    #[tauri::command]
    pub fn shell_mode(state: State<'_, ShellState>) -> ShellMode {
        state.mode
    }

    #[tauri::command]
    pub fn open_management(window: tauri::WebviewWindow, app: AppHandle) -> Result<(), String> {
        if window.label() != "controls" { return Err("Only the compact controls may open management".into()); }
        show_management(&app); Ok(())
    }

    #[tauri::command]
    pub fn hide_management(window: tauri::WebviewWindow) -> Result<(), String> {
        if window.label() != "management" { return Err("Only management may hide its own view".into()); }
        window.hide().map_err(|error| error.to_string())
    }

    #[tauri::command]
    pub fn request_compact_edit(window: tauri::WebviewWindow, app: AppHandle) -> Result<(), String> {
        if window.label() != "controls" { return Err("Only the compact controls may request edit mode".into()); }
        use tauri::Emitter;
        let main = app.get_webview_window("main").ok_or("Main battlefield is closed")?;
        main.emit("compact://edit", ()).map_err(|error| error.to_string())
    }

    /// Called by the webview after it has written its save.
    #[tauri::command]
    pub async fn quit_app(app: AppHandle) {
        std::thread::spawn(move || finish(&app, ExitKind::Quit));
    }

    #[tauri::command]
    pub async fn relaunch_app(app: AppHandle) {
        std::thread::spawn(move || finish(&app, ExitKind::Relaunch));
    }
}

#[cfg(desktop)]
pub use native::setup;

#[cfg(test)]
mod tests {
    #[test]
    fn manager_frame_is_preserved_if_contained_and_clamped_when_a_monitor_shrinks() {
        let work = super::PixelRect { x: -1280, y: 0, width: 1280, height: 800 };
        let insets = super::Insets { left: 8, top: 32, right: 8, bottom: 8 };
        let contained = super::PixelRect { x: -900, y: 100, width: 776, height: 600 };
        assert_eq!(super::fit_managed_bounds(contained, 760, 560, insets, work), super::ManagedBounds { frame: contained, client_width: 760, client_height: 560 });
        let offscreen = super::PixelRect { x: 100, y: 500, width: 776, height: 600 };
        assert_eq!(super::fit_managed_bounds(offscreen, 760, 560, insets, work), super::ManagedBounds {
            frame: super::PixelRect { x: -776, y: 0, width: 776, height: 800 }, client_width: 760, client_height: 760,
        });
    }

    #[test]
    fn opaque_relaunch_preserves_only_preview_discriminator() {
        assert!(super::relaunch_arguments(false).is_empty());
        assert_eq!(super::relaunch_arguments(true), vec!["--party-preview"]);
    }

    use super::*;

    #[test]
    fn opaque_override_is_explicit() {
        assert!(!opaque_forced(None, &[]));
        assert!(!opaque_forced(Some("0"), &[]));
        assert!(!opaque_forced(Some("true"), &[]));
        assert!(opaque_forced(Some("1"), &[]));
        assert!(opaque_forced(None, &["--opaque-window".into()]));
        assert!(!opaque_forced(None, &["--opaque-window=false".into()]));
    }

    #[test]
    fn saved_preference_selects_mode_and_bad_files_default_to_overlay() {
        assert_eq!(resolve_mode(false, &parse_prefs(None)), ShellMode::Overlay);
        assert_eq!(
            resolve_mode(false, &parse_prefs(Some(b"not json"))),
            ShellMode::Overlay
        );
        assert_eq!(
            resolve_mode(false, &parse_prefs(Some(b"{}"))),
            ShellMode::Overlay
        );
        let opaque = parse_prefs(Some(br#"{"opaqueWindow":true}"#));
        assert_eq!(resolve_mode(false, &opaque), ShellMode::Window);
        assert_eq!(
            resolve_mode(true, &ShellPrefs::default()),
            ShellMode::Window
        );
    }

    #[test]
    fn preference_roundtrips_atomically_through_disk() {
        let dir = std::env::temp_dir().join(format!("tl-shell-{}", std::process::id()));
        let path = dir.join("nested").join(PREFS_FILE);
        write_prefs(
            &path,
            &ShellPrefs {
                opaque_window: true,
            },
        )
        .unwrap();
        assert_eq!(
            parse_prefs(std::fs::read(&path).ok().as_deref()).opaque_window,
            true
        );
        write_prefs(
            &path,
            &ShellPrefs {
                opaque_window: false,
            },
        )
        .unwrap();
        assert_eq!(
            parse_prefs(std::fs::read(&path).ok().as_deref()),
            ShellPrefs::default()
        );
        assert!(!path.with_extension("json.tmp").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn menu_label_tracks_visibility_and_exit_runs_once() {
        assert_eq!(visibility_label(true), "Hide");
        assert_eq!(visibility_label(false), "Show");
        let gate = ExitGate::default();
        assert!(gate.request());
        assert!(!gate.request());
        assert!(gate.finish());
        assert!(!gate.finish());
        // A direct webview quit (HUD button) also closes the gate for later tray requests.
        let direct = ExitGate::default();
        assert!(direct.finish());
        assert!(!direct.request());
    }

    #[test]
    fn private_transparency_is_declared_without_changing_windows_window_defaults() {
        let base: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mac: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.macos.conf.json")).unwrap();
        assert_eq!(base["app"]["macOSPrivateApi"], true);
        assert!(mac.get("app").is_none());
        assert_eq!(mac["bundle"]["macOS"]["signingIdentity"], "-");
        let window = &base["app"]["windows"][0];
        assert_eq!(window["transparent"], true);
        assert_eq!(window["alwaysOnTop"], true);
        assert_eq!(window["skipTaskbar"], true);
    }
}
