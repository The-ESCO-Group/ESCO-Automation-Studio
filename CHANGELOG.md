# Changelog

All notable changes to ESCO Automation Studio are recorded here. This is an
internal, offline engineering tool — it does not communicate with controllers,
does not modify `.ACD` files, and requires no external API keys.

## 0.1.0 — Internal engineering IDE

First consolidated internal release. Offline Studio 5000-style IDE for viewing,
editing, simulating, validating, importing, and comparing ladder logic.

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
