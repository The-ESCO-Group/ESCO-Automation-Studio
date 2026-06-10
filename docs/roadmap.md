# Roadmap

Status legend: ✅ done · 🔜 next · ⏳ later

## Done

- ✅ Editable ladder routine + semantic AST
- ✅ Instruction registry + simulator (scan cycle)
- ✅ Validation engine
- ✅ Project persistence (`.plcproj.json` export/import)
- ✅ Instruction set: XIC, XIO, OTE, OTL, OTU, ONS, TON, TOF, RTO, CTU, CTD,
  RES, MOV, ADD, SUB, MUL, DIV, EQU, NEQ, GRT, GEQ, LES, LEQ, NOP, AFI
- ✅ L5X import (MVP + hardening: branches, member/array paths, descriptions,
  alias/unmodeled-type warnings, located warnings, summary, stress fixtures)
- ✅ Controlled project-actions API
- ✅ Cross-reference panel — where each tag is read/written across routines
- ✅ Tag table editor — create/rename/describe/delete with types
- ✅ Branch editing UI — parallel/seal-in **and nested** branches by hand
- ✅ L5X nested branch import — representable nested branches preserve topology
  and simulation semantics; unrepresentable shapes still warn and flatten
- ✅ Routine & project compare — fingerprint match + strict/logical (OR-order)
  canonicalization; JSON/CSV report export
- ✅ AI assistant (offline/rule-based) + provider interface (local/mock/external
  seam, no API key) + UX polish
- ✅ Undo / redo action history (Ctrl+Z/Y) + copy / duplicate / paste rungs
- ✅ Multi-dimensional array tags + alias resolution (import/export,
  validation + simulation, `SIZE` per declared dimension) + nested
  UDT/structured member validation, member-array bounds, and member-path
  aliases, plus program-scope shadowing
- ✅ Per-element/member tag comments — Logix `<Comments><Comment Operand=...>`
  metadata round-trips through L5X and surfaces in tag search/properties as
  `Tag.Member` / `Tag[index]` previews
- ✅ Per-element/member tag engineering-unit review — Logix
  `<EngineeringUnits><EngineeringUnit Operand=...>` metadata round-trips
  through L5X and is reviewable for duplicate operands, blank units, member
  paths, and array bounds without unit conversion or live display formatting
- ✅ Validator rules: double-coil, duplicate program tag, alias target, array
  bounds, unknown member, unknown routine, plus I/O module parent/slot/keying/
  connection metadata checks including chassis-size slot bounds
- ✅ Crash-safe error boundary + unsaved-changes guard
- ✅ Project format v2 + migration system + browser autosave/recovery
- ✅ Instruction set: bitwise (AND/OR/XOR/NOT), math (MOD/SQR/NEG/ABS/CLR),
  compare (LIM/MEQ), decode/encode (DCD/ENC), program control (JSR/SBR/RET)
- ✅ Instruction set: data movement (COP/CPS/FLL/MVM), file/array
  (AVE/STD/SRT/FAL/FSC/SIZE/FFL/FFU/LFL/LFU/FBC/DDT), sequencer (SQO/SQI/SQL), and
  shift (BSL/BSR) with bounded offline execution
- ✅ File bit compare / diagnostic detect — FBC records mismatching DINT-array bit
  numbers into the result array, DDT also updates reference bits, and both handle
  qualified program-scoped arrays plus starting word offsets as bounded offline
  approximations
- ✅ JMP / LBL — bounded intra-routine label jumps
- ✅ FOR / BRK — bounded sibling-routine FOR loops with loop-exit support
- ✅ MCR — bounded master-control zones that scan disabled rungs with false power
- ✅ STRING / ASCII instructions — executable scalar operations, number/string
  conversions, and offline channel-buffer instructions over STRING tag values
- ✅ JSR / SBR / RET — offline multi-routine execution with a call-depth guard
  and Studio-style input/return parameter copying
- ✅ Offline controller/task status projection — imported task schedules expose
  the exact offline scan set, inhibited/missing/non-ladder/duplicate schedule
  entries, watchdog metadata, and DisableUpdateOutputs review state
- ✅ Continuous task output-update validation — DisableUpdateOutputs on a
  CONTINUOUS task is flagged because Studio 5000 reserves that setting for
  PERIODIC and EVENT tasks
- ✅ Redundancy continuous-task validation — redundancy-enabled controllers that
  still carry a CONTINUOUS task are flagged while switchover remains unmodelled
- ✅ Task capacity validation — controllers over 32 tasks and tasks over 32
  scheduled programs are flagged, with ControlLogix/SoftLogix controllers
  allowed up to 1000 scheduled programs per task
- ✅ Event task review projection — imported EVENT task EventInfo trigger,
  EnableTimeout metadata, trigger tag resolution, and missing/unresolved trigger
  findings are reviewable with no-runtime event scheduling and timeout
  boundaries explicit
- ✅ Program interface review projection — imported program Input/Output/InOut
  parameters, required/default/dimension/radix/ExternalAccess metadata, empty
  programs, and malformed-interface findings are reviewable offline
- ✅ Program parameter connection import/export and review projection — imported
  controller ParameterConnections round-trip through L5X and resolve
  Program.Parameter endpoints offline with missing/malformed/unresolved/
  duplicate/same-endpoint/type findings while runtime transfer remains
  unmodelled
- ✅ Controller properties review projection — controller identity, firmware,
  catalog, chassis/slot, System Overhead Time Slice, ShareUnusedTimeSlice, and
  redundancy/front-port crossload metadata are reviewable with offline-only
  boundaries explicit
- ✅ Controller ReportMinorOverflow import/export and review projection — the
  controller overflow minor-fault reporting flag round-trips through L5X and is
  reviewable with malformed flag findings while arithmetic overflow fault
  generation remains unmodelled
- ✅ Controller project-matching review projection — MatchProjectToController,
  ProjectSN, and InhibitAutomaticFirmwareUpdate metadata are reviewable with
  serial-pairing findings plus serial-number, download-preflight,
  firmware-update, and replacement-workflow boundaries explicit
- ✅ Controller documentation review projection — project documentation language
  and pass-through/download metadata are reviewable with language merge and
  documentation-download boundaries explicit
- ✅ Controller audit timestamp review projection — ProjectCreationDate and
  LastModifiedDate metadata are reviewable with audit-log, history-sync,
  timestamp-verification, and download boundaries explicit
- ✅ Controller WallClockTime review projection — LocalTimeAdjustment and
  TimeZone metadata are reviewable with controller clock read/set and time-sync
  boundaries explicit
- ✅ Controller TimeSynchronize review projection — PTPEnable/Priority1/
  Priority2 metadata is reviewable with CIP Sync, grandmaster-election, and
  controller time-quality boundaries explicit
- ✅ Controller CST review projection — Coordinated System Time MasterID metadata
  is reviewable with CST clock-coordination, master-election, chassis-time-sync,
  live-time-status, and controller-communication boundaries explicit
- ✅ Controller SafetyInfo review projection — GuardLogix safety lock/signature/
  signature-timestamp/run-mode-protection/configure-safety-I/O plus
  SafetyEnabled/SafetyLevel metadata is reviewable with malformed enable flag
  and signature/timestamp pairing findings plus signature verification,
  enable/disable, lock/unlock, and controller safety-status boundaries explicit
- ✅ Controller Security review projection — source-protection Code,
  ChangesToDetect, SecurityAuthorityID, and SecurityAuthorityName metadata are
  reviewable with permission/authentication/change-monitoring boundaries
  explicit
- ✅ Controller SFC execution review projection —
  SFCExecutionControl/SFCRestartPosition/SFCLastScan metadata is reviewable with
  SFC execution boundaries explicit
- ✅ Fault-handler review projection — controller fault handlers, power-up
  handlers, and program fault routines resolve to imported handler programs/main
  routines or program fault routines for offline review, with missing, dangling,
  ambiguous, and non-ladder boundaries explicit; controller handler program
  targets are validator-backed
- ✅ Equipment phase review projection — PhaseManager `EQUIPMENT_PHASE` and
  `PHASE_INSTRUCTION` operands resolve to imported tags for offline review, with
  phase state-engine and command-arbitration boundaries explicit
- ✅ GuardLogix safety metadata review projection — imported task/program/tag/AOI
  Safety/Standard `Class` partitions and safety-instruction backing tags are
  reviewable with safety signature/lock/evaluation boundaries explicit
- ✅ GuardLogix safety program scheduling validation — standard or untagged
  programs scheduled under the safety task and safety programs scheduled under
  standard tasks are flagged as verify errors while unscheduled safety programs
  remain valid offline review state
- ✅ GuardLogix DIN/ROUT/CROUT review operands — diverse-input and redundant-output
  safety application instructions register as model-only backing-tag writes so
  imported safety routines parse, cross-reference, and round-trip without
  simulating safety evaluation
- ✅ Simulator debugging — execution trace + force table
- ✅ UDT / Add-On Instruction / I/O module import + offline **detail viewers/editors**
  (AOI parameters/local tags/routines/references, UDT members/paths/usage, I/O
  modules by slot plus identity/revision/keying/connection/port metadata, a
  searchable local Add I/O Device catalog for common modules with preset
  connection metadata, and selected-module properties editing/removal)
- ✅ UDT definition Family review — NoFamily/StringFamily metadata, empty data
  types, unrecognized families, and custom STRING LEN/DATA shape are reviewable
  with memory-layout and runtime string-layout boundaries explicit
- ✅ AOI identity/documentation metadata review — revision/vendor/signature,
  authoring history, help text, scan-mode flags, source-protection, and
  Safety/Standard class are reviewable with signature/protection/scan/safety
  boundaries explicit
- ✅ AOI call-interface visibility review — imported Required and
  instruction-face Visible flags remain independent so hidden required
  parameters and visible optional parameters review correctly offline
- ✅ UDT member metadata/layout review — member Radix, ExternalAccess,
  dimensions, hidden hosts, and bit-overlay Target/BitNumber rows are reviewable
  with controller memory-layout and bit-packing boundaries explicit
- ✅ Logix identifier edit-time guards — tag, routine, program, task,
  controller, UDT member, and AOI parameter/local-tag actions reject
  Studio-invalid Logix identifiers before mutation
- ✅ Tag data-type edit-time guards — tag create/retype actions resolve Logix
  scalar/predefined, UDT, and AOI data types before mutation and reject unknown
  type names
- ✅ Scope-aware tag creation — program-scoped tag actions require a resolved
  target program and enforce duplicate names within the relevant Logix scope
- ✅ Scope-aware tag editing — tag description, dimensions, metadata, retype,
  alias, delete, and rename actions target the selected controller/program scope
  and treat same-named local tags with Logix precedence
- ✅ Tag data-type table editing — the IDE tag grid exposes validated data-type
  edits for Logix scalar/predefined, UDT, and AOI types through the action layer
- ✅ Program-scoped tag creation in the IDE — the tag grid create row can target
  an existing program and create a local tag in that Studio scope
- ✅ Large-project handling: windowed tag table + virtualized large-routine
  editor rendering
- ✅ Performance: synthetic large-project generator + stress tests + import timing
- ✅ ESCO Virtual Controller — offline driver / simulation session in
  `@esco/controller-comm`: a real state machine (disconnected → browsing →
  path-selected → connecting → online/monitoring/uploading/downloading/faulted)
  with Set Path / Route Browser (realistic ESCO virtual paths + recents), Go Online
  (matched / mismatch / no-project comparison), Download (validate → store signed
  snapshot → online), Upload (reconstruct image for inspection), controller mode
  changes (Program / Run / Remote Program / Remote Run with run-mode edit guard),
  an offline fault model + Clear Faults, connection health, timestamps, and an
  activity log. Surfaced in the ESCO Virtual Controller panel + status bar.
  Branded "not real hardware"; real controller comms still need a verified
  transport. Separate from the hardware safety gate, which still refuses hardware
- ✅ ESCO-native runtime format — `.easruntime` (ESCO Automation Studio Runtime):
  ESCO-owned compiled runtime artifact with an execution-ordered task/program/
  routine model, flattened routine payloads, power-up tag state, I/O binding
  metadata, `sha256` integrity checksum, schema versioning, and `esco-native`
  provenance. Build / Export / Import wired into the File menu; import is verified
  and loads as read-only ESCO Runtime source. Legacy `.easrt` imports are still
  accepted, but new exports use `.easruntime`. `.easpkg` export/import now
  carries the editable `.easproj` plus compiled `.easruntime` with embedded
  checksums; `.easlib` exports reusable offline library content and feeds the
  matching component-family import commands after checksum validation. See
  `docs/esco-native-formats.md`
- ✅ L5X export — generated offline, review-only `.L5X` with explicit warnings
  and supported-content preservation
- ✅ Proprietary binary guard — offline-safe detection of `.ACD` / ACD-archive /
  `.L5K` / mislabelled-binary imports before any parse, a professional blocked
  format modal (Import L5X instead / Compatibility notes / Cancel), an
  export-target guard so `.acd` is never faked, honest project provenance (source
  type, file, path, timestamp, blocked-attempt audit), and Project Properties /
  About visibility. Routes the engineer to offline `.L5X` review while keeping
  `.ACD` outside the product
- ✅ UDT tag member values — imported UDT members expand into watch/simulation
  paths, including member arrays
- ✅ MESSAGE control tag values — common MSG status/configuration members expand
  for offline watch/review without controller communication
- ✅ Project-defined AOI calls — recognized as model-only logic instead of
  unknown unsupported instructions
- ✅ Unprotected RLL AOI execution — imported AOI ladder routines run offline
  against AOI instance parameter/local member paths
- ✅ Nested RLL AOI calls — AOI routines can call another imported RLL AOI
  through an AOI-typed local instance tag
- ✅ AOI execution-review policy — source-protected/signature metadata,
  non-ladder bodies, scan-phase routines, `Logic` scan-body selection, and
  first-ladder fallback are projected into the IDE using the same boundaries the
  simulator applies
- ✅ AOI instruction restriction validation — unprotected ladder AOI definitions
  flag Studio-unavailable instructions and identifiable MSG/alarm/motion data
  instances that are not passed through InOut parameters, plus AOI-local GSV/SSV
  supported-class, GSV-only-class, and `THIS` instance-name restrictions
- ✅ AOI capacity validation — Studio 5000 Input/Output-parameter plus local-tag
  counts, versioned InOut-parameter caps, and nested AOI-call depth are checked
  offline for imported or edited AOI definitions
- ✅ AOI local-tag type validation — Studio-forbidden MESSAGE, MODULE, alarm,
  motion/object local tags and multi-dimensional local-tag arrays are reported
  with InOut-parameter guidance
- ✅ MSG/GSV/SSV review operands — model-only message/system instructions expose
  cross-reference-safe tag operands while ignoring object/attribute keywords,
  with explicit no-runtime MSG execution/CIP/remote-transfer/status-update and
  GSV/SSV object-attribute read/write boundaries
- ✅ Model-only instruction review-state projection — preserved process,
  message/system, motion, alarm, safety, equipment-phase, SFC, event, and serial
  hardware blocks expose pass-through behavior, operand roles, and explicit
  no-runtime boundaries for IDE/property-panel review, including detailed
  message/system, process PID/PV/CV/status/scheduling/tuning, and motion
  planner/axis/drive/feedback/coordinate/group/cam/gear/event boundaries
- ✅ AHL hardware handshake review operands — ASCII Handshake Lines exposes
  Studio-style channel, AND/OR mask, control, and channel-status operands with
  explicit no-runtime DTR/RTS line, mask-application, serial-port, and
  control/status boundaries
- ✅ Process loop review projection — PID/PIDE plus loop/scaling/totalizer blocks
  resolve their imported block tags, PV/CV references, qualified program paths,
  missing imports, and type mismatches without simulating closed-loop control
- ✅ Produced/consumed tag connection review — ProduceInfo/ConsumeInfo metadata,
  RPI/unicast settings, invalid consumed RPIs, invalid counts, missing producer
  bindings, program-scoped roles, controller CanUseRPIFromProducer/
  CanUseRPIFromController source flags, and conflicting roles are projected
  without communication or RPI negotiation
- ✅ I/O module review projection — catalog/revision/keying, inhibit,
  MajorFault, parent/port topology, duplicate slots, ports, and bus sizes are
  projected without module connections or electronic-keying enforcement
- ✅ Module connection review projection — imported I/O connection name/type/RPI/
  priority/EventID/unicast metadata, duplicate names, and malformed connection
  rows are reviewable without module connections, RPI scheduling, event-triggered
  connection dispatch, or connection priority scheduling
- ✅ Controller Trend import/export and review projection — Logix Designer
  trend attributes, TrendX template payloads, pen display metadata,
  sample/capture settings, and trigger fields are preserved and reviewable
  without online trend execution, controller sampling, trend-log capture, or
  sampled-data export
- ✅ Controller Quick Watch List import/export and review projection — Logix
  Designer watch list names, watch tag specifiers, scopes, and extra attributes
  are preserved and reviewable without online watch monitoring, live values,
  force interaction, or controller communication
- ✅ Controller EtherNet/IP configuration import/export and review projection —
  InternetProtocol, EthernetPorts, and EthernetNetwork metadata are preserved
  and reviewable without applying IP settings, network browsing, live port
  state, diagnostics, or controller communication
- ✅ Controller communication path import/export and review projection —
  CommPath/CommDriver metadata is preserved and reviewable for path/driver
  pairing and routed-path shape without path browsing, online connection, driver
  validation, download target selection, or controller communication
- ✅ Controller serial communication port import/export and review projection —
  CommPorts/SerialPort metadata plus ASCII/DF1 child protocol attributes are
  preserved and reviewable without serial hardware access, DF1 runtime, ASCII
  channel hardware state, live channel status, or controller communication
- ✅ Structured Text IDE editing — imported/new ST routines open as editable
  source, run conservative structural checks while typing and in project-wide
  Verify, report clear undefined ST tag/member references and obvious array
  bounds in Verify, save through `project-actions`, round-trip through
  generated L5X, and execute a conservative offline subset for assignments and
  nested `IF` / `ELSIF` / `ELSE` flow plus bounded `FOR` / `WHILE` / `REPEAT`
  loops, `EXIT`, numeric `CASE` selections, and program-local `JSR` / `SBR` /
  `RET` routine calls with input/return parameter copying, plus standalone calls
  to registered executable instructions through the shared instruction registry
  with positional and named-argument mapping, and project-wide Verify coverage
  for required operands, unknown named operands, invalid expression operands, and
  model-only ST call status, plus invalid write-target and alias-resolved
  tag/member/array type mismatch diagnostics, Studio-style `CASE` immediate
  selector labels/ranges, obvious nonnumeric `CASE` expression diagnostics, and
  obvious CASE selector type-mismatch diagnostics for known numeric expression
  tags/members/typed literals, plus exact REAL selector warnings
- ✅ Non-ladder AOI body preservation — unprotected AOI ST/FBD/SFC routines stay
  read-only and round-trip through generated L5X when source XML is available
- ✅ HMI controller references — offline ESCO sync-state metadata
  with controller/program tag, UDT/AOI data type, and alarm browser rows, plus
  action-layer add/update/remove support and IDE status visibility
- ✅ HMI usage/capacity reporting — target-device Usage panel projection for
  screen, element, trend, data-log, storage, surface scaling, and raster-scaling
  risk estimates
- ✅ Find/Search Results expansion — global offline search across ladder, tags,
  tag comments, controller metadata, HMI screens/elements/bindings/events,
  alarms, trends, data logs, languages, security, assets, reusable graphics, and
  HMI controller references, with safe replace-preview reporting
- ✅ Reviewed Replace All — Search Results can apply exactly the previewed
  mutable text-field replacements while skipping identifiers, tag paths,
  security permissions, and read-only imported source
- ✅ HMI navigation projection — security-aware route/menu model for screens,
  popups, shortcuts, folders, omitted screens, missing targets, and dead-end
  screen review
- ✅ HMI live runtime preview — tag provider, safe expression evaluator, binding
  engine, and runtime controller (write/toggle/momentary/increment, navigation,
  alarm acknowledge) drive a live operator preview in the designer with indicator
  lamps, multi-state indicators, an SVG trend sparkline, a language switcher, a
  tag inspector, and broken-binding diagnostics
- ✅ HMI alarm / trend / language authoring — designer panels create/update/delete
  alarm definitions (digital + analog triggers), trend definitions and tag-bound
  pens, and language packs + localized strings through validated
  `@esco/project-actions` handlers; authored data is immediately live in the
  runtime preview (alarm activation, trend sampling, live language switching)
- ✅ HMI authoring completeness — trend-chart objects bind to a chosen trend;
  alarm-summary objects honor a filter expression (field-scoped + substring);
  language packs round-trip through CSV import/export; HMI security roles/users
  are authorable and the runtime preview supports user login/logout
- ✅ Studio 5000 communication-command guard coverage — Network Browser, Select
  Recent Path, Go Online, Monitor, Upload, Download, Online Edit, Program Mode,
  Run Mode, Test Mode, Lock Controller, Clear Faults, and Go To Faults are
  visible guarded commands with blocked audit entries when no verified real
  transport exists; Go Offline remains a safe local lifecycle transition
- ✅ Read-only online-readiness scaffolding (no real link) — `@esco/controller-comm`
  adds a transport/provider honesty contract (`realControllerIo` + `verified`), an
  abstract read-only controller transport base, a monitor-state readiness matrix,
  and a staged online-readiness report so a future read-only online mode can be
  wired in safely. This is scaffolding and safety gates only: no concrete or
  verified physical transport ships, real Go Online / Monitor / upload / download /
  online edit stay blocked, and a regression guard test fails if any shipped
  transport flips `verified`. The lone `verified` provider is the in-process ESCO
  SoftController — software only (`realControllerIo: false`), never hardware
- ✅ External LLM provider seam — configured `ExternalLlmProvider` instances run
  an injected model caller through the safe agent loop and still return only
  previewable project-action plans; unconfigured instances own no key and fail
  closed
- ✅ Desktop Tauri packaging scaffold — packaged Windows shell with startup
  window promotion, native project file dialogs, restrictive CSP, honest
  offline-only capability report, and Windows Credential Manager-backed AI key
  storage
- ✅ CI (install/typecheck/test/build) + CHANGELOG + CONTRIBUTING + dependency
  review + issue templates
- ✅ In-repo E2E smoke harness (`pnpm e2e`)
- ✅ Architecture & AI documentation

## Next milestones

1. **Vendor-neutral PLC target adapters:** implement and validate real adapters
   under the ESCO `TargetAdapter` contract for physical PLC families.
   Allen-Bradley/EtherNet/IP stays the first high-value track, but Siemens,
   CODESYS/IEC runtimes, Beckhoff, Schneider/Modicon, Omron, Mitsubishi, and
   ESCO runtime targets should all use the same compile, compare, backup,
   permission, audit, read-back, and validation gates. See
   `docs/vendor-neutral-plc-download-architecture.md`.
2. **Deeper model-only families:** firmware-faithful execution strategy for
   selected process/message/motion behavior, hardware-specific ASCII
   handshaking, and protected/non-ladder AOI review behavior.
3. **Structured Text execution hardening** — remaining instruction/function call
   forms, remaining CASE selector coercion/fault semantics, prescan/postscan behavior, and
   firmware-faithful type/status behavior.
4. **AOI execution hardening** — deeper non-ladder AOI semantic viewing/execution
   strategy plus controller-fault/status/signature fidelity.
5. **Desktop release hardening** — Microsoft Entra ID sign-in, code signing,
   and distribution/release validation.
6. **L5X export fidelity hardening** — round-trip deeper module/port, AOI
   routine, safety/signature, and remaining complex branch metadata.

## Constraints (unchanged)

- No physical PLC download or online editing without a field-validated target
  adapter and destructive-action safety gate.
- Read-only software-wired monitoring foundations may exist, but they do not
  make a PLC family download-ready.
- No `.ACD` reading, writing, compiling, decompiling, or conversion (proprietary
  binary format; a guarded, honest L5X-based compatibility layer is provided instead).
- No unsafe automation affecting real hardware.
- AI mutates the project only through `@esco/project-actions`, only on Apply.
