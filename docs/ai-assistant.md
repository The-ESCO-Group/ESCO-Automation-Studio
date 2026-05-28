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

## Provider interface (LLM-ready, no API key)

The assistant runs behind a small provider seam so a real LLM can be added later
without touching the UI or the safety model:

```ts
type ProviderMode = "local" | "mock" | "external";

interface AssistantProvider {
  readonly name: string;
  readonly mode: ProviderMode;
  run(input: AssistantInput): Promise<AssistantResult>;
}
```

- **`LocalRuleBasedProvider`** (`localProvider.ts`) — the shipping default. Wraps
  `runAssistant` (the substring planner). Fully offline, deterministic.
- **`MockProvider`** (`mockProvider.ts`) — a deterministic stand-in for tests and
  demos. Returns a previewable plan; accepts a custom `responder` to simulate
  other model outputs.
- **`ExternalLlmProvider`** (`externalProvider.ts`) — a stub for a future real
  model. It is **not** wired to any network or key; calling `run` rejects with a
  clear "not configured" error so the app falls back to local.

`createProvider(mode)` builds one; `getDefaultProvider()` returns the local
provider (the UI uses this — see `DEFAULT_PROVIDER_MODE`).

### Adding a real LLM later

1. Implement `AssistantProvider` in a new `external` provider: in `run`, send the
   prompt plus **context** (`context.ts`: routines, tags, findings, undefined
   tags) to the model and translate the reply into an `AssistantResult` — a
   message and, for changes, an `AssistantPlan` whose actions use only known
   `ProposedProjectAction` kinds (`createTag`, `addRungFromText`, …).
2. Read the key from configuration/env at call time. **No key is bundled**, and
   nothing should call out unless explicitly configured.
3. **`apply.ts` is unchanged** — it still maps every action to
   `@esco/project-actions` and runs validation, so the LLM can never bypass the
   safe mutation layer, and the user still clicks **Apply**.

## Safety constraints

- The **default** assistant is **offline/local** and its suggestions **must be
  reviewed before applying** (the UI states this).
- The assistant **cannot** mutate React state, project JSON, or files directly —
  only via the controlled action layer, only on explicit Apply.
- **No PLC communication.** No download, no online edit, no controller comms.
- **No `.ACD` editing.** The tool only reads/writes its own `.plcproj.json` and
  imports `.L5X` text.

## Live online agent (opt-in)

There is an optional **online** agent powered by Claude (`claude-opus-4-7`),
selectable in the AI Copilot panel. It is **off by default**. See
[`online-ai-safety.md`](online-ai-safety.md) for the full safety posture.

- **Model/provider config lives in one place:** `agentConfig.ts`
  (`AGENT_MODEL_ID`, `AGENT_MODEL_LABEL`). Update the model id there only, copied
  exactly from the provider's official docs.
- **Two transports** (`apps/web/src/ai-online.ts`):
  - `browser-key` — *developer/local testing only.* The browser calls the
    provider with a user-pasted key (session-only, never written to disk).
  - `proxy` — *production pattern.* The browser posts to `/api/ai`; a server/dev
    middleware (`apps/web/vite.config.ts`) injects `ANTHROPIC_API_KEY` from the
    environment, so the browser never sees the key.
- **Agentic, but propose-only.** The loop (`agentLoop.ts`) lets the model call a
  **whitelisted** tool set (`agentTools.ts`): read tools run live; write tools are
  recorded as a previewable **plan**. The real project is never mutated during the
  run — the user reviews and clicks **Apply**, which routes the plan through
  `applyPlan` → `@esco/project-actions` and runs validation (one undoable edit).
- **Context is bounded** (`agentContext.ts`): a compact summary is inlined and the
  model fetches detail via read tools; large projects are summarized.
- The loop takes an **injectable `ModelCaller`**, so it is fully unit-tested with a
  mock — no real network calls in tests.
