# AI Assistant (`@esco/ai-assistant`)

A safe, **offline, rule-based** assistant that explains PLC logic and proposes
changes. It is the foundation for a future LLM-backed assistant — the apply
path and safety model are already in place.

## Current implementation

- **Local only.** No network, no API key. Intent matching is simple substring
  matching in `planner.ts`.
- **Propose, don't mutate.** The assistant produces an `AssistantResult` with an
  optional `AssistantPlan` (a list of `ProposedProjectAction`s). It never
  changes the project itself.
- **Apply through the action layer.** `applyPlan(project, plan)` maps each
  proposed action to a `@esco/project-actions` call and returns an `ApplyResult`
  (new project + validation findings). The user must click **Apply**.

## Supported commands

| Prompt contains | Result |
|---|---|
| `explain rung` | Explains the current rung: instructions, tags read/written, timers/counters, unsupported, behaviour. |
| `explain routine` | Summarizes the routine: rung count, tags, outputs, timers/counters, unsupported, validation. |
| `validation` / `explain error` | Groups validation findings by severity with safe-fix suggestions. |
| `motor` | Plan: create StartPB/StopPB/MotorRun (if missing) + seal-in rung. |
| `fix undefined` / `undefined tag` | Plan: create each undefined tag with an inferred type (BOOL/TIMER/COUNTER/DINT). |
| `timer` | Plan: StartPB + Timer1 (TIMER) + TON example + `XIC(Timer1.DN) OTE(TimerDone)`. |
| `counter` | Plan: CountPB + Counter1 (COUNTER) + CTU example + `XIC(Counter1.DN) OTE(CountDone)`. |
| `mov` | Plan: StartPB + SomeDint + `XIC(StartPB) MOV(123, SomeDint)`. |
| anything else | Help text listing the commands. |

## Proposed-action preview & apply workflow

1. The user types a prompt or clicks a quick action.
2. `runAssistant(input)` returns a message and, for generation/fix intents, a
   plan. The UI shows the explanation and a readable list of proposed actions
   (e.g. `Create tag StartPB (BOOL)`, `Add rung: [XIC(StartPB),...]OTE(MotorRun)`).
3. The user clicks **Apply actions**.
4. The UI calls `onApply(plan)` → `applyPlan` → `@esco/project-actions`.
5. The UI shows "Applied successfully — N action(s)" and the validation summary.

Plans only ever contain actions that exist in `@esco/project-actions`. Tags that
already exist are not re-created (create-or-reuse).

## Plan / result model

```ts
interface ProposedProjectAction { id; kind; label; description; input }
interface AssistantPlan { id; title; explanation; actions; warnings }
interface AssistantResult { ok; message; plan?; error? }
interface ApplyResult { ok; project; applied: string[]; findings; error? }
```

## Future LLM integration points

The architecture is designed so a real LLM can be dropped in without changing
the safety model:

- **`planner.ts`** is the swap point. Replace substring matching with an LLM
  call that returns the same `AssistantResult` / `AssistantPlan` shape.
- The LLM would receive **context** (`context.ts`: routines, tags, findings,
  undefined tags) and must emit only known `ProposedProjectAction` kinds.
- **`apply.ts` is unchanged** — it still maps actions to `@esco/project-actions`
  and runs validation. The LLM can never bypass it.
- An LLM connector should live behind the same `runAssistant` interface and
  require its key via configuration; the MVP requires none.

## Safety constraints

- AI suggestions are **offline/local** in this MVP and **must be reviewed before
  applying** (the UI states this).
- The assistant **cannot** mutate React state, project JSON, or files directly —
  only via the controlled action layer, only on explicit Apply.
- **No PLC communication.** No download, no online edit, no controller comms.
- **No `.ACD` editing.** The tool only reads/writes its own `.plcproj.json` and
  imports `.L5X` text.
