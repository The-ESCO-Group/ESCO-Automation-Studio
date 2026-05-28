# Project Actions (`@esco/project-actions`)

The controlled action layer is the **only** sanctioned way to change a PLC
project. The web UI and the AI assistant both go through it; nothing else
mutates project state directly.

## Why actions exist

- **Single source of mutation.** All edits (tags, rungs, instructions, imports)
  flow through one typed, tested API instead of being scattered across React
  components.
- **Safety for AI.** A future LLM-backed assistant can only ever change the
  project by emitting these actions — it never touches React state, JSON, or
  files. The action layer is the trust boundary.
- **Auditability.** Every action returns a result describing what happened,
  including validation findings, so changes can be previewed and reviewed.

## Rules

1. **Immutability.** An action never mutates its input project. It returns a new
   `PlcProject` (structurally shared where unchanged). Callers adopt the result.
2. **No throwing for expected failures.** Actions return
   `{ ok: false, error }` instead of throwing. The input project is returned
   unchanged on failure.
3. **Validation after mutation.** Every action runs the validation engine over
   the resulting project and returns the `findings`, so the UI/AI can show the
   state immediately after a change.
4. **Semantic AST only.** Ladder edits operate on the `@esco/ladder` AST, never
   on text. `addRungFromText` parses neutral text into the AST via the L5X
   parser, then edits the AST.
5. **Registry-driven.** Instruction operand shapes come from
   `@esco/instructions`, not hardcoded.

## Result shape

```ts
interface ProjectActionResult<T = unknown> {
  ok: boolean;
  project: PlcProject;        // unchanged when ok === false
  data?: T;                   // e.g. { rungId } / { nodeId } / { tagId }
  findings?: ValidationFinding[];
  warnings?: string[];
  error?: string;
}
```

## Supported actions

| Action | Input | Notes |
|---|---|---|
| `createTag` | `{ name, dataType?, scope?, programId?, description? }` | Rejects duplicates. Default BOOL / controller scope. |
| `renameTag` | `{ from, to }` | Renames the tag **and** remaps every operand reference (incl. member/array paths). |
| `deleteTag` | `{ name }` | Only if the tag is not referenced by any ladder operand. |
| `createRoutine` | `{ programId, name, language? }` | Adds a ladder routine to a program. |
| `addRung` | `{ routineId, comment? }` | Appends an empty rung. |
| `addRungFromText` | `{ routineId, text, comment? }` | Parses Logix neutral text → AST rung (branches supported). |
| `deleteRung` | `{ routineId, rungId }` | |
| `addInstruction` | `{ routineId, rungId, instructionType }` | Operands built from the registry definition. |
| `removeInstruction` | `{ routineId, rungId, nodeId }` | |
| `updateInstructionOperand` | `{ routineId, rungId, nodeId, index?, value }` | |
| `validateProject` | `(project)` | Returns findings (no mutation). |
| `scanProject` | `(project, values, options?)` | One scan of a routine; returns next tag values (no mutation). |
| `importProjectFile` | `(text)` | Parse `.plcproj.json`. |
| `importL5XFile` | `(text)` | Import L5X; returns `{ summary }` + warnings. |
| `exportProjectJson` | `(project)` | Serialize to `.plcproj.json` text. |

## Example: add a rung

```ts
import { addRungFromText } from "@esco/project-actions";

const result = addRungFromText(project, {
  routineId,
  text: "[XIC(StartPB),XIC(MotorRun)]XIO(StopPB)OTE(MotorRun)",
  comment: "Seal-in motor starter",
});
if (result.ok) {
  setProject(result.project);          // adopt the new project
  // result.findings -> validation after the edit
}
```

## Example: import an L5X file

```ts
import { importL5XFile } from "@esco/project-actions";

const result = importL5XFile(xmlText);
if (result.ok) {
  setProject(result.project);
  // result.data.summary -> { programs, routines, rungs, tags, unsupportedInstructions, warnings }
}
```

## Example: scan

```ts
import { defaultValues, scanProject } from "@esco/project-actions";

let values = { ...defaultValues(project), StartPB: true };
values = scanProject(project, values, { deltaMs: 1000 }).data!.values;
// values.MotorRun, values["Timer1.DN"], ...
```
