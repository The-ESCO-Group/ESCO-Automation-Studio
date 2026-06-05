# Current Limitations

ESCO Automation Studio is an **offline engineering and simulation tool**. The
following are intentional boundaries and known gaps.

## Safety boundaries (by design)

- **No real PLC / controller communication.** It cannot connect to, browse, or
  exchange data with any controller.
- **Offline Simulation is the default controller mode.** The controller-session
  state machine distinguishes Offline Simulation, Model-only Review,
  Disconnected, Connection Disabled, Controller Link Unavailable, Faulted, and
  Safety Blocked states. The UI must not say "Connected" unless a future
  verified real transport reports a supported live session.
- **No online edits, uploads, downloads, hardware Go Online, controller mode
  changes, controller locking, or fault clearing.** Commands that resemble
  controller access are routed through `@esco/controller-comm`, including Go
  Online, Monitor, Upload, Download, Online Edit, Network Browser, Select Recent
  Path, Program Mode, Run Mode, Test Mode, Lock Controller, Clear Faults, and Go
  To Faults. They return a blocked result with a reason and record an audit
  event. Go Offline only returns the local session to Offline Simulation. Nothing
  is ever sent to hardware in this build.
- Produced/consumed tag metadata is imported, exported, validated, and reviewable
  offline, including invalid consumed-tag RPI findings and controller
  `CanUseRPIFromProducer` / `CanUseRPIFromController` source-flag findings, but
  no producer/consumer controller connection, remote browse, data transfer, RPI
  negotiation, or RPI scheduling is attempted.
- I/O module metadata is imported, exported, reviewable, and locally addable
  offline, including parent topology, ports, keying, inhibit, bus size,
  MajorFault settings, and module connection metadata such as connection
  name/type/RPI/priority/EventID/unicast settings. Offline validation can flag
  missing parent bindings, duplicate slots, slots outside a known chassis/bus
  size, invalid electronic-keying values, and invalid module connection RPIs. The
  Add I/O Device catalog can create common module records in the project tree
  using searchable/category-filtered offline presets and default first-connection
  metadata, and the selected-module properties editor can update catalog, slot,
  topology, revision/keying, inhibit, description, and first connection metadata.
  Selected modules can be removed offline with parent/child topology protection,
  but no module connection, RPI scheduling, connection priority scheduling,
  event-triggered connection dispatch, unicast/multicast enforcement, topology
  browse, electronic-keying enforcement, module profile download, or controller
  major-fault injection is attempted.
- **No `.ACD` compile / decompile or editing.** `.ACD` is Rockwell's proprietary
  binary controller-project format and can only be opened or written by licensed
  Studio 5000 Logix Designer tooling. ESCO never reads, writes, compiles,
  decompiles, or converts `.ACD` files, and never fakes one on export. Instead it
  provides a complete, honest **ACD compatibility layer**: selecting an `.ACD`
  (or a compressed ACD archive, a legacy `.L5K`, or a mislabelled binary) for
  import is detected *before any parse* (`@esco/parser-l5x` `parseL5X` guard and
  `@esco/project-actions` `detectUnsupportedProjectFormat`) and surfaced in a
  professional compatibility modal — format, why it is blocked, the supported
  offline formats, and the exact next step — with **Import L5X instead**,
  **Compatibility notes**, and **Cancel** actions. Export targets are guarded too
  (`detectUnsafeExportTarget`), so an `.acd` save is refused rather than written
  as a renamed file. The tool only reads `.L5X` (XML) and reads/writes its own
  `.plcproj.json`. The in-memory project records honest **provenance** (source
  type, file name, path, timestamp, and any blocked `.ACD` attempt), visible in
  Project Properties → Source and Help → About → ACD project compatibility. To
  bring an `.ACD` into ESCO, open it in Studio 5000 and export it to `.L5X` first.
- The AI assistant has **no hardware access** and changes the project **only**
  through `packages/project-actions`, only after explicit user Apply.
- **Online readiness is scaffolding and safety gates only — not online support.**
  `@esco/controller-comm` now models a future read-only online mode: a
  transport/provider honesty contract (`realControllerIo` + `verified`), an
  abstract read-only controller transport base, a monitor-state readiness matrix,
  and a staged online-readiness report. None of it is a real controller link. No
  concrete or verified physical transport ships, so every real Go Online, Monitor,
  upload, download, and online-edit command stays blocked, and a regression test
  fails if any shipped transport reports `verified: true`. The only `verified`
  provider is the in-process ESCO SoftController (software only,
  `realControllerIo: false`); it never touches hardware. Reaching real online use
  still requires a verified physical transport that does not exist in this build.

## Functional gaps

- **L5X export is review-only.** The app can generate a best-effort `.L5X` from
  the ESCO model, but it is not controller-verified, not a replacement for a
  Studio 5000 export, and it never overwrites the imported source file.
- **Instruction set is growing but partial.** Executed offline: bit (XIC/XIO/
  OTE/OTL/OTU/ONS/OSR/OSF), timers/counters (TON/TOF/RTO/CTU/CTD/RES), move/math/compute
  (MOV/COP/CPS/FLL/MVM/ADD/SUB/MUL/DIV/MOD/SQR/NEG/ABS/CPT/CMP/CLR), bitwise
  (AND/OR/XOR/NOT), extended/trig math (SIN/COS/TAN/ASN/ACS/ATN/LN/LOG/XPY/DEG/
  RAD/TRN), compare (EQU/NEQ/GRT/GEQ/LES/LEQ/LIM/MEQ), conversion/bit-position (TOD/FRD/BTD/SWPB/DCD/ENC/DTR),
  file/array (AVE/STD/SRT/FAL/FSC/SIZE/FFL/FFU/LFL/LFU/FBC/DDT), sequencer
  (SQO/SQI/SQL), shift (BSL/BSR), string/ASCII
  (CONCAT/DELETE/FIND/INSERT/LEFT/LEN/MID/RIGHT/LOWER/UPPER/ACI/ACB/AEX/ASC/
  ABL/ACL/ACN/ARD/ARL/ASR/AWA/AWT/DTOS/RTOS/STOD/STOR),
  and program/routine control (JSR/SBR/RET/TND/JMP/LBL/FOR/BRK/MCR/IOT/NOP/AFI).
  **Registered model-only** (parsed, rendered, validated as info, and
  round-tripped on export, but not simulated): ASCII hardware handshake (AHL),
  process control (PID/PIDE and the loop/scaling/totalizer family),
  GuardLogix safety, and message/alarm/motion
  (MSG/GSV/SSV/ALMx/MSO…). The remaining gap is making those families
  controller/firmware-faithful *executable*, not registering them or exposing
  their review state. Model-only review projection now reports declared operand
  roles/directions, missing required operands, pass-through rung behavior, and
  explicit no-runtime boundaries for communication, MSG execution/CIP
  connections/remote transfer/status updates, GSV/SSV controller object
  attribute read/write, tag-memory access, process/motion/safety/alarm behavior,
  including PID algorithm execution, PV sampling, CV output, loop update
  scheduling, process status/alarm updates, manual/cascade/tieback handling,
  closed-loop tuning, signal-conditioning/totalizer calculations, motion
  planner, axis-state, drive-command, feedback, coordinate/group, cam/gear, and
  event/watch/registration effects, serial ports, AHL DTR/RTS-style handshake
  line read/write, mask application, serial control/status updates, SFC, and
  PhaseManager.
  PID/PIDE and loop/scaling/totalizer blocks have an offline process-loop review
  report for imported block tags and PV/CV references, but no PID/PIDE
  algorithm, process calculation, status/alarm bit update, runtime tag write,
  or controller-period/watchdog behavior is simulated.
  PhaseManager/equipment-phase instructions have an offline review report for
  `EQUIPMENT_PHASE` and `PHASE_INSTRUCTION` operands, but phase state
  transitions, command arbitration, ownership transfer, batch sequencer
  requests, runtime phase parameter transfer, and controller-verified phase
  scheduling are not simulated.
  GuardLogix safety `Class` metadata and safety-instruction backing tags have an
  offline review report, and validation catches safety/standard program
  schedules that cross the task partition, but realtime safety task scheduling,
  safety signatures, lock/unlock state, memory partition enforcement, controller
  safety status, and actual safety instruction evaluation are not simulated.
  MESSAGE control tag members are modelled for offline review, and MSG/GSV/SSV
  cross-reference real tag operands while ignoring object/attribute keywords,
  but no MSG execution, CIP connection, remote data transfer, MESSAGE control
  status update, GSV object-attribute read, or SSV object-attribute write is
  attempted.
- **Structured Text execution is partial.** Imported and new ST routines can be
  edited in the IDE, receive conservative structural warnings in the editor plus
  structural, undefined-reference, member-path, and obvious array-bound
  diagnostics in project-wide Verify, and round-trip through `.L5X`. Offline
  Simulation executes only a conservative subset today: scalar/member/array
  assignments, Studio `[ := ]` non-retentive assignment syntax as ordinary
  scan-time writes, shared numeric/boolean expressions with Logix `&`/`AND`
  semantics, string literal assignment, simple string relational comparisons
  inside logical BOOL expressions,
  nested `IF` / `ELSIF` / `ELSE` flow, bounded `FOR` / `WHILE` / `REPEAT`
  loops, `EXIT` from the nearest loop, numeric `CASE` selections with
  Studio-style immediate labels/ranges, and
  program-local `JSR` / `SBR` / `RET` routine calls into sibling ST or ladder
  routines with input/return parameter copying. Standalone calls to registered
  executable instructions run through the same offline instruction registry used
  by ladder simulation, including positional and named-argument call forms; Verify
  checks registered ST calls for required operands, unknown named operands, invalid
  expression operands, invalid write targets, and tag/member/array type mismatches
  through aliases, predefined structures, UDTs, AOI instance members, and
  program-qualified paths, and it flags `CASE` labels that are not immediate
  numeric values or ranges plus `CASE` expressions that clearly resolve to
  BOOL, STRING, or structured values. It also catches obvious selector type
  mismatches for known numeric CASE expression tags, members, or typed literals,
  such as REAL selector labels under an integer expression or typed integer
  labels under a REAL expression, and warns when known REAL expressions use
  exact selector values instead of ranges. Full Logix ST semantics — model-only instruction
  family execution, remaining CASE selector coercion/fault edge cases, `[ := ]`
  RUN-mode/SFC automatic-reset clearing behavior,
  prescan/postscan behavior, fault/status behavior, and firmware-specific type conversion —
  remain unmodelled. FBD and SFC routines remain preserved read-only views.
  Controller/program fault-handler references are also reviewable offline:
  controller fault and power-up handlers resolve to handler programs with main
  routines, and program fault routines resolve by routine id, but controller
  fault dispatch, power-up events, program fault dispatch, and live fault/status
  words are not simulated.
  Truly unknown vendor instructions are **preserved read-only** and pass through the simulator.
- **Nested branch import is improved but still bounded by the current AST.**
  You can build parallel/seal-in branches by hand (add branch, add/remove legs,
  add instructions per leg) *and* nest a parallel inside a leg. L5X import now
  preserves representable nested branch paths in the ladder AST and simulator.
  Branch shapes where every parallel leg has a private continuation cannot yet
  be represented faithfully, so those still flatten to a series with a warning.
- **Local / rule-based AI by default.** Intent matching is keyword-based and runs
  fully offline with no key or network. An **opt-in online agent** is available in
  the Copilot: off by default; when enabled it uses the saved Anthropic/Claude or
  OpenAI profile and sends prompt + project context to the provider. It edits only by proposing actions you
  Apply through `project-actions`, with no PLC/.ACD/file access. The `browser-key`
  transport is for developer/local testing only; prefer the proxy/env-key pattern
  for internal/production use. See `online-ai-safety.md`.
- **Import robustness is still improving.** Real-world L5X variety (UDTs,
  AOIs, complex/nested branches, arrays) is partially handled; unrepresentable
  complex branches are flattened with a warning, and unmodeled members default
  to 0/false in simulation.
- **Program-scoped multi-routine, bounded task scheduling.** Offline Scan Once /
  Run can scan non-inhibited task-scheduled programs' main routines in imported
  task/program order, while explicit routine scans remain available for focused
  debugging. Program-scoped tags are stored as `Program:ProgramName.Tag` value
  paths and isolated during scheduled scans, including same-named local tags in
  different programs. Qualified reads of another program's local tags are
  supported in operands and CPT/CMP expressions. An offline controller/task
  status report mirrors which scheduled main routines will scan and flags
  inhibited, missing, duplicate, and non-ladder schedule entries with
  period/priority/watchdog/output-update metadata. Offline validation catches a
  continuous task with DisableUpdateOutputs set, since Studio 5000 only exposes
  that setting for PERIODIC and EVENT tasks, and catches redundancy-enabled
  controllers that still carry a CONTINUOUS task. It also catches task-capacity
  violations against Studio limits (32 tasks per controller, 32 scheduled
  programs per task, or 1000 programs per task for imported ControlLogix/
  SoftLogix controllers); periodic/event timing, priority pre-emption, watchdog
  faults, cross-program calls, redundancy switchover, and live controller
  task-status words are still not modelled.
  EVENT task trigger metadata is reviewable offline for EventTrigger/Tag
  bindings, EnableTimeout, and imported trigger-tag resolution, but controller
  event scheduling, module input state-change monitoring, consumed-tag trigger
  transfer, EVENT instruction dispatch, timeout/watchdog behavior, and live
  event-task status words are not modelled.
  Controller identity, firmware/catalog/chassis, System Overhead Time Slice,
  ShareUnusedTimeSlice, redundancy settings, and front-port crossload metadata
  are reviewable offline, but firmware compatibility, controller status words,
  system-overhead CPU scheduling, redundancy switchover, memory-pad
  enforcement, and front-port crossload behavior are not simulated.
  ReportMinorOverflow metadata is preserved through L5X import/export
  and reviewable offline for malformed true/false or 1/0 flags, but arithmetic
  overflow minor-fault generation, live minor-fault status, controller fault
  logs, and download preflight are not simulated.
  Project/controller matching and automatic firmware-update flags are reviewable
  offline for imported MatchProjectToController and
  ProjectSN plus InhibitAutomaticFirmwareUpdate metadata, but controller
  serial-number matching, download preflight, firmware updates,
  firmware-update inhibition, and controller replacement workflows are not
  modelled.
  Controller WallClockTime settings are reviewable offline for imported
  LocalTimeAdjustment and TimeZone metadata, but controller clock reads/sets,
  time synchronization, time-zone dialogs, scheduled time changes, and wall-clock
  runtime behavior are not modelled.
  Controller TimeSynchronize settings are reviewable offline for imported
  PTPEnable and PTP priority metadata, but controller clock synchronization,
  CIP Sync runtime behavior, grandmaster election, and controller time-quality
  status are not modelled.
  Controller Coordinated System Time settings are reviewable offline for
  imported `CST MasterID` metadata, but CST clock coordination, CST master
  election, chassis time synchronization, live time status, and controller
  communication are not modelled.
  Project documentation language/download settings are reviewable offline for
  imported language and pass-through attributes, but language merge, language
  selection dialogs, controller pass-through storage, and real documentation or
  extended/custom-property download are not simulated.
  Project audit timestamps are reviewable offline for imported
  ProjectCreationDate and LastModifiedDate attributes, but controller audit-log
  reads, project history synchronization, timestamp verification, and controller
  downloads are not modelled.
  GuardLogix controller SafetyInfo settings are reviewable offline for imported
  enable/lock/signature ID/timestamp/run-mode-protection/configure-safety-I/O/
  safety-level attributes, including malformed enable flags and
  signature/timestamp pairing findings, but safety signature verification,
  safety enable/disable, lock/unlock operations, safety I/O configuration,
  memory partition enforcement, and controller safety status are not simulated.
  Controller Security settings are reviewable offline for imported Code,
  ChangesToDetect, SecurityAuthorityID, and SecurityAuthorityName attributes,
  including partial change-detection and FactoryTalk authority findings, but
  permission enforcement, FactoryTalk authentication, source-protection
  enforcement, change monitoring, controller audit-log writes, and controller
  communication are not simulated.
  Controller SFC execution-control metadata (`SFCExecutionControl`,
  `SFCRestartPosition`, and `SFCLastScan`) is reviewable offline, but SFC step
  execution, transition evaluation, restart-state behavior, last-scan execution,
  and controller-verified SFC scheduling are not modelled.
  PhaseManager/equipment-phase instructions are reviewable offline for imported
  phase and external-request control tags, but the PhaseManager state engine,
  command arbitration, ownership transfer, FactoryTalk Batch/external sequencer
  behavior, and runtime phase parameter transfer are not modelled.
  GuardLogix safety partitions are reviewable offline for imported task/program/
  tag/AOI `Class` metadata and safety backing tags. Safety/standard program
  task-partition membership is validated offline, but the tool does not verify
  safety signatures, safety locking, runtime safety task assignment, safety
  memory partitioning, controller SafetyInfo behavior, or controller safety
  status.
  Program parameter interfaces are reviewable offline for imported
  `Input`/`Output`/`InOut` metadata, required/default values, dimensions, radix,
  and ExternalAccess. Imported controller `ParameterConnections` are preserved
  and reviewable for endpoint shape, resolution, duplication, same-endpoint, and
  simple type-compatibility findings, but runtime parameter transfer,
  controller-verified program connections, scheduling effects, and download
  preflight are not modelled.
  Controller Trend definitions are preserved and reviewable offline for
  attributes, pen definitions, TrendX template payloads, sample/capture settings,
  and trigger fields, but the tool does not open a Logix Designer trend window,
  sample live controller tags, capture trend logs, export sampled trend data, or
  communicate with RSLinx/FactoryTalk services.
  Controller Quick Watch Lists are preserved and reviewable offline for list
  names, watch tag specifiers, and scopes, but the tool does not open a live
  Studio 5000 Quick Watch pane, subscribe to controller tag values, apply forces,
  or perform online edits from those watch entries.
  Controller EtherNet/IP configuration objects are preserved and reviewable
  offline for IP/DNS/host metadata, Ethernet port rows, and ring/VLAN supervisor
  settings, but the tool does not apply IP settings to a controller, browse a
  live network, read physical link state, run network diagnostics, or communicate
  with RSLinx/FactoryTalk services.
  Controller last-used communication path metadata (`CommPath`/`CommDriver`) is
  preserved and reviewable offline for path/driver pairing and routed-path shape,
  but the tool does not browse communication paths, validate workstation drivers,
  go online, select a download target, or communicate with RSLinx/FactoryTalk
  services.
  Controller serial communication port configuration is preserved and reviewable
  offline for SerialPort, ASCII, and DF1 attributes, but the tool does not open a
  serial port, run DF1, maintain ASCII channel hardware state, read live channel
  status, or change controller communication settings.
  JSR/SBR/RET run subroutines within the scanned routine's program, including
  Studio-style input-count, SBR input, and RET return parameter copying.
  JMP/LBL labels are routine local and guarded; FOR loops run sibling routines
  with an index tag but do not model full task scheduling or parameter passing.
  MCR zone behavior is a bounded offline approximation and does not model every
  controller fault/status nuance. FBC/DDT compare the requested DINT-array bit
  range in one bounded offline scan and update CONTROL/result metadata, but do
  not model controller per-scan resumption or every status bit nuance. IOT is
  accepted and scans as a no-op because there is no delayed physical output
  image or controller connection.
- **AOI execution is RLL-only and offline.** UDT definitions have detail viewers
  and UDT tag members are expanded for offline watch/simulation. UDT member
  Radix, ExternalAccess, array dimensions, hidden host members, and bit-overlay
  Target/BitNumber rows are imported/exported and reviewable for malformed
  layouts, but controller memory layout, bit-packing execution, online data-type
  edits, controller downloads, external-access enforcement, and live formatting
  are not modelled. UDT Family metadata is imported/exported and reviewable for
  `NoFamily`, `StringFamily`, empty data types, unrecognized family values, and
  custom STRING `LEN`/`DATA` shape, but custom string runtime layout, online
  data-type edits, controller downloads, controller memory layout, and live
  data-type editor behavior are not modelled. Project-defined
  unprotected RLL AOI routines execute against AOI instance member paths,
  including nested AOI calls through AOI-typed local instance tags, but
  source-protected AOIs, Structured Text/FBD/SFC AOI routines, instruction
  signature enforcement, and controller-verified AOI scheduling/fault nuances
  are not modelled. AOI identity/documentation metadata is reviewable for
  revision/vendor/signature, authoring history, help text, scan-mode flags, and
  Safety/Standard class, but signatures are not verified, source protection is
  not bypassed, scan-mode flags do not drive execution, and safety partitions are
  not enforced. AOI execution review now makes that boundary explicit in the
  IDE: it identifies the selected offline scan body (`Logic` or first ladder
  fallback), marks Prescan/Postscan/EnableInFalse and non-ladder routines as
  preserved read-only, and labels source-protected/signature metadata without
  enforcing controller signatures. AOI call-interface Required, Default,
  Dimensions, usage, and instruction-face Visible flags are display/review
  metadata only. The validator inspects unprotected ladder AOI bodies for
  Studio-unavailable instructions and identifiable MSG/alarm/motion InOut
  data-instance requirements, plus GSV/SSV object-class restrictions that Studio
  applies inside AOIs, and flags Studio 5000 AOI capacity limits for
  Input/Output parameters plus local tags, InOut parameters, and nested AOI call
  depth. It also rejects AOI local tags with MESSAGE, MODULE, alarm,
  motion/object types or multi-dimensional arrays, matching Studio's local-tag
  editor limits. Source-protected and non-ladder AOI bodies remain opaque, so
  nesting through hidden logic is left to Studio 5000. The tool does not run full
  Studio 5000 call-face verification, instruction-signature verification, or
  controller fault semantics from those flags. I/O is imported metadata only —
  no controller communication.
- **HMI View Designer support is structural.** Screens, popups, a system banner,
  offline controller-reference synchronization metadata, bindings, events,
  alarm/trend/data-log/security/language metadata, and unsupported content can
  be modeled and verified offline. Controller references snapshot imported
  tags/data types/alarms for review and binding validation, but they do not
  browse live controllers, decrypt secured `.ACD` files, or perform real
  synchronization. Usage/capacity reporting estimates storage and scaling risks
  from modeled assets, language strings, and data-log retention; it is not a
  firmware-certified PanelView memory audit. Navigation projection is an offline
  route/menu review from modeled screens and shortcuts, not a full runtime
  security session manager. Verification catches
  missing tag/system-tag references, invalid binding targets, event tag command
  paths, invalid graphic layout/style metadata, animation target/source/state
  table issues, HMIBC/Button Control tag configuration, asset/screen/tag-path
  property references, unsupported assets, Add-On Graphic definition/reusable
  binding issues, alarm/diagnostics table metadata, navigation/shortcut/popup
  metadata, target-device capacity/surface compatibility, trend trace sources,
  data-log/status tags, and obvious binding
  source/type mismatch risks, plus circular property-to-property bindings within
  an element and security role reference/policy and language-pack/default-language issues. Offline runtime
  package build now produces verification/checksum/save-to-media JSON metadata,
  detects tampered package manifests, and blocks on HMI errors. Language packs
  can import/export deterministic CSV files with missing-string metadata, and
  HMI content bundles can round-trip screens/popups/Add-On Graphics/assets/
  unsupported metadata with checksums, but there is not yet a
  complete runtime emulator including firmware-accurate HMIBC high-speed
  hardware behavior,
  vendor-native View Designer folder/text format importer, full pixel reusable
  Add-On Graphic editor, controller/import-backed alarm service and full pixel Alarm
  Manager/History UI, hardware-backed automatic diagnostics, full interactive
  pixel-rendered trend chart editor, real hardware mounted/removable-media
  data-log writes, or real HMI
  upload/download transfer.
- **Array behavior is offline-bounded.** Multi-dimensional atomic, structured,
  and UDT arrays import/export, expand into `Tag[0,0]`-style value paths,
  validate subscript count and bounds, feed `SIZE` per declared dimension, and
  resolve integer tag/member indirect subscripts plus bounded arithmetic
  subscript expressions during offline scans. Controller memory-layout details
  and every controller fault/status nuance for array instructions are still
  approximated.
- **Engineering units are display metadata only.** Per-tag and per-element/member
  engineering units import/export and are reviewable for duplicate operands,
  blank text, member paths, and array bounds, but no unit conversion, online
  tag-property edit, controller download, or live display formatting is
  simulated.
- **Large-routine virtualization uses estimated row height.** Routines over 100
  rungs render a scroll-window plus overscan instead of mounting every rung, but
  unusually tall branch-heavy rungs can make the scrollbar position approximate.
- **Find/replace is bounded to mutable text.** Search Results can find broadly
  across PLC and HMI project content and can apply a reviewed Replace All to the
  previewed mutable text fields. It intentionally skips identifiers, tag paths,
  security permissions, read-only imported source text, and other identity
  references; there is no unrestricted raw XML/project-wide replace.
- **No multi-user, no persistence server.** Projects live in the browser session
  until exported.

## Notes

- DINT/REAL are treated as numbers without strict integer truncation or range
  checks.
- TIMER/COUNTER timing uses a per-scan millisecond delta, not a real-time clock.
- Undo history is capped at 100 steps; copy/paste operates on whole rungs.
