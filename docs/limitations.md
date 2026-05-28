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
- **Instruction set is growing but partial.** Supported: XIC, XIO, OTE, OTL, OTU,
  ONS, TON, TOF, RTO, CTU, CTD, RES, MOV, ADD, SUB, MUL, DIV, EQU, NEQ, GRT, GEQ,
  LES, LEQ, NOP, AFI. Not yet: JSR/RET (offline routine calls), TOD/RTOR, file/
  sequencer/PID and many others. Unsupported instructions are **preserved
  read-only** and pass through the simulator (they do not execute).
- **Single-level branch editing only.** You can build parallel/seal-in branches
  by hand (add branch, add/remove legs, add instructions per leg), but nested
  branches can't be created in the UI; imported nested branches are flattened
  with a warning.
- **Local / rule-based AI by default.** Intent matching is keyword-based. There
  is an `AssistantProvider` seam (local / mock / external) ready for a real LLM,
  but the external provider is unconfigured — no LLM connector, no API key, no
  network calls.
- **Import robustness is still improving.** Real-world L5X variety (UDTs,
  AOIs, complex/nested branches, arrays) is partially handled; nested branches
  are flattened with a warning, and unmodeled members default to 0/false in
  simulation.
- **Single-routine simulation focus.** Scanning targets the open/main routine;
  multi-routine/task scheduling (JSR/SBR/RET) is not modelled yet.
- **Single-dimension arrays only.** `DINT[8]` is modelled; multi-dimension arrays
  import the first dimension; arrays of structures aren't expanded.
- **No multi-user, no persistence server.** Projects live in the browser session
  until exported.

## Notes

- DINT/REAL are treated as numbers without strict integer truncation or range
  checks.
- TIMER/COUNTER timing uses a per-scan millisecond delta, not a real-time clock.
- Undo history is capped at 100 steps; copy/paste operates on whole rungs.
