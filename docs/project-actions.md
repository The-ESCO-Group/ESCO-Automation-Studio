# Project Actions (`@esco/project-actions`)

The controlled action layer is the **only** sanctioned way to change a PLC
project. The web UI and the AI assistant both go through it; nothing else
mutates project state directly.

## Why actions exist

- **Single source of mutation.** All edits (tags, rungs, instructions, imports)
  flow through one typed, tested API instead of being scattered across React
  components.
- **Safety for AI.** Local, mock, and externally configured LLM-backed
  assistants can only ever change the project by emitting these actions — they
  never touch React state, JSON, or files. The action layer is the trust
  boundary.
- **Auditability.** Every action returns a result describing what happened,
  including validation findings, so changes can be previewed and reviewed.

## Rules

1. **Immutability.** An action never mutates its input project. It returns a new
   `PlcProject` (structurally shared where unchanged). Callers adopt the result.
2. **No throwing for expected failures.** Actions return
   `{ ok: false, error }` instead of throwing. The input project is returned
   unchanged on failure.
3. **Validation after mutation.** Every action runs the validation engine over
   the resulting project and returns the `findings`, so the UI/AI can show the
   state immediately after a change.
4. **Semantic AST only.** Ladder edits operate on the `@esco/ladder` AST, never
   on text. `addRungFromText` parses neutral text into the AST via the L5X
   parser, then edits the AST.
5. **Registry-driven.** Instruction operand shapes come from
   `@esco/instructions`, not hardcoded.
6. **Studio-style identifiers.** Logix object edits reject names that Studio
   5000 would reject at entry: over 40 characters, illegal characters,
   consecutive underscores, or a trailing underscore. This guard covers tags,
   routines, programs, tasks, controllers, UDT members, and AOI parameter/local
   tags before validation runs.
7. **Studio-style data types.** Tag creation and retyping resolve data types
   before mutation. Logix scalar types, predefined structured/model-only types,
   project UDTs, and AOIs are accepted; unknown type names are rejected at the
   edit boundary instead of creating a tag Studio 5000 cannot verify.
8. **Scope-aware tags.** Program-scoped tag creation must name an existing
   program and inserts into that program's local tag table. Duplicate tag names
   are checked within the relevant Logix scope, so same-named local tags in
   different programs remain valid while same-scope duplicates are rejected.
   Tag edit actions accept the selected scope/program id and fail when a bare
   name is ambiguous across scopes, so description/metadata/dimension/retype/
   alias/delete/rename operations update the intended Studio tag table row.

## Result shape

```ts
interface ProjectActionResult<T = unknown> {
  ok: boolean;
  project: PlcProject;        // unchanged when ok === false
  data?: T;                   // e.g. { rungId } / { nodeId } / { tagId }
  findings?: ValidationFinding[];
  warnings?: string[];
  error?: string;
}
```

## Supported actions

| Action | Input | Notes |
|---|---|---|
| `createTag` | `{ name, dataType?, scope?, programId?, description?, dimensions?, externalAccess?, constant? }` | Rejects duplicates. Default BOOL / controller scope. |
| `renameTag` | `{ from, to, scope?, programId? }` | Renames the scoped tag **and** remaps operand references with Logix local-tag precedence. |
| `setTagMetadata` | `{ name, scope?, programId?, externalAccess?, constant? }` | Sets/clears Studio 5000 tag metadata; Constant tags are still validated against logic writes. |
| `deleteTag` | `{ name, scope?, programId? }` | Only if the scoped tag is not referenced by any ladder operand. |
| `tagEngineeringUnitReviewReport` | `(project)` | Reviews imported per-tag and per-element/member engineering units, duplicate operands, blank unit text, member paths, and array bounds while keeping unit conversion, online tag-property edits, controller download, and live display formatting offline-only. |
| `udtDefinitionReviewReport` | `(project)` | Reviews imported UDT Family metadata, NoFamily/StringFamily classification, empty data types, custom STRING LEN/DATA shape, and unrecognized family values while keeping memory layout, custom string runtime layout, online data-type edits, controller download, and live data-type editor behavior offline-only. |
| `udtMemberMetadataReviewReport` | `(project)` | Reviews imported UDT member Radix, ExternalAccess, dimensions, hidden host members, and bit-overlay Target/BitNumber metadata while keeping controller memory layout, bit packing, online data-type edits, controller download, external-access enforcement, and live display formatting offline-only. |
| `describeAoiInterfaceReview` | `(aoi)` | Reviews an AOI's imported call interface, including usage, Required, instruction-face Visible, dimensions, defaults, by-reference InOut/array binding, and source-protection boundaries without executing or editing the AOI body. |
| `aoiMetadataReviewReport` | `(project)` | Reviews imported AOI revision/vendor/signature, authoring/documentation/help text, source-protection, scan-mode flags, and Safety/Standard class metadata while keeping signature enforcement, source-protection bypass, scan-mode execution, and safety partition enforcement offline-only. |
| `createRoutine` | `{ programId, name, language? }` | Adds a ladder routine to a program. |
| `setRoutineProperties` | `{ routineId, name?, description? }` | Renames and/or re-describes a routine; on rename, remaps JSR/FOR/SFC routine references within the owning program. |
| `addRung` | `{ routineId, comment? }` | Appends an empty rung. |
| `addRungFromText` | `{ routineId, text, comment? }` | Parses Logix neutral text → AST rung (branches supported). |
| `deleteRung` | `{ routineId, rungId }` | |
| `addInstruction` | `{ routineId, rungId, instructionType }` | Operands built from the registry definition. |
| `removeInstruction` | `{ routineId, rungId, nodeId }` | |
| `updateInstructionOperand` | `{ routineId, rungId, nodeId, index?, value }` | |
| `validateProject` | `(project)` | Returns findings (no mutation). |
| `scanProject` | `(project, values, options?)` | One scan of task-scheduled main routines by default, or one explicit routine via `routineId`; isolates program-scoped values as `Program:ProgramName.Tag`, resolves qualified program-scope reads in operands and CPT/CMP expressions, resolves integer tag/member and bounded expression indirect array subscripts, and returns next tag values (no mutation). |
| `controllerPropertiesReviewReport` | `(project)` | Reviews imported controller identity, catalog/firmware/chassis/slot, System Overhead Time Slice, ShareUnusedTimeSlice, redundancy settings, and front-port crossload metadata while keeping firmware/status/switchover/crossload behavior offline-only. |
| `controllerProjectMatchingReviewReport` | `(project)` | Reviews imported MatchProjectToController, ProjectSN, and InhibitAutomaticFirmwareUpdate metadata, including missing/orphan serial metadata, while keeping controller serial-number matching, download preflight, firmware updates, firmware-update inhibition, and controller replacement workflows offline-only. |
| `controllerReportMinorOverflowReviewReport` | `(project)` | Reviews imported controller ReportMinorOverflow metadata, including malformed true/false or 1/0 findings, while keeping arithmetic-overflow minor-fault generation, live minor-fault status, controller fault logs, download preflight, and controller communication offline-only. |
| `controllerConsumeRpiReviewReport` | `(project)` | Reviews imported controller `CanUseRPIFromProducer` / `CanUseRPIFromController` consumed-tag RPI-source metadata, including malformed or conflicting flag findings, while keeping producer RPI negotiation, connection scheduling, download preflight, and controller communication offline-only. |
| `controllerDocumentationReviewReport` | `(project)` | Reviews imported project documentation language and pass-through/download metadata while keeping language merge, controller storage, and documentation download offline-only. |
| `controllerAuditReviewReport` | `(project)` | Reviews imported controller ProjectCreationDate and LastModifiedDate metadata, flagging partial timestamp pairs while keeping controller audit-log reads, project history synchronization, timestamp verification, and controller download offline-only. |
| `controllerSafetyInfoReviewReport` | `(project)` | Reviews imported GuardLogix SafetyInfo enable/lock/signature ID/timestamp/run-mode-protection/configure-safety-I/O/safety-level metadata, including malformed enable flags and signature/timestamp pairing findings, while keeping signature verification, safety enable/disable, lock/unlock, safety I/O configuration, and controller safety status offline-only. |
| `controllerWallClockReviewReport` | `(project)` | Reviews imported controller WallClockTime LocalTimeAdjustment and TimeZone metadata while keeping controller clock read/set, time synchronization, time-zone dialogs, scheduled time changes, and wall-clock runtime behavior offline-only. |
| `controllerTimeSyncReviewReport` | `(project)` | Reviews imported controller TimeSynchronize PTPEnable/Priority1/Priority2 metadata, including partial and malformed priority findings, while keeping controller clock synchronization, CIP Sync runtime behavior, grandmaster election, and controller time-quality status offline-only. |
| `controllerCstReviewReport` | `(project)` | Reviews imported controller Coordinated System Time `CST MasterID` metadata, flagging missing or malformed master IDs while keeping CST clock coordination, CST master election, chassis time synchronization, live time status, and controller communication offline-only. |
| `controllerSecurityReviewReport` | `(project)` | Reviews imported controller Security Code, ChangesToDetect, SecurityAuthorityID, and SecurityAuthorityName metadata, including partial change-detection and FactoryTalk authority findings, while keeping permission enforcement, source-protection enforcement, FactoryTalk authentication, change monitoring, audit-log writes, and controller communication offline-only. |
| `controllerSfcExecutionReviewReport` | `(project)` | Reviews imported controller `SFCExecutionControl`, `SFCRestartPosition`, and `SFCLastScan` metadata while keeping SFC step/transition execution, restart state, last-scan behavior, and controller-verified scheduling offline-only. |
| `controllerTrendReviewReport` | `(project)` | Reviews imported controller Trend definitions, preserving trend attributes, TrendX template payloads, pen display metadata, sample/capture settings, and trigger fields while keeping online trend execution, controller sampling, trend logs, and sampled-data export offline-only. |
| `controllerQuickWatchReviewReport` | `(project)` | Reviews imported controller Quick Watch Lists, preserving watch tag specifiers/scopes and resolving imported controller, program, parameter, and AOI targets while keeping online watch monitoring, live tag values, force interaction, and controller communication offline-only. |
| `controllerEthernetConfigReviewReport` | `(project)` | Reviews imported controller InternetProtocol, EthernetPorts, and EthernetNetwork metadata, flagging invalid IPv4/manual settings, duplicate ports, speed/duplex, VLAN, and ring timing findings while keeping IP setting apply, network browsing, live port state, diagnostics, and controller communication offline-only. |
| `controllerCommunicationPathReviewReport` | `(project)` | Reviews imported controller `CommPath`/`CommDriver` metadata, flagging missing path/driver pairs and malformed routed path or driver rows while keeping path browse, online connection, driver validation, download target selection, and controller communication offline-only. |
| `controllerCommPortReviewReport` | `(project)` | Reviews imported controller CommPorts/SerialPort metadata and ASCII/DF1 protocol children, flagging duplicate channels, missing protocol children, and malformed baud/data/stop-bit settings while keeping serial hardware access, DF1 runtime, ASCII channel hardware state, live channel status, and controller communication offline-only. |
| `programInterfaceReviewReport` | `(project)` | Reviews imported program `Input`/`Output`/`InOut` parameters, required/default/dimension/radix/ExternalAccess metadata, empty programs, and malformed-interface findings while keeping cross-program parameter binding and runtime transfer offline-only. |
| `programParameterConnectionReviewReport` | `(project)` | Reviews imported controller `ParameterConnections`, resolving `Program.Parameter` endpoints against imported program parameters and flagging missing, malformed, unresolved, duplicate, same-endpoint, and incompatible endpoint pairs while keeping runtime parameter transfer, controller-verified binding, scheduling, and download preflight offline-only. |
| `controllerTaskStatusReport` | `(project)` | Projects imported task schedules into the exact offline scan set, with inhibited/missing/non-ladder/duplicate schedule rows plus period/priority/watchdog/DisableUpdateOutputs review metadata; the validator separately flags DisableUpdateOutputs on CONTINUOUS tasks and Logix task/scheduled-program capacity violations. |
| `eventTaskReviewReport` | `(project)` | Reviews imported EVENT task EventInfo trigger and EnableTimeout metadata, trigger tag resolution, missing/unresolved trigger findings, and non-EVENT EventInfo findings while keeping controller event scheduling, trigger dispatch, and timeout/watchdog behavior offline-only. |
| `faultHandlerReviewReport` | `(project)` | Reviews controller fault handlers and power-up handlers against imported handler programs/main routines, and program fault routines against imported routine ids, flagging missing/dangling/ambiguous/non-ladder handlers while keeping fault dispatch model-only. |
| `safetyMetadataReviewReport` | `(project)` | Reviews imported GuardLogix task/program/tag/AOI `Class` metadata and model-only safety-instruction backing tags; the validator separately catches safety/standard program task-partition scheduling mismatches while keeping realtime safety task execution/scheduling, signatures, lock state, memory partition enforcement, and safety evaluation offline-only. |
| `equipmentPhaseReviewReport` | `(project)` | Reviews model-only PhaseManager/equipment-phase instructions, resolving `EQUIPMENT_PHASE` and `PHASE_INSTRUCTION` targets, missing imports, qualified program paths, and type mismatches while keeping the phase state engine offline-only. |
| `processLoopReviewReport` | `(project)` | Reviews model-only PID/PIDE and loop/scaling/totalizer instructions, resolving block tags, PV/CV references, qualified program paths, missing imports, and type mismatches while keeping closed-loop execution unmodelled. |
| `tagConnectionReviewReport` | `(project)` | Reviews produced/consumed tag connection metadata, surfacing producer/remote-tag bindings, RPI/unicast settings, invalid consumed RPIs, invalid produce counts, program-scoped roles, and conflicting roles without opening controller connections. |
| `ioModuleReviewReport` | `(project)` | Reviews imported I/O modules, surfacing catalog/revision/keying identity, inhibit and MajorFault metadata, parent module/port topology, duplicate slots, ports, and bus sizes without opening module connections. |
| `moduleConnectionReviewReport` | `(project)` | Reviews imported I/O module connection name/type/RPI/priority/EventID/unicast metadata, duplicate names, missing/invalid RPI settings, and malformed connection rows while keeping module connections, RPI scheduling, event-triggered connection dispatch, connection priority scheduling, and unicast/multicast enforcement offline-only. |
| `addIoModule` / `updateIoModule` / `removeIoModule` | `(project, input)` | Adds common offline I/O module records, including optional catalog-seeded first connection metadata, edits selected-module catalog, slot, parent/port/path, revision/keying, inhibit, description, and first connection metadata, and removes selected modules through the controlled action layer, with duplicate name/slot, invalid RPI, and parent-with-children rejection. |
| `collectTagReferences` | `(project, tagName?)` | Cross-reference / where-used: every read/write of a tag across all ladder routines (direction from the instruction registry, with JSR/SBR/RET parameter resolution). Member/array paths resolve to their base tag; CPT/CMP expression operands are decomposed into their referenced paths. Filter by base name or by a qualified `Program:ProgramName.Tag` for program-scoped references (no mutation). |
| `createHmiAddOnGraphic` / `updateHmiAddOnGraphic` / `deleteHmiAddOnGraphic` | Add-On Graphic definition metadata, size, and exposed property interface | Edits reusable HMI Add-On Graphic definitions through the action layer; elements can then be added with `addHmiElement({ surfaceKind: "add-on-graphic", ... })`. |
| `addHmiControllerReference` / `updateHmiControllerReferenceStatus` / `removeHmiControllerReference` | Controller id, sync metadata, and status changes | Snapshots controller/program tags, UDT/AOI data types, and alarm tags into an offline View Designer-style controller reference; updates sync states such as stale/conflict/secured without any live controller communication. |
| `importProjectFile` | `(text)` | Parse `.plcproj.json`. |
| `importL5XFile` | `(text)` | Import L5X; returns `{ summary }` + warnings. |
| `exportProjectJson` | `(project)` | Serialize to `.plcproj.json` text. |

## Example: add a rung

```ts
import { addRungFromText } from "@esco/project-actions";

const result = addRungFromText(project, {
  routineId,
  text: "[XIC(StartPB),XIC(MotorRun)]XIO(StopPB)OTE(MotorRun)",
  comment: "Seal-in motor starter",
});
if (result.ok) {
  setProject(result.project);          // adopt the new project
  // result.findings -> validation after the edit
}
```

## Example: import an L5X file

```ts
import { importL5XFile } from "@esco/project-actions";

const result = importL5XFile(xmlText);
if (result.ok) {
  setProject(result.project);
  // result.data.summary -> { programs, routines, rungs, tags, unsupportedInstructions, warnings }
}
```

## Example: scan

```ts
import { defaultValues, scanProject } from "@esco/project-actions";

let values = { ...defaultValues(project), StartPB: true };
values = scanProject(project, values, { deltaMs: 1000 }).data!.values;
// values.MotorRun, values["Timer1.DN"], ...
```
