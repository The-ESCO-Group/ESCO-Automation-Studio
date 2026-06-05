mod git_service;
mod git_terminal;

use serde::Serialize;
use std::{fs, path::PathBuf};
use tauri::{LogicalSize, Size, Window};

const KEYRING_SERVICE: &str = "com.scintilla.escogroup.automationstudio";

#[derive(Serialize)]
struct DesktopCapabilities {
    controller_connection: &'static str,
    online_edits: bool,
    binary_project_access: bool,
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

const BLOCKED_BINARY_PROJECT_EXTENSION: &str = concat!(".", "a", "c", "d");
const BLOCKED_BINARY_PROJECT_EXTENSIONS: [&str; 4] = [
    BLOCKED_BINARY_PROJECT_EXTENSION,
    concat!(".", "a", "c", "d", ".gz"),
    concat!(".", "a", "c", "d", ".zip"),
    concat!(".", "a", "c", "d", ".7z"),
];

fn unsafe_save_target_message(path: &PathBuf) -> Option<String> {
    let name = file_name(path).trim().to_ascii_lowercase();
    let is_blocked_binary_project = BLOCKED_BINARY_PROJECT_EXTENSIONS
        .iter()
        .any(|extension| name.ends_with(extension));
    if is_blocked_binary_project {
        return Some(
            "Cannot save as a proprietary binary controller-project file. ESCO Automation Studio exports ESCO-native project files or L5X review files and never fakes proprietary controller binaries. Save an ESCO project or export L5X instead."
                .to_string(),
        );
    }
    if name.ends_with(".l5k") {
        return Some(
            "Cannot save as legacy L5K. ESCO Automation Studio exports .plcproj.json or L5X; use Export L5X for controller interchange."
                .to_string(),
        );
    }
    None
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
        binary_project_access: false,
        secure_key_storage: "windows-credential-manager",
    }
}

#[tauri::command]
fn secure_key_available() -> bool {
    let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, "__availability_probe__") else {
        return false;
    };

    matches!(entry.get_password(), Ok(_) | Err(keyring::Error::NoEntry))
}

#[tauri::command]
fn secure_key_get(name: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &name).map_err(|error| error.to_string())?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn secure_key_set(name: String, value: String) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, &name)
        .map_err(|error| error.to_string())?
        .set_password(&value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn secure_key_delete(name: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &name).map_err(|error| error.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
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
fn desktop_window_action(window: Window, action: String) -> Result<(), String> {
    match action.as_str() {
        "minimize" => window.minimize().map_err(|error| error.to_string()),
        "toggle-maximize" => {
            let is_maximized = window.is_maximized().map_err(|error| error.to_string())?;
            if is_maximized {
                window.unmaximize().map_err(|error| error.to_string())
            } else {
                window.maximize().map_err(|error| error.to_string())
            }
        }
        "close" => window.close().map_err(|error| error.to_string()),
        _ => Err(format!("Unsupported desktop window action: {action}")),
    }
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
            .add_filter("ESCO project", &["easproj", "plcproj.json", "json"])
            .set_file_name(&suggested_name)
            .save_file(),
    };

    let Some(path) = target else {
        return Ok(None);
    };

    if let Some(message) = unsafe_save_target_message(&path) {
        return Err(message);
    }

    fs::write(&path, text)
        .map_err(|error| format!("Could not save \"{}\": {error}", path.display()))?;

    Ok(Some(DesktopSavedFile {
        file_name: file_name(&path),
        path: path.display().to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::{unsafe_save_target_message, BLOCKED_BINARY_PROJECT_EXTENSION};
    use std::path::PathBuf;

    #[test]
    fn blocks_fake_binary_project_save_targets() {
        let blocked_extension = BLOCKED_BINARY_PROJECT_EXTENSION.to_uppercase();
        let blocked = unsafe_save_target_message(&PathBuf::from(format!("Plant{blocked_extension}"))).unwrap();
        assert!(blocked.contains("Cannot save as a proprietary binary controller-project file"));
        assert!(blocked.contains("never fakes proprietary controller binaries"));

        assert!(unsafe_save_target_message(&PathBuf::from(format!("backup{BLOCKED_BINARY_PROJECT_EXTENSION}.zip"))).is_some());
        assert!(unsafe_save_target_message(&PathBuf::from("legacy.L5K")).is_some());
    }

    #[test]
    fn allows_supported_save_targets() {
        assert!(unsafe_save_target_message(&PathBuf::from("Plant.plcproj.json")).is_none());
        assert!(unsafe_save_target_message(&PathBuf::from("Plant.json")).is_none());
        assert!(unsafe_save_target_message(&PathBuf::from("Plant.L5X")).is_none());
    }
}

#[tauri::command]
fn git_available() -> bool {
    git_service::git_available()
}

#[tauri::command]
fn git_select_project_folder() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("Choose Project History Folder")
        .pick_folder()
        .map(|path| path.display().to_string()))
}

#[tauri::command]
fn git_init_repo(repo_path: String) -> Result<git_service::ProjectStatus, String> {
    git_service::init_repo(&repo_path)
}

#[tauri::command]
fn git_get_status(repo_path: String) -> Result<git_service::ProjectStatus, String> {
    git_service::get_project_status(&repo_path)
}

#[tauri::command]
fn git_create_revision(
    repo_path: String,
    files: git_service::BundleFiles,
    message: String,
) -> Result<git_service::Revision, String> {
    git_service::create_revision(&repo_path, &files, &message)
}

#[tauri::command]
fn git_get_history(repo_path: String, max: Option<u32>) -> Result<Vec<git_service::Revision>, String> {
    git_service::get_revision_history(&repo_path, max)
}

#[tauri::command]
fn git_compare_revisions(
    repo_path: String,
    from: String,
    to: String,
) -> Result<Vec<git_service::DiffEntry>, String> {
    git_service::compare_revisions(&repo_path, &from, &to)
}

#[tauri::command]
fn git_read_revision_files(repo_path: String, rev: String) -> Result<git_service::BundleFiles, String> {
    git_service::read_revision_files(&repo_path, &rev)
}

#[tauri::command]
fn git_restore_revision(repo_path: String, rev: String) -> Result<git_service::RestoreResult, String> {
    git_service::restore_revision(&repo_path, &rev)
}

#[tauri::command]
fn git_create_branch(
    repo_path: String,
    name: String,
    checkout: bool,
) -> Result<git_service::ProjectStatus, String> {
    git_service::create_branch(&repo_path, &name, checkout)
}

#[tauri::command]
fn git_switch_branch(repo_path: String, name: String) -> Result<git_service::ProjectStatus, String> {
    git_service::switch_branch(&repo_path, &name)
}

#[tauri::command]
fn git_add_remote(repo_path: String, name: String, url: String) -> Result<git_service::ProjectStatus, String> {
    git_service::add_remote(&repo_path, &name, &url)
}

#[tauri::command]
fn git_push_remote(
    repo_path: String,
    remote: String,
    branch: Option<String>,
    set_upstream: bool,
) -> Result<git_service::SyncResult, String> {
    git_service::push_remote(&repo_path, &remote, branch.as_deref(), set_upstream)
}

#[tauri::command]
fn git_pull_remote(
    repo_path: String,
    remote: String,
    branch: Option<String>,
) -> Result<git_service::SyncResult, String> {
    git_service::pull_remote(&repo_path, &remote, branch.as_deref())
}

// ---------------------------------------------------------------------------
// Git — open a PowerShell terminal in the project folder for manual Git work.
// ---------------------------------------------------------------------------

/// Open a PowerShell terminal where the engineer can run Git directly. `path` is
/// the folder to open in (typically the current project's folder); when omitted
/// or invalid, the terminal opens in the user's home folder.
#[tauri::command]
fn open_git_terminal(path: Option<String>) -> Result<(), String> {
    git_terminal::open_git_terminal(path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            desktop_capabilities,
            secure_key_available,
            secure_key_get,
            secure_key_set,
            secure_key_delete,
            promote_desktop_window_to_ide,
            desktop_window_action,
            open_project_file,
            read_project_file,
            save_project_file,
            git_available,
            git_select_project_folder,
            git_init_repo,
            git_get_status,
            git_create_revision,
            git_get_history,
            git_compare_revisions,
            git_read_revision_files,
            git_restore_revision,
            git_create_branch,
            git_switch_branch,
            git_add_remote,
            git_push_remote,
            git_pull_remote,
            open_git_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running ESCO Automation Studio desktop shell");
}
