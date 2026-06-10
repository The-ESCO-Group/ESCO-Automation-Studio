# Current Architecture

ESCO Automation Studio is an ESCO-native PLC/automation IDE with offline
engineering, simulation, and guarded online-read-only foundations. It is a pnpm
monorepo built in dependency order, with React only at the top.

## Dependency order

```
core → ladder → instructions → simulator → validator
                              → project-store → parser-l5x → project-actions → ai-assistant
apps/web depends on the packages above (never the reverse).
```

## Packages

### `packages/core`
The PLC domain model and single source of truth: `PlcProject`, `Controller`,
`Task`, `Program`, `Routine`, `Tag`, plus the structured data-type catalog
(`TIMER`/`COUNTER`/`CONTROL` members, atomic BOOL/DINT/REAL/STRING) and factories.
`Routine.ladder` is `unknown` to avoid a hard dependency on `@esco/ladder`.

### `packages/ladder`
The semantic ladder AST (`LadderRoutine` → `LadderRung` → `LadderBranch` →
`LadderNode`/`InstructionOperand`), with `parallelBranches` + `next` for branch
logic. Provides factories, traversal (`routineNodes`, `routineTagReferences`),
and immutable edit helpers (`addRung`, `appendNode`, `setOperandValue`,
`mapRoutineNodes`, `appendRungWithRoot`, …).

### `packages/instructions`
The instruction registry — the single definition of each instruction (XIC, XIO,
OTE, TON, CTU, MOV, COP/FLL, SQO/SQI/SQL, JMP/LBL, CONCAT/LEN, EQU, GRT, LES): operands (with
`direction` + `allowedTypes`), runtime `execute`, render style. Plus operand
helpers (`isNumericLiteral`, `parseNumericLiteral`, `baseTagName`, `isPlainTag`).

### `packages/simulator`
The scan-cycle runtime: `TagMemory`, `RungExecutor` (series + parallel + `next`,
unknown instructions pass through), `RoutineExecutor`, `PlcRuntime`
(`scanOnce(deltaMs)`), and builders (`createRuntime`, `collectOutputTags`).

### `packages/validator`
Rule-based validation over a project (`createDefaultEngine().run(project)`):
missing main routine, duplicate tags, and registry-driven ladder operand checks
(`missing-operand`, `undefined-tag`, `operand-type-mismatch`,
`unsupported-instruction`). Never mutates the project.

### `packages/project-store`
`.plcproj.json` serialize/deserialize with validation. See
[project-actions.md](./project-actions.md).

### `packages/parser-l5x`
Studio 5000 `.L5X` (XML) import/export: `parseL5X`, extractors (controller,
programs, routines, tags), a branch-aware `parseRungText`, `importL5X` → domain
project + warnings + summary, and review-only `exportL5X` generation with
explicit offline warnings.

### `packages/project-actions`
The controlled mutation layer — the only sanctioned way to change a project.
Typed, immutable, result-returning commands; validation after every edit. See
[project-actions.md](./project-actions.md).

### `packages/ai-assistant`
Offline, rule-based assistant that explains logic and proposes plans applied via
`project-actions`. See [ai-assistant.md](./ai-assistant.md).

### `apps/web`
React + Vite IDE shell: Project Explorer, ladder editor (`EditorArea` +
`LadderView`), Properties, and the bottom dock (**Errors | Watch | AI
Assistant**). All edits, imports, exports, simulation, and AI applies route
through `@esco/project-actions`.

## Safety boundaries

- No PLC/controller communication, download, or online editing.
- No `.ACD` editing; only `.plcproj.json` (read/write) and review-only `.L5X`
  import/export.
- The AI assistant changes the project only through `project-actions`, only on
  explicit user Apply.
