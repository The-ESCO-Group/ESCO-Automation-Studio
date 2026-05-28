# Online AI Safety

ESCO Automation Studio ships an **offline, local, rule-based** assistant by
default. It also offers an **optional, opt-in online agent** (Claude
`claude-opus-4-7`) for engineers who want a live model to help build and edit
logic. This document describes exactly what the online mode does and the
guarantees around it.

## Defaults and opt-in

- The **local/offline assistant is the default** and works with **no key** and
  **no network**.
- The **online agent is off by default.** Nothing is sent anywhere until a user
  explicitly selects "Live Online" in the AI Copilot, chooses a transport, and
  submits a prompt.
- The Copilot shows a clear notice in online mode:
  *"Online mode sends your selected prompt and project context to the configured
  AI provider."*

## What is sent, and to where

When (and only when) online mode is used, the user's prompt plus a **bounded**
project context (a compact summary, the selected routine, validation findings,
and whatever the model fetches via read tools) are sent to the configured
provider's Messages API. Context size is guarded: large projects are summarized
rather than shipped whole.

## API key handling

- **No API key is ever bundled or committed.** `.gitignore` excludes `.env*`.
- **Two transports:**
  - **`browser-key` — developer/local testing only.** The user pastes their own
    key; it is held in `sessionStorage` for the browser session only and is
    **never written to disk** by the app. The browser calls the provider directly
    (`anthropic-dangerous-direct-browser-access`).
  - **`proxy` — recommended for production/internal use.** The browser posts to a
    same-origin route (`/api/ai`); a server/dev middleware injects
    `ANTHROPIC_API_KEY` from the **server environment** and forwards the request.
    The browser never sees the key. A dev/preview implementation ships in
    `apps/web/vite.config.ts`; replicate it as a real server route when deploying.
- The key is never logged or shown back in the UI.

## What the online agent can and cannot do

The agent acts **only** through a whitelisted tool set (`packages/ai-assistant/
src/agentTools.ts`):

- **Read tools** (live, never mutate): project overview, routines, a routine's
  rungs/nodes, tags, validation findings, cross-references, instruction metadata.
- **Write tools** (proposed, not executed live): `create_tag`, `rename_tag`,
  `delete_tag` (refused if referenced), `set_tag_description`, `create_routine`,
  `add_rung`, `add_rung_from_text`, `delete_rung`, `add_instruction`,
  `remove_instruction`, `update_instruction_operand`, `set_rung_comment`,
  `add_parallel_branch`, `add_branch_leg`, `add_instruction_to_branch`. Each maps
  to a typed `@esco/project-actions` call.

**Blocked / non-existent:** file-system access, shell, arbitrary code/eval,
network beyond the configured AI provider, PLC/controller communication, online
edit/download/upload, and `.ACD` access. These are not exposed as tools, so the
model cannot reach them.

## How edits are applied

The online agent **proposes a plan**; it does not silently change anything.

1. The model inspects via read tools and proposes write actions (held as a plan
   against an internal working copy — the real project is untouched).
2. The user reviews the proposed actions and clicks **Apply**.
3. Apply routes the plan through `applyPlan` → `@esco/project-actions`, runs the
   validator, and commits the result as a **single undoable edit** (Ctrl+Z
   reverts the whole run).

No AI edit bypasses validation, and the AI can never mutate React state, JSON, or
files directly.

## Not a replacement for Studio 5000

This tool, with or without the online agent, is an **offline engineering and
simulation aid**. It is not certified and is not equivalent to Rockwell
Automation Studio 5000. Always review generated logic before any production use.
