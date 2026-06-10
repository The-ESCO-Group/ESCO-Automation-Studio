# Changelog

All notable changes to ESCO Automation Studio are recorded here. This is an
internal, offline engineering tool — it does not communicate with controllers,
does not modify `.ACD` files, and requires no external API keys.

## 0.1.0 — Internal engineering IDE

First consolidated internal release. ESCO-native offline IDE for viewing,
editing, simulating, validating, importing, and comparing ladder logic.

### HMI Designer full-screen pop-out mode (2026-06-10)
- Added a **Pop Out / Dock HMI** toggle to the HMI Designer header: the designer
  expands into a fixed full-viewport shell (with native `requestFullscreen` when
  available), widens the workspace grid for large-monitor authoring, locks body
  scroll behind it, and keeps every panel (toolbox, project tree, canvas,
  properties, live preview) scrollable with contained overscroll. Escape or the
  toggle returns the designer to its docked layout; exiting browser full-screen
  re-docks automatically. Covered by the new `e2e/hmipopout.mjs` driver.

### ESCO-owned EtherNet/IP / CIP protocol codecs — Goal B read-only groundwork (2026-06-07)
- Added **`@esco/driver-ethernetip`**: pure, ESCO-owned EtherNet/IP / CIP byte codecs for
  the future Goal B read-only Allen-Bradley driver, written from the public ODVA
  specifications — **no Rockwell software, binaries, `.ACD` files, or services used or
  required**. Implemented: encapsulation header + RegisterSession/UnregisterSession/
  ListIdentity, TCP stream framing (fragmentation-safe), CPF/SendRRData (UCMM), EPATH
  logical + symbolic segments with Logix tag-address parsing (`Program:Main.Tank[2].Level`),
  message router + CIP status decoding, Unconnected Send backplane routing, atomic CIP
  value decoding (arrays + Logix STRING; unknown structures stay raw bytes), Read Tag /
  Read Tag Fragmented builders + reply parsing, Symbol Object tag-list paging with
  symbol-type decode, and Identity parsing with fault-bit decode.
- **Boundary unchanged:** these are codecs only — **no sockets, no transport, no
  controller endpoint, and no write/download/mode-change builders exist** (enforced by a
  read-only regression guard test). This slice did not include UI-to-controller access;
  later Goal B work added the backend-only transport/gateway path while physical-hardware
  verification still reports `verified: false`.
- Added the **sans-I/O `LogixSessionCore`** protocol state machine on top of the codecs:
  EtherNet/IP session registration, single-in-flight UCMM request/response correlation
  (protocol violations honestly fail the session; per-request CIP errors do not),
  transparent fragmented-read reassembly with no-progress guards, full tag-list
  pagination with program-scope recursion, identity reads, and clean close/fail
  semantics. Still **no sockets in this pure package** — the backend transport drives it through
  `receive()` / `takeOutbound()` / `fail()`.
- Added **`@esco/driver-ethernetip-node`**: the BACKEND-ONLY TCP transport (`node:net`,
  port 44818) driving the sans-I/O session core — connect/close lifecycle, hook-based
  frame flushing, connect timeout, inactivity watchdog, and read-only delegation. Tested
  over real loopback TCP against a test-only fake target built from the same ESCO codecs.
  **Never imported by browser code**; loopback tests prove transport mechanics only, not
  hardware validation.
- Added **`EthernetIpReadOnlyComms`** — the ESCO EtherNet/IP implementation of the
  `ReadOnlyControllerComms` safety seam from `@esco/controller-comm` (backend-only
  package). Conservative capabilities (`canRead` only), non-throwing open failures,
  honest identity mapping (mode never faked), scalar reads that refuse to mangle
  arrays/structures, and tag listing with system symbols excluded.
  `createEthernetIpReadOnlyTransport()` deliberately has **no `verified` parameter** —
  the transport always carries `verified: false`, so the controller-comm safety gate
  routes every connect to safety-blocked until signed hardware-validation evidence
  constructs the transport explicitly.
- Added **`EthernetIpGatewayDriver`** — the gateway `ControllerDriver` implementation in
  the backend-only package (browser bundle keeps the placeholder; a backend host injects
  the real driver). Identity deliberately omits all project fields because the CIP
  Identity object cannot prove which project is loaded — so the gateway compare always
  defaults to **Online Read-Only** and `online-matched` is structurally unreachable
  through this driver (verified by integration tests through a real `ControllerGateway`,
  including a blocked controlled-write attempt). No write/subscribe/snapshot/compare
  surface; every browsed tag reports `writable: false`; undecoded UDTs read as null with
  quality "uncertain"; identity fault bits surface as non-clearable device-level faults.
- Added the **backend API host** (`apps/api`): constructs the `ControllerGateway` with
  the real `EthernetIpGatewayDriver` swapped in for the placeholder (browser bundle keeps
  the placeholder) and serves ESCO-owned JSON routes under `/api/gateway` — drivers,
  session connect/disconnect/snapshot, identity, status, faults, tag browse/read, audit
  log. **No write route exists**; `POST /api/gateway/write` answers 405 with the
  read-only-milestone reason. The gateway gained audit-recorded
  `getIdentity`/`getStatus`/`getFaults` proxies so hosts never touch drivers directly.
  Build/run mirrors apps/mcp (`vite build` → `node dist/index.mjs`); verified with a live
  smoke test of the built server.
- Added the **web-side gateway client** (`apps/web/src/gateway-client.ts`):
  `EscoGatewayClient`, the fetch-based web half of the ESCO Online Session Manager —
  typed against `@esco/controller-gateway`, `VITE_ESCO_API_URL`-aware, failed connects
  returned as results (not crashes), **no write method** (guarded by test). React
  components call this client, never drivers. An end-to-end suite now proves the entire
  Goal B chain with production code at every layer: web client → real HTTP → API host →
  gateway → EtherNet/IP driver → TCP → fake target, landing in Online Read-Only with a
  full audit trail. React component wiring to this client is still to do.
- Added the **visible ESCO Online panel** (View → "ESCO Online (Gateway)"):
  `components/online/EscoOnlinePanel.tsx` renders the gateway-backed read-only session —
  connection form (driver/endpoint/CIP path), Goal B state badge, identity/status (mode
  honestly shown as not-yet-read), device faults, read-only tag browser with per-tag
  reads, and the gateway audit trail. **No write affordance exists**; undecoded UDT
  values render as "not decoded" instead of fake data. Full web suite 137/137 + build
  green.
- Added **batched read-only tag polling** through every layer: gateway `readTags()`
  (per-tag failures never blank the batch; one audited entry), API
  `POST /api/gateway/tags/read-batch` (validated, max 200), client `readTags()`, and a
  session-manager polling loop (immediate sample, self-stop after 3 consecutive
  transport failures, stops on disconnect/leaving the panel) behind a
  "Watch all (poll 2 s)" toggle with per-tag error cells. Labeled honestly as polling —
  a stand-in until a real subscription path (Forward Open) exists.
- Added **UDT template reading** (`logix/templates.ts` + `LogixSessionCore.readTemplate`):
  Template object (0x6C) attribute reads (definition size/structure size/member
  count/handle), paged Read Template with no-progress guards, member-entry parsing
  (info/type/offset + null-separated names with defensive placeholders), and
  `decodeStructureValue()` — atomic members, atomic arrays, and packed BOOL bits decode;
  nested structures are reported as undecoded rather than guessed. Template byte-count
  ambiguity is documented in-source and handled with defensive parsing. Driver/gateway
  wiring of template-decoded values is the next slice.
- Added **controller keyswitch/mode reading**: the identity status word's public
  byte-pair behavior
  now decodes to Run / Remote Run / Program / Remote Program in `CipIdentity.keyswitch`;
  the gateway driver reports it as `ControllerStatus.mode` (Faulted wins; unlisted
  encodings stay undefined — never guessed) and the seam adapter as `controllerMode`.
  The Online panel's mode field now shows real keyswitch state instead of
  "not read yet".
- **Full-repo verification (2026-06-07)**: after the Goal B EtherNet/IP read-only build
  (codecs → session core → TCP transport → seam adapter → gateway driver → API host →
  web client → session manager → visible panel → batched/connected polling → UDT decode →
  keyswitch/mode → Forward Open connected messaging) plus the parallel OPC UA driver and
  Online Tag Monitor UI work, the entire monorepo is green: **24 packages typecheck clean,
  2830 tests pass across 350 files**. Read-only throughout; `verified: false` everywhere;
  no Rockwell runtime dependency anywhere in the shipped path.
- Completed the **Forward Open chapter** (design §4 slice 4 — driver opt-in):
  `EthernetIpGatewayDriver` gained a `connectedMessaging` option (default OFF). When on,
  it negotiates a class-3 channel via Forward Open after connect, carries the same
  read-only requests over it, exposes the outcome on `connectedMessagingActive`, and
  sends a polite Forward Close on disconnect. On any Forward Open failure it stays on
  UCMM transparently with a note in the connection message — no behavior change for
  existing callers. 2 loopback tests (negotiate+read+close; default-off invariant);
  driver-node + api 63/63; api bundle rebuilt. Connected messaging is now proven end to
  end (codec → session core → fake target → driver), read-only throughout.
- Implemented the **connected-mode fake-target slice** (design §4 slice 3): the test-only
  `FakeLogixServer` now answers Forward Open (allocates an O→T connection ID, echoes
  serial/vendor/originator), routes connected SendUnitData requests through the same
  canned CIP database with sequence echo, and honors Forward Close — with
  `forwardOpenCount`/`forwardCloseCount` for assertions. `LogixTcpClient` gained
  `openConnected`/`closeConnected`/`isConnectedMode`. A loopback test opens a channel,
  reads a tag over connected messaging, and closes cleanly. Only the driver opt-in
  (slice 4) remains.
- Implemented the **connected-mode session slice** (design §4 slice 2):
  `LogixSessionCore.openConnected()/closeConnected()` — with a class-3 channel open,
  every existing read-only request routes through SendUnitData with a cycling sequence;
  mismatched sequences fail the session honestly; refused Forward Opens leave UCMM
  routing intact; Forward Close reverts cleanly. 5 crafted-frame tests; suites 195/195 +
  downstream 60/60. The transport/driver do NOT use it yet (slices 3–4 remain).
- Implemented the **Forward Open codec slice** (design §4 slice 1): `cip/forward-open.ts`
  — Forward Open 0x54 / Large Forward Open 0x5B / Forward Close 0x4E builders+parsers
  with reference-verified constants (0x0A/0x05/0x07/0xA3) and network-parameter bits,
  plus connected SendUnitData framing helpers (connection ID + u16 sequence) in cpf.ts.
  10 golden-vector tests; codec suite 190/190. NOTHING consumes these yet — the
  session-core connected mode, fake-target support, and driver opt-in are slices 2–4.
- Added **`docs/goal-b-forward-open-design.md`** — DESIGN ONLY for connected (class-3)
  messaging: verified Forward Open/Close field layouts and connected-request framing
  (CPF 0x00A1 connection ID + 0x00B1 with u16 sequence) from public open-source
  behavior, an explicit to-verify list for unpinned byte constants, a 4-slice
  implementation plan, and the honest framing that CIP has NO tag-level push — class-3
  connections make polling cheaper; the panel's "polling" label stays accurate.
- Added **`docs/goal-b-hardware-validation.md`** — the operational definition of what
  earns `verified: true`: gate mechanics, required evidence package, a 14-row hardware
  test matrix (identity/keyswitch/browse/reads/UDT/fragmented/batch/subscription/faults/
  link-loss/routing/non-interference/abuse safety), site commissioning checklist, and
  the atomic change-control PR shape that flips the flag. Explicitly states software
  evidence is never acceptable, that NO evidence records exist, and that the validated
  firmware list is EMPTY — procedure defined, not performed.
- **EtherNet/IP browser E2E + standalone fake target**: `apps/api` now also builds
  `dist/fake-target.mjs` (TEST-ONLY canned-CIP target — not a controller emulator) and
  `e2e/escoonline-enip.mjs` drives the real panel UI against it through the full stack:
  Online Read-Only connect, identity card (vendor/product/firmware/serial), keyswitch
  Mode Run, symbol browse with honest `DINT[]` typing, wire-value tag read, audit trail,
  zero write affordances, clean disconnect — 11/11 in a real browser. (Also unblocked
  the api bundle by externalizing the OPC UA stack's optional `proper-lockfile` dynamic
  import — noted in vite.config.ts for the OPC UA slice owner.)
- **Live link-state honesty in status**: the EtherNet/IP driver's `getStatus()` now
  consults the actual TCP session state — a lost session (watchdog timeout, peer drop)
  reports `faulted` / `connected: false` with "go offline and reconnect" guidance instead
  of a stale "online" status. Verified over loopback by dropping the connection
  mid-session.
- **EtherNet/IP SSE end-to-end proof**: the end-to-end suite now streams a LIVE value
  change across every layer of the real driver path — HTTP SSE subscribe → gateway →
  polling subscription → batched reads → TCP → fake target — asserting both the initial
  sample and the changed value arrive in the event stream.
- Added **read-only tag subscriptions to the EtherNet/IP driver** — POLLING-BACKED and
  labeled as such (NOT CIP class-1/Forward Open; that push path remains future work):
  samples through the batched Multiple-Service read path on an interval (default 1 s,
  configurable), emits on value/quality CHANGE plus one initial sample per tag, reports
  read-error transitions as one bad-quality null, stops on unsubscribe and disconnect.
  This lights up the gateway `watchTags` → API SSE subscribe route for real EtherNet/IP
  sessions end to end. Verified over loopback TCP (initial sample, change dedup,
  single-emit per change, unsubscribe and disconnect both halt polling).
- Added **nested-template recursive decoding**: single nested structures inside UDTs now
  decode through their own templates (driver fetches the template closure transitively,
  capped; cycle/depth guarded) and flatten to dotted member paths ("Inner.Count") in tag
  values. Struct arrays remain honestly undecoded (element stride is not claimed);
  unresolvable branches stay null and are reported with dotted paths. Verified over
  loopback TCP with a two-template closure fetched exactly once.
- Wired **template-decoded structure reads** into the EtherNet/IP gateway driver: struct
  tag reads now return named member records (`{ Count: 1234, Flag: true }`) instead of
  null — the driver learns tag→template mappings from the symbol table (lazy browse-once),
  fetches + caches template definitions, and decodes ONLY when the reply's structure
  handle matches the template CRC (mismatch stays null/uncertain — never decoded with the
  wrong layout). Partially-decodable structures report quality "uncertain"; member arrays
  render as JSON text. Verified over loopback TCP incl. cache behavior (symbol table and
  template each fetched exactly once across repeated reads).
- Added **CIP Multiple Service Packet (0x0A)** batching beneath the polling path: tag
  polls now cost one wire round trip per chunk (default 20 tags) instead of one per tag
  — new multi-service codec with golden-vector tests,
  `LogixSessionCore.readTagsBatch()` (transparent fallbacks: per-tag reads for targets
  rejecting 0x0A, fragmented re-reads for embedded partial transfers, invalid paths
  reported without sending), optional `ControllerDriver.readTags?` preferred by the
  gateway, and the EtherNet/IP driver implementation. Read-only throughout; verified
  down to the wire by a loopback test asserting exactly one multi-service request per
  batch.
- **Browser E2E for the panel** (`e2e/escoonline.mjs`, 13/13 against the live web + API
  stack): View-menu entry, read-only banner, backend driver registry visible (real
  EtherNet/IP driver + simulator), simulator connect → Online Read-Only, gateway
  status/identity/audit, zero write affordances, clean disconnect. Fixed a browser-only
  "Illegal invocation" bug (unbound `window.fetch` in the client — Node tolerates it,
  browsers don't). Ribbon suite re-run 49/49 with the new View-menu item.
- Added the **web ESCO Online Session Manager state layer**
  (`apps/web/src/esco-online-session.ts` + `use-esco-gateway.ts`): framework-free
  `EscoOnlineSession` (availability, connect/disconnect, status+faults, tag
  browse/read cache, audit, busy/error state) with the `useEscoGateway()` hook on top.
  **No write action exists** (guarded by test); failed connects render as results.
  The visible Online panel that mounts the hook is still to do.
- Tests: **171 unit tests** (20 files) across the driver packages, the API host, and the
  web client/session layers — golden byte vectors for every codec layer, scripted
  fake-controller exchanges for the session core, loopback-TCP transport tests,
  seam-adapter tests, gateway-driver/rule-7 integration tests, full-stack API-host
  tests, web-client + session-manager tests, and the end-to-end chain proof;
  `@esco/controller-comm` (incl. the shipped-transports verified guard) +
  `@esco/controller-gateway` suites re-run green.

### Read-only online-readiness scaffold + controller-command safety guard (2026-06-05)
- Added the **controller-communication safety gate** (`@esco/controller-comm`): every
  ESCO online command — Controller Route Browser, Saved Controller Path, Path Diagnostics,
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
