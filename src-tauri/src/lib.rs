pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Taskbar Legends desktop runtime failed");
}

#[cfg(test)]
mod tests {
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
