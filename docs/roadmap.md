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
- ✅ Branch editing UI — parallel/seal-in **and nested** branches by hand
- ✅ Routine & project compare — fingerprint match + strict/logical (OR-order)
  canonicalization; JSON/CSV report export
- ✅ AI assistant (offline/rule-based) + provider interface (local/mock/external
  seam, no API key) + UX polish
- ✅ Undo / redo action history (Ctrl+Z/Y) + copy / duplicate / paste rungs
- ✅ Single-dimension array tags + alias resolution (validation + simulation) +
  UDT/structured member validation + program-scope shadowing
- ✅ Validator rules: double-coil, duplicate program tag, alias target, array
  bounds, unknown member, unknown routine
- ✅ Crash-safe error boundary + unsaved-changes guard
- ✅ Project format v2 + migration system + browser autosave/recovery
- ✅ Instruction set: bitwise (AND/OR/XOR/NOT), math (MOD/SQR/NEG/ABS/CLR),
  compare (LIM/MEQ), program control (JSR/SBR/RET)
- ✅ JSR / SBR / RET — offline multi-routine execution with a call-depth guard
- ✅ Simulator debugging — execution trace + force table
- ✅ UDT / Add-On Instruction / I/O module import + read-only **detail viewers**
  (AOI parameters/local tags/routines/references, UDT members/paths/usage, I/O
  modules by slot)
- ✅ Large-project handling: windowed tag table + large-routine collapse/show-all
- ✅ Performance: synthetic large-project generator + stress tests + import timing
- ✅ CI (install/typecheck/test/build) + CHANGELOG + CONTRIBUTING + dependency
  review + issue templates
- ✅ In-repo E2E smoke harness (`pnpm e2e`)
- ✅ Architecture & AI documentation

## Next milestones

1. **More data/sequencer instructions:** COP/CPS/FLL/FAL, SQO/SQI, file ops.
2. **AOI / UDT logic execution** (internal routines are imported and listed but
   not simulated; show/run their logic).
3. **Real LLM connector** — implement an `external` `AssistantProvider` that
   calls a model; apply path and safety model unchanged; key via configuration.
4. **Desktop packaging with Tauri** — scaffold `apps/desktop` per
   [docs/desktop.md](./desktop.md) (needs a Rust toolchain).
5. **True editor virtualization** for very large routines (today: collapse +
   show-all).
6. **L5X export research** (not yet implemented; import-only today).

## Constraints (unchanged)

- No PLC/controller communication, download, or online editing.
- No `.ACD` editing.
- No unsafe automation affecting real hardware.
- AI mutates the project only through `@esco/project-actions`, only on Apply.
