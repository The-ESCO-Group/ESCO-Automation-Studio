# Desktop Packaging

ESCO Automation Studio now has a Tauri desktop scaffold in `apps/desktop`. It
reuses the existing `apps/web` renderer and starts the desktop window with
`?desktop-startup=1`, which shows the Figma-inspired first-run startup box. The
regular browser dev URL, `http://localhost:5173`, keeps showing the IDE layout
and does not show the startup box.

## Startup Experience

The desktop-only startup surface includes:

- ESCO Automation Studio / PLC Engineering IDE app mark.
- Scintilla ESCO GROUP wordmark styling in navy and gold.
- Startup sign-in is temporarily bypassed.
- Automatic entry into the offline IDE after loading.
- Open Project, New Project, Import L5X, Restore Backup.
- Footer status: Workspace ready / No controller connection active.

The packaged desktop window starts at the startup-box size (`758 x 558`) so the
first-run view is not surrounded by a large empty IDE background. Once startup
loading completes, the renderer creates a starter project and invokes the desktop
shell to promote the window to the full IDE workspace (`1280 x 800`, resizable,
minimum `1024 x 700`). Browser localhost development is unchanged.

Microsoft sign-in is temporarily disabled for desktop startup. Until Azure app
registration, token handling, and secure user identity storage are implemented,
the shell enters the IDE without requiring identity.

## Commands

```bash
corepack pnpm install
corepack pnpm --filter @esco/desktop typecheck
corepack pnpm --filter @esco/desktop dev
corepack pnpm --filter @esco/desktop build
```

Root aliases are also available:

```bash
corepack pnpm dev:desktop
corepack pnpm build:desktop
```

## Tooling Requirement

Tauri requires Rust/Cargo, the MSVC linker from Visual Studio Build Tools, and
Windows WebView2 runtime support. This workstation has been prepared with
Rustup and Visual Studio Build Tools, so `tauri build` now produces both the
portable application executable and installer bundles.

If another workstation needs the prerequisites, use:

```powershell
winget install --id Rustlang.Rustup -e
rustup default stable
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --quiet --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Run the build from a Visual Studio developer environment so Rust can find
`link.exe`:

```powershell
cmd /c "call ""C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"" -arch=x64 && set PATH=%USERPROFILE%\.cargo\bin;%PATH% && corepack pnpm --filter @esco/desktop build"
```

Current build outputs are generated under
`apps/desktop/src-tauri/target/release/` and are intentionally ignored by git.

## Safety Boundaries

- No PLC/controller communication is added by the desktop shell.
- No upload/download/go-online behavior is added.
- No online edits are added.
- No `.ACD` handling is added.
- File workflows remain explicit user actions.
- L5X generation remains offline and review-before-use.

## Settings And API-Key Persistence

The web app already uses a `SettingsStore` abstraction plus
`createSecretStore()` for AI secrets. In the browser it falls back to
`localStorage`; in the packaged Windows desktop shell, the `secure_key_*` Tauri
commands store secrets in Windows Credential Manager through the Rust `keyring`
adapter.

The desktop startup now records workstation-only first-run metadata, including
the last startup action and a hard default of `offline-simulation`. This metadata
is not written into project files and does not imply a real controller
connection. Recent-project entries remain local convenience metadata for the
native file-dialog and file-backed project workflow.

The current desktop Rust command surface reports:

- `controller_connection: "offline-simulation"`
- `online_edits: false`
- `acd_access: false`
- `secure_key_storage: "windows-credential-manager"`

That keeps the executable scaffold honest: AI keys use the OS credential store
in packaged desktop builds, while the browser build continues to report its
local-storage fallback.

## Current Status

- [x] `apps/desktop` Tauri scaffold.
- [x] Desktop-only startup mode via `?desktop-startup=1`.
- [x] Web localhost IDE startup remains unchanged.
- [x] Desktop config preflight script.
- [x] Startup-box-sized launch window with promotion into the full IDE shell.
- [x] Workstation-only first-run metadata that keeps Offline Simulation as the
      default mode.
- [x] Rust/Cargo installed on the workstation.
- [x] MSVC Build Tools installed on the workstation.
- [x] Real `.exe`/installer artifact generated locally.
- [ ] Native file dialog bridge.
- [x] OS-backed API-key secure storage adapter.
- [ ] Microsoft Entra ID sign-in implementation.
- [ ] Code signing for distributed Windows deployment.
