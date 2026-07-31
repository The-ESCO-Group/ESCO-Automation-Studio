# Studio 5000 v36/v37 Offline Parity

Last updated: 2026-07-09.

This is the 1:1 offline parity ledger for making ESCO Automation Studio feel like a Studio 5000 Logix Designer v36/v37 engineering cockpit while staying honest about controller boundaries. ESCO does not install or run the Logix Designer SDK here, does not open `.ACD`, and does not perform physical upload, download, online edit, force, mode-change, safety signature, controller transfer, FactoryTalk, or Linx operations.

## Reference Anchors

- Studio 5000 Logix Designer v37.00 release notes: https://www.rockwellautomation.com/en-in/docs/studio-5000-logix-designer/37-00/releasenotesmainenu-ditamap/studio-5000-logix-designer-application-release-not.html
- v37 system features: Instruction Toolbox search/insert, redundancy enhancements, and OPC UA enablement/report metadata per controller port: https://www.rockwellautomation.com/en-in/docs/studio-5000-logix-designer/37-00/releasenotesmainenu-ditamap/system-features.html
- v37 functional changes: help-source option, serial-port support removal for affected controllers, legacy mnemonic import conversion, and Import/Export version 2.28: https://www.rockwellautomation.com/en-in/docs/studio-5000-logix-designer/37-00/releasenotesmainenu-ditamap/functional-changes.html
- Studio 5000 Logix Designer v36.00.02 release notes: https://compatibility.rockwellautomation.com/GeneratedReleaseNote.aspx?o=&pdf=0&v1=63531&v2=63531
- Logix Designer SDK Getting Results Guide: https://literature.rockwellautomation.com/idc/groups/literature/documents/gr/ldsdk-gr001_-en-p.pdf

## Status Meanings

- Working: implemented as offline IDE behavior and covered by automated tests.
- Review-only: imported, exported, displayed, or validated as model metadata, but not executed against controller/hardware.
- Blocked: visible only through guarded flows; no real controller operation is attempted.
- Missing: no credible offline parity surface exists yet.

## Parity Matrix

| Area | Status | Current parity | Test evidence |
|---|---|---|---|
| Shell, ribbon, menus | Working | File/Edit/View/Search/Logic/Communications/Tools/Window/Help, compact nested File and Communications groups, standard toolbar, online toolbar, path bar, status bar, instruction toolbar | `ribbon`, `welcome`, `studio5000-parity` |
| Keyboard/mouse focus | Working | Nested menu hover/click, global shortcuts, operand context-menu focus restoration | `ribbon`, `shortcuts`, `ladderedit`, `studio5000-parity` |
| v37-style instruction search/insert | Working | Alt+Insert Add Ladder Element picker searches registry and inserts through project-actions; instruction group picker filters toolbar categories | `ladderedit`, `newinstr`, `ribbon`, `studio5000-parity` |
| New/Open/Save/Save As | Working | ESCO project JSON open/save, dirty state, recovery, close, autosave warning | `persist`, `dirtystate`, `recovery`, `welcome` |
| Project/controller properties | Working / review-only | Editable identity/source/project properties; controller tabs cover General, faults, Date/Time, Advanced, Project, Redundancy, Capacity, Port Configuration, Security, Alarm Log | `props`, `ribbon`, `welcome`, `studio5000-parity` |
| Controller Organizer tree | Working | Controllers, controller tags, tasks, programs, routines, AOIs, data types, trends, logical model, I/O configuration modules | `organizercontext`, `organizerassets`, `offline-workflows`, `studio5000-parity` |
| Ladder editing | Working | Add/delete/reorder rungs, comments, branches, nested branches, instruction palette/search, operand editing, create missing tag, diagnostics | `ladderedit`, `ladder-add-delete`, `ladderreorder`, `branchedit`, `nestedbranch`, `laddercontext`, `verifyoutput` |
| Ladder execution | Working subset | Offline scan executes supported registry instructions such as contacts/coils, timers, counters, move/compare/math/file/string subsets; model-only families are not faked | `instr`, `newinstr`, `l5x`, `arrayvalues`, unit tests |
| Structured Text | Working subset | Editable ST source with structural diagnostics and conservative offline execution subset; full Studio 5000 ST semantics still incomplete | `stsource`, `stcoverage`, unit tests |
| FBD/SFC | Review-only | Imported graphical routines are preserved/reviewed; FBD semantic review exists; no graphical execution parity | `fbdviewer`, `structuregaps` |
| Tags/data types | Working / review-only | Controller/program tags, aliases, arrays, UDTs, AOIs, radix, external access, constants, comments, engineering units, watch/trend UI | `tags`, `udtdetail`, `aoidetail`, `engineeringunits`, unit tests |
| Forces | Review-only / blocked for hardware | Offline simulation force UI exists; physical controller force operations are blocked | `forcetrace`, `ribbon`, `controller` |
| Tasks/schedules | Working offline / review-only | Periodic/continuous/event metadata, priorities, watchdogs, task scan stats, scheduler validation; no controller scheduler timing guarantee | `taskmonitor`, `taskcadence`, `taskscanstats`, unit tests |
| I/O modules | Working offline / review-only | Backplane/slot/module metadata, keying, connections, RPI metadata, catalog add/change/remove; no module connection or profile download | `iomodulecatalog`, `iodetail`, `moduleconnections`, `connectionmetadata` |
| Produced/consumed tags | Review-only | Metadata and validation preserved; no producer/consumer controller connection or RPI scheduling | unit tests, `docs/current-features.md` |
| Redundancy/security/audit/time | Review-only | Controller property tabs and import/export review reports preserve metadata; no enforcement of controller redundancy, FactoryTalk security, safety lock/signature, or time sync | `props`, unit review tests |
| v37 OPC UA enablement/report metadata | Missing / review-only boundary | Generic ESCO Online OPC UA read-only gateway scaffolding exists, but v37 controller-port OPC UA enablement/report metadata is not yet a first-class controller property/editor surface | gateway/API unit tests, `escoonline` |
| Import/export L5X | Working review-only | L5X import/export completes, preserves unsupported instructions honestly, re-imports generated L5X, and emits handoff receipt | `l5x`, `l5x-branch`, `stsource`, `persist`, `studio5000-parity` |
| Component import/export | Working | Controller/program/routine/tag/task/component packages | `component-export`, `component-import`, `routine-import`, `program-import`, `tag-import`, `task-import` |
| `.ACD` / `.L5K` | Blocked | Unsupported proprietary/binary/legacy formats are detected and refused with guidance to use L5X; no conversion is faked | `binaryguard` |
| Logix Designer SDK handoff | Review-only / blocked transfer | SDK probe/handoff receipt path is sandbox-only; installer and controller-transfer routes are not run or exposed | `packages/logix-designer-sdk`, `docs/logix-designer-sdk-handoff.md` |
| AI workflow | Working offline boundary | AI reads project state, proposes Studio-style offline edits, applies only through project-actions, and explains Studio 5000 handoff limits | `ai`, `aiagent`, unit tests |
| Offline simulation | Working subset | Scan once/run/stop, values/watch/trend, supported instruction execution, explicit model-only labels | `driver`, `readonly-monitoring`, `instr`, `l5x`, `taskcadence` |
| Real online/controller operations | Blocked | Go Online, upload, download, online edit, mode change, lock, fault clear, safety signatures, real forces, FactoryTalk/Linx operations remain guarded | `controller`, `ribbon`, `studio5000-parity` |

## Working

- Studio-style offline shell, menus, toolbar rails, path/status bars, Controller Organizer, properties dialogs, ladder/ST authoring, L5X round-trip, component interchange, AI handoff, and offline simulation subset.
- The current regression fixes make `welcome`, `ribbon`, `ladderedit`, `l5x`, and the new `studio5000-parity` driver pass locally.

## Review-only

- FBD/SFC, model-only instruction families, controller redundancy/security/audit/time-sync metadata, I/O connection metadata, produced/consumed tag metadata, safety metadata/signatures, SDK handoff receipts, and L5X export for Studio 5000 review.

## Blocked

- Physical controller upload/download, real Go Online, online edits, mode changes, real forces, clear faults, lock/unlock, safety signature operations, FactoryTalk/Linx operations, `.ACD` open/save/convert, SDK controller transfer, and installer execution.

## Missing

- First-class v37 OPC UA per-port enablement/report editor in Controller Properties.
- Firmware-faithful execution for PID/PIDE, MSG/GSV/SSV, motion, PhaseManager, GuardLogix safety, full FBD/SFC execution, and complete Studio 5000 ST semantics.
- Field-validated read-only physical controller session evidence and any approved future write/download gate.
