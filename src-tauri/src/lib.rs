use serde::Deserialize;

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

#[tauri::command]
fn set_overlay_bounds(window: tauri::WebviewWindow, bounds: OverlayBounds) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main overlay may change its bounds".into());
    }
    bounds.validate()?;
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
                bounds.x,
                bounds.y,
                i32::try_from(bounds.width).map_err(|error| error.to_string())?,
                i32::try_from(bounds.height).map_err(|error| error.to_string())?,
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
            .set_position(tauri::PhysicalPosition::new(bounds.x, bounds.y))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![set_overlay_bounds])
        .run(tauri::generate_context!())
        .expect("Taskbar Legends desktop runtime failed");
}

#[cfg(test)]
mod tests {
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
