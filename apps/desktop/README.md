# ESCO Automation Studio Desktop

This package is the Windows desktop shell for ESCO Automation Studio. It wraps
the existing web IDE with Tauri and requests `?desktop-startup=1`, which shows
the desktop-only first-run startup box before entering the normal IDE.

The web dev server at `localhost:5173` does not request that flag, so it keeps
showing the IDE layout for UI work.

## Commands

```bash
corepack pnpm --filter @esco/desktop typecheck
corepack pnpm --filter @esco/desktop dev
corepack pnpm --filter @esco/desktop build
```

`tauri build` requires Rust/Cargo and the Windows WebView2 build prerequisites.
If Rust is not installed, the scaffold can be verified but an `.exe` cannot be
produced yet.

## Safety Boundaries

- Offline Simulation is the only controller mode in this shell.
- No PLC upload/download/go-online/online edits are added here.
- No `.ACD` access is added here.
- Microsoft sign-in is not faked. Until Azure app registration and secure token
  handling exist, the desktop startup button opens the local profile setup path.
- AI API keys must move to OS-backed secure storage before production desktop
  deployment. The current command boundary reports that adapter as pending.
