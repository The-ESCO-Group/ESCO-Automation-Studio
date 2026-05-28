# Roadmap

Status legend: ✅ done · 🔜 next · ⏳ later

## Done

- ✅ Editable ladder routine + semantic AST
- ✅ Instruction registry + simulator (scan cycle)
- ✅ Validation engine
- ✅ Project persistence (`.plcproj.json` export/import)
- ✅ Instruction set: XIC, XIO, OTE, OTL, OTU, ONS, TON, TOF, RTO, CTU, CTD,
  RES, MOV, ADD, SUB, MUL, DIV, EQU, NEQ, GRT, GEQ, LES, LEQ, NOP, AFI
- ✅ L5X import (MVP + hardening: branches, member/array paths, descriptions,
  alias/unmodeled-type warnings, located warnings, summary, stress fixtures)
- ✅ Controlled project-actions API
- ✅ Cross-reference panel — where each tag is read/written across routines
- ✅ Tag table editor — create/rename/describe/delete with types
- ✅ Branch editing UI — build single-level parallel/seal-in branches by hand
- ✅ Routine & project compare — match by logic fingerprint, not just names
- ✅ Compare report export (JSON/CSV)
- ✅ AI assistant (offline/rule-based) + provider interface (local/mock/external
  seam, no API key) + UX polish
- ✅ Undo / redo action history (Ctrl+Z/Y) + copy / duplicate / paste rungs
- ✅ Single-dimension array tags (import, simulate, watch, bounds validation)
- ✅ Validator rules: double-coil, duplicate program tag, alias target, array bounds
- ✅ Crash-safe error boundary + unsaved-changes indicator/guard
- ✅ In-repo E2E smoke harness (`pnpm e2e`)
- ✅ Architecture & AI documentation

## Next milestones (Logix Fidelity)

1. **More instructions:** bitwise (AND/OR/XOR/NOT), math (MOD/SQR/NEG/ABS),
   data (CLR/COP/FLL), compare (LIM/MEQ).
2. **JSR / SBR / RET** — offline multi-routine execution with a call stack.
3. **AOI / UDT / I/O tree viewers** — import and display (read-only first).
4. **Nested / multi-level branch editing** (single-level is implemented;
   imported nested branches are still flattened with a warning).
5. **Real LLM connector** — implement an `external` `AssistantProvider` that
   calls a model; apply path and safety model unchanged; key via configuration.
6. **L5X export research** (not yet implemented; import-only today).
7. **Desktop packaging with Tauri.**
8. **Real project import stress testing** with large Studio 5000 exports.

## Constraints (unchanged)

- No PLC/controller communication, download, or online editing.
- No `.ACD` editing.
- No unsafe automation affecting real hardware.
- AI mutates the project only through `@esco/project-actions`, only on Apply.
