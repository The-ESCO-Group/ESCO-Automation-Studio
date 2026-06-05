# ESCO Automation Studio

A Studio 5000-style PLC / automation IDE for ESCO Electric — an **offline**
engineering tool for editing, simulating, validating, and importing ladder
logic. It does **not** communicate with any controller and never touches `.ACD`
files.

## What it supports today

- **Editable ladder logic** stored as a semantic AST (not text).
- **Editable Structured Text source** for imported or newly-created ST routines,
  with conservative structural warnings while typing, project-wide Verify
  diagnostics for the same structural problems, undefined tag/member references,
  obvious array bounds, Studio-style `CASE` immediate selector labels/ranges,
  obvious nonnumeric `CASE` expressions, typed-literal/tag/member selector type
  mismatches, and Studio-style warnings for exact REAL `CASE` selectors,
  plus `.L5X` line-by-line round-trip preservation.
  Offline Simulation now executes a conservative ST subset: scalar/member/array
  assignments including Studio `[ := ]` non-retentive assignment syntax as
  scan-time writes, numeric/boolean expressions with Logix `&`/`AND` semantics,
  simple string relational comparisons inside logical BOOL expressions, nested
  `IF` / `ELSIF` / `ELSE` flow,
  bounded `FOR` / `WHILE` / `REPEAT` loops, `EXIT`, numeric `CASE` selections
  with Studio-style immediate labels/ranges,
  and program-local
  `JSR` / `SBR` / `RET` routine calls with parameter copying. Standalone ST
  calls to registered executable instructions now reuse the shared instruction
  registry and offline tag-memory model, including named argument mapping for
  `Operand := value` / `Operand => tag` forms and omitted trailing optional
  operands, with Verify checks for missing required operands, unknown named
  operands, invalid write targets, and simple alias-resolved tag/member/array
  type mismatches, including `CASE` expressions that resolve to BOOL, STRING,
  or structured values instead of numeric values.
- **Branch editing/import** — build parallel / seal-in branches by hand,
  including **nested** branches (add a parallel branch, add/remove legs, add
  instructions per leg, nest a parallel inside a leg). L5X import preserves
  representable nested branch topology instead of flattening it to a series.
- **Undo / redo** for every project edit (Ctrl+Z / Ctrl+Y), with copy /
  duplicate / paste of rungs.
- **Offline scan-cycle simulation** with a Watch panel (toggle inputs, Scan
  Once / Run / Reset). Array tags (`DINT[n]`, `DINT[n,m]`), structured members,
  imported UDT tag members, and program-scoped tags (`Program:Name.Tag`) are
  watched as individual value paths.
- **Simulator debugging** — an execution **trace** (per-instruction power flow)
  and a **force** table that overrides values for offline what-if testing.
- **Instruction set — executed offline:** bit (XIC, XIO, OTE, OTL, OTU, ONS,
  OSR, OSF),
  timers/counters (TON, TOF, RTO, CTU, CTD, RES), move/compare (MOV, EQU, NEQ,
  GRT, GEQ, LES, LEQ), math/compute (ADD, SUB, MUL, DIV, MOD, SQR, NEG, ABS,
  CPT, CMP, CLR, LIM, MEQ, AND, OR, XOR, NOT), extended/trig math (SIN, COS,
  TAN, ASN, ACS, ATN, LN, LOG, XPY, DEG, RAD, TRN), data movement (COP, CPS,
  FLL, MVM), conversion/bit-position (TOD, FRD, BTD, SWPB, DCD, ENC, DTR),
  file/array (AVE, STD, SRT, FAL, FSC, SIZE, FFL, FFU, LFL, LFU, FBC, DDT),
  sequencer (SQO, SQI, SQL), bit shift (BSL, BSR),
  string/ASCII operations (CONCAT, DELETE, FIND, INSERT, LEFT, LEN, MID, RIGHT,
  LOWER, UPPER, ACI, ACB, AEX, ASC, ABL, ACL, ACN, ARD, ARL, ASR, AWA, AWT,
  DTOS, RTOS, STOD, STOR),
  and program/routine control (JSR, SBR, RET, TND, JMP, LBL, FOR, BRK, MCR, IOT, NOP, AFI).
- **Registered model-only** — parsed, rendered, validated (as info), and
  round-tripped on export, but **not** simulated: ASCII hardware handshake
  (`AHL`), process control (PID, PIDE, …), GuardLogix safety, and
  message/alarm/motion (MSG, GSV, SSV, ALMx, MSO…).
  Model-only instructions expose deterministic review-state metadata for the
  IDE: operand roles/directions, missing required operands, pass-through rung
  behavior, and explicit boundaries such as no controller communication, no MSG
  execution/CIP connection/remote data transfer/status updates, no GSV/SSV
  controller object attribute read/write, no tag memory access, no PID
  algorithm/PV sampling/CV output, no loop update scheduling, no process
  status/alarm updates, no manual/cascade/tieback handling, no closed-loop
  tuning, no signal-conditioning/totalizer calculation, no motion
  command/planner execution, no axis-state, drive-command, motion-feedback,
  coordinate/group, or cam/gear runtime effects, no safety/alarm evaluation, no
  serial port access, no ASCII handshake line read/write, no AHL mask
  application, no serial control/status update, and no SFC/PhaseManager state
  engine.
  PID/PIDE and loop/scaling/totalizer blocks also have a project-level process
  loop review that resolves block tags, PV/CV references, qualified
  `Program:Name.Tag` paths, missing imports, and type mismatches while keeping
  closed-loop execution explicitly unmodelled.
  PhaseManager instructions (`PATT`, `PCMD`, `PXRQ`, …) also have a project-level
  equipment phase review that resolves `EQUIPMENT_PHASE` and
  `PHASE_INSTRUCTION` tags, qualified `Program:Name.Tag` paths, missing imports,
  and type mismatches while keeping the phase state engine, command arbitration,
  ownership transfer, batch sequencer requests, and parameter transfer
  unmodelled.
  GuardLogix safety partitions have a project-level safety metadata review that
  surfaces imported task/program/tag/AOI `Class` metadata, safety instruction backing
  tags, missing imports, standard-vs-safety wiring findings, and validator-backed
  safety/standard program task-partition mismatches while keeping realtime safety
  task scheduling, signatures, lock state, memory partition enforcement, and
  safety evaluation unmodelled.
  Project-defined AOI calls are recognized; unprotected imported RLL AOI routines
  execute offline against AOI instance parameter/local member paths, including
  nested AOI calls through AOI-local instance tags, while protected or non-ladder
  AOI logic stays model-only. AOI detail views now use the same execution-review
  policy as the simulator: source-protected AOIs are metadata-only, signatures
  are display-only, `Logic` is the preferred offline scan body, the first ladder
  routine is the fallback, and Prescan/Postscan/EnableInFalse plus ST/FBD/SFC
  routines are preserved read-only.
  AOI ladder-body validation also flags Studio-unavailable instructions such as
  JSR/SBR/RET, FOR/BRK, IOT, EVENT, SFC reset/pause, selected PhaseManager
  commands, and MAOC inside unprotected AOI definitions, and checks that
  identifiable MSG, ALMA/ALMD, and motion-control data instances are InOut
  parameters when used inside an AOI. It also validates AOI-local GSV/SSV
  object-class restrictions, including GSV-only classes and required `THIS`
  instance names for programming-component classes. AOI capacity validation
  checks Studio 5000 limits for Input/Output parameters plus local tags, InOut
  parameter counts by authored software revision, and nested AOI call depth.
  AOI local-tag validation also rejects Studio-forbidden MESSAGE, MODULE, alarm,
  motion/object local tag types and multi-dimensional local-tag arrays.
  AOI identity/documentation metadata can also be projected for offline review:
  revision/vendor/signature, authoring history, help text, scan-mode flags, and
  Safety/Standard class are visible without verifying signatures, bypassing
  source protection, driving scan-mode execution, or enforcing safety partitions.
  AOI call-interface review keeps imported Required and instruction-face Visible
  flags independent, so hidden required parameters and visible optional
  parameters stay distinct in offline review.
  MESSAGE control tags expose common status/configuration members for offline
  watch/review, and MSG/GSV/SSV operands cross-reference their real tag operands
  without treating class/attribute keywords as tags; MSG never communicates,
  opens a CIP message connection, transfers remote data, or updates MESSAGE
  control status, and GSV/SSV never read or write controller object attributes.
  Unknown vendor instructions are preserved read-only and pass through the
  simulator unchanged.
- **Task, multi-routine, and program flow** — offline scans run imported
  task-scheduled programs' main routines by default, preserving each program's
  local tag image separately; JSR runs a subroutine against shared tags, SBR
  receives Studio-style input parameters, RET copies return parameters and exits
  early, JMP/LBL skip within a routine, and FOR/BRK runs bounded routine loops;
  MCR zones scan disabled rungs with false power. Logic can read qualified
  program-scope paths such as `Program:OtherProgram.Tag` in operands and
  CPT/CMP expressions. IOT validates and preserves immediate-output calls as an
  offline no-op because there is no delayed hardware output image to flush.
  Runtime guards protect against runaway recursion, jumps, and loop counts.
  Imported task schedules can also be projected into an offline controller/task
  status report that shows which main routines will scan, duplicate scheduled
  routines, inhibited tasks/programs, missing programs/main routines, non-ladder
  main routines, watchdog metadata, and DisableUpdateOutputs metadata. Offline
  validation also flags hand-edited continuous tasks that set
  DisableUpdateOutputs, which Studio 5000 only allows on PERIODIC or EVENT
  tasks, flags redundancy-enabled controllers that still carry a CONTINUOUS
  task, and enforces Logix task capacity limits: 32 tasks per controller and
  32 scheduled programs per task, or 1000 for imported ControlLogix/SoftLogix
  controllers, without claiming realtime task pre-emption or controller fault
  words.
  EVENT task trigger metadata can also be projected into an offline event-task
  review that surfaces EventTrigger/Tag bindings, unresolved trigger tags, and
  explicit boundaries for controller event scheduling, module state-change
  monitoring, and consumed-tag trigger transfer.
- **Program interface review** — imported program parameters (`Input`, `Output`,
  and `InOut`) can be projected for offline review, including required/default,
  dimension, radix, external-access, and malformed-interface findings.
  Controller `ParameterConnections` are also preserved and projected into an
  offline cross-program endpoint review while runtime parameter transfer and
  controller-verified connections remain explicitly unmodelled.
- **Controller properties review** — imported controller identity, catalog,
  firmware, chassis/slot, System Overhead Time Slice, ShareUnusedTimeSlice, and
  redundancy settings, including front-port crossload metadata, can be projected
  for offline review, with missing identity, invalid percentage metadata, or
  malformed crossload flags flagged while firmware compatibility, status words,
  system-overhead scheduling, redundancy switchover, and front-port crossload
  remain unmodelled.
- **Controller ReportMinorOverflow review** — imported `ReportMinorOverflow`
  metadata can be projected for offline review, with malformed true/false or
  1/0 flags identified while arithmetic-overflow minor-fault generation,
  minor-fault status, controller fault logs, and download preflight remain
  unmodelled.
- **Controller project-matching review** — imported `MatchProjectToController`
  `ProjectSN`, and `InhibitAutomaticFirmwareUpdate` metadata can be projected
  for offline review, with partial or malformed flags and mismatched serial
  metadata identified while controller serial-number matching, download
  preflight, firmware updates, and controller replacement workflows remain
  unmodelled.
- **Controller documentation review** — imported project documentation language
  metadata (`CurrentProjectLanguage`, `DefaultProjectLanguage`, and
  `ControllerLanguage`) plus pass-through/download settings can be projected for
  offline review, with partial or malformed download flags identified while
  language merge, controller pass-through storage, and documentation download
  remain unmodelled.
- **Controller audit timestamp review** — imported `ProjectCreationDate` and
  `LastModifiedDate` metadata can be projected for offline review, with partial
  timestamp pairs flagged while controller audit-log reads, project history
  synchronization, timestamp verification, and controller downloads remain
  unmodelled.
- **Controller WallClockTime review** — imported controller wall-clock metadata
  (`LocalTimeAdjustment` and `TimeZone`) can be projected for offline review,
  with partial or malformed offsets flagged while controller clock read/set,
  time synchronization, and wall-clock runtime behavior remain unmodelled.
- **Controller TimeSynchronize review** — imported CIP Sync / IEEE 1588
  metadata (`PTPEnable`, `Priority1`, and `Priority2`) can be projected for
  offline review, with partial or malformed PTP priority metadata flagged while
  controller clock synchronization, grandmaster election, and time-quality
  runtime behavior remain unmodelled.
- **Controller CST review** — imported Coordinated System Time metadata
  (`CST MasterID`) can be projected for offline review, with missing or malformed
  master IDs flagged while CST clock coordination, master election, chassis time
  synchronization, and live time status remain unmodelled.
- **Controller SafetyInfo review** — imported GuardLogix `SafetyInfo` metadata
  (`SafetyEnabled`, `SafetyLocked`, `SafetySignatureID`,
  `SafetySignatureTimestamp`, `SignatureRunModeProtect`,
  `ConfigureSafetyIOAlways`, and `SafetyLevel`) can be projected for offline
  review, with partial, malformed enable flag, missing-signature, and
  signature/timestamp pairing findings flagged while safety signature
  verification, enable/disable, lock/unlock, safety I/O configuration, and
  controller safety status remain unmodelled.
- **Controller Security review** — imported controller `<Security>` metadata
  (`Code`, `ChangesToDetect`, `SecurityAuthorityID`, and
  `SecurityAuthorityName`) can be projected for offline review, with partial
  change-detection and FactoryTalk authority findings flagged while permission
  enforcement, source-protection enforcement, FactoryTalk authentication,
  change monitoring, and controller audit-log writes remain unmodelled.
- **Controller SFC execution review** — imported `SFCExecutionControl`,
  `SFCRestartPosition`, and `SFCLastScan` metadata can be projected for offline
  review while SFC step execution, transition evaluation, restart state,
  last-scan behavior, and controller-verified SFC scheduling remain unmodelled.
- **Equipment phase review** — imported PhaseManager instructions can be
  projected for offline review, including `EQUIPMENT_PHASE`/`PHASE_INSTRUCTION`
  target resolution, program-qualified operands, missing imported phase objects,
  and type mismatches while the PhaseManager state engine remains unmodelled.
- **GuardLogix safety metadata review** — imported Safety/Standard `Class`
  metadata on tasks, programs, tags, and AOIs plus model-only safety-instruction
  backing tags can be projected for offline review, with missing tags,
  standard-tag safety block wiring, and safety/standard program task-partition
  scheduling mismatches flagged while safety signatures, lock/unlock, realtime
  safety task scheduling, and safety evaluation remain unmodelled.
- **Fault-handler review** — imported controller fault handlers, power-up
  handlers, and program fault routines are projected for offline review:
  controller handlers resolve to imported handler programs with main routines,
  program fault routines resolve by routine id, and missing, dangling,
  ambiguous, or non-ladder bodies are identified while automatic fault dispatch
  and controller fault words remain explicitly unmodelled.
- **Validation engine** (undefined tags, type mismatches, missing operands,
  unsupported instructions, unresolved JMP/LBL labels, array index bounds,
  integer tag/member and bounded expression indirect subscripts, unknown members,
  double-coil, duplicate tags, alias-target and unknown-routine resolution;
  program-scope shadowing; safety task/program partition constraints;
  controller fault/power-up handler program references;
  continuous-task output-update and redundancy constraints; Logix
  task/scheduled-program capacity constraints; I/O module parent, slot conflict,
  chassis-size, keying, and connection-RPI checks; AOI body instruction
  restrictions, data-instance InOut checks, AOI-local GSV/SSV class checks, and
  AOI capacity/nesting and local-tag type limits).
- **Project persistence** — versioned `.plcproj.json` (format v2 + migrations),
  browser autosave / recovery, an unsaved-changes guard, and a crash-safe error
  boundary.
- **Studio 5000 L5X import/export** (parallel/nested branch structures,
  member/array paths, multi-dimensional array metadata,
  descriptions, alias and unmodeled-type warnings, located warnings, import
  summary). Export is generated offline for review only and round-trips
  controller/program/routine logic (ladder + Structured Text; FBD/SFC bodies
  preserved as read-only imported XML), tags (including role / external-access
  metadata and produced/consumed connection settings), program metadata
  (parameters, inhibit, fault routine), controller SFC execution-control,
  GuardLogix SafetyInfo, controller Security, WallClockTime, TimeSynchronize,
  CST, project-matching/firmware-update flags, ReportMinorOverflow, controller
  redundancy front-port crossload metadata, communication path/driver metadata,
  project audit timestamps, and project documentation language/download metadata,
  UDTs (including Family/StringFamily metadata, member radix, ExternalAccess,
  dimensions, and bit-overlay layout metadata), Add-On Instruction definitions, I/O module
  identity/revision/port metadata, and tasks with scheduling metadata.
  Program parameters can also be projected into an offline interface review for
  `Input`/`Output`/`InOut` metadata, and controller `ParameterConnections`
  round-trip through import/export with a review projection for malformed,
  unresolved, duplicate, same-endpoint, and incompatible endpoint pairs without
  creating controller-verified program connections or runtime transfer.
  EVENT task `EventInfo` metadata can be projected into an offline trigger
  review, including `EnableTimeout`, without arming controller event tasks,
  dispatching EVENT instructions, or modelling timeout/watchdog behavior.
  Produced/consumed tags can also be projected into an offline connection review
  that flags program-scoped roles, missing consumed producer bindings, invalid
  consumed RPIs, invalid produced consumer counts, controller
  `CanUseRPIFromProducer` / `CanUseRPIFromController` source flags, and
  conflicting roles without opening any controller connection or scheduling RPI
  negotiation.
  I/O modules can be projected into an offline module review that surfaces
  catalog/revision/keying, inhibit and MajorFault settings, parent module/port
  topology, duplicate slots, and port/bus metadata without opening module
  connections or enforcing electronic keying. The IDE can also add common I/O
  device records locally under I/O Configuration through a searchable offline
  module catalog covering common ControlLogix/POINT I/O, communication, safety,
  motion, specialty, and generic Ethernet entries. Catalog presets seed revision,
  keying, parent-port, and first connection metadata, giving engineers a visible
  offline module tree builder plus a selected-module properties editor for
  catalog, slot, parent/port/path, revision, keying, inhibit, description, and
  first connection metadata; modules can also be removed offline with child
  topology protection, without contacting hardware or module profiles.
  Module connection metadata can also be projected into an offline connection
  review that surfaces connection name/type, requested packet interval,
  scheduling priority, EventID, unicast settings, duplicate names, and malformed
  connection metadata without opening a module connection, scheduling RPI
  updates, dispatching event-triggered connections, or applying connection
  priority scheduling.
  Controller Trend definitions can be imported/exported and projected into an
  offline review that preserves trend attributes, the TrendX template payload,
  pen display metadata, sample/capture settings, and trigger fields while
  keeping online trend execution, controller sampling, trend logs, and sampled
  data export explicitly unmodelled.
  Controller Quick Watch Lists can also be imported/exported and projected into
  an offline review that preserves list names, watch tag specifiers, program/AOI
  scopes, and extra attributes while keeping online watch monitoring, live
  values, and force/edit interaction explicitly unmodelled.
  Controller EtherNet/IP configuration objects (`InternetProtocol`,
  `EthernetPorts`, and `EthernetNetwork`) can be imported/exported and projected
  into an offline review for IP/DNS/host metadata, port enable/speed/duplex
  rows, and ring/VLAN supervisor settings while keeping IP setting apply,
  network browse, live link state, and diagnostics explicitly unmodelled.
  Controller last-used communication path metadata (`CommPath` and `CommDriver`)
  can be imported/exported and projected into an offline review for path/driver
  pairing, routed-path shape, and explicit no-online boundaries while keeping
  path browsing, driver validation, online connection, and download target
  selection unmodelled.
  Controller serial communication port configuration (`CommPorts` /
  `SerialPort` with `ASCII` and `DF1` child objects) can also be
  imported/exported and projected into an offline review for baud/data/stop-bit,
  control-line, channel, and protocol metadata while keeping serial hardware
  access, DF1 runtime, ASCII channel hardware state, and live channel status
  explicitly unmodelled.
  UDT member metadata can be projected into an offline layout/display review
  for member Radix, ExternalAccess, array dimensions, hidden host members, and
  Logix bit-overlay Target/BitNumber rows without enforcing controller memory
  layout, bit packing, online data-type edits, or live display formatting. Tag,
  routine, program, task, controller, UDT member, and AOI parameter/local-tag
  edit actions reject Studio-invalid Logix identifier shapes before mutation.
  UDT definition metadata can also be projected into an offline family review
  for `NoFamily`, `StringFamily`, empty data types, and custom STRING
  `LEN`/`DATA` shape without enforcing controller memory layout, custom string
  runtime layout, online data-type edits, or controller downloads.
  Unsupported instructions are preserved read-only.
- **Structure viewers** — click an Add-On Instruction, UDT, or I/O module in the
  explorer for a detail view: AOI parameters with Required/Visible
  interface metadata / local tags / routines / call references; UDT definition family review, UDT members (with array dims,
  display metadata, and layout review state) + member paths + tags using it;
  the I/O module tree by slot, revision, keying, connection metadata, and ports,
  plus an offline searchable Add I/O Device catalog, selected-module properties
  editor, and guarded offline module removal for common module records.
- **HMI View Designer foundation** — optional HMI project model with screens,
  popups, a system banner, graphic element registry, bindings/events, model-only
  alarms/trends/data logs, offline controller-reference synchronization
  metadata with tag/data-type/alarm browser rows, and verification for missing
  tags/system tags,
  invalid graphic layout/style metadata, invalid binding targets, binding type
  risks, circular property bindings, event tag commands, animation sources/state
  tables, HMIBC/Button Control tag references and offline command/feedback
  preview, asset/screen/tag-path property references, Add-On Graphic
  definitions/reusable binding restrictions, alarm/diagnostics table metadata,
  navigation/shortcut/popup metadata, target-device capacity/surface
  compatibility, usage/capacity reporting, storage estimates, raster scaling
  risks, trend/data-log references, security role references/policies, and
  language-pack/default-language issues, plus offline runtime-package
  verification/build/save metadata with checksum, tamper checking, and
  model-only transfer status. Language packs can be exported/imported as
  deterministic CSV files with missing-string markers and import metadata.
  HMI screens, popups, Add-On Graphics, asset metadata, and unsupported-content
  metadata can be exported/imported as deterministic text bundle entries with
  manifest checksums, including folder-style path/text import-export.
  Reusable Add-On Graphic definitions have validated action-layer create/edit/
  delete support for metadata, size, exposed properties, and contained elements.
  Runtime-preview sessions model screen navigation, popup open/close,
  language changes, tag-write previews, data-log commands, command blocking,
  and current/previous screen system tags.
  Project navigation can be projected into a security-aware route/menu model
  from screens and shortcuts, including shortcut folders, omitted screens,
  missing targets, and dead-end screens.
  Alarm definitions have an offline runtime-preview engine for active/returned,
  acknowledge, suppress/unsuppress, history, quality, system-tag counts, and
  summary/manager/history table rows.
  Automatic Diagnostics have an offline live/history runtime stream for
  validation, import, runtime, system, and hardware-metadata diagnostics.
  Trend definitions have an offline runtime-preview buffer for sampled trace
  history with sample-rate and time-window trimming plus deterministic chart
  preview geometry; data logs have an offline runtime-preview buffer with
  retention trimming, clear, status, CSV export, and removable-media save
  preview metadata.
- **Large-project handling** — search-first windowed tag table and
  scroll-windowed rendering for very large ladder routines.
- **Tag table editor** — create / rename / dimension / ExternalAccess /
  Constant / describe / delete tags. Tag creation and retyping resolve Logix
  scalar types, predefined structured/model-only types, project UDTs, and AOIs
  before mutation, rejecting unknown types instead of creating unverifiable tag
  declarations. The IDE create row can create controller tags or program-scoped
  local tags by selecting a real target program; program-scoped creation enforces
  duplicate names within the relevant Logix scope, so same-named local tags in
  different programs remain valid. Tag-table edits pass the selected
  controller/program scope into the action layer, so description, dimensions,
  data type, metadata, alias, delete, and rename operations update the intended
  Studio tag row and remap references with local-tag precedence. Imported Logix per-element/member
  comments are searchable and visible as compact `Tag.Member` / `Tag[index]`
  previews. Imported
  per-element/member engineering units can also be projected
  for offline review, including duplicate operands, blank unit text, invalid
  member paths, and array-index findings without modelling unit conversion,
  online tag-property edits, controller downloads, or live display formatting.
- **Cross reference** — where each tag is read / written, including tag paths
  inside CPT/CMP expressions.
- **Find / Search Results** — offline global search across controller metadata,
  tags/comments, routines/rungs, HMI screens/elements/bindings/events, alarms,
  trends, data logs, languages, security, assets, reusable graphics, and HMI
  controller references, plus reviewed Replace All for previewed mutable text
  fields while identifiers, tag paths, and read-only source stay skipped.
- **Routine & project compare** — match routines by logic fingerprint (not just
  names) and see identical / changed / only-in-either, with side-by-side diffs.
- **AI assistant** — offline rule-based assistant by default, plus an optional
  external provider seam that runs an injected model caller through the same
  safe tool-use loop. All changes remain previewable plans applied only through
  the controlled action layer.

## Requirements

- Node.js >= 20 (developed on Node 24)
- pnpm 9 (via Corepack: `corepack pnpm ...`)

## Commands

```bash
corepack pnpm install        # install dependencies
corepack pnpm -r typecheck   # type-check every package
corepack pnpm test           # run the Vitest suite
corepack pnpm dev            # start the web IDE (http://localhost:5173)
corepack pnpm e2e            # browser smoke tests (needs dev server running)
```

> If `pnpm` is on your PATH you can drop the `corepack` prefix.

## Run the demo

1. `corepack pnpm dev`, open http://localhost:5173.
2. The **Welcome dashboard** lists what the tool does and quick actions.
3. Click **Open Demo Routine** → toggle `StartPB` in **Watch** → **Scan Once** →
   `MotorRun` energizes (seal-in starter).
4. See [`docs/demo-script.md`](docs/demo-script.md) for the full walkthrough.

## Architecture summary

A pnpm monorepo built in dependency order; React lives only in `apps/web`.

```text
core → ladder → instructions → simulator → validator
                              → project-store → parser-l5x → project-actions → ai-assistant
apps/web depends on the packages above (never the reverse).
```

- `packages/core` — PLC domain model + data-type catalog.
- `packages/ladder` — semantic ladder AST + immutable edits.
- `packages/instructions` — instruction registry (single source of metadata).
- `packages/simulator` — scan-cycle runtime.
- `packages/validator` — rule-based validation.
- `packages/project-store` — `.plcproj.json` serialize/deserialize.
- `packages/parser-l5x` — Studio 5000 L5X import and review-only export.
- `packages/project-actions` — **the only sanctioned way to mutate a project**
  (typed, immutable, validated). See [`docs/project-actions.md`](docs/project-actions.md).
- `packages/ai-assistant` — offline assistant. See [`docs/ai-assistant.md`](docs/ai-assistant.md).
- `apps/web` — React + Vite IDE shell.

Full detail: [`docs/current-architecture.md`](docs/current-architecture.md),
features: [`docs/current-features.md`](docs/current-features.md).

## Safety / limitations (offline by default)

- **No PLC / controller communication, download, or online editing.**
  Studio-style communication commands are visible only through the guarded
  controller-command layer: Network Browser, Select Recent Path, Go Online,
  Monitor, Upload, Download, Online Edit, Program Mode, Run Mode, Test Mode,
  Lock Controller, Clear Faults, and Go To Faults all return blocked audit
  entries unless a future verified real transport exists. Go Offline remains a
  safe local lifecycle transition back to Offline Simulation.
- **No `.ACD` compile/decompile** — only `.plcproj.json` (read/write) and
  review-only `.L5X` import/export.
- **AI is offline/local by default** and changes the project only through
  `packages/project-actions`, only on explicit Apply.
- **Optional opt-in online AI agent** (Claude `claude-opus-4-7`): off by default,
  uses your own API key via browser-local storage, Windows Credential Manager in
  packaged desktop builds, or a server proxy with an env key — no key is bundled
  or committed. When enabled, it sends your prompt and project context to the
  provider. It still edits only by proposing actions you Apply through
  `project-actions`; it has no PLC/.ACD/file access. See
  [`docs/online-ai-safety.md`](docs/online-ai-safety.md).
- **Not a replacement for Studio 5000** — an offline engineering/simulation aid.

Full list: [`docs/limitations.md`](docs/limitations.md). Online AI safety:
[`docs/online-ai-safety.md`](docs/online-ai-safety.md). Roadmap:
[`docs/roadmap.md`](docs/roadmap.md).

## Architecture rules

- The UI must not own the PLC model — it lives in `packages/core`.
- All project mutations go through `packages/project-actions`.
- The semantic ladder AST and the instruction registry are the sources of truth.
