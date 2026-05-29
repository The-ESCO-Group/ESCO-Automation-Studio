# Online AI Safety

ESCO Automation Studio uses a live Copilot agent with the engineer's saved
Anthropic/Claude or OpenAI model for engineers who want help explaining,
diagnosing, and proposing ladder edits.
The UI keeps credential setup outside the chat panel and keeps all project
changes review-only until the engineer clicks Apply.

## Workstation setup

- The Copilot panel no longer asks for transport, online/offline mode, or API key
  details inline.
- Settings opens the workstation setup dialog where the user saves a profile,
  provider, model id, and API key once.
- The current web build stores that setup in local app storage. The Windows EXE
  shell should move the same profile contract to OS-backed secure storage
  (Windows Credential Manager or the Tauri stronghold/plugin equivalent).
- Nothing is sent anywhere until the user submits a prompt to Copilot.

## What is sent, and to where

When Copilot is used, the user's prompt plus a **bounded** project context (a
compact summary, the selected routine, validation findings, and whatever the
model fetches via read tools) are sent to the configured provider's Messages API.
Context size is guarded: large projects are summarized rather than shipped
whole.

## API key handling

- **No API key is ever bundled or committed.** `.gitignore` excludes `.env*`.
- The chat panel never displays or requests the key.
- The key is never logged or shown back in the UI.
- For the current web build, the saved workstation profile is local to the
  browser profile. For the Windows desktop build, use OS credential storage
  instead of browser local storage.

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
