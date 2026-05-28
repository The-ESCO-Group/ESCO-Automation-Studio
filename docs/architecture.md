# Architecture

ESCO Automation Studio is a pnpm monorepo. The PLC domain model is the single
source of truth and lives in `packages/core`; every other package and app
depends on it rather than redefining the model.

## Dependency order (per the plan)

```text
shared
  -> core (domain model)
  -> instructions (registry: XIC, XIO, OTE, ...)
  -> ladder (semantic ladder AST)
  -> simulator (scan-cycle runtime)
  -> validator (rule-based checks)
  -> ui editor (apps/web)
  -> parser-l5x (import)
  -> ai-assistant (later)
```

## Rules

- The UI must not own the PLC model.
- Storage/schema must not leak into React components.
- Ladder is stored as a structured model, never as plain text only.

The web shell (`apps/web`) resolves `@esco/*` packages directly to their
TypeScript source via Vite aliases, so the dev experience needs no per-package
build step.
