# Desktop packaging foundation (Tauri)

A desktop build is planned via **Tauri** (small, secure, uses the OS webview).
This document is the foundation/plan; the `apps/desktop` shell is intentionally
**not** scaffolded yet so the web app and CI stay green until a Rust toolchain is
available in the build environment.

## Why Tauri

- Reuses the existing `apps/web` build as the renderer — no UI rewrite.
- Native file open/save dialogs and an app menu.
- Small installer; offline by design.

## Planned layout

```
apps/
  web/        # existing renderer (unchanged)
  desktop/    # Tauri shell
    src-tauri/
      tauri.conf.json
      src/main.rs       # registers file open/save + menu commands
    package.json        # "tauri dev" / "tauri build"
```

The desktop window loads the built `apps/web` bundle.

## App menu (planned)

- **File**: Open Project… · Save Project As… · Import L5X… · Export Compare
  Report… · Recent Projects · Exit
- **Edit**: Undo · Redo
- **Help**: About (offline-only notice), Documentation

## Recent projects

Store recently opened/exported project paths in app config (Tauri store). This
is the only place a native file *history* belongs — the browser build keeps using
explicit open/export.

## Safety rules for the desktop build

- **No PLC communication**, no downloads/uploads, no online edits.
- **No `.ACD` handling.**
- **Explicit file open/save only.** Use **Save As** — never overwrite an
  imported `.L5X` or the user's original file by default.
- Store the user's Copilot API key in OS-backed secure storage, not in project
  files and not in plain app config.
- Network access is limited to the configured AI provider when the engineer sends
  a Copilot prompt.

## Build (once scaffolded)

```bash
corepack pnpm --filter @esco/desktop tauri dev     # run the desktop shell
corepack pnpm --filter @esco/desktop tauri build    # produce an installer
```

Code signing is required for distributed company deployment (Windows). The
portable build is acceptable for internal evaluation.

## Status

- [ ] Scaffold `apps/desktop` with Tauri (requires Rust toolchain in CI/dev).
- [ ] Native open/save dialogs wired to the existing import/export actions.
- [ ] App menu + recent projects.
- [ ] Installer / portable build + (optional) auto-update.
