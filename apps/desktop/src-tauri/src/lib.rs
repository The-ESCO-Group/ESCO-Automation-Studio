use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::{LogicalSize, Size, Window};

#[derive(Serialize)]
struct DesktopCapabilities {
    controller_connection: &'static str,
    online_edits: bool,
    acd_access: bool,
    secure_key_storage: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopTextFile {
    text: String,
    file_name: String,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSavedFile {
    file_name: String,
    path: String,
}

fn file_name(path: &PathBuf) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("project.plcproj.json")
        .to_string()
}

fn read_text_file(path: PathBuf) -> Result<DesktopTextFile, String> {
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read \"{}\": {error}", path.display()))?;
    Ok(DesktopTextFile {
        file_name: file_name(&path),
        path: path.display().to_string(),
        text,
    })
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

#[tauri::command]
fn promote_desktop_window_to_ide(window: Window) -> Result<(), String> {
    window.set_resizable(true).map_err(|error| error.to_string())?;
    window
        .set_min_size(Some(Size::Logical(LogicalSize {
            width: 1024.0,
            height: 700.0,
        })))
        .map_err(|error| error.to_string())?;
    window
        .set_size(Size::Logical(LogicalSize {
            width: 1280.0,
            height: 800.0,
        }))
        .map_err(|error| error.to_string())?;
    window.center().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_project_file() -> Result<Option<DesktopTextFile>, String> {
    let path = rfd::FileDialog::new()
        .set_title("Open ESCO Automation Studio Project")
        .add_filter("ESCO project", &["plcproj.json", "json"])
        .add_filter("JSON", &["json"])
        .pick_file();

    match path {
        Some(path) => read_text_file(path).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
fn read_project_file(path: String) -> Result<DesktopTextFile, String> {
    read_text_file(PathBuf::from(path))
}

#[tauri::command]
fn save_project_file(
    path: Option<String>,
    suggested_name: String,
    text: String,
) -> Result<Option<DesktopSavedFile>, String> {
    let target = match path {
        Some(path) if !path.trim().is_empty() => Some(PathBuf::from(path)),
        _ => rfd::FileDialog::new()
            .set_title("Save ESCO Automation Studio Project")
            .add_filter("ESCO project", &["plcproj.json", "json"])
            .set_file_name(&suggested_name)
            .save_file(),
    };

    let Some(path) = target else {
        return Ok(None);
    };

    fs::write(&path, text)
        .map_err(|error| format!("Could not save \"{}\": {error}", path.display()))?;

    Ok(Some(DesktopSavedFile {
        file_name: file_name(&path),
        path: path.display().to_string(),
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop_capabilities,
            promote_desktop_window_to_ide,
            open_project_file,
            read_project_file,
            save_project_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running ESCO Automation Studio desktop shell");
}
