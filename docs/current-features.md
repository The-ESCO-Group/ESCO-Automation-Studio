# Current Features

A detailed inventory of what ESCO Automation Studio supports today.

## Ladder editing

- Semantic ladder AST (`@esco/ladder`): rungs → branches (series, parallel,
  continuation) → nodes → operands. Not stored as text.
- Add / delete rungs; editable rung comments.
- Grouped instruction palette (Bit / Timer-Counter / Move-Math / Compare) that
  adds to the selected rung.
- Inline operand editing with undefined-tag highlighting and one-click
  "create the missing tag" (data type inferred from the operand).
- Rung and instruction selection with a focus highlight.
- Branch rendering (parallel paths stacked); unsupported instructions render as
  dashed, read-only boxes.

## Instruction set

| Category | Instructions |
|---|---|
| Bit | XIC, XIO, OTE, OTL, OTU |
| Timer / Counter | TON, CTU |
| Move / Math | MOV, ADD, SUB, MUL, DIV |
| Compare | EQU, NEQ, GRT, GEQ, LES, LEQ |

Instruction metadata (operands, allowed types, read/write direction, render
style) lives in the registry (`@esco/instructions`) and drives the editor,
simulator, validator, and import.

## Simulation

- Scan-cycle runtime (`@esco/simulator`): series + parallel + continuation,
  unknown instructions pass through (never crash).
- Watch panel: BOOL toggles, DINT/REAL number inputs, TIMER/COUNTER member
  values (PRE/ACC/EN/TT/DN, CU), input/output role.
- Scan Once / Run (interval) / Reset; timers advance by a per-scan delta.

## Validation

- Rule-based (`@esco/validator`): undefined tags (base-tag aware for member /
  array paths), operand type mismatches, missing required operands, unsupported
  instructions (info). Never mutates the project. Surfaced in the Errors tab and
  the title-bar validation badge.

## Tags

- Tag table editor: searchable table with name, type, scope, description,
  current value, role badge, and reference count.
- Create (BOOL/DINT/REAL/TIMER/COUNTER), inline rename (remaps references),
  edit description, delete (blocked when referenced) — all via `project-actions`.

## Cross reference

- Every tag use across routines: routine, rung number, instruction type,
  operand path, and read/write direction. Click to open the routine. Member /
  array paths resolve to the base tag.

## Files

- Export / import `.plcproj.json` (full project incl. ladder AST).
- Studio 5000 `.L5X` import: controller, programs, routines, rungs (+comments),
  controller & program tags (+descriptions, aliases), supported instructions,
  with a counts + warnings import summary.

## AI assistant (offline, rule-based)

- Explain rung / routine / validation findings.
- Generate motor starter, timer, counter, MOV examples; fix undefined tags.
- Proposes a previewable plan; applies only on click, only through
  `project-actions`; shows validation after apply. No API key required.

## UI / UX

- Welcome dashboard (action cards, feature & limitation summaries, last-import
  summary, offline notice).
- Title bar with project / routine / validation status and offline badge.
- Bottom dock: Errors · Watch · AI Assistant · Cross Ref (with counts).
- Properties panel: context-aware detail for controller / program / tag /
  routine / rung / instruction.
- Typed toast system (success / info / warning / error).
