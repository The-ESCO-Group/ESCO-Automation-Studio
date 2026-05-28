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
- **Instruction set is growing but partial.** Supported: bit (XIC/XIO/OTE/OTL/
  OTU/ONS), timers/counters (TON/TOF/RTO/CTU/CTD/RES), move/math
  (MOV/ADD/SUB/MUL/DIV/MOD/SQR/NEG/ABS/CLR), bitwise (AND/OR/XOR/NOT), compare
  (EQU/NEQ/GRT/GEQ/LES/LEQ/LIM/MEQ), program control (JSR/SBR/RET/NOP/AFI). Not
  yet: COP/CPS/FLL/FAL, SQO/SQI, PID, MSG and many others. Unsupported
  instructions are **preserved read-only** and pass through the simulator.
- **Nested branch editing is supported; L5X import still flattens nested branches.**
  You can build parallel/seal-in branches by hand (add branch, add/remove legs,
  add instructions per leg) *and* nest a parallel inside a leg. The gap is on
  **import**: `parseRungText` models only single-level `[A,B]` branches, so
  nested branches in an imported L5X rung are flattened to a series with a
  warning. Building nested branches in the editor works.
- **Local / rule-based AI by default.** Intent matching is keyword-based. There
  is an `AssistantProvider` seam (local / mock / external) ready for a real LLM,
  but the external provider is unconfigured — no LLM connector, no API key, no
  network calls.
- **Import robustness is still improving.** Real-world L5X variety (UDTs,
  AOIs, complex/nested branches, arrays) is partially handled; nested branches
  are flattened with a warning, and unmodeled members default to 0/false in
  simulation.
- **Program-scoped multi-routine, single task.** JSR/SBR/RET run subroutines
  within the scanned routine's program; cross-program calls, task scheduling,
  and SBR/RET parameter passing are not modelled.
- **UDT / AOI / I-O are view-only.** They have read-only detail viewers
  (parameters, members, modules, references), but AOI/UDT internal logic is not
  executed and I/O is imported metadata only — no controller communication.
- **Single-dimension arrays only.** `DINT[8]` is modelled; multi-dimension arrays
  import the first dimension; arrays of structures aren't expanded.
- **Large routines collapse rather than virtualize.** Routines over 100 rungs
  show the first 100 with a "Show all" toggle; there is no true row
  virtualization yet, so "Show all" on a very large routine can be heavy.
- **No multi-user, no persistence server.** Projects live in the browser session
  until exported.

## Notes

- DINT/REAL are treated as numbers without strict integer truncation or range
  checks.
- TIMER/COUNTER timing uses a per-scan millisecond delta, not a real-time clock.
- Undo history is capped at 100 steps; copy/paste operates on whole rungs.
