//! Opens a PowerShell terminal in the project's folder so engineers can run Git
//! themselves — commit, push, pull, clone, whatever they need. ESCO does not wrap
//! Git operations; it just drops the user into a ready terminal (with a short
//! command cheat-sheet) where real credential prompts and the full Git CLI work.

/// Launch a PowerShell window whose working directory is `path` (falling back to
/// the user's home folder), printing a brief Git cheat-sheet. Returns a clean,
/// user-facing message on failure.
#[cfg(windows)]
pub fn open_git_terminal(path: Option<String>) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::path::Path;
    use std::process::Command;

    /// Give the spawned shell its own visible console window.
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;

    let working_dir = path
        .filter(|candidate| !candidate.trim().is_empty() && Path::new(candidate).is_dir())
        .or_else(|| std::env::var("USERPROFILE").ok())
        .unwrap_or_else(|| ".".to_string());

    // Printed once when the terminal opens; the user is then left at the prompt.
    let banner = concat!(
        "Write-Host 'ESCO Automation Studio - Git terminal' -ForegroundColor Cyan;",
        "Write-Host ('Folder: ' + (Get-Location).Path);",
        "Write-Host '';",
        "Write-Host 'Common commands:' -ForegroundColor Yellow;",
        "Write-Host '  git status';",
        "Write-Host '  git add -A; git commit -m \"message\"';",
        "Write-Host '  git pull';",
        "Write-Host '  git push';",
        "Write-Host '  git clone <url>     # download an existing repository';",
        "Write-Host '  git init            # start tracking this folder';",
        "Write-Host ''"
    );

    Command::new("powershell.exe")
        .args(["-NoExit", "-NoProfile", "-Command", banner])
        .current_dir(&working_dir)
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map(|_child| ())
        .map_err(|error| {
            format!("Could not open a Git terminal. Is PowerShell available? ({error})")
        })
}

#[cfg(not(windows))]
pub fn open_git_terminal(_path: Option<String>) -> Result<(), String> {
    Err("Opening a Git terminal is available in the Windows desktop app.".to_string())
}
