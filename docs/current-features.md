# Current Features

A detailed inventory of what ESCO Automation Studio supports today.

## Ladder editing

- Semantic ladder AST (`@esco/ladder`): rungs → branches (series, parallel,
  continuation) → nodes → operands. Not stored as text.
- Add / delete rungs; editable rung comments.
- Grouped instruction palette (Bit / Timer-Counter / Move-Math / Compare /
  Program) that adds to the selected rung.
- **Branch editing** for the selected rung: add a parallel branch, add/remove
  legs (empty legs only), and add instructions to a specific leg — enough to
  build a seal-in by hand. Single-level parallels (the MVP scope).
- Inline operand editing with undefined-tag highlighting and one-click
  "create the missing tag" (data type inferred from the operand).
- Copy / Duplicate / Paste rungs (deep-cloned with fresh ids).
- Undo / redo for every project edit, with Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
  (text fields keep native undo); undoing back to the last saved state clears
  the unsaved-changes flag.
- Rung and instruction selection with a focus highlight.
- Branch rendering (parallel paths stacked); unsupported instructions render as
  dashed, read-only boxes.

## Instruction set

| Category | Instructions |
|---|---|
| Bit | XIC, XIO, OTE, OTL, OTU, ONS |
| Timer / Counter | TON, TOF, RTO, CTU, CTD, RES |
| Move / Math | MOV, ADD, SUB, MUL, DIV, MOD, SQR, NEG, ABS, CLR |
| Bitwise | AND, OR, XOR, NOT |
| Compare | EQU, NEQ, GRT, GEQ, LES, LEQ, LIM, MEQ |
| Program | JSR, SBR, RET, NOP, AFI |

ONS is a rising-edge one-shot (storage bit); RTO is a retentive timer cleared by
RES; CTD counts down (mirror of CTU); LIM handles ascending and circular ranges;
MEQ compares under a mask. JSR runs a sibling routine against the same tags (RET
returns early; SBR marks an entry), with a call-depth guard. Instruction
metadata (operands, allowed types, read/write direction, render style) lives in
the registry
(`@esco/instructions`) and drives the editor, simulator, validator, and import.

## Simulation

- Scan-cycle runtime (`@esco/simulator`): series + parallel + continuation,
  unknown instructions pass through (never crash).
- Watch panel: BOOL toggles, DINT/REAL number inputs, TIMER/COUNTER member
  values (PRE/ACC/EN/TT/DN, CU), input/output role.
- Scan Once / Run (interval) / Reset; timers advance by a per-scan delta.
- Multi-routine execution: JSR runs a sibling routine (same program) against the
  shared tag memory, RET returns early, with a 32-deep call guard.

## Controller safety boundary

- `@esco/controller-comm` owns the controller/session state machine and guarded
  hardware-command policy.
- Default state is **Offline Simulation**. Additional safe states distinguish
  **Model-only Review**, **Disconnected**, **Connection Disabled**,
  **Controller Link Unavailable**, **Faulted**, and **Safety Blocked**.
- Hardware Go Online, upload, download, online edit, and live controller monitor
  are represented as guarded commands. In this build they return blocked results
  with explicit reasons and audit entries because no tested controller transport
  is configured.
- Ribbon and status UI must not claim a controller is connected unless the
  session reports a verified real transport. The shipped transports do not do
  that.

## Validation

- Rule-based (`@esco/validator`): undefined tags (base-tag aware for member /
  array paths), operand type mismatches, missing required operands, unsupported
  instructions (info), array index out-of-range, double-coil (a BOOL driven by
  2+ OTE), duplicate controller / program tags, and alias-target resolution.
  Never mutates the project. Surfaced in the Errors tab and the title-bar badge.

## Tags

- Tag table editor: searchable table with name, type, scope, description,
  current value, role badge, and reference count.
- Create (BOOL/DINT/REAL/TIMER/COUNTER), inline rename (remaps references),
  edit description, delete (blocked when referenced) — all via `project-actions`.
- Single-dimension array tags (`DINT[8]`): imported from L5X `Dimensions`,
  expanded into element value-paths for simulation, shown per-element in the
  Watch panel, and bounds-checked by validation.

## Cross reference

- Every tag use across routines: routine, rung number, instruction type,
  operand path, and read/write direction. Click to open the routine. Member /
  array paths resolve to the base tag.

## Files

- Export / import `.plcproj.json` (full project incl. ladder AST).
- Studio 5000 `.L5X` import: controller, programs, routines, rungs (+comments),
  controller & program tags (+descriptions, aliases), supported instructions,
  and read-only structure — user-defined types, Add-On Instruction definitions,
  and the I/O module tree — with a counts + warnings import summary. Warnings
  include routine/rung location for unsupported instructions and flattened
  branches, plus alias and unmodeled-data-type notices.

## Structure viewers (read-only)

- Click an item in the Project Explorer to open a detail view in the center:
  - **Add-On Instruction:** name / description / revision, a parameters table
    (name, type, usage, required, default, description), local tags, routine
    names, and "Used by" call references (click to open the calling routine).
  - **UDT:** description, members (type, array dimension, description), member
    access-path previews, and the tags that use the type.
  - **I/O module tree:** modules by slot (name, catalog, slot, parent module,
    comm path, description) with an offline-only ("imported metadata, no
    controller communication") notice.

## Large projects

- Tag table renders search-first and windows large tag sets (cap with a
  "search to narrow down" notice); derived rows are memoized.
- Routines over 100 rungs collapse to the first 100 with a "Show all rungs"
  control to keep the editor responsive.

## Compare (`@esco/compare`)

- Normalize each routine to canonical neutral text (ids and absolute rung
  numbers dropped) into a full (operand-sensitive) and structure
  (operand-insensitive) fingerprint.
- Compare view: load a second `.plcproj.json` or `.L5X`, then see matched /
  changed / only-in-current / only-in-comparison counts. Routines pair by logic
  fingerprint first, then by name — so renamed routines still match.
- Expand a changed routine for a side-by-side normalized rung diff.

## AI assistant (offline, rule-based)

- Explain rung / routine / validation findings.
- Generate motor starter, timer, counter, MOV examples; fix undefined tags.
- Proposes a previewable plan; applies only on click, only through
  `project-actions`; shows validation after apply. No API key required.
- Runs behind an `AssistantProvider` seam (local / mock / external). The local
  rule-based provider is the default; the external stub is unconfigured (no
  network/key) — ready for a future LLM behind the same apply path.

## UI / UX

- Welcome dashboard (action cards, feature & limitation summaries, last-import
  summary, offline notice).
- Title bar with project / routine / validation status, offline badge, and
  Tags / Compare views.
- Bottom dock: Errors · Watch · AI Assistant · Cross Ref (with counts).
- Properties panel: context-aware detail for controller / program / tag /
  routine / rung / instruction.
- Typed toast system (success / info / warning / error).
- Unsaved-changes indicator (with a close/reload guard) and a crash-safe error
  boundary that keeps a render error from blanking the app.
