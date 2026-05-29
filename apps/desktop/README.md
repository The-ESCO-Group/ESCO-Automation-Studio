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
- the window opens at the compact startup-box size (758×558, non-resizable) and
  the `promote_desktop_window_to_ide` command exists;
- a restrictive **Content-Security-Policy** is set (no longer `null`) — see below;
- the capability set stays minimal (**core permissions only** — no broad
  `fs`/`shell`/`http` grants);
- the desktop capability report stays honest: `offline-simulation`,
  `online_edits: false`, `acd_access: false`.

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
connect-src 'self' https://api.anthropic.com https://api.openai.com;
object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

`connect-src` is opened **only** to same-origin plus the two opt-in online-AI
hosts; everything else is locked to `'self'`. Tauri augments this policy with the
sources it needs for IPC at build time.

> **Validate before release:** this CSP is asserted by the preflight but has not
> been exercised by a real `tauri build` in this environment (no Rust toolchain).
> Run the desktop app once after building and confirm the IDE loads and the
> opt-in online assistant can still reach its host before relying on it.

## Secure key storage (OS keychain)

AI API keys must move off browser `localStorage` to OS-backed encrypted storage
before production desktop deployment. The web side already ships the abstraction:
`apps/web/src/desktop-secret-store.ts` resolves a `SecretStore` that prefers the
OS keychain on desktop and falls back to browser-local storage, exposing which
backend is active (`backend` / `osEncrypted` / `label`) so the UI never claims
"secure" storage when only the fallback is active.

It calls these Tauri commands (the contract — see `SECURE_KEY_COMMANDS`):
`secure_key_available`, `secure_key_get(name)`, `secure_key_set(name, value)`,
`secure_key_delete(name)`. Until those commands are compiled in,
`secure_key_available` is absent, so the abstraction degrades to browser-local —
the app keeps working and auto-upgrades once the commands exist.

**Ready-to-enable Rust implementation** (build-unverified here — needs the Rust
toolchain to compile and a real run to validate against Windows Credential
Manager). Add to `Cargo.toml`:

```toml
keyring = { version = "3", features = ["windows-native"] }
```

Add to `src-tauri/src/lib.rs` and register the four commands in
`generate_handler!`:

```rust
const KEYRING_SERVICE: &str = "com.scintilla.escogroup.automationstudio";

#[tauri::command]
fn secure_key_available() -> bool {
    keyring::Entry::new(KEYRING_SERVICE, "__availability_probe__")
        .map(|entry| !matches!(entry.get_password(), Err(keyring::Error::PlatformFailure(_))))
        .unwrap_or(false)
}

#[tauri::command]
fn secure_key_get(name: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &name).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(other) => Err(other.to_string()),
    }
}

#[tauri::command]
fn secure_key_set(name: String, value: String) -> Result<(), String> {
    keyring::Entry::new(KEYRING_SERVICE, &name)
        .map_err(|e| e.to_string())?
        .set_password(&value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn secure_key_delete(name: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &name).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(other) => Err(other.to_string()),
    }
}
```

After compiling, flip `desktop_capabilities.secure_key_storage` from
`"pending-os-keychain-adapter"` to the active backend and have the web profile
read/write the key through `createSecretStore()` instead of `localStorage`.

## Safety Boundaries

- Offline Simulation is the only controller mode in this shell.
- No PLC upload/download/go-online/online edits are added here.
- No `.ACD` access is added here.
- Microsoft sign-in is not faked. Until Azure app registration and secure token
  handling exist, the desktop startup button opens the local profile setup path.
- AI API keys must move to OS-backed secure storage (above) before production
  desktop deployment. `desktop_capabilities` reports that adapter as pending.
