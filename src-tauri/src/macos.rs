pub fn opaque_requested(value: Option<&str>, args: &[String]) -> bool {
    value == Some("1") || args.iter().any(|arg| arg == "--opaque-window")
}

#[cfg(target_os = "macos")]
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::{utils::config::BackgroundThrottlingPolicy, window::Color, Manager};

    let opaque = opaque_requested(
        std::env::var("TASKBAR_LEGENDS_OPAQUE").ok().as_deref(),
        &std::env::args().collect::<Vec<_>>(),
    );
    // Choose the activation policy before creating the Mac window. Windows/Linux
    // continue using Tauri's original declarative window creation path.
    app.set_activation_policy(if opaque {
        tauri::ActivationPolicy::Regular
    } else {
        tauri::ActivationPolicy::Accessory
    });
    let config = app
        .config()
        .app
        .windows
        .first()
        .ok_or("Missing main window")?;
    let builder = tauri::WebviewWindowBuilder::from_config(app, config)?;
    let builder = if opaque {
        builder
            .title("Taskbar Legends — opaque test window")
            .transparent(false)
            .background_color(Color(23, 33, 45, 255))
            .decorations(true)
            .always_on_top(false)
            .skip_taskbar(false)
            .shadow(true)
            .resizable(true)
            .focused(true)
            .inner_size(800.0, 488.0)
            .center()
            .initialization_script(
                "Object.defineProperty(window, '__TASKBAR_SHELL_MODE__', { value: 'window' });",
            )
    } else {
        builder
            .visible_on_all_workspaces(true)
            .accept_first_mouse(true)
            .background_throttling(BackgroundThrottlingPolicy::Disabled)
    };
    builder.build()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::opaque_requested;

    #[test]
    fn opaque_flag_is_explicit_and_does_not_treat_zero_as_enabled() {
        assert!(!opaque_requested(None, &[]));
        assert!(!opaque_requested(Some("0"), &[]));
        assert!(!opaque_requested(Some("true"), &[]));
        assert!(opaque_requested(Some("1"), &[]));
        assert!(opaque_requested(None, &["--opaque-window".into()]));
        assert!(!opaque_requested(None, &["--opaque-window=false".into()]));
    }

    #[test]
    fn platform_config_enables_private_transparency_without_changing_windows_defaults() {
        let base: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let mac: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.macos.conf.json")).unwrap();
        assert_eq!(mac["app"]["macOSPrivateApi"], true);
        assert!(mac["app"].get("windows").is_none());
        assert!(base["app"].get("macOSPrivateApi").is_none());
        assert_eq!(base["app"]["windows"][0]["transparent"], true);
        assert_eq!(base["app"]["windows"][0]["alwaysOnTop"], true);
    }
}
