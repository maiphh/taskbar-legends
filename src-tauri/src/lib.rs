use serde::Deserialize;
use serde_json::Value;
use tauri::Manager;

mod shell;

#[derive(Deserialize)]
struct OverlayBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl OverlayBounds {
    fn validate(&self) -> Result<(), String> {
        if self.width == 0
            || self.height == 0
            || self.width > i32::MAX.unsigned_abs()
            || self.height > i32::MAX.unsigned_abs()
        {
            return Err("Overlay bounds must be positive signed-32-bit physical dimensions".into());
        }
        Ok(())
    }
}

#[derive(Clone, Copy)]
struct FrameInsets { left: i32, top: i32, right: i32, bottom: i32 }

fn frame_insets(window: &tauri::WebviewWindow) -> Result<FrameInsets, String> {
    let inner_position = window.inner_position().map_err(|error| error.to_string())?;
    let outer_position = window.outer_position().map_err(|error| error.to_string())?;
    let inner_size = window.inner_size().map_err(|error| error.to_string())?;
    let outer_size = window.outer_size().map_err(|error| error.to_string())?;
    let left = i64::from(inner_position.x) - i64::from(outer_position.x);
    let top = i64::from(inner_position.y) - i64::from(outer_position.y);
    let right = i64::from(outer_size.width) - i64::from(inner_size.width) - left;
    let bottom = i64::from(outer_size.height) - i64::from(inner_size.height) - top;
    Ok(FrameInsets {
        left: i32::try_from(left).map_err(|error| error.to_string())?,
        top: i32::try_from(top).map_err(|error| error.to_string())?,
        right: i32::try_from(right).map_err(|error| error.to_string())?,
        bottom: i32::try_from(bottom).map_err(|error| error.to_string())?,
    })
}

fn client_to_frame_bounds(client: &OverlayBounds, insets: FrameInsets) -> Result<OverlayBounds, String> {
    if [insets.left, insets.top, insets.right, insets.bottom].iter().any(|value| *value < 0) {
        return Err("Native frame insets cannot be negative".into());
    }
    Ok(OverlayBounds {
        x: client.x.checked_sub(insets.left).ok_or("Frame x is outside signed bounds")?,
        y: client.y.checked_sub(insets.top).ok_or("Frame y is outside signed bounds")?,
        width: u32::try_from(i64::from(client.width) + i64::from(insets.left) + i64::from(insets.right)).map_err(|error| error.to_string())?,
        height: u32::try_from(i64::from(client.height) + i64::from(insets.top) + i64::from(insets.bottom)).map_err(|error| error.to_string())?,
    })
}

#[tauri::command]
fn set_overlay_bounds(window: tauri::WebviewWindow, bounds: OverlayBounds) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main overlay may change its bounds".into());
    }
    bounds.validate()?;
    // The command contract is physical client geometry. SetWindowPos needs the decorated outer frame.
    let frame = client_to_frame_bounds(&bounds, frame_insets(&window)?)?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
        };
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        // One OS transaction preserves the bottom edge while expanding upward.
        // Dimensions were range-checked above; the handle is owned by this Tauri window.
        let success = unsafe {
            SetWindowPos(
                hwnd.0,
                std::ptr::null_mut(),
                frame.x,
                frame.y,
                i32::try_from(frame.width).map_err(|error| error.to_string())?,
                i32::try_from(frame.height).map_err(|error| error.to_string())?,
                SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOZORDER,
            )
        };
        if success == 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    #[cfg(not(windows))]
    {
        window
            .set_size(tauri::PhysicalSize::new(bounds.width, bounds.height))
            .map_err(|error| error.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(frame.x, frame.y))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn set_control_bounds(window: tauri::WebviewWindow, app: tauri::AppHandle, bounds: OverlayBounds) -> Result<(), String> {
    if window.label() != "main" { return Err("Only the main overlay may position its control surface".into()); }
    bounds.validate()?;
    let control = app.get_webview_window("controls").ok_or("Missing compact controls window")?;
    control.set_size(tauri::PhysicalSize::new(bounds.width, bounds.height)).map_err(|error| error.to_string())?;
    control.set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y)).map_err(|error| error.to_string())
}

#[tauri::command]
fn submit_management_message(window: tauri::WebviewWindow, app: tauri::AppHandle, mut message: Value) -> Result<(), String> {
    use tauri::Emitter;
    if window.label() != "management" || !window.is_visible().unwrap_or(false) { return Err("Only the visible management window may send authority requests".into()); }
    if !message.is_object() || message.get("requestId").and_then(Value::as_str).map_or(true, |id| id.len() > 120) { return Err("Malformed management request".into()); }
    message["replyTo"] = Value::String("management".into());
    app.emit_to("main", "management://request", message).map_err(|error| error.to_string())
}

#[tauri::command]
fn publish_management_reply(window: tauri::WebviewWindow, app: tauri::AppHandle, target_label: String, payload: Value) -> Result<(), String> {
    use tauri::Emitter;
    if window.label() != "main" || target_label != "management" { return Err("Management replies must come from main and target its owned management view".into()); }
    let target = app.get_webview_window("management").ok_or("Management window has closed")?;
    if !target.is_visible().unwrap_or(false) { return Err("Management view is no longer open".into()); }
    target.emit("management://reply", payload).map_err(|error| error.to_string())
}

pub fn run() {
    let mut context = tauri::generate_context!();
    // The window is built in setup so the saved overlay/opaque choice applies on every platform.
    for window in &mut context.config_mut().app.windows {
        window.create = false;
    }
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            set_overlay_bounds,
            set_control_bounds,
            submit_management_message,
            publish_management_reply,
            shell::native::open_management,
            shell::native::hide_management,
            shell::native::request_compact_edit,
            shell::native::shell_mode,
            shell::native::quit_app,
            shell::native::relaunch_app
        ])
        .setup(shell::setup)
        .run(context)
        .expect("Taskbar Legends desktop runtime failed");
}

#[cfg(test)]
mod tests {
    #[test]
    fn decorated_client_geometry_converts_to_outer_frame_without_changing_client_size() {
        let client = super::OverlayBounds { x: 100, y: 200, width: 640, height: 160 };
        let frame = super::client_to_frame_bounds(&client, super::FrameInsets { left: 8, top: 31, right: 8, bottom: 8 }).unwrap();
        assert_eq!((frame.x, frame.y, frame.width, frame.height), (92, 169, 656, 199));
        let frameless = super::client_to_frame_bounds(&client, super::FrameInsets { left: 0, top: 0, right: 0, bottom: 0 }).unwrap();
        assert_eq!((frameless.x, frameless.y, frameless.width, frameless.height), (100, 200, 640, 160));
    }

    #[test]
    fn rejects_invalid_native_bounds() {
        use super::OverlayBounds;
        assert!(OverlayBounds {
            x: -1920,
            y: -100,
            width: 1920,
            height: 200
        }
        .validate()
        .is_ok());
        assert!(OverlayBounds {
            x: 0,
            y: 0,
            width: 0,
            height: 160
        }
        .validate()
        .is_err());
        assert!(OverlayBounds {
            x: 0,
            y: 0,
            width: u32::MAX,
            height: 160
        }
        .validate()
        .is_err());
    }

    #[test]
    fn shell_is_transparent_frameless_topmost_and_not_in_taskbar() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let window = &config["app"]["windows"][0];
        assert_eq!(window["transparent"], true);
        assert_eq!(window["decorations"], false);
        assert_eq!(window["alwaysOnTop"], true);
        assert_eq!(window["skipTaskbar"], true);
        assert_eq!(window["focus"], false);
        assert_eq!(window["visible"], false);
        assert_eq!(window["height"], 160);
    }
}
