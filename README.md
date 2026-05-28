# ESCO Automation Studio

A Studio 5000-style PLC / automation IDE for ESCO Electric — an **offline**
engineering tool for editing, simulating, validating, and importing ladder
logic. It does **not** communicate with any controller and never touches `.ACD`
files.

## What it supports today

- **Editable ladder logic** stored as a semantic AST (not text).
- **Branch editing** — build parallel / seal-in branches by hand, including
  **nested** branches (add a parallel branch, add/remove legs, add instructions
  per leg, nest a parallel inside a leg).
- **Undo / redo** for every project edit (Ctrl+Z / Ctrl+Y), with copy /
  duplicate / paste of rungs.
- **Offline scan-cycle simulation** with a Watch panel (toggle inputs, Scan
  Once / Run / Reset). Array tags (`DINT[n]`) are watched element-by-element.
- **Simulator debugging** — an execution **trace** (per-instruction power flow)
  and a **force** table that overrides values for offline what-if testing.
- **Instruction set:** XIC, XIO, OTE, OTL, OTU, ONS, TON, TOF, RTO, CTU, CTD,
  RES, MOV, ADD, SUB, MUL, DIV, MOD, SQR, NEG, ABS, CLR, AND, OR, XOR, NOT,
  EQU, NEQ, GRT, GEQ, LES, LEQ, LIM, MEQ, JSR, SBR, RET, NOP, AFI.
- **Multi-routine execution** — JSR runs a subroutine against shared tags, RET
  returns early, with a call-depth guard against runaway recursion.
- **Validation engine** (undefined tags, type mismatches, missing operands,
  unsupported instructions, array index bounds, unknown members, double-coil,
  duplicate tags, alias-target and unknown-routine resolution; program-scope
  shadowing).
- **Project persistence** — versioned `.plcproj.json` (format v2 + migrations),
  browser autosave / recovery, an unsaved-changes guard, and a crash-safe error
  boundary.
- **Studio 5000 L5X import** (branches, member/array paths, descriptions, alias
  and unmodeled-type warnings, located warnings, import summary). Import-only;
  unsupported instructions are preserved read-only.
- **Structure viewers** — click an Add-On Instruction, UDT, or I/O module in the
  explorer for a read-only detail view: AOI parameters / local tags / routines /
  call references; UDT members (with array dims) + member paths + tags using it;
  the I/O module tree by slot (offline metadata only).
- **Large-project handling** — search-first windowed tag table and a
  collapse / show-all mode for very large routines.
- **Tag table editor** — create / rename / describe / delete tags.
- **Cross reference** — where each tag is read / written.
- **Routine & project compare** — match routines by logic fingerprint (not just
  names) and see identical / changed / only-in-either, with side-by-side diffs.
- **AI assistant** — offline, rule-based; explains logic and proposes previewable
  plans applied only through the controlled action layer (no API key). Runs
  behind a provider interface (local / mock / external) ready for a future LLM.

## Requirements

- Node.js >= 20 (developed on Node 24)
- pnpm 9 (via Corepack: `corepack pnpm ...`)

## Commands

```bash
corepack pnpm install        # install dependencies
corepack pnpm -r typecheck   # type-check every package
corepack pnpm test           # run the Vitest suite
corepack pnpm dev            # start the web IDE (http://localhost:5173)
corepack pnpm e2e            # browser smoke tests (needs dev server running)
```

> If `pnpm` is on your PATH you can drop the `corepack` prefix.

## Run the demo

1. `corepack pnpm dev`, open http://localhost:5173.
2. The **Welcome dashboard** lists what the tool does and quick actions.
3. Click **Open Demo Routine** → toggle `StartPB` in **Watch** → **Scan Once** →
   `MotorRun` energizes (seal-in starter).
4. See [`docs/demo-script.md`](docs/demo-script.md) for the full walkthrough.

## Architecture summary

A pnpm monorepo built in dependency order; React lives only in `apps/web`.

```text
core → ladder → instructions → simulator → validator
                              → project-store → parser-l5x → project-actions → ai-assistant
apps/web depends on the packages above (never the reverse).
```

- `packages/core` — PLC domain model + data-type catalog.
- `packages/ladder` — semantic ladder AST + immutable edits.
- `packages/instructions` — instruction registry (single source of metadata).
- `packages/simulator` — scan-cycle runtime.
- `packages/validator` — rule-based validation.
- `packages/project-store` — `.plcproj.json` serialize/deserialize.
- `packages/parser-l5x` — Studio 5000 L5X import.
- `packages/project-actions` — **the only sanctioned way to mutate a project**
  (typed, immutable, validated). See [`docs/project-actions.md`](docs/project-actions.md).
- `packages/ai-assistant` — offline assistant. See [`docs/ai-assistant.md`](docs/ai-assistant.md).
- `apps/web` — React + Vite IDE shell.

Full detail: [`docs/current-architecture.md`](docs/current-architecture.md),
features: [`docs/current-features.md`](docs/current-features.md).

## Safety / limitations (offline by default)

- **No PLC / controller communication, download, or online editing.**
- **No `.ACD` compile/decompile** — only `.plcproj.json` (read/write) and `.L5X`
  (read).
- **AI is offline/local by default** and changes the project only through
  `packages/project-actions`, only on explicit Apply.
- **Optional opt-in online AI agent** (Claude `claude-opus-4-7`): off by default,
  uses your own API key (browser session-only) or a server proxy with an env key —
  no key is bundled or committed. When enabled, it sends your prompt and project
  context to the provider. It still edits only by proposing actions you Apply
  through `project-actions`; it has no PLC/.ACD/file access. See
  [`docs/online-ai-safety.md`](docs/online-ai-safety.md).
- **Not a replacement for Studio 5000** — an offline engineering/simulation aid.

Full list: [`docs/limitations.md`](docs/limitations.md). Online AI safety:
[`docs/online-ai-safety.md`](docs/online-ai-safety.md). Roadmap:
[`docs/roadmap.md`](docs/roadmap.md).

## Architecture rules

- The UI must not own the PLC model — it lives in `packages/core`.
- All project mutations go through `packages/project-actions`.
- The semantic ladder AST and the instruction registry are the sources of truth.
