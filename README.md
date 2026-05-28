# ESCO Automation Studio

A Studio 5000-style PLC / automation IDE for ESCO Electric.

This is a clean monorepo foundation. It currently provides the workspace
structure and a basic running IDE web shell. The PLC domain model, ladder
editor, simulator, validator, L5X import, and AI assistant are built on top of
this foundation in later phases (see `01_Planning/ESCO Automation Studio Plan.md`).

## Requirements

- Node.js >= 20 (developed on Node 24)
- pnpm 9 (provided via Corepack: `corepack pnpm ...`)

## Install

```bash
corepack pnpm install
```

## Run the web IDE shell

```bash
corepack pnpm dev
```

Then open the URL Vite prints (default http://localhost:5173).

> If you have `pnpm` on your PATH (e.g. after `npm i -g pnpm` or
> `corepack enable` as administrator), you can drop the `corepack` prefix and
> just run `pnpm install` / `pnpm dev`.

## Workspace layout

```text
apps/
  web/                React + Vite IDE shell
  api/                Backend API (stub, Node http)
packages/
  core/               PLC domain model (Project/Controller/Task/Program/Routine/Tag)
  ladder/             Ladder semantic model (rungs, branches, nodes, operands)
  instructions/       Instruction registry (XIC, XIO, OTE, ...)
  simulator/          PLC scan-cycle runtime (skeleton)
  validator/          Rule-based validation engine (skeleton)
  parser-l5x/         L5X import (stub)
  project-store/      Project save/load to .plcproj.json
  ui/                 Shared UI components
  shared/             IDs, errors, events, utilities
docs/
tests/
scripts/
```

## Architecture rules

- The UI must not own the PLC model. The model lives in `packages/core`.
- Database/storage schema must not leak into React components.
- Build in dependency order: core -> instructions -> ladder -> simulator ->
  validator -> UI editor -> L5X import -> AI assistant.
