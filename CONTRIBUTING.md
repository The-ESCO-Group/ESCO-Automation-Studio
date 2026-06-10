# Contributing to ESCO Automation Studio

ESCO Automation Studio is an internal, **offline** PLC engineering tool. Please
keep every change within the safety boundaries below.

## Setup

- Node.js ≥ 20, pnpm 9 via Corepack.

```bash
corepack pnpm install
corepack pnpm -r typecheck   # type-check every package
corepack pnpm test           # unit tests (Vitest)
corepack pnpm dev            # web app on http://localhost:5173
corepack pnpm e2e            # browser E2E (needs dev server + Microsoft Edge)
corepack pnpm build          # build the web app
```

> If `pnpm` is already on your PATH you can drop the `corepack` prefix.

## Architecture rules (do not break)

- **All project mutations go through `packages/project-actions`.** The UI never
  mutates the project model, JSON, files, or React state directly.
- **The semantic ladder AST is the source of truth** for logic;
  **the instruction registry is the source of truth** for instruction metadata,
  rendering, validation, and runtime behaviour.
- **Keep parser, simulator, and validator logic out of React** — the UI consumes
  the package/action layers.
- **The AI assistant only proposes plans**; they apply through the action layer
  after explicit user Apply.

## Safety boundaries (non-negotiable)

- No unsafe physical PLC/controller operations. Any read-only PLC-family
  transport must stay backend-only and guarded; downloads, writes, physical
  uploads, online edits, forces, and mode changes remain blocked.
- No `.ACD` reading/writing/compiling/decompiling.
- No L5X export (import-only today).
- No external paid APIs and no bundled API keys; nothing is sent off-device.
- Never overwrite a user's original imported file (Save As / export only).

## Workflow

- Branch from `main`; make incremental, verified commits.
- Every feature needs tests; UI-flow changes need an E2E driver; user-facing
  changes need docs.
- Run typecheck + tests (+ e2e when browser behaviour changes) before committing.

## Extending the app

- **New instruction:** add a definition in `packages/instructions` and register
  it; validation, parsing, simulation, and rendering pick it up. Add unit tests.
- **New validator rule:** add to `packages/validator/src/rules.ts` and the
  default engine, with tests.
- **New project action:** add to `packages/project-actions`, returning a
  `ProjectActionResult`; never throw for expected failures.
- **New parser support:** extend `packages/parser-l5x` extractors; preserve
  unsupported content read-only.
