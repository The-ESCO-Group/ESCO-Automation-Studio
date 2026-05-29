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

## Settings & API-key persistence (implemented)

The renderer now persists workstation settings through a storage abstraction so
the desktop shell can swap the backend without touching call sites:

- `apps/web/src/settings.ts` — `SettingsStore` over a `StorageLike` interface,
  with `browserStorage()` (localStorage) and `memoryStorage()` (tests / SSR)
  implementations. Reads never throw; corrupt values fall back cleanly.
- `apps/web/src/ai-profile.ts` — the AI profile (name/email/**API key**) is saved
  once via `SettingsStore`; `hasAiProfile()` makes "ask once" work across
  sessions, `clearAiProfile()` rotates/forgets it. The key is never written to a
  project file and never sent to git.
- `apps/web/src/app-settings.ts` — first-run completion flag and the preferred
  controller-connection mode.

**Desktop mapping:** implement a `StorageLike` over an **OS-backed secure store**
(Windows Credential Manager / DPAPI via a Tauri command) and inject it into
`SettingsStore` instead of `browserStorage()`. The API key then lives in the OS
keychain, not localStorage. No other code changes are required.

## Controller connection (implemented, offline-blocked)

`@esco/controller-comm` provides the connection state machine, transports, and the
guarded upload/download/online-edit commands. The desktop shell does **not** relax
any of this: there is no tested transport, so real controller I/O stays
safety-blocked. A real transport would be a new `RealControllerTransport` subclass
that flips `verified` to true only after hardware validation — out of scope for
this repo.

## Status

- [x] Settings/API-key persistence abstraction (`SettingsStore`) — swappable for an
      OS keychain in the packaged build.
- [x] Controller connection state machine + guarded commands (`@esco/controller-comm`).
- [ ] Scaffold `apps/desktop` with Tauri (requires Rust toolchain in CI/dev).
- [ ] Native open/save dialogs wired to the existing import/export actions.
- [ ] App menu + recent projects.
- [ ] OS-keychain `StorageLike` implementation for the API key.
- [ ] Installer / portable build + (optional) auto-update.
