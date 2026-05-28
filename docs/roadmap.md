# Roadmap

Status legend: ✅ done · 🔜 next · ⏳ later

## Done

- ✅ Editable ladder routine + semantic AST
- ✅ Instruction registry + simulator (scan cycle)
- ✅ Validation engine
- ✅ Project persistence (`.plcproj.json` export/import)
- ✅ Instruction expansion: XIC, XIO, OTE, TON, CTU, MOV, EQU, GRT, LES
- ✅ L5X import (MVP + hardening: branches, member/array paths, descriptions, summary)
- ✅ Controlled project-actions API
- ✅ AI assistant MVP (offline/rule-based) + UX polish
- ✅ Architecture & AI documentation

## Next milestones

1. **Real LLM connector** behind the same action layer (swap `planner.ts`;
   apply path and safety model unchanged; key via configuration).
2. **More instructions:** ✅ OTL, OTU, NEQ, LEQ, GEQ, ADD, SUB, MUL, DIV added;
   🔜 remaining: ONS, RES, TOF, RTO, CTD (need edge/retentive state).
3. **Better branch editing UI** (create/split parallel branches in the editor,
   not only via imported/text rungs).
4. ✅ **Cross-reference panel** — where each tag is read/written across routines.
5. **Tag table editor** — bulk create/edit/delete tags with types/descriptions.
6. **Routine compare** — diff two routines / project versions.
7. **L5X export research** (not yet implemented; import-only today).
8. **Desktop packaging with Tauri.**
9. **Offline docs / tutorials** inside the app.
10. **Real project import stress testing** with large Studio 5000 exports.

## Constraints (unchanged)

- No PLC/controller communication, download, or online editing.
- No `.ACD` editing.
- No unsafe automation affecting real hardware.
- AI mutates the project only through `@esco/project-actions`, only on Apply.
