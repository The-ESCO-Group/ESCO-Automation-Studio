use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output};
use std::time::{SystemTime, UNIX_EPOCH};

const COMMIT_NAME: &str = "ESCO Automation Studio";
const COMMIT_EMAIL: &str = "studio@esco.local";
const WORKTREE: &str = "WORKTREE";
const MANAGED_DIRS: &[&str] = &["settings", "devices", "tags", "routines"];
const MANAGED_FILES: &[&str] = &["project.json", "project.plcproj.json", "alarms.json", "hmi.json"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStatus {
    pub initialized: bool,
    pub current_branch: String,
    pub detached: bool,
    pub has_commits: bool,
    pub has_uncommitted_changes: bool,
    pub changed_files: Vec<FileChange>,
    pub branches: Vec<String>,
    pub remotes: Vec<RemoteInfo>,
    pub ahead: u32,
    pub behind: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffEntry {
    pub path: String,
    pub status: String,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub backup_branch: String,
    pub revision: Revision,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub ok: bool,
    pub conflicts: bool,
    pub backup_branch: Option<String>,
    pub message: String,
}

pub type BundleFiles = BTreeMap<String, String>;

#[cfg(windows)]
fn no_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn no_window(_command: &mut Command) {}

fn raw(repo: &str, args: &[&str]) -> Result<Output, String> {
    let mut command = Command::new("git");
    command.current_dir(repo).args(args);
    no_window(&mut command);
    command.output().map_err(|error| {
        format!("Could not start version control. Is Git installed and on your PATH? ({error})")
    })
}

fn run(repo: &str, args: &[&str], context: &str) -> Result<String, String> {
    let output = raw(repo, args)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
    } else {
        Err(friendly(context, &output))
    }
}

fn friendly(context: &str, output: &Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let text = if stderr.trim().is_empty() { stdout.as_ref() } else { stderr.as_ref() };
    let lower = text.to_lowercase();
    let detail = if lower.contains("not a git repository") {
        "this folder is not under version control yet.".to_string()
    } else if lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("permission denied")
        || lower.contains("403")
    {
        "the remote rejected your sign-in. Check your credentials and access rights.".to_string()
    } else if lower.contains("could not resolve host")
        || lower.contains("unable to access")
        || lower.contains("failed to connect")
        || lower.contains("network is unreachable")
    {
        "could not reach the remote. Check the address and your network connection.".to_string()
    } else if lower.contains("no upstream")
        || lower.contains("no configured push destination")
        || lower.contains("does not appear to be a git repository")
    {
        "no remote is set up for this project yet.".to_string()
    } else if lower.contains("non-fast-forward") || lower.contains("rejected") {
        "the remote has newer changes. Sync (pull) before sending your versions.".to_string()
    } else {
        text.lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .unwrap_or("an unexpected version-control error occurred.")
            .to_string()
    };
    if context.is_empty() {
        detail
    } else {
        format!("{context}: {detail}")
    }
}

fn is_repo(repo: &str) -> bool {
    raw(repo, &["rev-parse", "--is-inside-work-tree"])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn has_commits(repo: &str) -> bool {
    raw(repo, &["rev-parse", "--verify", "--quiet", "HEAD"])
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn ensure_identity(repo: &str) -> Result<(), String> {
    let have_email = raw(repo, &["config", "user.email"])
        .map(|output| output.status.success() && !output.stdout.is_empty())
        .unwrap_or(false);
    if !have_email {
        run(repo, &["config", "user.email", COMMIT_EMAIL], "Could not configure version control")?;
        run(repo, &["config", "user.name", COMMIT_NAME], "Could not configure version control")?;
    }
    Ok(())
}

fn is_managed(rel: &str) -> bool {
    MANAGED_FILES.contains(&rel) || MANAGED_DIRS.iter().any(|dir| rel.starts_with(&format!("{dir}/")))
}

fn safe_relative(rel: &str) -> Result<PathBuf, String> {
    let path = Path::new(rel);
    if path.is_absolute() {
        return Err(format!("Refusing to write outside the project folder: \"{rel}\"."));
    }
    for component in path.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(format!("Refusing to write an unsafe path: \"{rel}\"."));
        }
    }
    if !is_managed(rel) {
        return Err(format!("\"{rel}\" is not part of an ESCO project bundle."));
    }
    Ok(path.to_path_buf())
}

fn clear_managed(repo: &str) -> Result<(), String> {
    let root = Path::new(repo);
    for dir in MANAGED_DIRS {
        let target = root.join(dir);
        if target.exists() {
            fs::remove_dir_all(&target).map_err(|error| format!("Could not prepare the project folder: {error}"))?;
        }
    }
    for file in MANAGED_FILES {
        let target = root.join(file);
        if target.exists() {
            fs::remove_file(&target).map_err(|error| format!("Could not prepare the project folder: {error}"))?;
        }
    }
    Ok(())
}

fn write_bundle(repo: &str, files: &BundleFiles) -> Result<(), String> {
    let mut validated = Vec::with_capacity(files.len());
    for (rel, content) in files {
        validated.push((safe_relative(rel)?, content));
    }
    clear_managed(repo)?;
    let root = Path::new(repo);
    for (rel, content) in validated {
        let target = root.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("Could not write the project folder: {error}"))?;
        }
        fs::write(&target, content.as_bytes())
            .map_err(|error| format!("Could not write \"{}\": {error}", target.display()))?;
    }
    Ok(())
}

fn read_file(path: &Path) -> Result<String, String> {
    fs::read_to_string(path).map_err(|error| format!("Could not read \"{}\": {error}", path.display()))
}

fn collect_dir(root: &Path, dir: &Path, files: &mut BundleFiles) -> Result<(), String> {
    if !dir.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(dir).map_err(|error| format!("Could not read the project folder: {error}"))? {
        let entry = entry.map_err(|error| format!("Could not read the project folder: {error}"))?;
        let path = entry.path();
        if path.is_dir() {
            collect_dir(root, &path, files)?;
        } else if path.is_file() {
            if let Ok(rel) = path.strip_prefix(root) {
                files.insert(rel.to_string_lossy().replace('\\', "/"), read_file(&path)?);
            }
        }
    }
    Ok(())
}

fn read_worktree_bundle(repo: &str) -> Result<BundleFiles, String> {
    let root = Path::new(repo);
    let mut files = BundleFiles::new();
    for file in MANAGED_FILES {
        let path = root.join(file);
        if path.is_file() {
            files.insert((*file).to_string(), read_file(&path)?);
        }
    }
    for dir in MANAGED_DIRS {
        collect_dir(root, &root.join(dir), &mut files)?;
    }
    Ok(files)
}

fn managed_pathspecs(repo: &str) -> Vec<String> {
    let root = Path::new(repo);
    let mut specs = Vec::new();
    for candidate in MANAGED_DIRS.iter().chain(MANAGED_FILES.iter()) {
        let tracked = raw(repo, &["ls-files", candidate])
            .map(|output| output.status.success() && !output.stdout.is_empty())
            .unwrap_or(false);
        if root.join(candidate).exists() || tracked {
            specs.push((*candidate).to_string());
        }
    }
    specs
}

const FIELD_SEP: &str = "\u{1f}";
const RECORD_SEP: &str = "\u{1e}";

fn log_format() -> String {
    format!("--format=%H{FIELD_SEP}%h{FIELD_SEP}%an{FIELD_SEP}%ae{FIELD_SEP}%cI{FIELD_SEP}%s{RECORD_SEP}")
}

fn parse_revisions(raw: &str) -> Vec<Revision> {
    raw.split(RECORD_SEP)
        .map(str::trim)
        .filter(|chunk| !chunk.is_empty())
        .filter_map(|chunk| {
            let fields: Vec<&str> = chunk.split(FIELD_SEP).collect();
            if fields.len() < 6 {
                return None;
            }
            Some(Revision {
                id: fields[0].to_string(),
                short_id: fields[1].to_string(),
                author_name: fields[2].to_string(),
                author_email: fields[3].to_string(),
                timestamp: fields[4].to_string(),
                message: fields[5].to_string(),
            })
        })
        .collect()
}

fn revision_at(repo: &str, rev: &str) -> Result<Revision, String> {
    let out = run(repo, &["log", "-1", &log_format(), rev], "Could not read that version")?;
    parse_revisions(&out)
        .into_iter()
        .next()
        .ok_or_else(|| "Could not read that version: it no longer exists.".to_string())
}

fn epoch_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_secs()).unwrap_or(0)
}

fn create_backup_branch(repo: &str, label: &str) -> Result<Option<String>, String> {
    if !has_commits(repo) {
        return Ok(None);
    }
    let name = format!("esco-backup/{label}-{}", epoch_secs());
    run(repo, &["branch", &name, "HEAD"], "Could not create a safety backup")?;
    Ok(Some(name))
}

pub fn init_repo(repo: &str) -> Result<ProjectStatus, String> {
    fs::create_dir_all(repo).map_err(|error| format!("Could not create the project folder: {error}"))?;
    if !is_repo(repo) {
        run(repo, &["init"], "Could not start version control")?;
        let _ = run(repo, &["symbolic-ref", "HEAD", "refs/heads/main"], "Could not start version control");
    }
    ensure_identity(repo)?;
    get_project_status(repo)
}

pub fn get_project_status(repo: &str) -> Result<ProjectStatus, String> {
    if !is_repo(repo) {
        return Ok(ProjectStatus {
            initialized: false,
            current_branch: String::new(),
            detached: false,
            has_commits: false,
            has_uncommitted_changes: false,
            changed_files: Vec::new(),
            branches: Vec::new(),
            remotes: Vec::new(),
            ahead: 0,
            behind: 0,
        });
    }

    let branch_raw = run(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"], "Could not read version status")
        .or_else(|_| run(repo, &["rev-parse", "--abbrev-ref", "HEAD"], "Could not read version status"))
        .unwrap_or_default();
    let detached = branch_raw.is_empty() || branch_raw == "HEAD";
    let current_branch = if detached { "(detached)".to_string() } else { branch_raw };
    let changed_files = parse_status(&String::from_utf8_lossy(&raw(repo, &["status", "--porcelain"])?.stdout));
    let mut branches: Vec<String> = run(repo, &["branch", "--format=%(refname:short)"], "Could not read versions")
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("esco-backup/"))
        .map(str::to_string)
        .collect();
    if branches.is_empty() && !detached && !current_branch.is_empty() {
        branches.push(current_branch.clone());
    }
    let remotes = parse_remotes(repo);
    let (ahead, behind) = ahead_behind(repo);

    Ok(ProjectStatus {
        initialized: true,
        current_branch,
        detached,
        has_commits: has_commits(repo),
        has_uncommitted_changes: !changed_files.is_empty(),
        changed_files,
        branches,
        remotes,
        ahead,
        behind,
    })
}

fn parse_status(text: &str) -> Vec<FileChange> {
    text.lines()
        .filter(|line| line.len() >= 3)
        .filter_map(|line| {
            let code = &line[..2];
            let path = line[3..].trim().to_string();
            if !is_managed(&path) {
                return None;
            }
            let status = match code.trim() {
                "??" => "untracked",
                c if c.contains('A') => "added",
                c if c.contains('D') => "deleted",
                c if c.contains('R') => "renamed",
                _ => "modified",
            };
            Some(FileChange { path, status: status.to_string() })
        })
        .collect()
}

fn parse_remotes(repo: &str) -> Vec<RemoteInfo> {
    run(repo, &["remote"], "Could not read remotes")
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| RemoteInfo {
            name: name.to_string(),
            url: run(repo, &["remote", "get-url", name], "Could not read remote").unwrap_or_default(),
        })
        .collect()
}

fn ahead_behind(repo: &str) -> (u32, u32) {
    let Ok(out) = run(repo, &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], "") else {
        return (0, 0);
    };
    let mut parts = out.split_whitespace();
    let behind = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    let ahead = parts.next().and_then(|part| part.parse().ok()).unwrap_or(0);
    (ahead, behind)
}

pub fn create_revision(repo: &str, files: &BundleFiles, message: &str) -> Result<Revision, String> {
    if !is_repo(repo) {
        init_repo(repo)?;
    }
    if !files.contains_key("project.json") && !files.contains_key("project.plcproj.json") {
        return Err("Could not save this version: the project data is incomplete.".to_string());
    }
    let message = message.trim();
    if message.is_empty() {
        return Err("Describe what changed before saving this version.".to_string());
    }

    write_bundle(repo, files)?;
    ensure_identity(repo)?;
    let specs = managed_pathspecs(repo);
    let mut add_args: Vec<&str> = vec!["add", "-A", "--"];
    add_args.extend(specs.iter().map(String::as_str));
    run(repo, &add_args, "Could not stage the project changes")?;

    let mut status_args: Vec<&str> = vec!["status", "--porcelain", "--"];
    status_args.extend(specs.iter().map(String::as_str));
    if String::from_utf8_lossy(&raw(repo, &status_args)?.stdout).trim().is_empty() {
        return Err("There are no changes to save as a new version.".to_string());
    }

    run(repo, &["commit", "-m", message], "Could not save this version")?;
    revision_at(repo, "HEAD")
}

pub fn get_revision_history(repo: &str, max: Option<u32>) -> Result<Vec<Revision>, String> {
    if !is_repo(repo) || !has_commits(repo) {
        return Ok(Vec::new());
    }
    let format = log_format();
    let limit = max.map(|value| format!("-n{value}"));
    let mut args: Vec<&str> = vec!["log", &format];
    if let Some(ref limit) = limit {
        args.push(limit);
    }
    let out = run(repo, &args, "Could not read the project history")?;
    Ok(parse_revisions(&out))
}

pub fn compare_revisions(repo: &str, from: &str, to: &str) -> Result<Vec<DiffEntry>, String> {
    if !is_repo(repo) {
        return Err("Could not compare versions: this folder is not under version control yet.".to_string());
    }
    if !has_commits(repo) {
        return Err("Save a version before comparing changes.".to_string());
    }
    let name_status = if to == WORKTREE {
        run(repo, &["diff", "--name-status", from], "Could not compare versions")?
    } else {
        run(repo, &["diff", "--name-status", from, to], "Could not compare versions")?
    };
    let mut entries = Vec::new();
    for line in name_status.lines() {
        let mut parts = line.split('\t');
        let Some(code) = parts.next() else { continue };
        let Some(path) = parts.last() else { continue };
        if !is_managed(path) {
            continue;
        }
        entries.push(DiffEntry {
            path: path.to_string(),
            status: match code.chars().next() {
                Some('A') => "added",
                Some('D') => "deleted",
                Some('R') => "renamed",
                _ => "modified",
            }
            .to_string(),
            old_content: file_at(repo, from, path),
            new_content: if to == WORKTREE { read_file(&Path::new(repo).join(path)).ok() } else { file_at(repo, to, path) },
        });
    }
    Ok(entries)
}

fn file_at(repo: &str, rev: &str, path: &str) -> Option<String> {
    if rev == WORKTREE {
        return read_file(&Path::new(repo).join(path)).ok();
    }
    let spec = format!("{rev}:{path}");
    let output = raw(repo, &["show", &spec]).ok()?;
    output.status.success().then(|| String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn read_revision_files(repo: &str, rev: &str) -> Result<BundleFiles, String> {
    if !is_repo(repo) {
        return Err("This folder is not under version control yet.".to_string());
    }
    if rev == WORKTREE {
        return read_worktree_bundle(repo);
    }
    if !has_commits(repo) {
        return Err("There are no saved versions yet.".to_string());
    }
    let listing = run(repo, &["ls-tree", "-r", "--name-only", rev], "Could not read that version")?;
    let mut files = BundleFiles::new();
    for path in listing.lines().map(str::trim).filter(|path| !path.is_empty() && is_managed(path)) {
        if let Some(content) = file_at(repo, rev, path) {
            files.insert(path.to_string(), content);
        }
    }
    Ok(files)
}

pub fn restore_revision(repo: &str, rev: &str) -> Result<RestoreResult, String> {
    if !is_repo(repo) || !has_commits(repo) {
        return Err("There are no saved versions to restore.".to_string());
    }
    let revision = revision_at(repo, rev)?;
    let backup = create_backup_branch(repo, "before-restore")?
        .ok_or_else(|| "Could not create a safety backup before restoring.".to_string())?;
    let files = read_revision_files(repo, &revision.id)?;
    write_bundle(repo, &files)?;
    Ok(RestoreResult { backup_branch: backup, revision })
}

pub fn create_branch(repo: &str, name: &str, checkout: bool) -> Result<ProjectStatus, String> {
    if !is_repo(repo) {
        return Err("This folder is not under version control yet.".to_string());
    }
    if !has_commits(repo) {
        return Err("Save a version before creating a work copy.".to_string());
    }
    let name = sanitize_branch(name)?;
    if checkout {
        run(repo, &["checkout", "-b", &name], "Could not create the work copy")?;
    } else {
        run(repo, &["branch", &name], "Could not create the work copy")?;
    }
    get_project_status(repo)
}

pub fn switch_branch(repo: &str, name: &str) -> Result<ProjectStatus, String> {
    if !is_repo(repo) {
        return Err("This folder is not under version control yet.".to_string());
    }
    if !has_commits(repo) {
        return Err("Save a version before switching work copies.".to_string());
    }
    let name = sanitize_branch(name)?;
    run(repo, &["checkout", &name], "Could not switch work copy")?;
    get_project_status(repo)
}

fn sanitize_branch(name: &str) -> Result<String, String> {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|ch| if ch.is_whitespace() { '-' } else { ch })
        .filter(|ch| !"~^:?*[\\".contains(*ch))
        .collect();
    if cleaned.is_empty()
        || cleaned.starts_with('-')
        || cleaned.starts_with('/')
        || cleaned.ends_with('/')
        || cleaned.ends_with('.')
        || cleaned.contains("..")
        || cleaned.contains("//")
    {
        return Err("That name can't be used. Try letters, numbers, slashes and hyphens.".to_string());
    }
    Ok(cleaned)
}

pub fn add_remote(repo: &str, name: &str, url: &str) -> Result<ProjectStatus, String> {
    if !is_repo(repo) {
        init_repo(repo)?;
    }
    let name = name.trim();
    let url = url.trim();
    if name.is_empty() || url.is_empty() {
        return Err("Please provide both a name and an address for the remote.".to_string());
    }
    let exists = run(repo, &["remote"], "Could not read remotes")
        .unwrap_or_default()
        .lines()
        .any(|line| line.trim() == name);
    if exists {
        run(repo, &["remote", "set-url", name, url], "Could not update the remote")?;
    } else {
        run(repo, &["remote", "add", name, url], "Could not add the remote")?;
    }
    get_project_status(repo)
}

pub fn push_remote(repo: &str, remote: &str, branch: Option<&str>, set_upstream: bool) -> Result<SyncResult, String> {
    if !is_repo(repo) {
        return Err("This folder is not under version control yet.".to_string());
    }
    if !has_commits(repo) {
        return Err("Save a version before sending it to the remote.".to_string());
    }
    let remote = remote.trim();
    if remote.is_empty() {
        return Err("Add a remote address before sending versions.".to_string());
    }
    let branch = current_branch_name(repo, branch)?;
    let mut args = vec!["push"];
    if set_upstream {
        args.push("-u");
    }
    args.push(remote);
    args.push(&branch);
    let output = raw(repo, &args)?;
    if output.status.success() {
        Ok(SyncResult { ok: true, conflicts: false, backup_branch: None, message: "Your versions were sent to the remote.".to_string() })
    } else {
        Err(friendly("Could not send versions", &output))
    }
}

pub fn pull_remote(repo: &str, remote: &str, branch: Option<&str>) -> Result<SyncResult, String> {
    if !is_repo(repo) {
        return Err("This folder is not under version control yet.".to_string());
    }
    if !has_commits(repo) {
        return Err("Save a version before syncing this project.".to_string());
    }
    let remote = remote.trim();
    if remote.is_empty() {
        return Err("Add a remote address before syncing this project.".to_string());
    }
    let branch = current_branch_name(repo, branch)?;
    let backup = create_backup_branch(repo, "before-sync")?;
    let output = raw(repo, &["pull", "--no-rebase", remote, &branch])?;
    if output.status.success() {
        return Ok(SyncResult {
            ok: true,
            conflicts: false,
            backup_branch: backup,
            message: "The project is up to date with the remote.".to_string(),
        });
    }
    let combined = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr)).to_lowercase();
    if combined.contains("conflict") || combined.contains("automatic merge failed") {
        let _ = raw(repo, &["merge", "--abort"]);
        let where_safe = backup.as_deref().map(|name| format!(" Your work is safe in a backup ({name}).")).unwrap_or_default();
        return Ok(SyncResult {
            ok: false,
            conflicts: true,
            backup_branch: backup,
            message: format!("The remote has changes that overlap with yours, so the sync was paused.{where_safe} Use Compare Changes to review, then re-save and sync again."),
        });
    }
    Err(friendly("Could not sync with the remote", &output))
}

fn current_branch_name(repo: &str, branch: Option<&str>) -> Result<String, String> {
    if let Some(branch) = branch {
        let branch = branch.trim();
        if !branch.is_empty() {
            return Ok(branch.to_string());
        }
    }
    let name = run(repo, &["rev-parse", "--abbrev-ref", "HEAD"], "Could not read the current work copy")?;
    if name == "HEAD" {
        return Err("Switch to a work copy before syncing.".to_string());
    }
    Ok(name)
}

pub fn git_available() -> bool {
    let mut command = Command::new("git");
    command.arg("--version");
    no_window(&mut command);
    command.output().map(|output| output.status.success()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_relative_rejects_unsafe_paths() {
        assert!(safe_relative("project.json").is_ok());
        assert!(safe_relative("tags/ctrl.json").is_ok());
        assert!(safe_relative("../project.json").is_err());
        assert!(safe_relative(".git/config").is_err());
        assert!(safe_relative("notes.txt").is_err());
    }

    #[test]
    fn parse_status_filters_to_managed_bundle() {
        let changes = parse_status(" M project.json\n?? devices/new.json\nA  tags/ctrl.json\n D alarms.json\n?? notes.txt");
        assert_eq!(changes.len(), 4);
        assert!(!changes.iter().any(|change| change.path == "notes.txt"));
    }

    #[test]
    fn sanitize_branch_cleans_and_rejects() {
        assert_eq!(sanitize_branch("Trial Run").unwrap(), "Trial-Run");
        assert_eq!(sanitize_branch("feature/x").unwrap(), "feature/x");
        assert!(sanitize_branch("   ").is_err());
        assert!(sanitize_branch("../escape").is_err());
        assert!(sanitize_branch("-option").is_err());
    }
}

#[cfg(test)]
mod integration {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    struct TempRepo {
        path: String,
    }

    impl TempRepo {
        fn new() -> Self {
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let mut dir = std::env::temp_dir();
            dir.push(format!("esco-git-test-{}-{n}", std::process::id()));
            fs::create_dir_all(&dir).unwrap();
            TempRepo { path: dir.display().to_string() }
        }
    }

    impl Drop for TempRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn bundle(count: usize) -> BundleFiles {
        let mut files = BundleFiles::new();
        files.insert("project.json".into(), "{\"bundleFormat\":\"test\",\"controllers\":[]}\n".into());
        files.insert("tags/ctrl-1.json".into(), format!("{{\"count\":{count}}}\n"));
        files
    }

    #[test]
    fn full_lifecycle_against_real_git() {
        if !git_available() {
            return;
        }
        let repo = TempRepo::new();
        let p = repo.path.as_str();
        let status = init_repo(p).unwrap();
        assert!(status.initialized);
        assert_eq!(status.current_branch, "main");

        let r1 = create_revision(p, &bundle(1), "First version").unwrap();
        let r2 = create_revision(p, &bundle(2), "Second version").unwrap();
        let history = get_revision_history(p, None).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].id, r2.id);
        assert!(create_revision(p, &bundle(2), "no-op").is_err());
        assert!(read_revision_files(p, "HEAD").unwrap()["tags/ctrl-1.json"].contains("\"count\":2"));
        assert!(compare_revisions(p, &r1.id, &r2.id).unwrap().iter().any(|entry| entry.path == "tags/ctrl-1.json"));

        let restore = restore_revision(p, &r1.id).unwrap();
        assert!(restore.backup_branch.starts_with("esco-backup/"));
        assert!(read_revision_files(p, WORKTREE).unwrap()["tags/ctrl-1.json"].contains("\"count\":1"));

        let on_trial = create_branch(p, "Trial Run", true).unwrap();
        assert_eq!(on_trial.current_branch, "Trial-Run");
        let back = switch_branch(p, "main").unwrap();
        assert_eq!(back.current_branch, "main");
    }

    #[test]
    fn empty_repo_returns_actionable_guards() {
        if !git_available() {
            return;
        }
        let repo = TempRepo::new();
        let p = repo.path.as_str();
        let status = init_repo(p).unwrap();
        assert_eq!(status.current_branch, "main");
        assert!(status.branches.iter().any(|branch| branch == "main"));
        assert!(create_branch(p, "Trial", true).err().unwrap().contains("Save a version"));
        assert!(compare_revisions(p, "HEAD", WORKTREE).err().unwrap().contains("Save a version"));
        assert!(pull_remote(p, "origin", None).err().unwrap().contains("Save a version"));
    }
}
