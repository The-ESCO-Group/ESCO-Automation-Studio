# Changelog

All notable changes to ESCO Automation Studio are recorded here. This is an
internal, offline engineering tool — it does not communicate with controllers,
does not modify `.ACD` files, and requires no external API keys.

## 0.1.0 — Internal engineering IDE

First consolidated internal release. Offline Studio 5000-style IDE for viewing,
editing, simulating, validating, importing, and comparing ladder logic.

### Live AI agent (2026-05-28)
- Added an **opt-in online agent** (Claude `claude-opus-4-7`) in the AI Copilot,
  alongside the offline rule-based assistant (which remains the default).
- The agent is **agentic but propose-only**: it inspects via a whitelisted set of
  read tools and proposes write actions as a previewable plan; the real project is
  never mutated during a run. Apply routes the plan through `@esco/project-actions`,
  runs validation, and commits one undoable edit.
- Two transports: `browser-key` (developer/local testing only — user-pasted key,
  session-only, never written to disk) and `proxy` (production pattern — a
  same-origin route injects `ANTHROPIC_API_KEY` from the server env; the browser
  never sees the key). No key is bundled or committed.
- Model/provider config centralized in `packages/ai-assistant/src/agentConfig.ts`.
- Tool whitelist maps only to project-actions; no file/shell/network/PLC/.ACD/eval
  tools exist. The agent loop is unit-tested with a mock provider (no real calls).

### Editor
- Editable ladder logic on a semantic AST (not text).
- Branch editing including **nested** parallel/seal-in branches.
- Undo / redo (Ctrl+Z / Ctrl+Y) and copy / duplicate / paste of rungs.

### Instructions
- Bit (XIC/XIO/OTE/OTL/OTU/ONS), timers/counters (TON/TOF/RTO/CTU/CTD/RES),
  move/math (MOV/ADD/SUB/MUL/DIV/MOD/SQR/NEG/ABS/CLR), bitwise (AND/OR/XOR/NOT),
  compare (EQU/NEQ/GRT/GEQ/LES/LEQ/LIM/MEQ), program control
  (JSR/SBR/RET/NOP/AFI).

### Simulation
- Offline scan-cycle simulator with a Watch panel.
- Multi-routine execution: JSR runs a subroutine, RET returns early (call-depth
  guarded).
- Debugging: execution **trace** tab and a **force** table (offline overrides).
- Single-dimension array tags and alias resolution in simulation.

### Validation
- Undefined tags, type mismatches, missing operands, unsupported instructions,
  array bounds, unknown members, double-coil, duplicate tags, alias targets,
  unknown JSR routines; program-scope shadowing.

### Tags & structure
- Tag table (create/rename/describe/delete), arrays, aliases, UDT member paths.
- L5X import: controller/programs/routines/rungs, tags (descriptions/aliases),
  branches, member/array paths, plus read-only UDT / Add-On Instruction / I/O
  module structure; located warnings + import summary with timing.

### Compare
- Routine/project comparison by logic fingerprint with strict and logical
  (OR-order-insensitive) modes; JSON/CSV report export.

### Project files
- `.plcproj.json` format v2 with metadata + a migration system.
- Browser autosave/recovery and an unsaved-changes guard.

### AI assistant
- Offline, rule-based assistant behind a provider interface (local/mock/
  external stub); proposes plans, applies only through the action layer.

### Quality
- 180+ unit tests, an in-repo browser E2E harness (`pnpm e2e`), and CI
  (install / typecheck / test / build).

### Known limitations
- Not a certified Studio 5000 replacement; offline-only.
- No L5X export, no `.ACD` handling, no PLC communication.
- Single task / program-scoped multi-routine; AOI/UDT internals are view-only.
- Large routines are not yet virtualized in the editor.
