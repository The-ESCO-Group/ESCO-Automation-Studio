# ESCO Automation Studio Desktop

This package is the Windows desktop shell for ESCO Automation Studio. It wraps
the existing web IDE with Tauri and requests `?desktop-startup=1`, which shows
the desktop-only first-run startup box before entering the normal IDE.

The web dev server at `localhost:5173` does not request that flag, so it keeps
showing the IDE layout for UI work.

## Commands

```bash
corepack pnpm --filter @esco/desktop typecheck   # static production preflight (no Rust needed)
corepack pnpm --filter @esco/desktop dev         # tauri dev (needs Rust + WebView2)
corepack pnpm --filter @esco/desktop build       # tauri build → installer (needs Rust + WebView2)
```

`typecheck`/`preflight` runs `scripts/verify-desktop-config.mjs`, a static gate
that asserts the production-safety properties we control from config + source
(see **Production preflight** below). It does not need a compiler.

`tauri dev` / `tauri build` require Rust/Cargo and the Windows WebView2 build
prerequisites. If Rust is not installed, the scaffold can be verified but an
`.exe`/installer cannot be produced yet.

## Production preflight (`scripts/verify-desktop-config.mjs`)

A real `tauri build` is the only thing that produces and fully validates an
installer, but the preflight catches regressions in the properties we can check
without a compiler, and fails CI if any weaken:

- the Tauri scaffold files and the `.ico` icon exist;
- product identity is intact (productName, `com.scintilla.escogroup` identifier,
  bundle publisher);
- the window opens at the compact startup-box size (760×560, non-resizable,
  undecorated) and the `promote_desktop_window_to_ide` command exists;
- a restrictive **Content-Security-Policy** is set (no longer `null`) — see below;
- the capability set stays minimal (**core permissions only** — no broad
  `fs`/`shell`/`http` grants);
- the desktop capability report stays honest: `offline-simulation`,
  `online_edits: false`, `binary_project_access: false`.

## Real Windows delivery

`corepack pnpm --filter @esco/desktop build` runs `tauri build`, which:

1. builds the web app (`@esco/web build` → `apps/web/dist`),
2. compiles the Rust shell, and
3. produces the bundles named in `tauri.conf.json` (`bundle.targets: "all"` →
   MSI via WiX and NSIS `setup.exe` on Windows) under
   `apps/desktop/src-tauri/target/release/bundle/`.

Prerequisites: Rust (stable, MSVC toolchain), the WebView2 runtime, and (for
MSI) the WiX toolset that Tauri provisions. **Code signing is not configured
yet** — for distribution, add an Authenticode certificate via Tauri's
`bundle.windows.certificateThumbprint` / signing config before shipping.

## Content-Security-Policy

The packaged window now ships a CSP (previously `null`):

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; font-src 'self' data:;
connect-src 'self' http://localhost:4000 http://127.0.0.1:4000
  https://api.anthropic.com https://api.openai.com;
object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

`connect-src` is opened **only** to same-origin, the local ESCO API on loopback
port `4000`, and the two opt-in online-AI hosts; everything else is locked out.
Tauri augments this policy with the sources it needs for IPC at build time.

> **Validate before release:** this CSP is asserted by the preflight but has not
> been exercised by a real `tauri build` in this environment (no Rust toolchain).
> Run the desktop app once after building and confirm the IDE loads and the
> opt-in online assistant can still reach its host before relying on it.

## Secure key storage (OS keychain)

AI API keys are stored through `apps/web/src/desktop-secret-store.ts`, which
prefers the desktop OS keychain and falls back to browser-local storage only when
the secure desktop commands are unavailable. The active backend is surfaced via
`backend` / `osEncrypted` / `label`, so the UI never claims "secure" storage
when only the fallback is active.

It calls these Tauri commands (the contract — see `SECURE_KEY_COMMANDS`):
`secure_key_available`, `secure_key_get(name)`, `secure_key_set(name, value)`,
`secure_key_delete(name)`. In the packaged Windows shell these are backed by the
`keyring` crate with the `windows-native` feature, using Windows Credential
Manager under the service name `com.scintilla.escogroup.automationstudio`.
`desktop_capabilities.secure_key_storage` reports
`"windows-credential-manager"` when this adapter is compiled in.

## Safety Boundaries

- Offline Simulation is the only controller mode in this shell.
- No PLC upload/download/go-online/online edits are added here.
- No proprietary binary controller-project access is added here.
- Microsoft sign-in is temporarily bypassed during desktop startup. Until Azure
  app registration and secure token handling exist, startup opens the IDE
  without requiring identity.
- AI API keys use OS-backed secure storage in the packaged desktop shell; browser
  builds remain honest about local fallback storage.
