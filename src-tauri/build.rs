fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["set_overlay_bounds"])),
    )
    .expect("Failed to build desktop shell metadata");
}
