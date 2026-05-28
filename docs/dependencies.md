# Dependencies & security notes

ESCO Automation Studio is an offline internal tool. This document summarizes its
dependencies and the safety posture for an internal security/license review.

## Runtime dependencies

| Package | Why | Notes |
|---|---|---|
| `react`, `react-dom` | Web UI | MIT |
| `fast-xml-parser` | Parse `.L5X` (XML) on import | MIT; XML parsed as data, no DTD/entity expansion used |

That is the entire third-party runtime surface. Everything else (ladder model,
instructions, simulator, validator, parser glue, project-actions, compare, AI
assistant) is first-party code under `packages/`.

## Dev / build dependencies

`typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, and `playwright-core`
(used only by the local E2E harness, which launches Microsoft Edge via the
`msedge` channel — no browser binaries are downloaded).

## Security posture

- **No network calls.** The app does not contact any server. No telemetry.
- **No external/paid APIs and no API keys.** The AI assistant is local and
  rule-based; the external-LLM provider is an unconfigured stub.
- **No PLC communication, downloads, uploads, or online edits.**
- **No `.ACD` handling** (no read/write/compile/decompile of controller binaries).
- **No L5X export** — import-only; the app never overwrites a user's source file.
- **File safety.** Imports are validated and parsed as data; project files are
  schema-checked before replacing app state. Autosave uses browser localStorage
  only and is recovery-only.
- **No arbitrary code execution** from imported content.

## Not certified

This tool is for offline engineering review and learning. It is **not** validated
for controlling live equipment and is **not** a certified Studio 5000 replacement.
