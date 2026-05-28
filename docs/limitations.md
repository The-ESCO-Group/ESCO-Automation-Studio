# Current Limitations

ESCO Automation Studio is an **offline engineering and simulation tool**. The
following are intentional boundaries and known gaps.

## Safety boundaries (by design)

- **No real PLC / controller communication.** It cannot connect to, browse, or
  exchange data with any controller.
- **No online edits or downloads.** Nothing is ever sent to hardware.
- **No `.ACD` compile / decompile or editing.** The tool only reads `.L5X` (XML)
  and reads/writes its own `.plcproj.json`.
- The AI assistant has **no hardware access** and changes the project **only**
  through `packages/project-actions`, only after explicit user Apply.

## Functional gaps

- **No L5X export yet** — import-only. Export research is on the roadmap.
- **Incomplete instruction set.** Supported: XIC, XIO, OTE, OTL, OTU, TON, CTU,
  MOV, ADD, SUB, MUL, DIV, EQU, NEQ, GRT, GEQ, LES, LEQ. Not yet: ONS, RES, TOF,
  RTO, CTD, JSR, and others. Unsupported instructions are **preserved read-only**
  and pass through the simulator (they do not execute).
- **Limited branch editing.** Branches import and simulate, but the editor adds
  instructions as a series; creating/splitting parallel branches in the UI is
  not implemented (use imported rungs or AI/text-generated rungs).
- **Local / rule-based AI only.** Intent matching is keyword-based; there is no
  LLM connector yet (the architecture is ready for one behind the same action
  layer).
- **Import robustness is still improving.** Real-world L5X variety (UDTs,
  AOIs, complex/nested branches, arrays) is partially handled; nested branches
  are flattened with a warning, and unmodeled members default to 0/false in
  simulation.
- **Single-routine simulation focus.** Scanning targets the open/main routine;
  multi-routine/task scheduling is not modelled.
- **No multi-user, no persistence server.** Projects live in the browser session
  until exported.

## Notes

- DINT/REAL are treated as numbers without strict integer truncation or range
  checks.
- TIMER/COUNTER timing uses a per-scan millisecond delta, not a real-time clock.
