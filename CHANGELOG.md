# Changelog

All notable changes to ESCO Automation Studio are recorded here. This is an
internal, offline engineering tool — it does not communicate with controllers,
does not modify `.ACD` files, and requires no external API keys.

## 0.1.0 — Internal engineering IDE

First consolidated internal release. Offline Studio 5000-style IDE for viewing,
editing, simulating, validating, importing, and comparing ladder logic.

### Read-only online-readiness scaffold + controller-command safety guard (2026-06-05)
- Added the **controller-communication safety gate** (`@esco/controller-comm`): every
  Studio 5000-style online command — Who Active, Select Recent Path, Path Diagnostics,
  Go Online, Monitor, Upload, Download, Online Edit (test / assemble / finalize / cancel),
  Program / Run / Remote Program / Remote Run / Test mode, Lock Controller, Clear Faults,
  Fault Diagnostics, Go To Faults — is **visible but blocked**, each with an honest reason,
  the exact required next step, an enumerated commissioning preflight, and a blocked audit
  row. Go Offline stays a safe local lifecycle transition.
- Added the **read-only online-readiness scaffold**: a transport/provider honesty contract
  (`realControllerIo` + `verified`), an abstract read-only controller transport base + a
  monitor-state readiness matrix, a staged online-readiness report, and the Controller-dock
  Online Readiness panel (explicitly captioned that a green "complete" stage is offline
  groundwork, **not** a live controller connection). This is scaffolding and safety gates
  only — **no concrete or verified physical transport ships.** Real Go Online / Monitor /
  upload / download / online edit / mode change / fault clearing stay blocked, and a
  regression guard test fails if any shipped transport flips `verified`. The lone verified
  provider is the in-process ESCO SoftController — **software only** (`realControllerIo:
  false`), never hardware.
- **Boundary unchanged:** no PLC/controller communication and no `.ACD` access ship. A
  future read-only hardware transport requires separate, verified lab validation before any
  live link; destructive writes remain the last-tier, separately-gated operation.
- Tests: `@esco/controller-comm` **349 unit tests** (12 files) incl. the shipped-transport
  verified-guard, physical/software command guards, transport/monitor readiness, safety
  evidence, and online-readiness suites; `e2e/controller.mjs` **36/36**.

### MCP server — drive the IDE from Claude Code / PowerShell (2026-06-04)
- Added **`@esco/mcp`** (`apps/mcp`): a Model Context Protocol server that exposes
  the offline ESCO IDE as tools, so **Claude Code in PowerShell** (or Claude
  Desktop) can inspect and edit PLC projects and drive the Simulation Lab using
  **your own Claude** — **no API key in the Studio, no per-token billing here.**
- Zero-dependency newline-delimited JSON-RPC 2.0 over stdio (`initialize`,
  `tools/list`, `tools/call`, `ping`). Bundled with Vite into a single
  `dist/server.mjs` that reuses the `@esco/*` TypeScript packages (no per-package
  build, no browser globals).
- **25 tools:** session (`esco_status`, `esco_boundaries`); PLC project
  (new/open/save, overview, list routines/tags, get routine, validate, create
  tag, add rung); L5X import/export (offline XML); Simulation Lab (create, add
  device/logic/scenario, run scenario / run all, report, save/open).
- Registered via a project-scoped `.mcp.json` at the repo root. Offline-only
  boundaries enforced (no controller comms, no `.ACD`/vendor binaries).
- Verified over stdio: tools listed; `esco_sim_create` → `esco_sim_run_scenario`
  (trip-overload, PASS 4/4) → `esco_sim_report` (status PASS).
- **Live bridge — watch Claude edit the open Studio.** The server hosts a
  localhost SSE bridge (`http://127.0.0.1:7393`); the running Studio (`LiveBridge`
  in `apps/web`) auto-subscribes and adopts/streams the project, showing a
  "Live: connected to Claude (MCP)" badge and a "Claude is editing…" flash as
  edits arrive — the user watches changes happen in real time. New tools
  `esco_open_studio` (launch the installed Studio via `ESCO_STUDIO_PATH` /
  `ESCO_STUDIO_URL`) and `esco_live_status`. Verified in-browser: Studio connects,
  adopts a Claude-created project ("Claude Live Session"), and shows live edits
  (3/3). Existing e2e unaffected (welcome 12/12, floatingai 8/8, simlab 12/12).

### Floating AI assistant (2026-06-04)
- Added a **global floating AI launcher** (`apps/web/src/components/FloatingAssistant.tsx`):
  a small corner button that expands into a compact, draggable, dismissable,
  state-persisted chat popover. It is **portal-rendered to `document.body`**, so it
  floats above the UI with **zero layout impact** — the 340px right Copilot dock
  stays optional and the layout stays clean. Toggle with **Ctrl/Cmd+I**; mounted
  with one line in `App.tsx`.
- **Live + agentic.** When an AI model is configured (AI setup), the float uses the
  same engine as the dock Copilot — `createModelCaller` (browser-key transport) +
  `runAgent` (`@esco/ai-assistant`). It inspects the project through the agent's
  read tools (overview, routines, tags, validation, cross-refs, HMI) and proposes
  real edits through the write tools (create/rename/delete tags, routines, rungs,
  instructions, branches, HMI screens/popups/elements). The tool transcript streams
  into the chat so you can see what it's doing.
- **Live updates.** Proposed plans are applied through the controlled
  `project-actions` layer as **one undoable edit** (Ctrl+Z). A per-session
  **Auto-apply** toggle applies edits automatically for hands-off operation
  (still undoable). When no model is configured it falls back to the offline
  rule-based provider (read-only previews) and offers a "Set up live model" link.
- Tests: `e2e/floatingai.mjs` (8 checks); live-mode UI verified with a fake profile.

### ESCO Simulation Lab (2026-06-04)
- Added the **ESCO Simulation Lab** (`@esco/sim-lab` + `apps/web` view): an
  offline, virtual, deterministic FAT/SAT workspace. Engineers create a
  simulation project (process type, offline controller model, scan rate, I/O,
  equipment), build a simulated device map with generated virtual tags
  (units/scaling/limits/faults/interlocks/alarms), add ESCO-owned logic
  templates, preview the ESCO HMI Runtime, author and run scenarios for
  pass/fail evidence, run/step/rewind the simulation with virtual fault
  injection and a timeline, and generate an ESCO-native JSON/CSV test report.
- Reuses the existing offline scan engine (`@esco/simulator`, `@esco/ladder`,
  `@esco/instructions`). Reached from the ribbon: **View → ESCO Simulation Lab**.
- **Boundaries:** offline/virtual only — no controller comms, no upload/download,
  no go-online/online-edit, no `.ACD` or vendor binary formats. Compatibility
  helpers (ESCO HMI Runtime, SCADA Compatibility Export, OPC UA / Modbus TCP /
  MQTT-Sparkplug Simulators, Ignition Gateway Export Review, Optix Migration
  Review) are ESCO-owned, offline review/export aids that copy no vendor UI,
  assets, or file formats and never open a real endpoint.
- Tests: `@esco/sim-lab` unit specs (55 tests) + `e2e/simlab.mjs` (full
  workflow, 10/10 browser checks).

### Live AI agent (2026-05-28)
- Added an **opt-in online agent** (Claude `claude-opus-4-7`) in the AI Copilot,
  alongside the offline rule-based assistant (which remains the default).
- The agent is **agentic but propose-only**: it inspects via a whitelisted set of
  read tools and proposes write actions as a previewable plan; the real project is
  never mutated during a run. Apply routes the plan through `@esco/project-actions`,
  runs validation, and commits one undoable edit.
- Two transports: `browser-key` (developer/local testing only — user-pasted key,
  session-only, never written to disk) and `proxy` (production pattern — a
  same-origin route injects `ANTHROPIC_API_KEY` from the server env; the browser
  never sees the key). No key is bundled or committed.
- Model/provider config centralized in `packages/ai-assistant/src/agentConfig.ts`.
- Tool whitelist maps only to project-actions; no file/shell/network/PLC/.ACD/eval
  tools exist. The agent loop is unit-tested with a mock provider (no real calls).

### Editor
- Editable ladder logic on a semantic AST (not text).
- Branch editing including **nested** parallel/seal-in branches.
- Undo / redo (Ctrl+Z / Ctrl+Y) and copy / duplicate / paste of rungs.

### Instructions
- Bit (XIC/XIO/OTE/OTL/OTU/ONS), timers/counters (TON/TOF/RTO/CTU/CTD/RES),
  move/math (MOV/ADD/SUB/MUL/DIV/MOD/SQR/NEG/ABS/CLR), bitwise (AND/OR/XOR/NOT),
  compare (EQU/NEQ/GRT/GEQ/LES/LEQ/LIM/MEQ), program control
  (JSR/SBR/RET/NOP/AFI).

### Simulation
- Offline scan-cycle simulator with a Watch panel.
- Multi-routine execution: JSR runs a subroutine, RET returns early (call-depth
  guarded).
- Debugging: execution **trace** tab and a **force** table (offline overrides).
- Single-dimension array tags and alias resolution in simulation.

### Validation
- Undefined tags, type mismatches, missing operands, unsupported instructions,
  array bounds, unknown members, double-coil, duplicate tags, alias targets,
  unknown JSR routines; program-scope shadowing.

### Tags & structure
- Tag table (create/rename/describe/delete), arrays, aliases, UDT member paths.
- L5X import: controller/programs/routines/rungs, tags (descriptions/aliases),
  branches, member/array paths, plus read-only UDT / Add-On Instruction / I/O
  module structure; located warnings + import summary with timing.

### Compare
- Routine/project comparison by logic fingerprint with strict and logical
  (OR-order-insensitive) modes; JSON/CSV report export.

### Project files
- `.plcproj.json` format v2 with metadata + a migration system.
- Browser autosave/recovery and an unsaved-changes guard.

### AI assistant
- Offline, rule-based assistant behind a provider interface (local/mock/
  external stub); proposes plans, applies only through the action layer.

### Quality
- 180+ unit tests, an in-repo browser E2E harness (`pnpm e2e`), and CI
  (install / typecheck / test / build).

### Known limitations
- Not a certified Studio 5000 replacement; offline-only.
- No L5X export, no `.ACD` handling, no PLC communication.
- Single task / program-scoped multi-routine; AOI/UDT internals are view-only.
- Large routines are not yet virtualized in the editor.
