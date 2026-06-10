# Current Features

A detailed inventory of what ESCO Automation Studio supports today.

## Parity matrix (test-backed)

This matrix is the QA/parity ledger. Status meanings are strict:

- **Working** — executes real offline logic in the IDE and is covered by passing
  automated tests.
- **Offline review-only** — the data/model is imported, edited, validated, and/or
  reviewed offline, but no controller/hardware behavior is executed (by design).
- **Missing (by design)** — intentionally not implemented because it requires a
  verified real controller transport; these stay guarded and never touch hardware.

"Tested by" lists the automated drivers/specs that exercise the area. A row is
only marked **Working** when those tests pass. Latest local QA lane from
2026-06-05: `corepack pnpm -r typecheck`, `corepack pnpm test`
(**2543/2543 unit/integration tests**), `corepack pnpm --filter @esco/web build`,
and `node e2e/run-all.mjs` (**90 drivers, 1208/1208 browser checks**) are green.
The build currently emits only Vite's non-failing large-chunk warning for the
bundled web app.

| Area | Status | Tested by |
|---|---|---|
| UI shell, ribbon, menus, dialogs, keyboard routing | Working | `ribbon`, `dialogs`, `shortcuts`, `workbench`, `welcome` |
| Project Explorer tree + context/command menus | Working | `organizercontext`, `organizerassets` |
| Ladder editing (rungs, branches, operands, palette, undo/redo, copy/paste) | Working | `ladderedit`, `branchedit`, `nestedbranch`, `laddercontext`, `laddertoolbar`, `undoredo`, `copypaste`, `instr`, `newinstr` |
| Structured Text editing + offline subset execution | Working (subset) | `stsource`, unit (`expression-evaluator`) |
| Instruction simulation (bit/timer/math/compare/file/string/…) | Working (broad) | `instr`, `newinstr`, `arrayvalues`, unit |
| Tags / Watch / Forces / Trace / Inspector | Working | `tags`, `forcetrace`, `arrayvalues`, `inspector` |
| Cross reference | Working | `xref` |
| Verify / validation output | Working | `verifyoutput`, `diagnostics` |
| I/O module workflow (catalog add, properties, remove — offline model) | Working (offline edits) | `iomodulecatalog`, `iodetail` |
| UDT / AOI detail + offline member/parameter editing | Working (offline) | `udtdetail`, `aoidetail`, `structure`, `structureedit` |
| Compare (routine diff) | Working | `compare` |
| Search / reviewed Replace All | Working | `search` |
| AI Copilot safety/default shell + optional configured agent components | Working | `ai`, `aiagent`, unit (`ai-assistant`) |
| Save/open `.plcproj.json`; L5X import; review-only L5X export | Working | `persist`, `l5x`, `l5x-branch`, `component-export` |
| ESCO Runtime (`.easruntime`) build/export/import | Working | `easrt` |
| Unsupported proprietary binary import + export guard | Working (guard) | `binaryguard` |
| Project History (desktop Git VCS) | Working (desktop) | `gittool`, `projecthistory` |
| HMI View Designer authoring + live runtime preview | Working (structural + live preview) | `hmidesigner`, `hmilive`, `hmilive-authoring`, `hmi-layout` |
| Task scheduling / scan-status / controller-properties reports | Offline review-only | `taskmonitor`, `taskscanstats` |
| ESCO Virtual Controller (offline/virtual session) | Offline/virtual session | `virtualcontroller`, `driver`, `readonly-monitoring` |
| Goal B ESCO Controller Gateway + vendor-neutral read-only EtherNet/IP/OPC UA foundation | Working (software-wired, not field-validated); Allen-Bradley/EtherNet/IP is the first adapter track, not the platform boundary | `@esco/controller-gateway`, `@esco/driver-ethernetip`, `@esco/driver-ethernetip-node`, `@esco/driver-opcua-node`, `@esco/api`, `gateway-client`, `gateway-contract`, `web-boundary`, `esco-online-session`, `end-to-end`, `escoonline` |
| Goal B Online Tag Monitor watch list | Working for gateway simulator/software path and EtherNet/IP loopback fake-target path with polling, SSE streaming where supported, changed-value highlighting, saved lists, quality/state honesty, and explicit stale/disconnected markers; hardware validation remains open | `EscoOnlinePanel`, `esco-online-session`, `gateway-client`, `@esco/api`, `e2e/escoonline`, `e2e/escoonline-enip`, `ribbon` |
| Goal B match check + upload snapshot surface | Working for gateway simulator/software path; EtherNet/IP hardware snapshot remains unsupported | `GatewayHost`, `EscoGatewayClient`, `EscoOnlineSession`, `EscoOnlinePanel`, `e2e/escoonline` |
| Goal B L5X import/export/sync path | Working as an offline gateway driver over ESCO project/L5X-imported structure; not a live controller path | `@esco/controller-gateway`, `GatewayHost` |
| Vendor-neutral PLC target/download adapters | Planned; architecture documented, but physical download remains blocked for every real PLC family until each adapter has compile, compare, backup, permission, audit, and read-back gates proven | `docs/vendor-neutral-plc-download-architecture.md` |
| ESCO Simulation Lab (offline FAT/SAT: devices, virtual tags, logic templates, scenarios, fault injection, timeline, report) | Working (offline/virtual) | `simlab` (e2e), `@esco/sim-lab` unit specs (`logic-templates`, `engine`, `scenarios`, `validation`, `report`, `compat`, `project`) |
| Compatibility review/export helpers (ESCO HMI Runtime, SCADA Compatibility Export, OPC UA / Modbus TCP / MQTT-Sparkplug Simulators, Ignition Gateway Export Review, Optix Migration Review) | Offline review-only (ESCO-owned, no vendor IP) | `@esco/sim-lab` unit (`compat`) |
| Process / motion / message / alarm / safety (PID, MSG/GSV/SSV, motion, PhaseManager) | Offline review-only (model parses + boundaries) | `props`, unit review projections |
| Real PLC online/download: Go Online, upload, download, online edit, mode change, lock, fault clear, network browse | Missing for field PLCs (by design) — guarded per target adapter, never touches hardware without validation | `controller` (verifies every command is blocked) |
| Desktop release (Entra sign-in, code signing, installer) | Partial baseline | `desktop-startup` |

### Parity estimate (backed by tests)

Parity is split because the product is **offline by design** — measuring it as a
single number against full Studio 5000 (which includes live controller work)
would be misleading.

- **Offline engineering & simulation parity: 91.8%.** Authoring, editing, the
  simulated instruction set, tags/watch/forces/trace, validation, cross
  reference, I/O/UDT/AOI offline editing, compare, search, L5X round-trip, and
  the HMI structural designer + live preview are all implemented and pass
  automated tests. The remaining gap is firmware-faithful execution of
  model-only families (PID/PIDE, MSG/GSV/SSV, motion, PhaseManager, GuardLogix
  safety), full Logix Structured Text semantics, and the hardest nested-branch
  shapes — these are tracked as review-only, never faked as executed.
- **Goal B online parity: ESCO-owned read-only foundation is software-wired,
  field use not ready.** The ESCO Controller Gateway models the online states,
  driver contract, generic driver paths, match-check default-to-read-only rule,
  driver/session capability metadata, explicit connection validation evidence
  (`software-wired` vs. future lab/field validation), tag read/watch/upload snapshot flow, and
  a controlled-write capability gate with audit/read-back scaffolding kept
  disabled for this read-only milestone. The web shell exposes the B1 Online
  toolbar command set. The repo now
  includes ESCO-owned EtherNet/IP/CIP codecs, a sans-I/O session core,
  backend-only TCP transport, gateway driver, API host, web gateway client,
  session manager, and visible ESCO Online panel tested through loopback/fake
  targets. Gateway read-side actions now enforce the public capability contract
  for status, faults, browse, reads, subscriptions, snapshot upload, and compare
  even when a driver object exposes optional methods. Gateway connection attempts
  also block `canConnect: false` driver paths before invoking any driver
  transport code, so placeholders and review-only adapters cannot fake an online
  session. Gateway audit entries now carry structured details for driver
  validation evidence, capability blocks, compare outcomes, read/watch counts,
  and snapshot provenance, and the Online panel renders those details in the
  audit trail. Generic OPC UA now has a backend-only read-only driver path and
  API-level tests covering read-only connect, identity, browse, single/batch
  reads, SSE tag subscription, and snapshot refusal through an injected fake
  OPC UA endpoint; generic OPC UA fault reads and security-policy/certificate
  handling are explicitly unsupported until reviewed instead of being faked;
  OPC UA browse now performs failure-tolerant read-only data-type probes when
  browse references omit variable type metadata, so the tag monitor can show
  BOOL/DINT/REAL-style types instead of generic `OPC_UA` where the endpoint
  permits value reads. Bad OPC UA status codes take precedence over payload
  decode uncertainty, so bad-quality structured values remain visibly `bad`
  instead of being softened to `uncertain`. OPC UA batch reads now use the
  backend adapter's multi-node read service (`session.read([...])`) and fall
  back to individual reads only when the batch service call itself fails, keeping
  watch-list rows and per-tag errors usable. The web session manager also stops
  active watch polling/streaming and marks watched rows stale when a status
  refresh reports disconnected, offline, or faulted, so old values cannot keep
  looking live after the gateway closes the session. The controller gateway now
  tracks active backend watch subscriptions and leaves `Online Monitor` after
  the final unsubscribe, restoring the underlying read-only/matched/mismatched
  state without reviving disconnected sessions. OPC UA controller status now reads
  the standard server current-time node as a read-only heartbeat, reporting
  warning/disconnected status when that heartbeat is bad or unreachable instead
  of trusting an existing session object blindly; the gateway downgrades its
  returned session snapshot when that status reports disconnected/faulted so the
  Online badge and status health cannot disagree, and OPC UA connect now fails
  fast when the initial heartbeat cannot be proven instead of briefly entering
  Online Read-Only and correcting later;
  OPC UA tag subscriptions now send an initial sample and are terminated on
  explicit unsubscribe or driver disconnect; the controller gateway now also
  calls driver disconnect when a later status heartbeat reports a lost
  connection, so backend sessions/subscriptions are cleaned up instead of only
  changing the UI state;
  the EtherNet/IP browser E2E now drives the visible Online panel through the
  real backend EtherNet/IP driver and loopback fake target for connect,
  identity/status, browse, read, watch polling, read-only status, stale-on-stop,
  audit, and disconnect;
  the API host now isolates gateway state per ESCO client session id, with the
  browser client sending `x-esco-session-id` for JSON routes and `session=...`
  for SSE watch streams so separate tabs/API clients do not share one active
  online session, and the backend now disconnects/removes idle inactive
  sessions while active watch streams keep their session open; session ids are
  normalized through one backend contract for headers, query strings, JSON, and
  SSE, and multiple active watches preserve `Online Monitor` until the final
  unsubscribe;
  browser-side driver summaries now normalize partial/missing capability
  payloads into a full fail-closed contract, so incomplete backend metadata
  cannot accidentally enable browse/read/watch/upload/compare controls;
  the visible Online panel exposes OPC UA-specific read-only endpoint, browse
  root, sampling interval, and tag-node mapping controls that flow through the
  gateway client/session rather than direct driver imports. The web app owns a
  browser-side `/api/gateway` JSON contract and has a boundary test that fails
  if browser code or the web package manifest imports `@esco/controller-gateway`,
  ESCO PLC driver packages, OPC UA/EtherNet-IP runtimes, or raw socket modules;
  the L5X sync path now exposes offline project structure through the gateway
  for compare/snapshot/tag review while explicitly refusing live controller fault
  reads because an offline snapshot cannot prove current fault state. The B5 project signature now includes
  program/routine structure, ST/source text, scrubbed ladder structure, tasks,
  UDTs, AOIs, and tags, while ignoring generated ids; gateway identity refresh
  recomputes the match proof and downgrades stale matched sessions to
  read-only/mismatched when the refreshed controller identity changes. The
  local project match signature now uses a prefixed ESCO stable-project
  SHA-256 digest with algorithm/source metadata instead of a short FNV hash.
  The Online panel now shows a B5 Match Evidence table with local vs online
  controller name, controller type, firmware, project name, project signature,
  signature algorithm, and signature source.
  Backend
  EtherNet/IP and OPC UA driver summaries and active sessions now publish
  `connectionEvidence` showing real-controller-route potential without
  hardware validation, and the Online panel shows that evidence beside driver
  capabilities. Legacy OPC DA remains a placeholder only.
  Physical
  download, online edit, mode changes, forces, fault clearing, and real plant
  use remain blocked until a validated gateway path explicitly enables them.

Do not read the 91.8% as "almost shippable as a physical-controller replacement":
it is an offline-feature-coverage figure, not a controller-verified one. Every
generated L5X is review-only and must be verified in a sandbox before any
production use.

## Ladder editing

- Semantic ladder AST (`@esco/ladder`): rungs → branches (series, parallel,
  continuation) → nodes → operands. Not stored as text.
- Add / delete rungs; editable rung comments.
- Grouped instruction palette (Bit / Timer-Counter / Move-Math / Compare /
  Program) that adds to the selected rung.
- **Branch editing** for the selected rung: add a parallel branch, add/remove
  legs (empty legs only), add instructions to a specific leg, and nest a
  parallel inside an existing leg — enough to build seal-in and nested branch
  layouts by hand.
- L5X import preserves representable nested branch paths in the ladder AST and
  simulation model. Branch shapes that cannot be represented faithfully by the
  current AST still fall back to a flat preserved series with an import warning.
- Inline operand editing with undefined-tag highlighting and one-click
  "create the missing tag" (data type inferred from the operand).
- Copy / Duplicate / Paste rungs (deep-cloned with fresh ids).
- Undo / redo for every project edit, with Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
  (text fields keep native undo); undoing back to the last saved state clears
  the unsaved-changes flag.
- Rung and instruction selection with a focus highlight.
- Branch rendering (parallel paths stacked); unsupported instructions render as
  dashed, read-only boxes.

## Structured Text source editing

- Imported or newly-created Structured Text routines open in the routine editor
  as editable source, save through the same controlled project-action path as
  ladder edits, and export line-by-line through generated `.L5X`.
- The editor runs the shared Structured Text structural analyzer while typing,
  surfacing unmatched blocks, parentheses, brackets, comments, and strings.
  Project-wide Verify reports the same structural findings as errors so invalid
  ST cannot hide outside the open editor, and it also flags clear undefined
  tag/member references plus obvious array bounds in ST source.
- Offline Simulation executes a conservative Structured Text subset for
  scheduled or explicitly selected ST routines: scalar/member/array assignments,
  Studio `[ := ]` non-retentive assignment syntax as scan-time writes,
  numeric/boolean expressions through the shared expression engine, including
  Logix `&`/`AND` logical/bitwise AND forms, string literal assignment, simple
  string relational comparisons (`=`, `<>`, `<`, `<=`, `>`, `>=`) inside logical
  BOOL expressions, nested `IF` /
  `ELSIF` / `ELSE` / `END_IF` flow, bounded `FOR` / `WHILE` / `REPEAT` loops,
  `EXIT` from the nearest loop, and numeric `CASE` selections with Studio-style
  immediate comma labels, immediate ranges, typed/radix literals, program-qualified
  writes in branch bodies, and `ELSE`. Program-local
  `JSR` / `SBR` / `RET` calls can dispatch from ST into sibling ST or ladder
  routines and copy input/return parameters through the same offline tag image.
  Standalone calls to registered executable instructions (for example `MOV`,
  `ADD`, `CONCAT`, and `TON`) run through the same instruction registry used by
  ladder simulation, including positional calls, named argument mapping
  (`Operand := value` / `Operand => tag`), omitted trailing optional operands
  such as sequencer/FIFO position slots and ASCII read quantities, trace writes,
  and output-tag discovery. Project-wide Verify also checks registered ST
  instruction calls for missing required operands, unknown named operands,
  invalid expression operands, invalid write targets, and alias-resolved
  tag/member/array type mismatches through predefined structures, UDTs, AOI
  instance members, and program-qualified paths. It also flags nested or top-level
  `CASE` selector labels that are not immediate numeric values or ranges and
  `CASE` expressions that resolve to BOOL, STRING, or structured values instead
  of numeric values. When the CASE expression resolves to a known numeric tag,
  member, or typed numeric literal, Verify also flags obvious selector type
  mismatches such as REAL labels under a DINT expression or typed DINT labels
  under a REAL expression, and warns when known REAL CASE expressions use exact
  selector values instead of range selectors, plus model-only review-only status.
  Unsupported ST statements are skipped instead of guessed; full Logix ST
  execution remains a gap.
- Imported FBD and SFC routines remain read-only source/outline views for
  review and round-trip preservation.

## Instruction set

| Category | Instructions (executed offline unless noted) |
|---|---|
| Bit | XIC, XIO, OTE, OTL, OTU, ONS, OSR, OSF |
| Timer / Counter | TON, TOF, RTO, CTU, CTD, RES |
| Move / Math | MOV, COP, CPS, FLL, MVM, ADD, SUB, MUL, DIV, MOD, SQR, NEG, ABS, CPT, CMP, CLR |
| Extended / Trig math | SIN, COS, TAN, ASN, ACS, ATN, LN, LOG, XPY, DEG, RAD, TRN |
| Bitwise | AND, OR, XOR, NOT |
| Compare | EQU, NEQ, GRT, GEQ, LES, LEQ, LIM, MEQ |
| Conversion / Bit position | TOD, FRD, BTD, SWPB, DCD, ENC, DTR |
| Sequencer | SQO, SQI, SQL |
| Shift | BSL, BSR |
| File / Array | AVE, STD, SRT, FAL, FSC, SIZE, FFL, FFU, LFL, LFU, FBC, DDT |
| String / ASCII | CONCAT, DELETE, FIND, INSERT, LEFT, LEN, MID, RIGHT, LOWER, UPPER, ACI, ACB, AEX, ASC, ABL, ACL, ACN, ARD, ARL, ASR, AWA, AWT, DTOS, RTOS, STOD, STOR |
| Program / Routine | JSR, SBR, RET, TND, JMP, LBL, FOR, BRK, MCR, IOT, NOP, AFI |
| Model-only (registered, not simulated) | ASCII hardware handshake (AHL), process (PID/PIDE/…), GuardLogix safety (including DIN/ROUT/CROUT backing-tag review operands), message/alarm/motion (MSG/GSV/SSV/ALMx/MSO…) |

ONS is a rising-edge one-shot (storage bit); RTO is a retentive timer cleared by
RES; CTU/CTD latch COUNTER overflow/underflow status bits on signed-DINT wrap and
RES clears them; LIM handles ascending and circular ranges;
MEQ compares under a mask; DCD/ENC convert between a low-nibble bit position and
a one-of-16 bit word; SWPB executes DINT byte-order modes (REVERSE, WORD, HIGHLOW).
COP/CPS/FLL/MVM, AVE/STD/SRT/FAL/FSC/SIZE, FFL/FFU/LFL/LFU,
FBC/DDT, SQO/SQI/SQL, and BSL/BSR run as bounded offline numeric approximations
over array/tag memory; FBC records mismatching bit numbers and DDT also updates
the reference bits, including qualified program-scoped array operands and
starting word offsets. The extended-math /
trig family computes exact offline results in **radians** (out-of-domain inputs
such as `LN(-1)` are guarded to 0, since offline there is no math-status fault
word). String/ASCII instructions operate on STRING tags and numeric results;
serial buffer instructions use the channel operand as an offline STRING buffer;
JMP/LBL perform bounded offline jumps to labels within the routine;
FOR executes a sibling routine with an index tag; BRK exits the active loop; MCR
zones scan disabled rungs with false power until the closing MCR. IOT is
accepted as an executable offline immediate-output flush point; it validates the
required update tag operand but performs no hardware communication. **Model-only**
families — ASCII hardware handshake, process control
(PID/PIDE), GuardLogix safety, and message/alarm/motion — are
registered so real L5X imports parse, render, validate (as info, never an
error), and round-trip with operands preserved, but are **not** simulated (each
passes the rung condition through and touches no tag memory or controller). A
shared model-only review projection exposes the Studio-style review state for
these blocks: declared operand roles/directions, missing required operands,
pass-through rung behavior, and explicit runtime boundaries such as no controller
communication, no MSG execution/CIP connection/remote data transfer/status
updates, no GSV/SSV controller object attribute read/write, no PID
algorithm/PV sampling/CV output, no loop update scheduling, no process
status/alarm updates, no manual/cascade/tieback handling, no closed-loop tuning,
no signal-conditioning/totalizer calculation, no motion command/planner
execution, no axis-state, drive-command, motion-feedback, coordinate/group,
cam/gear, or motion event/watch/registration runtime effects, no safety
evaluation, no alarm evaluation, no serial-port access, no ASCII handshake line
read/write, no AHL mask application, no serial control/status update, and no
SFC/PhaseManager state engine. The
instruction properties panel surfaces those boundaries for selected model-only
blocks. PID/PIDE and loop/scaling/totalizer instructions can
also be projected into a project-level process loop review that resolves their
block tags, PV/CV references, qualified `Program:Name.Tag` paths, missing
imports, and type mismatches while confirming closed-loop execution and runtime
tag writes are not simulated. Truly unknown vendor instructions are preserved
read-only. PhaseManager/equipment-phase instructions can also be projected into
a project-level equipment phase review that resolves `EQUIPMENT_PHASE` and
`PHASE_INSTRUCTION` targets, qualified `Program:Name.Tag` paths, missing
imports, and type mismatches while confirming phase state transitions, command
arbitration, ownership transfer, batch requests, and parameter transfer are not
simulated. GuardLogix safety partition metadata can be projected into a
project-level safety metadata review that surfaces imported task/program/tag/AOI
`Class` values, safety-instruction backing tags, missing imports, and
standard-tag wiring findings. The validator also catches safety/standard program
task-partition schedule mismatches while confirming realtime safety task
scheduling, signature/lock handling, memory partition enforcement, controller
safety status, and safety evaluation are not simulated. Project-defined Add-On Instruction
calls are recognized from imported AOI definitions; unprotected imported RLL AOI
logic executes offline against the instance tag's parameters/local members,
including nested AOI calls through AOI-local instance tags, while
source-protected or non-ladder AOI logic stays model-only. JSR runs a sibling
routine against the same tags with a call-depth guard; Studio-style
`JSR(routine,inputCount,inputs...,returns...)` operands copy values into the
callee's SBR operands and copy RET operands back into JSR return destinations.
Instruction metadata (operands, allowed types, read/write
direction, render style) lives in the registry (`@esco/instructions`) and drives
the editor, simulator, validator, and import.

## Simulation

- Scan-cycle runtime (`@esco/simulator`): series + parallel + continuation,
  unknown instructions pass through (never crash).
- Watch panel: BOOL toggles, DINT/REAL number inputs, STRING inputs,
  TIMER/COUNTER/CONTROL/MESSAGE member values
  (PRE/ACC/EN/TT/DN, CU/CD/OV/UN, EN/EU/DN/EM/FD/IN/UL/ER/POS/LEN), array
  elements, imported UDT tag members, and program-scoped tags
  (`Program:ProgramName.Tag`) as individual value paths.
- Scan Once / Run (interval) / Reset; timers advance by a per-scan delta.
- Imported task schedules feed offline Scan Once / Run: with no explicit routine
  selected, non-inhibited tasks scan their scheduled programs' main routines in
  imported task/program order. Program-scoped tag values are stored with
  `Program:ProgramName.Tag` paths and copied into that program's local scan image
  while its routine executes, so same-named local tags do not collide. Qualified
  reads of another program's local tag (`Program:OtherProgram.Tag`) resolve in
  ordinary operands and CPT/CMP expressions. Explicit routine scans remain
  available for focused debugging.
- The same imported task schedule can be projected into a deterministic offline
  controller/task status report. It mirrors the offline scan set, marks duplicate
  scheduled routines that are skipped, flags inhibited tasks/programs, missing
  scheduled programs, programs without a main routine, non-ladder main routines,
  and exposes period/priority/watchdog/DisableUpdateOutputs metadata with
  explicit "timing/watchdog/controller faults are not modelled" status bits.
  Offline validation flags continuous tasks that carry DisableUpdateOutputs
  because Studio 5000 only allows that output-processing flag on PERIODIC or
  EVENT tasks, and flags redundancy-enabled controllers that still carry a
  CONTINUOUS task. It also flags task-capacity violations: more than 32 tasks on
  a controller or more than 32 scheduled programs on a task, with ControlLogix
  and SoftLogix imported controllers allowed up to 1000 scheduled programs per
  task.
- EVENT task trigger metadata has an offline review projection for imported
  `EventInfo` (`EventTrigger`/`Tag`/`EnableTimeout`) settings. It resolves
  controller or qualified program trigger tags when they were imported, flags
  missing triggers, missing tag-bound triggers, unresolved trigger tags, and
  EventInfo on non-EVENT tasks, and keeps controller event scheduling, module
  state-change monitoring, consumed-tag trigger transfer, EVENT instruction
  dispatch, and timeout/watchdog behavior unmodelled.
- Program interfaces have an offline review projection for imported
  `Input`/`Output`/`InOut` parameters. It surfaces required/default values,
  dimensions, radix, ExternalAccess metadata, empty programs, and malformed
  hand-edited interface findings. Imported controller `ParameterConnections`
  are preserved and projected into an offline endpoint review that resolves
  program parameters and flags missing, malformed, unresolved, duplicate,
  same-endpoint, and incompatible endpoint pairs while confirming runtime
  transfer and controller-verified connections are not modelled.
- Controller properties have an offline review projection for imported
  processor/catalog/firmware/chassis/slot identity, System Overhead Time Slice,
  ShareUnusedTimeSlice, and redundancy settings, including front-port crossload
  metadata. It flags missing identity, invalid percentage metadata, and
  malformed front-port crossload security flags while confirming firmware
  compatibility checks, controller status words, system-overhead scheduling,
  redundancy switchover, and front-port crossload behavior are not modelled.
- Controller ReportMinorOverflow settings have an offline review projection for
  imported arithmetic-overflow minor-fault reporting metadata. It flags
  malformed true/false or 1/0 values while confirming overflow minor-fault
  generation, live minor-fault status, controller fault logs, download preflight,
  and controller communication are not modelled.
- Controller project/controller matching settings have an offline review
  projection for imported `MatchProjectToController` and
  `ProjectSN` plus `InhibitAutomaticFirmwareUpdate` metadata. It flags partial
  metadata, malformed true/false or 1/0 flags, missing ProjectSN when matching
  is enabled, and serial metadata without enabled matching while confirming
  controller serial-number matching, download preflight, firmware updates,
  firmware-update inhibition, and controller replacement workflows are not
  modelled.
- Controller project documentation settings have an offline review projection
  for imported `CurrentProjectLanguage`, `DefaultProjectLanguage`,
  `ControllerLanguage`, `PassThroughConfiguration`,
  `DownloadProjectDocumentationAndExtendedProperties`, and
  `DownloadProjectCustomProperties` metadata. It flags partial language/download
  metadata and malformed true/false download flags while confirming language
  merge, language-selection dialogs, controller pass-through storage, and
  documentation/extended/custom-property download are not modelled.
- Controller project audit timestamps have an offline review projection for
  imported `ProjectCreationDate` and `LastModifiedDate` metadata. It flags
  partial timestamp pairs while confirming controller audit-log reads, project
  history synchronization, timestamp verification, and controller downloads are
  not modelled.
- Controller WallClockTime settings have an offline review projection for
  imported `LocalTimeAdjustment` and `TimeZone` metadata. It flags partial
  settings, non-integer microsecond offsets, and offsets outside a +/-24 hour
  window while confirming controller clock read/set, time synchronization,
  time-zone dialogs, scheduled time changes, and wall-clock runtime behavior are
  not modelled.
- Controller TimeSynchronize settings have an offline review projection for
  imported CIP Sync / IEEE 1588 `PTPEnable`, `Priority1`, and `Priority2`
  metadata. It flags partial settings and malformed PTP priority values while
  confirming controller clock synchronization, CIP Sync runtime behavior,
  grandmaster election, and controller time-quality status are not modelled.
- Controller Coordinated System Time settings have an offline review projection
  for imported `CST MasterID` metadata. It flags missing and malformed master
  IDs while confirming CST clock coordination, master election, chassis time
  synchronization, live time status, and controller communication are not
  modelled.
- Controller GuardLogix SafetyInfo settings have an offline review projection
  for imported `SafetyEnabled`, `SafetyLocked`, `SafetySignatureID`,
  `SafetySignatureTimestamp`, `SignatureRunModeProtect`,
  `ConfigureSafetyIOAlways`, and `SafetyLevel` metadata. It flags partial
  SafetyInfo rows, malformed enable flags, signature/timestamp pairing
  mismatches, and locked/run-mode-protected settings without a signature while
  confirming signature verification, safety enable/disable, lock/unlock, safety
  task scheduling, safety I/O configuration, memory partition enforcement, and
  controller safety status are not modelled.
- Controller Security settings have an offline review projection for imported
  `Code`, `ChangesToDetect`, `SecurityAuthorityID`, and
  `SecurityAuthorityName` metadata. It flags partial change-detection settings,
  partial FactoryTalk authority metadata, and authority bindings without
  complete security settings while confirming permission enforcement,
  source-protection enforcement, FactoryTalk authentication, change detection,
  controller audit-log writes, and controller communication are not modelled.
- Controller SFC execution settings have an offline review projection for
  imported `SFCExecutionControl`, `SFCRestartPosition`, and `SFCLastScan`
  metadata. It flags partial imported settings while confirming SFC step
  execution, transition evaluation, restart-state behavior, last-scan execution,
  and controller-verified SFC scheduling are not modelled.
- PhaseManager/equipment-phase instructions have an offline review projection
  for model-only `PATT`/`PCMD`/`PXRQ`/related blocks. It resolves
  `EQUIPMENT_PHASE` and `PHASE_INSTRUCTION` operands from controller,
  program-scoped, and qualified program tag paths, flags missing or mismatched
  imported phase objects, and keeps the phase state engine, command arbitration,
  ownership transfer, batch sequencer requests, runtime phase parameter
  transfer, and controller-verified phase scheduling unmodelled.
- GuardLogix safety metadata has an offline review projection for imported
  task/program/tag/AOI `Class` metadata and model-only safety-instruction backing
  tags. It counts Safety vs Standard partitions, flags unknown `Class` values,
  missing backing tags, standard-class tags wired to safety blocks, and
  safety/standard program schedules across the task partition while keeping
  realtime safety task scheduling, safety signatures, lock/unlock state, memory
  partition enforcement, instruction execution, and controller safety status
  unmodelled.
- Controller fault handlers, power-up handlers, and program fault routines have
  an offline review projection. It resolves controller handler names to imported
  handler programs and their main routines, resolves program fault routines by
  routine id, flags missing, dangling, or ambiguous handler targets, labels
  ladder bodies as reviewable while confirming automatic fault/power-up dispatch
  and controller fault words are not modelled, and marks non-ladder bodies
  preserved read-only. The validator separately flags controller fault/power-up
  handler program references that do not resolve to a program with a main
  routine.
- Multi-routine and program flow: JSR runs a sibling routine (same program)
  against the shared tag memory, SBR receives JSR input parameters, RET copies
  return parameters and exits early, JMP/LBL can skip to a routine label,
  FOR/BRK runs bounded sibling-routine loops, and MCR zones
  disable rung power until the closing MCR. Runtime guards cap call depth, taken
  jumps, and loop iterations per scan.
- Add-On Instruction calls: imported, unprotected RLL AOI routines execute
  offline using the AOI instance tag as private parameter/local storage. Input
  and InOut parameters seed the AOI frame; Output/InOut parameters and local tags
  are written back to `Instance.Member` paths. Nested AOI calls work when the
  outer AOI uses an AOI-typed local instance tag. Source-protected AOIs and
  non-ladder AOI routines are preserved for review and not simulated. A shared
  AOI execution-review projection mirrors the simulator policy for the IDE:
  source-protected AOIs stay metadata-only, signatures are display-only, the
  ladder routine named `Logic` is the preferred offline scan body, the first
  imported ladder routine is the fallback when `Logic` is absent, and
  Prescan/Postscan/EnableInFalse plus ST/FBD/SFC bodies are preserved read-only.
  Offline validation mirrors Studio 5000 AOI body restrictions for unprotected
  ladder definitions: JSR/SBR/RET, FOR/BRK, IOT, EVENT, SFC reset/pause,
  selected PhaseManager commands, MAOC, and JXR are flagged, and identifiable
  MSG, ALMA/ALMD, and motion-control data instances must be InOut parameters.
  GSV/SSV blocks inside AOIs are also checked against Studio 5000's supported
  object-class list, GSV-only classes, and `THIS` instance-name requirement for
  programming-component classes. AOI capacity checks also flag definitions that
  exceed Studio 5000's Input/Output-parameter plus local-tag count, versioned
  InOut-parameter count, or nested AOI-call depth limits. AOI local-tag checks
  reject Studio-forbidden MESSAGE, MODULE, alarm, motion/object local tag types
  and multi-dimensional local-tag arrays.
  AOI identity/documentation metadata has a separate offline review projection
  for revision/vendor/signature, authoring history, help text, scan-mode flags,
  source protection, and Safety/Standard class without enforcing signatures,
  bypassing protection, executing scan-mode routines, or scheduling safety
  partitions.
  AOI call-interface review also preserves Studio-style parameter metadata,
  including Required, Default, Dimensions, usage, and instruction-face Visible
  flags, with Required and Visible treated as independent display properties.

## Controller safety boundary

- `@esco/controller-comm` owns the controller/session state machine and guarded
  hardware-command policy.
- Default state is **Offline Simulation**. Additional safe states distinguish
  **Model-only Review**, **Disconnected**, **Connection Disabled**,
  **Controller Link Unavailable**, **Faulted**, and **Safety Blocked**.
- Controller Route Browser, Saved Controller Path, Hardware Go Online, live monitor, upload,
  download, online edit, Program Mode, Run Mode, Test Mode, Lock Controller,
  Clear Faults, and Go To Faults are represented as guarded commands. In this
  build they return blocked results with explicit reasons and audit entries
  because no tested controller transport is configured. Go Offline remains a
  safe local lifecycle transition back to Offline Simulation.
- Imported TestEdits metadata can be reviewed and lifecycle-marked in the
  offline project model. That is offline review state only; it is not a real
  online edit and never modifies a controller.
- Ribbon and status UI must not claim a controller is connected unless the
  session reports a verified real transport. The shipped transports do not do
  that.
- The Online toolbar's Read Tags and Watch Tags actions open the ESCO Online
  gateway monitor. That surface now supports browsed-tag filtering, add/remove
  watched tags, typed tag-name entry, saved/restored watch lists, read-only
  polling, gateway SSE streaming where the active driver supports it,
  value quality/timestamp/source/write-status columns, stale/no-sample state,
  and changed-value highlighting. It does not enable writes.
- The gateway monitor stores stale/disconnected reasons per watched tag. A
  polling transport failure, stream disconnect, or stopped watch marks old
  samples stale; a later successful read or stream sample clears that state so
  the table does not present last-known values as live data.
- The ESCO Online panel now displays the selected driver/session capability
  contract from the gateway: status/fault/browse/read/batch/stream/upload/
  compare support plus blocked write/download/online-edit/force/mode-change/
  clear-fault operations. This comes from `/api/gateway/drivers` and the
  session snapshot rather than UI-side guessing.
- The Online toolbar's Set Path action opens the ESCO Online gateway connection
  form and focuses the endpoint field. This is gateway path setup only; network
  browsing and physical-controller path discovery remain guarded.
- The Online toolbar's Go Online, Go Offline, Upload Snapshot, Compare,
  Read Tags, Watch Tags, Faults, and Controller Status actions open the ESCO
  Online gateway panel. The panel can run a read-only connect, disconnect an
  ESCO gateway session, refresh read-only status/faults where supported, run an
  explicit local-project identity compare, and capture a read-only gateway
  snapshot on the simulator/software path. Compare refreshes online identity
  evidence through the gateway before evaluating the local project. Mismatches
  remain read-only; no write route is exposed. The Online toolbar's
  real-controller Download button is disabled/guarded.

## ESCO Virtual Controller (offline driver / simulation session)

- `@esco/controller-comm` also provides the **ESCO Virtual Controller** — an
  ESCO-owned, fully offline/virtual controller backend with a real, stateful
  IDE-style session. It is branded "ESCO Virtual Controller / Offline Driver /
  Simulation Session" and is explicitly **not real hardware**. It is separate
  from the hardware safety gate above (which still refuses to touch a real
  controller); the virtual backend can legitimately reach an "online" state
  because it is online against the in-memory simulation, never against hardware.
- State machine: `disconnected → browsing → path-selected → connecting → online`
  (+ `monitoring`, `uploading`, `downloading`, `faulted`, `error`). Session data:
  selected path, controller identity, controller mode (Program / Run / Remote
  Program / Remote Run), connection health, last online/upload/download
  timestamps, online project signature, downloaded controller snapshot, fault
  list, warnings, and an activity log.
- **Set Path / Route Browser** chooses from realistic ESCO virtual paths
  (EtherNet/IP → 192.168.1.10 → ESCO-ENBT → Backplane → Slot 0, Local Emulation
  Virtual Backplane, USB Virtual Controller); recent paths persist locally.
- **Go Online** requires a selected path, transitions through connecting to
  online, and compares the offline project signature to the controller image —
  reporting **matched**, **mismatch** (seeds a fault), or **no project
  downloaded**. **Monitor** enters live virtual monitoring.
- **Download** requires a path, blocks on hard validation errors (seeding
  validation faults), stores a signed project snapshot on the virtual controller,
  records the download timestamp, and goes online in Program mode.
- **Upload** requires a path and an existing snapshot, returns the stored image so
  the project structure can be reconstructed/inspected (loaded read-only), and
  records the upload timestamp; it warns when there is no image to upload.
- **Mode changes**: Run / Remote Run require a downloaded project matching the
  controller and guard destructive edits (read-only while scanning); Program /
  Remote Program allow edits. The mode is surfaced in the status bar and panel.
- **Faults**: an offline fault model with seeded validation / no-project /
  mismatch / mode faults, a Clear Faults command that recovers session state, and
  a fault list in the ESCO Virtual Controller panel.
- UI: the **ESCO Virtual Controller panel** (in the Controller dock) exposes Set
  Path, Go Online, Monitor, Download, Upload, Go Offline, mode controls, the fault
  list, session data, and the activity log; the status bar shows the virtual
  session state and mode.
- **Not real hardware yet**: there is no real controller link, no real upload /
  download / online edits, and no physical I/O. Real controller communications
  require a verified, tested transport against genuine hardware (out of scope for
  this build) — at which point the same session UI would drive it through the
  hardware safety gate.

## Validation

- Rule-based (`@esco/validator`): undefined tags (base-tag aware for member /
  array paths), operand type mismatches, missing required operands, unsupported
  instructions (info), unresolved JMP/LBL labels, instruction-specific syntax
  checks (for example malformed CPT/CMP expressions), array subscript-count and
  index bounds for tags and UDT member arrays, nested structured/UDT member-path checks,
  double-coil (a BOOL driven by 2+ OTE), duplicate controller / program tags,
  program-qualified tag references in operands and CPT/CMP expressions, and
  alias-target resolution, including aliases to member paths. Task-header checks
  include one-periodic-safety-task, continuous-task DisableUpdateOutputs,
  redundancy-enabled continuous tasks, and Logix task-capacity constraints;
  safety partition checks also catch
  safety/standard program schedules crossing the task boundary. Controller
  handler checks catch
  controller fault/power-up handler program names that do not resolve to an
  imported program with a main routine. AOI definition checks flag ladder-body
  instructions Studio 5000 does not allow inside AOIs, enforce InOut parameters
  for identifiable MSG/alarm/motion data instances, and validate AOI-local
  GSV/SSV class restrictions plus AOI capacity/nesting and local-tag type
  limits. I/O module verify
  checks cover duplicate module names, missing parent modules/ports, duplicate
  slots under the same parent, slots outside a known chassis/bus size,
  electronic-keying values, and invalid module connection RPIs.
  Never mutates the project. Surfaced in the Errors tab and the title-bar badge.

## Tags

- Tag table editor: searchable table with name, type, dimensions, scope,
  Studio 5000 ExternalAccess / Constant metadata, description, current value,
  role badge, and reference count. The Type column is editable through the same
  validated action path as creation/retyping, with a datalist of Logix scalar
  types, predefined structures, project UDTs, and AOIs. The create row can add
  controller-scoped tags or program-scoped local tags by selecting an existing
  target program.
- Imported Logix per-element/member tag comments (`<Comments><Comment
  Operand=...>`) are preserved through L5X import/export and surfaced in the tag
  table/properties as searchable `Tag.Member` / `Tag[index]` comment previews.
- Imported Logix per-element/member engineering units
  (`<EngineeringUnits><EngineeringUnit Operand=...>`) are preserved through L5X
  import/export and can be projected into an offline review that shows full
  `Tag.Member` / `Tag[index]` paths, duplicate unit operands, blank unit text,
  invalid member paths, and array-index findings while keeping unit conversion,
  online tag-property edits, controller download, and live display formatting
  unmodelled.
- Create tags with Studio-resolved data types: Logix scalar types, predefined
  structured/model-only types (for example TIMER, COUNTER, CONTROL, MESSAGE,
  MODULE, AXIS_*), project UDTs, and AOIs. Unknown data types are rejected
  before mutation. Program-scoped tag creation requires an existing program and
  writes to that program's local tag table; duplicate checks are Logix-scope
  aware, so same-named local tags can exist in different programs while
  duplicates in the same scope are rejected. Tag table edits carry the selected
  Logix scope through `project-actions`: description, dimensions, data type,
  ExternalAccess/Constant/radix metadata, aliases, delete, and rename update the
  intended controller or program tag row, fail on ambiguous bare names, and
  count/remap ladder references with program-local tag precedence plus
  `Program:ProgramName.Tag` qualified references. Tag create/rename, routine
  create/rename, and controller/program/task rename actions reject Studio-invalid
  Logix identifier shapes immediately, including overlength names, consecutive
  underscores, and trailing underscores. Tag dimensions, ExternalAccess,
  Constant, description, and delete (blocked when referenced) are all controlled
  through `project-actions`.
- Multi-dimensional array tags (`DINT[8]`, `DINT[2,3]`): imported from L5X
  `Dimensions`, round-tripped on export, expanded into element value-paths for
  simulation, shown per-element in the Watch panel, and validated for subscript
  count plus per-dimension bounds. Offline scans also resolve integer tag/member
  indirect subscripts and bounded arithmetic subscript expressions such as
  `Flags[Index]`, `Flags[Index+1]`, and `Matrix[Row,Col]`.
- UDT tag members, including multi-dimensional array members, are expanded into
  offline value paths (for example `Motor.Running`, `Motor.Faults[1]`,
  `Recipe.Steps[0,2]`) so ladder references scan and watch like ordinary tag
  paths.
- Imported UDT member metadata (`Radix`, `ExternalAccess`, array dimensions,
  hidden host members, and bit-overlay `Target`/`BitNumber` rows) is preserved
  and can be projected into an offline review that flags missing data types,
  malformed overlay targets, non-integer hosts, out-of-range bits, duplicate
  host bits, and non-BOOL overlay members while keeping controller memory-layout
  enforcement, bit packing, online data-type edits, controller downloads, and
  live display formatting unmodelled. UDT member edits reject Studio-invalid
  identifier shapes immediately, including overlength names, consecutive
  underscores, and trailing underscores.
- Imported UDT definition metadata (`Family`) is preserved and can be projected
  into an offline review that distinguishes ordinary `NoFamily` structures,
  custom `StringFamily` types, missing Family metadata, unrecognized family
  values, empty data types, and malformed custom STRING `LEN`/`DATA` member
  shape while keeping controller memory layout, custom string runtime layout,
  online data-type edits, controller downloads, and live data-type editor
  behavior unmodelled.
- AOI instance tags expand imported parameters and local tags into offline value
  paths (for example `ScaleInst.In`, `ScaleInst.Out`, `ScaleInst.Scratch`) for
  watch and RLL AOI execution. AOI parameter and local-tag edits use the same
  Studio-style identifier guard as tags, routines, programs, tasks, and UDT
  members before the post-edit validator runs.
- Alias tags can target base tags, array elements, or member paths (for example
  `MotorRun` aliasing `Motor.Running`) and resolve through validation and
  offline simulation without separate alias storage.
- MESSAGE control tags expose common status/configuration members (for example
  `MsgCtl.EN`, `MsgCtl.DN`, `MsgCtl.ERR`, `MsgCtl.Path`) for offline review;
  MSG remains model-only and never communicates, opens a CIP message connection,
  transfers remote data, or updates MESSAGE control status bits. MSG/GSV/SSV
  expose review operand metadata so cross-reference reports the message control
  tag, GSV destination, and SSV source without treating object-class or
  attribute names as tag references. GSV/SSV also expose explicit no-runtime
  controller-object attribute read/write boundaries.

## Cross reference

- Every tag use across routines: routine, rung number, instruction type,
  operand path, and read/write direction. Click to open the routine. Member /
  array paths resolve to the base tag, and CPT/CMP expressions are decomposed
  into their referenced tag paths. JSR routine names and input-count fields are
  excluded, MSG/GSV/SSV object keywords are excluded, while SBR inputs and
  RET/JSR return parameters use the correct read/write direction.

## Files

- **ESCO Runtime (`.easruntime`, ESCO-native).** ESCO owns a native compiled-runtime
  format, `.easruntime` (ESCO Automation Studio Runtime). **Build ESCO Runtime**
  compiles the project into an execution-oriented payload (ordered task → program
  → routine scan model, flattened ladder/ST routine payloads, power-up tag state,
  tag metadata, I/O binding metadata, build/validation summary). **Export ESCO
  Runtime** writes a checksummed (`sha256`), schema-versioned, ESCO-native JSON
  artifact stamped `provenance: "esco-native"`. **Import ESCO Runtime** verifies
  the extension, schema version, and checksum (rejecting corrupt / tampered /
  unsupported files) and loads it as inspectable, read-only "ESCO Runtime"
  provenance — never disguised as a fully editable project. Legacy `.easrt`
  runtime files are still accepted on import, but new exports use `.easruntime`.
  **Export ESCO Package** writes a self-contained `.easpkg` containing the
  editable `.easproj` and compiled `.easruntime`; validation verifies entry
  bytes/checksums and the package-level checksum, and **Import ESCO Package**
  opens the embedded editable project. **Export ESCO Library** writes a
  checksummed `.easlib` project-library artifact, and the offline Import
  Add-On Instruction / Data Type / Trend commands can extract matching reusable
  definitions from it after envelope checksum validation. See
  [docs/esco-native-formats.md](esco-native-formats.md).
- **Proprietary binary guard (offline-safe).** ESCO never reads, writes,
  compiles, decompiles, or converts proprietary binary `.ACD` controller project
  files, and never fakes one on export. Selecting an `.ACD`, a compressed ACD
  archive (`.acd.gz/.zip/.7z`), a legacy `.L5K`, or a mislabelled binary for
  import is detected *before any parse* — by extension and by content sniffing
  (e.g. the compound-file header and `RSEnc` markers) — and opens a professional
  blocked-format modal stating the format, why it is blocked, the supported
  offline formats, and the exact next step, with **Import L5X instead**,
  **Compatibility notes** (→ Help/About), and **Cancel**. Export/save targets are
  guarded too, so an `.acd` target is refused rather than written as a renamed
  file. Every loaded project records honest **provenance** (source type, file
  name, path, timestamp, and any blocked `.ACD` attempt), shown in Project
  Properties → Source and Help → About → unsupported project formats. The safe
  offline review path is an exported `.L5X` file; `.ACD` stays outside the
  product.
- Export / import `.plcproj.json` (full project incl. ladder AST and provenance).
- Studio 5000 `.L5X` import: controller, programs, routines, rungs (+comments),
  controller & program tags (+descriptions, per-element/member comments,
  aliases), supported instructions,
  and read-only structure — user-defined types, Add-On Instruction definitions,
  and the I/O module tree — with a counts + warnings import summary. Warnings
  include routine/rung location for unsupported instructions and unrepresentable
  flattened branches, plus alias and unmodeled-data-type notices.
- Studio 5000 `.L5X` export: generated offline, review-only `.L5X` for the
  current project. It round-trips controller/program/routine logic — ladder
  rungs (with comments) and Structured Text line-by-line, with FBD/SFC bodies
  preserved as read-only imported XML — plus controller & program tags
  (descriptions, per-element/member comments, aliases, array dimensions,
  per-element/member engineering units, Constant, produced/consumed role and
  connection settings, ExternalAccess),
  program metadata (inhibit, fault routine, parameters), controller program
  parameter connections, controller SFC
  execution-control metadata, GuardLogix SafetyInfo metadata, controller
  Security metadata, WallClockTime, TimeSynchronize, CST, project-matching/firmware-update flags,
  ReportMinorOverflow, redundancy front-port crossload metadata,
  controller communication path/driver metadata,
  controller project audit timestamps, documentation language/download metadata, UDTs (including Family/StringFamily,
  member Radix, ExternalAccess, array dimensions, and bit-overlay layout
  metadata), Add-On Instruction definitions
  (parameters/local tags/routine names and unprotected RLL routine bodies;
  source-protected logic is never reconstructed), I/O modules, controller serial
  communication port metadata, and tasks with
  their scheduling metadata (rate/priority/watchdog/inhibit and scheduled programs). The supported subset
  round-trips (project → export → import is equivalent); unsupported
  instructions are preserved in rung text and surfaced as warnings. Every file
  embeds an explicit notice that it is not a controller-verified Studio 5000
  export and never touches an `.ACD` file or a controller.
- Imported program parameters have an offline interface review that shows
  `Input`/`Output`/`InOut` usage, required/default metadata, dimensions, radix,
  ExternalAccess, empty programs, and malformed interface findings. Imported
  controller `ParameterConnections` round-trip through L5X and have an offline
  endpoint review for missing, malformed, unresolved, duplicate, same-endpoint,
  and incompatible program-parameter pairs without modelling runtime parameter
  transfer, controller-verified binding, or download preflight.
- Controller project/controller matching settings have an offline review that
  shows MatchProjectToController, ProjectSN, and
  InhibitAutomaticFirmwareUpdate metadata, partial/malformed flag findings,
  serial-pairing findings, and explicit no-runtime boundaries without matching
  controller serial numbers, running download preflight, updating firmware, or
  modelling replacement workflows.
- Controller ReportMinorOverflow settings have an offline review that shows the
  imported arithmetic-overflow minor-fault reporting flag, malformed flag
  findings, and explicit no-runtime boundaries without generating arithmetic
  overflow minor faults, reading live minor-fault status, writing controller
  fault logs, or running download preflight.
- Controller communication path settings have an offline review that shows
  imported `CommPath` and `CommDriver` metadata, path/driver pairing findings,
  routed-path shape findings, and explicit no-online boundaries without browsing
  communication paths, validating workstation drivers, going online, or selecting
  a download target.
- EVENT tasks have an offline trigger review that shows EventTrigger/Tag/
  EnableTimeout metadata, imported trigger-tag resolution, missing or unresolved
  trigger configuration, and no-runtime boundaries for event scheduling,
  dispatch, and timeout/watchdog behavior.
- Controller SFC execution settings have an offline review that shows
  `SFCExecutionControl`, `SFCRestartPosition`, and `SFCLastScan` metadata and
  partial-setting findings without modelling SFC execution, transition
  evaluation, restart state, or last-scan behavior.
- Controller project documentation settings have an offline review that shows
  project language and pass-through/download metadata, partial metadata
  findings, and malformed download flags without modelling language merge,
  controller pass-through storage, or documentation download.
- Controller project audit timestamps have an offline review that shows
  ProjectCreationDate and LastModifiedDate metadata, partial timestamp findings,
  and explicit no-runtime boundaries without reading controller audit logs,
  synchronizing project history, verifying timestamps, or downloading to a
  controller.
- Controller WallClockTime settings have an offline review that shows
  LocalTimeAdjustment and TimeZone metadata, partial/malformed offset findings,
  and explicit no-runtime boundaries without reading or setting a controller
  clock or modelling time synchronization.
- Controller TimeSynchronize settings have an offline review that shows
  PTPEnable, Priority1, and Priority2 metadata, partial/malformed priority
  findings, and explicit no-runtime boundaries without synchronizing a
  controller clock, running CIP Sync, electing a grandmaster, or reading
  controller time-quality status.
- Controller Coordinated System Time settings have an offline review that shows
  `CST MasterID` metadata, missing/malformed master findings, and explicit
  no-runtime boundaries without coordinating a CST clock, electing a CST master,
  synchronizing chassis time, reading live time status, or communicating with a
  controller.
- Controller GuardLogix SafetyInfo settings have an offline review that shows
  safety enable, safety lock, safety signature ID/timestamp, run-mode
  protection, configure-safety-I/O metadata, and safety level, including
  partial, malformed enable flag, missing-signature, and signature/timestamp
  pairing findings, without modelling signature verification, safety
  enable/disable, lock/unlock, safety I/O configuration, memory partitioning, or
  controller safety status.
- Controller Security settings have an offline review that shows source
  protection code, ChangesToDetect masks, and FactoryTalk security authority
  bindings, including partial metadata findings, without modelling permission
  enforcement, FactoryTalk authentication, source-protection enforcement, change
  monitoring, controller audit-log writes, or controller communication.
- Equipment phase instructions have an offline review that shows PhaseManager
  targets, missing imported `EQUIPMENT_PHASE`/`PHASE_INSTRUCTION` tags, and type
  mismatches without modelling phase state transitions, command arbitration,
  ownership transfer, batch requests, or runtime parameter transfer.
- GuardLogix safety metadata has an offline review that shows Safety/Standard
  `Class` partitions on tasks, programs, tags, and AOIs plus safety-instruction backing
  tags, with validation for safety/standard program task-partition schedules,
  without modelling safety task execution, signatures, lock state, memory
  partition enforcement, or controller safety status.
- Produced and consumed controller tags have an offline connection review that
  surfaces ProduceInfo/ConsumeInfo metadata, RPI/unicast settings, invalid
  consumed RPIs, invalid produce counts, missing consumed producer/remote-tag
  bindings, program-scoped connection roles, controller
  `CanUseRPIFromProducer` / `CanUseRPIFromController` source flags, malformed or
  conflicting controller RPI-source settings, and conflicting produced+consumed
  flags without attempting controller communication, RPI negotiation, or RPI
  scheduling.
- I/O modules have an offline module review projection that shows
  catalog/revision/electronic-keying identity, inhibit and MajorFault metadata,
  parent module/port topology, duplicate-slot findings, port details, and bus
  sizes while confirming no module connection, keying enforcement, topology
  browse, or major-fault injection is attempted.
- Imported module connection metadata has an offline connection review that
  shows connection name/type, requested packet interval, scheduling priority,
  EventID, unicast/multicast settings, duplicate connection names, missing or
  invalid RPI settings, and malformed connection rows while confirming no module
  connection, RPI scheduling, connection priority scheduling, event-triggered
  connection dispatch, unicast/multicast enforcement, or connection major-fault
  behavior is attempted.
- Controller Trend definitions (`<Trends><Trend>`) are imported/exported as
  model-only L5X workstation configuration. The importer preserves
  trend attributes, description, TrendX template payload, and pen attributes
  such as color/visibility/width/type/min/max/engineering units. The offline
  review projection flags empty trends, more than eight pens, invalid sample
  periods, and invalid capture counts while confirming no online trend run,
  controller sampling, trend-log capture, or sampled-data export is attempted.
- Controller Quick Watch Lists (`<QuickWatchLists><QuickWatchList>`) are
  imported/exported as model-only L5X workstation configuration. The
  importer preserves list names, descriptions, watch tag `Specifier` values,
  optional `Scope` values, and extra attributes. The offline review projection
  resolves controller, program-scoped, program-parameter, and AOI-scoped watch
  targets when their definitions were imported, flags empty/duplicate/unresolved
  lists, and confirms no online watch monitoring, live tag values, or
  force/edit interaction is attempted.
- Controller EtherNet/IP configuration objects (`<InternetProtocol>`,
  `<EthernetPorts>`, and `<EthernetNetwork>`) are imported/exported as
  model-only controller network metadata. The importer preserves IP/DNS/host
  attributes, Ethernet port enable/auto-negotiate/speed/duplex rows, and
  supervisor ring/VLAN fields. The offline review projection flags malformed
  manual IP settings, invalid IPv4 fields, duplicate ports, invalid speed/duplex
  values, VLAN range issues, and ring timing findings while confirming no IP
  setting apply, network browse, live link state, or diagnostics is attempted.
- Controller last-used communication path metadata (`CommPath` and `CommDriver`)
  is imported/exported as model-only workstation/controller connection metadata.
  The offline review projection flags missing path/driver pairs and malformed
  routed path or driver rows while confirming no path browse, online connection,
  driver validation, download target selection, or controller communication is
  attempted.
- Controller serial communication port configuration (`<CommPorts>` with
  `<SerialPort>`, `<ASCII>`, and `<DF1>` objects) is imported/exported as
  model-only controller configuration metadata. The importer preserves serial
  port attributes and protocol child attributes. The offline review projection
  flags duplicate channels, missing protocol children, and malformed baud/data/
  stop-bit settings while confirming no serial hardware access, DF1 runtime,
  ASCII channel hardware state, live channel status, or controller communication
  is attempted.
- Imported UDT member metadata has an offline layout/display review that shows
  member Radix, ExternalAccess, dimensions, hidden host members, bit-overlay
  Target/BitNumber rows, duplicate host bits, missing targets, non-integer hosts,
  and invalid overlay members while confirming no online data-type edit,
  controller download, memory-layout enforcement, bit-packing execution, or live
  display formatting is attempted.
- Imported UDT definition metadata has an offline family review that shows
  Family values, StringFamily LEN/DATA shape, empty data types, and unrecognized
  family values while confirming no online data-type edit, controller download,
  memory-layout enforcement, custom string runtime layout, or live data-type
  editor behavior is attempted.

## Structure viewers and offline structure editing

- Click an item in the Project Explorer to open a detail view in the center:
  - **Add-On Instruction:** name / description / revision, identity/documentation
    metadata, source-protection/signature review state, a parameters table (name,
    type, usage, required, visible, default, description), local tags, routine names,
    imported unprotected RLL routine metadata, and "Used by" call references
    (click to open the calling routine).
  - **UDT:** description, Family/StringFamily review, members (type, array
    dimension, display metadata, bit-overlay layout metadata, description),
    member access-path previews, and the tags that use the type.
  - **I/O module tree:** modules by slot (name, catalog, vendor/product code,
    revision, keying, inhibit flag, parent module/port, comm path, connection
    metadata, ports, and description) with an offline-only notice. The I/O
    detail view also has a Studio-style searchable Add I/O Device catalog with
    category filters for common ControlLogix/POINT I/O, communication, safety,
    motion, specialty, and generic Ethernet modules. Catalog presets seed
    revision/keying, parent-port, and first connection metadata. A selected-module
    properties editor handles catalog, slot, topology, revision/keying, inhibit,
    description, and first connection metadata. Selected modules can also be
    removed offline, with parent modules protected until their child modules are
    removed. These edits update the offline project model only and still perform
    no controller or module-profile communication.

## HMI View Designer foundation

- Optional HMI project model with target PanelView 5000-style device metadata,
  offline controller-reference synchronization metadata, screens, popups, a
  system banner, shortcuts, assets, add-on graphics, alarm views, diagnostics
  views, trends, data logs, language packs, security roles, and preserved
  unsupported content.
- HMI controller references can snapshot imported/project controller tags,
  program tags, UDT/AOI data types, and ALARM_ANALOG/ALARM_DIGITAL tag rows for
  offline tag browsing. Synchronization states mirror View Designer review
  icons (`not-imported`, `synchronizing`, `synchronized`, `stale`, `conflict`,
  `error`, `unsupported-source`, and `secured`) without claiming live controller
  communication.
- HMI target-device usage/capacity reporting estimates screen count, largest
  surface element count, trend count, data-log count, runtime storage
  (assets/language strings/data-log retention), per-surface scaling, and raster
  scaling risks against the selected PanelView-style profile. The HMI designer
  surfaces the same report as a Usage panel.
- HMI project navigation can be projected into a deterministic route/menu model
  from included screens and shortcuts. It resolves navigate/open-popup command
  intent, groups shortcut folders, tracks omitted screens, missing targets,
  dead-end screens, and active-role security visibility for View
  Designer-style navigation review.
- HMI graphic element registry covers common controls, model-only HMI Button
  Control (HMIBC) metadata, navigation, media, alarm summary, and trend chart
  placeholders. Unsupported vendor elements are preserved read-only.
- HMI verification checks empty/missing surfaces, duplicate screen names,
  missing home screens, invalid element geometry, unsupported/model-only
  elements, invalid graphic layout/style metadata, missing/invalid binding
  target properties, explicitly non-bindable binding targets, binding
  source/type mismatch risks, circular local property-to-property bindings,
  missing tag and system-tag sources, missing event targets, set-tag command
  paths, animation target/source/state table issues, HMIBC controller/feedback/
  status tag configuration, asset/screen/tag-path property references,
  unsupported assets, Add-On Graphic definitions/reusable binding restrictions,
  alarm/diagnostics table metadata,
  navigation/shortcut/popup metadata, target-device capacity/surface
  compatibility, storage estimate overflow, raster scaling risks, trend trace
  sources, and data-log/status tag paths, plus security role
  references/policies, missing/default/duplicate language-pack metadata, and
  missing translated string markers.
- HMI Button Control (HMIBC) elements can produce deterministic offline
  command/feedback/status previews for configured controller, feedback, and
  status tags, including pressed, idle, feedback-active, mismatch, bad-quality,
  and unconfigured states.
- Reusable HMI Add-On Graphic definitions can be created, renamed, resized,
  given vendor/revision metadata, edited for exposed property interfaces,
  populated with elements through `project-actions`, and deleted through the
  same validated action path as screens and popups.
- Offline HMI runtime package build creates a verified save-to-media JSON
  artifact metadata record with target-device snapshot, content checksum, model
  summary, validation summary, model-only upload/download status, and
  deserialize/integrity checks that detect tampering. Package build is blocked
  when HMI verification has errors.
- HMI language packs can be exported/imported as deterministic CSV language
  files with quoted strings, missing-string markers, duplicate-id warnings,
  source/import metadata, and stable checksums.
- HMI content bundles export/import screens, popups, Add-On Graphics, asset
  metadata, and unsupported-content metadata as separate deterministic text
  entries with a manifest and per-file checksums, giving ESCO HMI-style
  content exchange a model-layer baseline. The same content can be exported as
  and imported from folder-style path/text entries, with checksums rebuilt from
  file contents and verified against the manifest.
- HMI runtime-preview sessions model current/previous screen routing, popup
  stack open/close, language changes, offline tag-write previews, data-log
  command previews, hardware/unsupported command blocking, command logs, and
  display/project system-tag values.
- HMI alarm definitions have an offline runtime-preview engine that evaluates
  digital and analog alarm triggers with deadband, tracks active/returned/
  acknowledged/suppressed states, records history and quality changes, and
  exposes ESCO HMI alarm system-tag counts. Alarm runtime data can be
  projected into deterministic summary, manager, and history table rows with
  current metadata and stable sorting.
- Automatic Diagnostics have an offline runtime-preview stream for validation,
  import, runtime, system, and hardware-metadata diagnostics, with de-duplicated
  live events, occurrence counts, clear/resolution history, severity/source
  summary counts, and live/history table rows.
- HMI trend definitions have an offline runtime-preview buffer that records
  sampled trace history, coerces BOOL traces to 0/1, marks missing/bad samples,
  enforces the configured sample rate, and trims points to the configured time
  range. Buffered trends can also render deterministic chart-preview geometry
  with plot bounds, time/value ticks, trace points, colors, and SVG-style paths
  that break across bad/missing samples.
- HMI data-log definitions have an offline runtime-preview buffer that records
  sampled tag rows, marks missing/bad samples, enforces the configured sample
  rate, trims rows to the configured retention window, supports clear, tracks
  status text, and exports deterministic CSV with per-tag quality columns.
  CSV exports can be wrapped in a removable-media save-preview artifact with
  mount/free-space checks, normalized target paths, byte counts, and content
  checksums.
- **Live HMI runtime preview.** A `RuntimeTagProvider` / `SimulatorTagProvider`
  holds typed tag values with quality (good/bad/uncertain) and timestamps,
  seeded from the project's controller references (or demo tags), exposing
  read / write / subscribe / listTags / metadata / reset / dispose. A safe
  expression evaluator (no `eval`) resolves `{Tag}` / `{Program:..}` /
  `{System.*}` references with boolean/comparison/arithmetic operators,
  parentheses, and `if/min/max/clamp/round/formatNumber`, reporting
  missing-tag and syntax diagnostics. A binding engine resolves each object's
  runtime properties (text, value, visible, enabled, fill/stroke/foreground/
  background colors, state, opacity) from tag/expression/system-tag/property
  bindings and color/state-map animations, with per-property quality and
  diagnostics, and live tag subscriptions. A runtime controller ties the
  provider, binding engine, alarm runtime, and trend buffers together and
  executes real operator actions — write/set/toggle/momentary press-release/
  increment/decrement tag writes, navigate/open/close popup, alarm
  acknowledge (selected + all visible), language change, and login/logout —
  all through the model/provider layer with denied-action diagnostics. The HMI
  View Designer can Start/Stop Runtime Preview and Reset Simulator: objects
  render from live values, buttons fire their authored commands, numeric inputs
  write tags, a tag inspector drives values, and a diagnostics/alarm panel
  reflects runtime state. Stopping the preview disposes all subscriptions.
  The preview renders **indicator lamps** (lit from a bound boolean) and
  **multi-state indicators** (caption/color from a state-map binding), draws a
  **live trend chart** as an SVG sparkline from the controller's sampled trend
  buffer (`renderHmiTrendChartPreview` geometry), and offers a **language
  switcher** (`controller.setLanguage`) that re-resolves localized-text bindings
  live. Localized text binds via system-tag paths `Text.<id>`, resolved from the
  current language pack with per-key fallback to the default language
  (`resolveHmiLanguageStrings` / `localizeHmiText`); a missing key surfaces as a
  binding diagnostic.
- **HMI alarm / trend / language authoring.** The designer's left panel authors
  project-level HMI definitions through the reviewed `@esco/project-actions`
  layer: alarms (name, tag path, severity, digital/analog-high/analog-low trigger
  with threshold/deadband, enable toggle — `createHmiAlarmDefinition` /
  `updateHmiAlarmDefinition` / `deleteHmiAlarmDefinition`); trends (name, sample
  rate/window, plus tag-bound pens with auto-assigned colors —
  `createHmiTrendDefinition` / `updateHmiTrendDefinition` /
  `deleteHmiTrendDefinition` / `addHmiTrendPen` / `removeHmiTrendPen`); and
  language packs + localized strings (`createHmiLanguagePack` /
  `deleteHmiLanguagePack` / `setHmiLanguageString` / `removeHmiLanguageString` /
  `setHmiDefaultLanguage`). Every action validates inputs, mutates the project
  immutably, returns a `ProjectActionResult`, and surfaces HMI-validation
  warnings. Authored data is immediately live in the runtime preview: an authored
  alarm activates when its tag crosses the threshold, an authored trend samples
  its pens into the live sparkline, and an authored language appears in the
  preview language switcher and re-resolves localized text live.

## Large projects

- Tag table renders search-first and windows large tag sets (cap with a
  "search to narrow down" notice); derived rows are memoized.
- Routines over 100 rungs use a scroll-windowed editor render path that keeps
  only the visible rung window plus overscan mounted while preserving access to
  the full routine.

## Compare (`@esco/compare`)

- Normalize each routine to canonical neutral text (ids and absolute rung
  numbers dropped) into a full (operand-sensitive) and structure
  (operand-insensitive) fingerprint.
- Compare view: load a second `.plcproj.json` or `.L5X`, then see matched /
  changed / only-in-current / only-in-comparison counts. Routines pair by logic
  fingerprint first, then by name — so renamed routines still match.
- Expand a changed routine for a side-by-side normalized rung diff.

## Find / Search Results

- Search Results performs offline project-wide find across controller metadata,
  tags, tag descriptions, per-element/member tag comments, UDT/member
  descriptions, routine names/descriptions, structured text, rung neutral text
  and comments, HMI screens/popups/banner content, HMI element names/properties,
  HMI bindings/expressions/events, alarms, trends, data logs, language strings,
  security users/roles/permissions, assets, Add-On Graphics, and HMI controller
  reference browser rows.
- Search scopes can be filtered in the pure search API (`controller`, `logic`,
  `tags`, `hmi`, `security`, `assets`). The same layer exposes a safe
  replace-preview report that identifies replaceable text fields and skipped
  read-only/identity matches. The Search Results dock can apply a reviewed
  Replace All to exactly those previewed mutable text fields; component names,
  tag descriptions/comments, rung comments, structured text, HMI captions/text,
  language strings, alarm messages, and similar authored text can change while
  identifiers, tag paths, security permissions, source text, and other
  read-only/identity references stay skipped.

## AI Copilot / assistant surfaces

- The default first-viewport IDE does not mount the retired inline AI chat,
  legacy Copilot tabs, or API-key fields; `ai` and `aiagent` smoke tests guard
  that shell posture.
- The right-side AI Copilot panel remains available from the workbench. Without
  completed setup it cannot transmit project context and instead routes the user
  to settings.
- Assistant planning runs behind an `AssistantProvider` seam
  (local / mock / external). Safe apply paths still require an explicit preview
  and go through `project-actions`; configured external providers require a
  selected model and API key.

## Desktop shell

- Tauri Windows desktop scaffold reuses the web IDE renderer with a desktop-only
  startup window, native Open/Save project file dialogs, a restrictive packaged
  Content-Security-Policy, and a preflight that verifies offline-only controller
  capabilities.
- Packaged desktop builds expose `secure_key_*` commands backed by Windows
  Credential Manager through the Rust `keyring` adapter, so AI API keys can be
  stored outside browser local storage. Browser builds keep the explicit
  local-storage fallback label.

## UI / UX

- Welcome dashboard (action cards, feature & limitation summaries, last-import
  summary, offline notice).
- Title bar with project / routine / validation status, offline badge, and
  Tags / Compare views.
- Bottom dock: Errors · Controller · Search Results · Cross Reference · Build ·
  Task Monitor · Watch · Trend · Forces.
- Properties panel: context-aware detail for controller / program / tag /
  routine / rung / instruction.
- Typed toast system (success / info / warning / error).
- Unsaved-changes indicator (with a close/reload guard) and a crash-safe error
  boundary that keeps a render error from blanking the app.
