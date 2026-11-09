//! Desktop-only window mode, tray/menu-bar menu and save-then-exit lifecycle.
//! The deterministic game core never sees any of this.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// How long the webview gets to flush localStorage before the process exits anyway.
pub const EXIT_GRACE: Duration = Duration::from_secs(3);
/// Short settle after the webview acknowledges, so the engine can persist storage.
pub const EXIT_SETTLE: Duration = Duration::from_millis(250);
pub const QUIT_EVENT: &str = "shell://quit";
pub const RELAUNCH_EVENT: &str = "shell://relaunch";
const PREFS_FILE: &str = "shell.json";

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
    pub exit: ExitGate,
}

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
    use tauri::{AppHandle, Emitter, Manager, State, Wry};

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
        let config = app
            .config()
            .app
            .windows
            .first()
            .ok_or("Missing main window")?
            .clone();
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
            ShellMode::Overlay => overlay_platform(builder),
        };
        builder.build()?;
        app.manage(ShellState {
            mode,
            prefs_path,
            exit: ExitGate::default(),
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
        let result = if visible {
            window.hide()
        } else {
            window.show()
        };
        if result.is_ok() {
            let _ = label.set_text(visibility_label(!visible));
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
