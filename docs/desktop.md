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
- Sign in with Microsoft.
- Continue offline.
- Open Project, New Project, Import L5X, Restore Backup.
- Footer status: Workspace ready / No controller connection active.

The Microsoft button does not fake authentication. Until Azure app registration,
token handling, and secure user identity storage are implemented, it opens the
local profile/API-key setup path. Continue offline enters the IDE in Offline
Simulation.

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

The web app already uses a `SettingsStore` abstraction. In the browser it falls
back to `localStorage`; in desktop production it should be replaced with an
OS-backed secure store such as Windows Credential Manager or DPAPI through a
Tauri command/plugin.

The current desktop Rust command surface reports:

- `controller_connection: "offline-simulation"`
- `online_edits: false`
- `acd_access: false`
- `secure_key_storage: "pending-os-keychain-adapter"`

That keeps the executable scaffold honest: it does not claim secure keychain
storage is complete until the adapter is implemented and tested.

## Current Status

- [x] `apps/desktop` Tauri scaffold.
- [x] Desktop-only startup mode via `?desktop-startup=1`.
- [x] Web localhost IDE startup remains unchanged.
- [x] Desktop config preflight script.
- [x] Rust/Cargo installed on the workstation.
- [x] MSVC Build Tools installed on the workstation.
- [x] Real `.exe`/installer artifact generated locally.
- [ ] Native file dialog bridge.
- [ ] OS-backed API-key secure storage adapter.
- [ ] Microsoft Entra ID sign-in implementation.
- [ ] Code signing for distributed Windows deployment.
