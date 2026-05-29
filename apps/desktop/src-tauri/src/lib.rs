use serde::Serialize;

#[derive(Serialize)]
struct DesktopCapabilities {
    controller_connection: &'static str,
    online_edits: bool,
    acd_access: bool,
    secure_key_storage: &'static str,
}

#[tauri::command]
fn desktop_capabilities() -> DesktopCapabilities {
    DesktopCapabilities {
        controller_connection: "offline-simulation",
        online_edits: false,
        acd_access: false,
        secure_key_storage: "pending-os-keychain-adapter",
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_capabilities])
        .run(tauri::generate_context!())
        .expect("error while running ESCO Automation Studio desktop shell");
}
