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
- ✅ AI assistant (offline/rule-based) + provider interface (local/mock/external
  seam, no API key) + UX polish
- ✅ In-repo E2E smoke harness (`pnpm e2e`)
- ✅ Architecture & AI documentation

## Next milestones

1. **Real LLM connector** — implement an `external` `AssistantProvider` that
   calls a model and returns the same `AssistantResult`/`AssistantPlan` shape;
   apply path and safety model unchanged; key via configuration (none bundled).
2. **Nested / multi-level branch editing** (single-level is implemented;
   imported nested branches are still flattened with a warning).
3. **More instructions:** ONS/RES/TOF/RTO/CTD/NOP/AFI added; 🔜 TOF retentivity
   edge cases, ONS variants, JSR/RET offline routine-call simulation.
4. **Compare report export** — JSON/CSV of compare results (see optional M7).
5. **L5X export research** (not yet implemented; import-only today).
6. **Desktop packaging with Tauri.**
7. **Offline docs / tutorials** inside the app.
8. **Real project import stress testing** with large Studio 5000 exports.

## Constraints (unchanged)

- No PLC/controller communication, download, or online editing.
- No `.ACD` editing.
- No unsafe automation affecting real hardware.
- AI mutates the project only through `@esco/project-actions`, only on Apply.
